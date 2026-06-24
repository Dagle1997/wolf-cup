/**
 * T3-3 admin-groups router. Four endpoints (paths prefixed with /groups
 * since this router is mounted at /api/admin matching the existing
 * adminCoursesRouter + adminEventsRouter pattern):
 *
 *   GET    /groups/:groupId                       — fetch group + members
 *   PATCH  /groups/:groupId                       — edit name + visibility
 *   POST   /groups/:groupId/members               — add player (GHIN | manual)
 *   DELETE /groups/:groupId/members/:playerId     — remove player
 *
 * All four gated by requireSession → requireOrganizer. PATCH + POST also
 * have bodyLimit(4 KB) since they have request bodies; GET + DELETE have
 * no body so no bodyLimit.
 *
 * Add-by-GHIN does NOT call the GHIN client at add time — it's purely a
 * DB op (SELECT-or-race-safe-INSERT player by ghin, then INSERT
 * group_member). The race-safe pattern mirrors `lookupOrBindOAuthIdentity`
 * in auth.ts:384-464 (T1-6b).
 *
 * `manualHandicapIndex` stays NULL for GHIN-bound adds (the column is the
 * override for non-GHIN players; conflating semantics would confuse
 * downstream rendering). T3-10 (refresh-from-GHIN profile action) is the
 * future home for live-handicap display logic.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import { ghinClient } from '../lib/ghin-client.js';
import { groups, groupMembers, players } from '../db/schema/index.js';

const SAVE_BODY_LIMIT_BYTES = 4 * 1024;
const TENANT_ID = 'guyan';
const PLAYER_CONTEXT_ID = 'league:guyan-wolf-cup-friday';
// libsql constraint-violation sentinels. Two distinct cases are caught
// here together because both should map to 409 in T3-3:
//   - SQLITE_CONSTRAINT_UNIQUE (rawCode 2067): UNIQUE INDEX violation.
//     Fires for the partial-unique on players.ghin (concurrent add race).
//   - SQLITE_CONSTRAINT_PRIMARYKEY (rawCode 1555): PRIMARY KEY violation,
//     including COMPOSITE PRIMARY KEYs. Fires for the (group_id, player_id)
//     composite PK on group_members (player already in group).
const SQLITE_UNIQUE_RAW_CODE = 2067;
const SQLITE_PRIMARYKEY_RAW_CODE = 1555;

function isUniqueOrPkConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const direct = matchUniqueOrPkSentinel(err);
  if (direct) return true;
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

const PatchGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    moneyVisibilityMode: z.enum(['open', 'participant', 'self_only']).optional(),
  })
  .refine((data) => data.name !== undefined || data.moneyVisibilityMode !== undefined, {
    message: 'at least one of name or moneyVisibilityMode required',
  });

const AddMemberRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ghin'),
    ghin: z.number().int().positive(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
  }),
  z.object({
    mode: z.literal('manual'),
    name: z.string().trim().min(1),
    manualHandicapIndex: z.number().finite().min(-10).max(54).optional(),
    // Cell phone (optional). Loose validation: trim, cap length. Stored
    // as entered — normalization for SMS matching is the future bot's job.
    // An empty string after trim becomes null (treated as "not provided").
    phone: z
      .string()
      .trim()
      .max(32)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
  }),
]);

type AddMemberRequest = z.infer<typeof AddMemberRequestSchema>;

export const adminGroupsRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /groups/:groupId — fetch group + members
// ---------------------------------------------------------------------------
adminGroupsRouter.get('/groups/:groupId', requireSession, requireOrganizer, async (c) => {
  const requestId = c.get('requestId');
  const groupId = c.req.param('groupId');

  const groupRows = await db.select().from(groups).where(eq(groups.id, groupId));
  if (groupRows.length === 0) {
    return c.json({ error: 'not_found', code: 'group_not_found', requestId }, 404);
  }
  const group = groupRows[0]!;

  // Join group_members → players, ordered by player name ASC for stable
  // display.
  const memberRows = await db
    .select({
      playerId: players.id,
      name: players.name,
      ghin: players.ghin,
      manualHandicapIndex: players.manualHandicapIndex,
      preferredTeeColor: players.preferredTeeColor,
      phone: players.phone,
    })
    .from(groupMembers)
    .innerJoin(players, eq(groupMembers.playerId, players.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(players.name));

  // Resolve each member's CURRENT handicap index: live from GHIN for
  // GHIN-linked players (whose manual_handicap_index is intentionally NULL),
  // else their manual index. Parallel + fault-tolerant so one bad GHIN number
  // never blanks the roster. (The handicap-lock feature later freezes these.)
  const log = c.get('logger');
  const currentByPlayer = new Map<string, number | null>();
  await Promise.all(
    memberRows.map(async (m) => {
      if (m.ghin && ghinClient) {
        try {
          const { handicapIndex } = await ghinClient.getHandicap(Number(m.ghin));
          currentByPlayer.set(m.playerId, handicapIndex);
        } catch {
          log?.warn({ event: 'ghin_current_hi_failed', groupId, playerId: m.playerId });
          currentByPlayer.set(m.playerId, m.manualHandicapIndex ?? null);
        }
      } else {
        currentByPlayer.set(m.playerId, m.manualHandicapIndex ?? null);
      }
    }),
  );

  return c.json({
    id: group.id,
    name: group.name,
    eventId: group.eventId,
    moneyVisibilityMode: group.moneyVisibilityMode,
    members: memberRows.map((m) => ({
      ...m,
      currentHandicapIndex: currentByPlayer.get(m.playerId) ?? null,
    })),
  });
});

// ---------------------------------------------------------------------------
// PATCH /groups/:groupId — edit name + visibility
// ---------------------------------------------------------------------------
adminGroupsRouter.patch(
  '/groups/:groupId',
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
    const groupId = c.req.param('groupId');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parseResult = PatchGroupRequestSchema.safeParse(raw);
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
    const body = parseResult.data;

    // v1 visibility-mode guard: defense-in-depth at the API layer. The UI
    // also disables non-'open' options. T3-1's CHECK constraint accepts
    // all 3 values, so this guard is the only thing preventing a direct
    // API call from setting v1.5 modes prematurely.
    if (
      body.moneyVisibilityMode !== undefined &&
      body.moneyVisibilityMode !== 'open'
    ) {
      return c.json(
        { error: 'bad_request', code: 'mode_not_v1', requestId },
        400,
      );
    }

    const updates: Partial<typeof groups.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.moneyVisibilityMode !== undefined) {
      updates.moneyVisibilityMode = body.moneyVisibilityMode;
    }

    const updated = await db
      .update(groups)
      .set(updates)
      .where(eq(groups.id, groupId))
      .returning();

    if (updated.length === 0) {
      return c.json({ error: 'not_found', code: 'group_not_found', requestId }, 404);
    }

    const row = updated[0]!;
    return c.json({
      id: row.id,
      name: row.name,
      eventId: row.eventId,
      moneyVisibilityMode: row.moneyVisibilityMode,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /groups/:groupId/members — add player (GHIN or manual)
// ---------------------------------------------------------------------------
adminGroupsRouter.post(
  '/groups/:groupId/members',
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
    const groupId = c.req.param('groupId');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parseResult = AddMemberRequestSchema.safeParse(raw);
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
    const body: AddMemberRequest = parseResult.data;

    // Pre-flight: group must exist (turns FK violation into clean 404).
    // Also fetch eventId — group_members.context_id inherits the parent
    // event's context_id per T3-1 FD-6 stamping rules (`event:${eventId}`,
    // NOT `event:${groupId}`).
    const groupRows = await db
      .select({ id: groups.id, eventId: groups.eventId })
      .from(groups)
      .where(eq(groups.id, groupId));
    if (groupRows.length === 0) {
      return c.json({ error: 'not_found', code: 'group_not_found', requestId }, 404);
    }
    const groupEventId = groupRows[0]!.eventId;

    // Resolve the player_id (existing-by-ghin OR newly-inserted).
    let playerId: string;
    let playerRow: typeof players.$inferSelect;
    try {
      if (body.mode === 'ghin') {
        const resolved = await resolveOrInsertGhinPlayer(body.ghin, body.firstName, body.lastName);
        playerId = resolved.id;
        playerRow = resolved;
      } else {
        const inserted = await insertManualPlayer(
          body.name,
          body.manualHandicapIndex ?? null,
          body.phone ?? null,
        );
        playerId = inserted.id;
        playerRow = inserted;
      }
    } catch (err) {
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'admin_group_add_member_failed',
        stage: 'player_resolve',
        groupId,
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json({ error: 'internal', code: 'add_failed', requestId }, 500);
    }

    // INSERT group_member. Catch composite-PK UNIQUE → 409 player_already_in_group.
    try {
      await db.insert(groupMembers).values({
        groupId,
        playerId,
        tenantId: TENANT_ID,
        contextId: `event:${groupEventId}`, // inherits parent event's context_id (FD-6)
      });
    } catch (err) {
      if (isUniqueOrPkConstraintError(err)) {
        return c.json(
          { error: 'conflict', code: 'player_already_in_group', requestId },
          409,
        );
      }
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'admin_group_add_member_failed',
        stage: 'group_member_insert',
        groupId,
        playerId,
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json({ error: 'internal', code: 'add_failed', requestId }, 500);
    }

    log.info({
      event: 'admin_group_member_added',
      groupId,
      playerId,
      mode: body.mode,
    });

    return c.json(
      {
        player: {
          id: playerRow.id,
          name: playerRow.name,
          ghin: playerRow.ghin,
          manualHandicapIndex: playerRow.manualHandicapIndex,
          preferredTeeColor: playerRow.preferredTeeColor,
          phone: playerRow.phone,
        },
        groupMember: { groupId, playerId },
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// DELETE /groups/:groupId/members/:playerId — remove member
// ---------------------------------------------------------------------------
adminGroupsRouter.delete(
  '/groups/:groupId/members/:playerId',
  requireSession,
  requireOrganizer,
  async (c) => {
    const requestId = c.get('requestId');
    const groupId = c.req.param('groupId');
    const playerId = c.req.param('playerId');

    const result = await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, playerId)));

    // libsql .delete() returns rowsAffected on the underlying result.
    const rowsAffected = (result as { rowsAffected?: number }).rowsAffected ?? 0;
    if (rowsAffected === 0) {
      return c.json({ error: 'not_found', code: 'member_not_found', requestId }, 404);
    }

    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Race-safe resolve-or-insert for GHIN-bound players. Mirrors
 * `lookupOrBindOAuthIdentity` (auth.ts:384-464) but for the simpler case
 * of a single partial-unique column (players.ghin).
 *
 * Outer SELECT: single round-trip for returning players.
 * Inner SELECT (in tx): catches a concurrent insert that happened between
 *   the outer SELECT and the tx open.
 * INSERT: if the partial-UNIQUE on players.ghin fires (rare race within
 *   the tx), retry-SELECT to find the row the concurrent insert wrote.
 */
