/**
 * T5-11 event-scoped rule-set revision endpoint.
 *
 * Mount: `app.route('/api/events', eventRuleEditsRouter)`. Effective URL:
 *   POST /api/events/:eventId/rule-sets/:ruleSetId/revisions
 *
 * Complementary to T3-5's `/api/admin/rule-sets/:id/revisions`:
 *   - T3-5: setup-time rule-set library edits (no event scope; effective_from
 *     = (null, 1); global requireOrganizer; no activity emit; no freeze guard).
 *   - T5-11: mid-event corrections with effective-hole boundary (per-event
 *     organizer auth; activity emit; frozen-round freeze guard).
 *
 * Structural reference: admin-rule-sets.ts:321-444 (revision-insert pattern,
 * MAX(revision_number) + 1, FD-8 immutable history, UNIQUE(rule_set_id,
 * revision_number) safety net).
 *
 * Auth model (T5-7/T5-8/T5-9 pattern): per-event organizer ONLY (NOT global
 * `requireOrganizer`, NOT scorer-of-any-foursome). Auth runs INSIDE
 * `db.transaction` BEFORE state reads + existence checks (no-existence-leak
 * invariant: nonexistent eventId → 403, NOT 404).
 *
 * Frozen-round freeze-window: if any event_round in the affected window has
 * a `rounds` row whose `round_states.state == 'finalized'`, the edit is
 * rejected with 422 `rule_edit_would_recompute_finalized_round` and a
 * `frozenRoundIds` array of the offending event_rounds.id values (NOT
 * rounds.id — clients drive UI off event_rounds).
 *
 * T6 money recompute: not yet shipped. v1 emits a post-commit breadcrumb
 * (`rule_revision_pending_t6_recompute`); followup T5-11a swaps in the real
 * dispatcher when T6-9/T6-13 lands.
 *
 * Architectural note (rule_sets-as-library): T3-1 models rule_sets as a
 * tenant-scoped library with NO rule_sets→events FK. v1 ships a loose
 * tenant-scoped existence check for `:ruleSetId`; followup T5-11e tightens
 * via an `event_rule_set_links` table once T3-2 wizard populates it.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  eventRounds,
  roundStates,
  rounds,
  ruleSetRevisions,
  ruleSets,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import {
  BusinessRuleError,
  isEventOrganizerByEventId,
} from '../services/round-state.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const eventRuleEditBodySchema = z.object({
  configJson: z.object({}).passthrough(),
  effectiveFromRoundId: z.string().uuid(),
  effectiveFromHole: z.number().int().min(1).max(19),
  reason: z.string().max(500).optional(),
});

export const eventRuleEditsRouter = new Hono();

eventRuleEditsRouter.post(
  '/:eventId/rule-sets/:ruleSetId/revisions',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId');
    const ruleSetId = c.req.param('ruleSetId');

    // Path UUID validation.
    if (!eventId || !UUID_RE.test(eventId)) {
      return c.json(
        { error: 'bad_request', code: 'invalid_event_id', requestId },
        400,
      );
    }
    if (!ruleSetId || !UUID_RE.test(ruleSetId)) {
      return c.json(
        { error: 'bad_request', code: 'invalid_rule_set_id', requestId },
        400,
      );
    }

    // Body parse + Zod.
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'malformed_json', requestId },
        400,
      );
    }
    const parsed = eventRuleEditBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          code: 'invalid_body',
          issues: parsed.error.issues,
          requestId,
        },
        400,
      );
    }
    const body = parsed.data;

    let revisionContext: {
      revisionId: string;
      revisionNumber: number;
    } | null = null;

    try {
      const result = await db.transaction(async (tx) => {
        // (i) Auth FIRST. No-existence-leak invariant: nonexistent eventId →
        // FALSE → 403 (NOT 404).
        const authed = await isEventOrganizerByEventId(
          tx,
          eventId,
          player.id,
          TENANT_ID,
        );
        if (!authed) {
          throw new BusinessRuleError(
            'not_authorized_for_rule_edit',
            'caller is not the per-event organizer',
            403,
          );
        }

        // (ii) Rule-set scope check (loose tenant-scoped per AC-2(ii)).
        // Followup T5-11e tightens via an event_rule_set_links table.
        const ruleSetRows = await tx
          .select({ id: ruleSets.id })
          .from(ruleSets)
          .where(
            and(
              eq(ruleSets.id, ruleSetId),
              eq(ruleSets.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (ruleSetRows.length === 0) {
          throw new BusinessRuleError(
            'rule_set_not_found',
            'rule_set does not exist in tenant scope',
            404,
          );
        }

        // (iii) Boundary validation: anchor round must exist + belong to
        // this event.
        const anchorRows = await tx
          .select({
            id: eventRounds.id,
            eventId: eventRounds.eventId,
            roundNumber: eventRounds.roundNumber,
          })
          .from(eventRounds)
          .where(
            and(
              eq(eventRounds.id, body.effectiveFromRoundId),
              eq(eventRounds.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (anchorRows.length === 0) {
          throw new BusinessRuleError(
            'effective_from_round_not_found',
            'effectiveFromRoundId does not reference a known event_round',
            422,
          );
        }
        const anchor = anchorRows[0]!;
        if (anchor.eventId !== eventId) {
          throw new BusinessRuleError(
            'round_not_in_event',
            'effectiveFromRoundId belongs to a different event',
            422,
          );
        }

        // (iv) Frozen-round freeze-window.
        //
        // Affected window of event_round.id values:
        //   - hole 1..18 → anchor + every event_round with round_number > anchor.round_number
        //   - hole 19    → every event_round with round_number > anchor.round_number
        //                  (anchor itself NOT included; boundary is between anchor and anchor+1)
        const includeAnchor = body.effectiveFromHole !== 19;
        const successorRows = await tx
          .select({ id: eventRounds.id })
          .from(eventRounds)
          .where(
            and(
              eq(eventRounds.eventId, eventId),
              eq(eventRounds.tenantId, TENANT_ID),
              gt(eventRounds.roundNumber, anchor.roundNumber),
            ),
          );
        const affectedEventRoundIds = includeAnchor
          ? [anchor.id, ...successorRows.map((r) => r.id)]
          : successorRows.map((r) => r.id);

        // For each event_round in the window, look up whether a rounds row
        // exists AND whether its state is 'finalized'. event_rounds without
        // an associated rounds row are treated as not-finalized (no scores
        // to recompute). round_states.round_id is a PK so today the join
        // produces at most one row per rounds row, but we dedupe defensively
        // — schema drift or data corruption could otherwise leak duplicate
        // ids into the response.
        const frozenRoundIdSet = new Set<string>();
        if (affectedEventRoundIds.length > 0) {
          const frozenRows = await tx
            .select({ eventRoundId: rounds.eventRoundId })
            .from(rounds)
            .innerJoin(roundStates, eq(roundStates.roundId, rounds.id))
            .where(
              and(
                inArray(rounds.eventRoundId, affectedEventRoundIds),
                eq(rounds.tenantId, TENANT_ID),
                eq(roundStates.tenantId, TENANT_ID),
                eq(roundStates.state, 'finalized'),
              ),
            );
          for (const r of frozenRows) {
            if (r.eventRoundId !== null) frozenRoundIdSet.add(r.eventRoundId);
          }
        }
        const frozenRoundIds = Array.from(frozenRoundIdSet);

        if (frozenRoundIds.length > 0) {
          const err = new BusinessRuleError(
            'rule_edit_would_recompute_finalized_round',
            `${frozenRoundIds.length} finalized round(s) in affected window`,
            422,
          );
          (err as unknown as { frozenRoundIds: string[] }).frozenRoundIds =
            frozenRoundIds;
          throw err;
        }

        // (v) Compute next revision_number for this rule_set. SQLite
        // deferred isolation can produce the same value under concurrent
        // edits; UNIQUE(rule_set_id, revision_number) is the safety net
        // (handler returns 500 with breadcrumb log on collision — same
        // posture as T3-5).
        const maxRows = await tx
          .select({ revisionNumber: ruleSetRevisions.revisionNumber })
          .from(ruleSetRevisions)
          .where(
            and(
              eq(ruleSetRevisions.ruleSetId, ruleSetId),
              eq(ruleSetRevisions.tenantId, TENANT_ID),
            ),
          )
          .orderBy(desc(ruleSetRevisions.revisionNumber))
          .limit(1);
        const fromRevisionNumber = maxRows[0]?.revisionNumber ?? 0;
        const toRevisionNumber = fromRevisionNumber + 1;

        // (vi) Read prior revision's configJson for the audit diff.
        let priorConfig: unknown = null;
        if (fromRevisionNumber > 0) {
          const priorRows = await tx
            .select({ configJson: ruleSetRevisions.configJson })
            .from(ruleSetRevisions)
            .where(
              and(
                eq(ruleSetRevisions.ruleSetId, ruleSetId),
                eq(ruleSetRevisions.revisionNumber, fromRevisionNumber),
                eq(ruleSetRevisions.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          if (priorRows.length > 0) {
            try {
              priorConfig = JSON.parse(priorRows[0]!.configJson);
            } catch {
              priorConfig = null;
            }
          }
        }

        // (vii) Insert revision row.
        const revisionId = randomUUID();
        const now = Date.now();
        await tx.insert(ruleSetRevisions).values({
          id: revisionId,
          ruleSetId,
          revisionNumber: toRevisionNumber,
          configJson: JSON.stringify(body.configJson),
          effectiveFromRoundId: body.effectiveFromRoundId,
          effectiveFromHole: body.effectiveFromHole,
          createdByPlayerId: player.id,
          reason: body.reason ?? null,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: `event:${eventId}`,
        });

        // (viii) Audit row (NEW event type).
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.RULE_SET_REVISED,
          entityType: AUDIT_ENTITY_TYPES.RULE_SET,
          entityId: ruleSetId,
          actorPlayerId: player.id,
          payload: {
            eventId,
            ruleSetId,
            revisionId,
            fromRevisionNumber,
            toRevisionNumber,
            effectiveFromRoundId: body.effectiveFromRoundId,
            effectiveFromHole: body.effectiveFromHole,
            reason: body.reason ?? null,
            priorConfig,
            newConfig: body.configJson,
          },
        });

        // (ix) Activity emit (v1 NO-OP per lib/activity.ts; T8 fills the body).
        // configDiffSummary is null in v1 — T8's activity-spine consumer will
        // compute the human-readable diff from priorConfig + newConfig at
        // banner-render time. The audit row already carries both configs.
        await emitActivity(tx, {
          type: 'rule_set.revised',
          actorPlayerId: player.id,
          scope: { eventId },
          payload: {
            ruleSetId,
            revisionId,
            effectiveFromRoundId: body.effectiveFromRoundId,
            effectiveFromHole: body.effectiveFromHole,
            configDiffSummary: null,
          },
        });

        return {
          revisionId,
          revisionNumber: toRevisionNumber,
        };
      });

      revisionContext = result;

      // Post-commit T6 breadcrumb. Logged outside the tx so a rolled-back
      // tx can't emit a misleading recompute-pending line.
      log.info({
        msg: 'rule_revision_pending_t6_recompute',
        event: 'rule_revision_pending_t6_recompute',
        requestId,
        eventId,
        ruleSetId,
        revisionId: result.revisionId,
        effectiveFromRoundId: body.effectiveFromRoundId,
        effectiveFromHole: body.effectiveFromHole,
      });

      return c.json(
        {
          ok: true,
          revisionId: result.revisionId,
          revisionNumber: result.revisionNumber,
          effectiveFromRoundId: body.effectiveFromRoundId,
          effectiveFromHole: body.effectiveFromHole,
          requestId,
        },
        200,
      );
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        const body: Record<string, unknown> = {
          error:
            err.status === 403
              ? 'forbidden'
              : err.status === 404
                ? 'not_found'
                : 'unprocessable',
          code: err.code,
          requestId,
        };
        const frozenRoundIds = (err as unknown as {
          frozenRoundIds?: unknown;
        }).frozenRoundIds;
        if (frozenRoundIds !== undefined) {
          body['frozenRoundIds'] = frozenRoundIds;
        }
        return c.json(body, err.status as 403 | 404 | 422);
      }
      log.error({
        msg: '/rule-sets revisions threw',
        requestId,
        eventId,
        ruleSetId,
        err: String(err),
        revisionContext,
      });
      return c.json(
        { error: 'internal', code: 'rule_edit_failed', requestId },
        500,
      );
    }
  },
);

