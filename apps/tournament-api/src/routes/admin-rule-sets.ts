/**
 * T3-5 admin-rule-sets router. Three endpoints (paths prefixed with
 * /rule-sets since this router is mounted at /api/admin matching
 * adminCoursesRouter / adminEventsRouter / adminGroupsRouter):
 *
 *   POST   /rule-sets                     — create rule_set + initial revision
 *   GET    /rule-sets/:id                 — fetch rule_set + latest revision
 *   POST   /rule-sets/:id/revisions       — append new revision (FD-8 immutable history)
 *
 * All gated by requireSession → requireOrganizer. POST endpoints have
 * bodyLimit(8 KB); GET has no bodyLimit.
 *
 * **FD-8 immutability:** existing rule_set_revisions rows are NEVER updated.
 * Every save creates a new row with revision_number = max+1. Composite UNIQUE
 * on (rule_set_id, revision_number) is the safety net for concurrent saves;
 * SELECT MAX + INSERT is wrapped in a tx for atomicity (SQLite deferred
 * isolation still allows same-revision_number race; UNIQUE → 409 catches it).
 *
 * **Two-stage parse on GET:** JSON.parse(configJson) → RuleSetConfigSchema
 * .safeParse(parsed). Distinct 500 codes (corrupt_config_json vs corrupt_config_shape)
 * for the two failure modes; defense-in-depth against stored-data drift.
 *
 * **Tenant-scoping posture:** v1 single-tenant 'guyan'; queries do NOT add
 * `WHERE tenant_id = ?` filters (matches courses.ts:39-43 + T3-1 acknowledged
 * gap). Multi-tenant hardening is a future coordinated story.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import { ruleSets, ruleSetRevisions } from '../db/schema/index.js';

const SAVE_BODY_LIMIT_BYTES = 8 * 1024;
const TENANT_ID = 'guyan';
const LIBRARY_CONTEXT_ID = 'library:guyan';
const SQLITE_UNIQUE_RAW_CODE = 2067;
const SQLITE_PRIMARYKEY_RAW_CODE = 1555;

function isUniqueOrPkConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (matchUniqueOrPkSentinel(err)) return true;
  const cause = (err as { cause?: unknown }).cause;
  return matchUniqueOrPkSentinel(cause);
}

function matchUniqueOrPkSentinel(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; extendedCode?: unknown; rawCode?: unknown };
  return (
    e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.rawCode === SQLITE_UNIQUE_RAW_CODE ||
    e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    e.extendedCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    e.rawCode === SQLITE_PRIMARYKEY_RAW_CODE
  );
}

/**
 * The contract for a rule_set_revisions.config_json blob. EXACTLY mirrored
 * in the frontend wizard (admin.rule-sets.$id.edit.tsx). Two copies, no
 * shared package — preserves the no-SHARED posture.
 *
 * The .refine pins the FD-12 carryover↔validation invariant: when
 * carryover=true, validation MUST be '2-putt'; when carryover=false,
 * validation MUST be 'none'. The frontend's identical refine prevents
 * invalid combos at the UI layer; the backend's is defense-in-depth.
 */
export const RuleSetConfigSchema = z
  .object({
    sandies: z.boolean(),
    autoPress: z.object({
      enabled: z.boolean(),
      downN: z.number().int().min(1).max(4),
      multiplier: z.number().positive().finite(),
    }),
    greenies: z.object({
      carryover: z.boolean(),
      validation: z.enum(['none', '2-putt']),
    }),
    individualBet: z.object({
      matchPlayPerHoleCents: z.number().int().nonnegative(),
      autoPressDownN: z.number().int().min(1).max(4).optional(),
    }),
    subGames: z.object({
      defaultBuyInPerParticipantCents: z.number().int().nonnegative(),
    }),
  })
  .refine(
    (data) =>
      (data.greenies.carryover === true && data.greenies.validation === '2-putt') ||
      (data.greenies.carryover === false && data.greenies.validation === 'none'),
    {
      path: ['greenies', 'validation'],
      message: 'greenie_validation must be "2-putt" when carryover=true, else "none"',
    },
  );