async function resolveOrInsertGhinPlayer(
  ghin: number,
  firstName: string,
  lastName: string,
): Promise<typeof players.$inferSelect> {
  const ghinStr = String(ghin);

  // Outer SELECT: returning-user fast path.
  const outer = await db.select().from(players).where(eq(players.ghin, ghinStr));
  if (outer[0]) return outer[0];

  // Miss: bind inside a transaction.
  return db.transaction(async (tx) => {
    const inner = await tx.select().from(players).where(eq(players.ghin, ghinStr));
    if (inner[0]) return inner[0];

    const newPlayerId = randomUUID();
    const now = Date.now();
    const fullName = `${firstName} ${lastName}`;
    try {
      await tx.insert(players).values({
        id: newPlayerId,
        isOrganizer: false,
        createdAt: now,
        name: fullName,
        ghin: ghinStr,
        manualHandicapIndex: null,
        preferredTeeColor: null,
        phone: null,
        tenantId: TENANT_ID,
        contextId: PLAYER_CONTEXT_ID,
      });
      const just = await tx.select().from(players).where(eq(players.id, newPlayerId));
      return just[0]!;
    } catch (err) {
      // UNIQUE on partial index fires if a concurrent first-add wrote
      // the same ghin between our inner SELECT and INSERT.
      if (!isUniqueOrPkConstraintError(err)) throw err;
      const retry = await tx.select().from(players).where(eq(players.ghin, ghinStr));
      if (retry[0]) return retry[0];
      // Pathological: UNIQUE fired but no row exists. Bubble.
      throw new Error('ghin_resolve_race_retry_empty');
    }
  });
}

async function insertManualPlayer(
  name: string,
  manualHandicapIndex: number | null,
  phone: string | null,
): Promise<typeof players.$inferSelect> {
  const newPlayerId = randomUUID();
  const now = Date.now();
  await db.insert(players).values({
    id: newPlayerId,
    isOrganizer: false,
    createdAt: now,
    name,
    ghin: null,
    manualHandicapIndex,
    preferredTeeColor: null,
    phone,
    tenantId: TENANT_ID,
    contextId: PLAYER_CONTEXT_ID,
  });
  const just = await db.select().from(players).where(eq(players.id, newPlayerId));
  return just[0]!;
}