export type RuleSetConfig = z.infer<typeof RuleSetConfigSchema>;

const CreateRuleSetRequestSchema = z.object({
  name: z.string().trim().min(1),
});

/**
 * Defaults for a brand-new rule_set's revision 1. Baseline 2v2 config:
 * sandies on, auto-press at N=2 with 2x multiplier, greenies carryover off
 * (FD-12), $1/hole match-play default, no sub-game buy-in.
 */
function defaultConfig(): RuleSetConfig {
  return {
    sandies: true,
    autoPress: { enabled: true, downN: 2, multiplier: 2 },
    greenies: { carryover: false, validation: 'none' },
    individualBet: { matchPlayPerHoleCents: 100 },
    subGames: { defaultBuyInPerParticipantCents: 0 },
  };
}

export const adminRuleSetsRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /rule-sets — create rule_set + revision 1
// ---------------------------------------------------------------------------
adminRuleSetsRouter.post(
  '/rule-sets',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_request', code: 'body_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parseResult = CreateRuleSetRequestSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parseResult.error.issues,
        },
        400,
      );
    }

    const ruleSetId = randomUUID();
    const revisionId = randomUUID();
    const now = Date.now();
    const config = defaultConfig();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(ruleSets).values({
          id: ruleSetId,
          name: parseResult.data.name,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });
        await tx.insert(ruleSetRevisions).values({
          id: revisionId,
          ruleSetId,
          revisionNumber: 1,
          configJson: JSON.stringify(config),
          effectiveFromRoundId: null,
          effectiveFromHole: 1,
          createdByPlayerId: c.get('player')!.id,
          reason: null,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });
      });
    } catch (err) {
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'admin_rule_set_create_failed',
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json(
        { error: 'internal', code: 'create_failed', requestId },
        500,
      );
    }

    log.info({
      event: 'admin_rule_set_created',
      ruleSetId,
      name: parseResult.data.name,
    });

    return c.json(
      { ruleSetId, revisionId, revisionNumber: 1, requestId },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// GET /rule-sets/:id — fetch rule_set + latest revision
// ---------------------------------------------------------------------------
adminRuleSetsRouter.get('/rule-sets/:id', requireSession, requireOrganizer, async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');
  const ruleSetId = c.req.param('id');

  const ruleSetRows = await db.select().from(ruleSets).where(eq(ruleSets.id, ruleSetId));
  if (ruleSetRows.length === 0) {
    return c.json(
      { error: 'not_found', code: 'rule_set_not_found', requestId },
      404,
    );
  }
  const ruleSet = ruleSetRows[0]!;

  const revisionRows = await db
    .select()
    .from(ruleSetRevisions)
    .where(eq(ruleSetRevisions.ruleSetId, ruleSetId))
    .orderBy(desc(ruleSetRevisions.revisionNumber))
    .limit(1);

  // Zero-revisions case (pathological — POST /rule-sets atomically creates
  // revision 1; only reachable via direct DB tampering). Return 200 with
  // null + warn log; UI handles by showing defaults + a banner.
  if (revisionRows.length === 0) {
    log.warn({
      event: 'rule_set_zero_revisions',
      ruleSetId,
    });
    return c.json({
      id: ruleSet.id,
      name: ruleSet.name,
      createdAt: ruleSet.createdAt,
      latestRevision: null,
      requestId,
    });
  }

  const rev = revisionRows[0]!;

  // Two-stage parse: JSON.parse + RuleSetConfigSchema.safeParse. Defense
  // against stored-data drift (e.g., schema added a field but old row
  // lacks it). Two distinct 500 codes for the two failure modes.
  let configRaw: unknown;
  try {
    configRaw = JSON.parse(rev.configJson);
  } catch (err) {
    const e = err as { message?: unknown } | null;
    log.error({
      event: 'rule_set_corrupt_config_json',
      ruleSetId,
      revisionId: rev.id,
      message: e?.message ?? null,
    });
    return c.json(
      { error: 'internal', code: 'corrupt_config_json', requestId },
      500,
    );
  }
  const shapeResult = RuleSetConfigSchema.safeParse(configRaw);
  if (!shapeResult.success) {
    log.error({
      event: 'rule_set_corrupt_config_shape',
      ruleSetId,
      revisionId: rev.id,
      issues: shapeResult.error.issues,
    });
    return c.json(
      { error: 'internal', code: 'corrupt_config_shape', requestId },
      500,
    );
  }

  return c.json({
    id: ruleSet.id,
    name: ruleSet.name,
    createdAt: ruleSet.createdAt,
    latestRevision: {
      id: rev.id,
      revisionNumber: rev.revisionNumber,
      configJson: shapeResult.data, // deserialized object (despite the field name)
      effectiveFromRoundId: rev.effectiveFromRoundId,
      effectiveFromHole: rev.effectiveFromHole,
      createdByPlayerId: rev.createdByPlayerId,
      createdAt: rev.createdAt,
    },
    requestId,
  });
});

// ---------------------------------------------------------------------------
// POST /rule-sets/:id/revisions — append new revision (FD-8)
// ---------------------------------------------------------------------------
adminRuleSetsRouter.post(
  '/rule-sets/:id/revisions',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_request', code: 'body_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const ruleSetId = c.req.param('id');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parseResult = RuleSetConfigSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parseResult.error.issues,
        },
        400,
      );
    }

    // Pre-flight: rule_set must exist (turns FK violation into clean 404).
    const ruleSetRows = await db
      .select({ id: ruleSets.id })
      .from(ruleSets)
      .where(eq(ruleSets.id, ruleSetId));
    if (ruleSetRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'rule_set_not_found', requestId },
        404,
      );
    }

    const revisionId = randomUUID();
    const now = Date.now();

    let nextRevisionNumber: number;
    try {
      // Wrap MAX-SELECT + INSERT in a tx for atomicity. SQLite's deferred
      // isolation still allows concurrent transactions to compute the
      // SAME nextRevisionNumber; UNIQUE on (rule_set_id, revision_number)
      // is the safety net.
      nextRevisionNumber = await db.transaction(async (tx) => {
        const maxRows = await tx
          .select({ revisionNumber: ruleSetRevisions.revisionNumber })
          .from(ruleSetRevisions)
          .where(eq(ruleSetRevisions.ruleSetId, ruleSetId))
          .orderBy(desc(ruleSetRevisions.revisionNumber))
          .limit(1);
        const computedNext = (maxRows[0]?.revisionNumber ?? 0) + 1;

        await tx.insert(ruleSetRevisions).values({
          id: revisionId,
          ruleSetId,
          revisionNumber: computedNext,
          configJson: JSON.stringify(parseResult.data),
          effectiveFromRoundId: null,
          effectiveFromHole: 1,
          createdByPlayerId: c.get('player')!.id,
          reason: null,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });
        return computedNext;
      });
    } catch (err) {
      if (isUniqueOrPkConstraintError(err)) {
        return c.json(
          {
            error: 'conflict',
            code: 'revision_number_conflict',
            requestId,
          },
          409,
        );
      }
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'admin_rule_set_revision_save_failed',
        ruleSetId,
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json(
        { error: 'internal', code: 'save_failed', requestId },
        500,
      );
    }

    log.info({
      event: 'admin_rule_set_revision_created',
      ruleSetId,
      revisionId,
      revisionNumber: nextRevisionNumber,
    });

    return c.json(
      { revisionId, revisionNumber: nextRevisionNumber, requestId },
      201,
    );
  },
);
