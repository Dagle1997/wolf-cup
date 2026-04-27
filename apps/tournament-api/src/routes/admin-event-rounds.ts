/**
 * T3-9 admin-event-rounds router. Two endpoints (paths prefixed with
 * /event-rounds since this router is mounted at /api/admin matching
 * adminCoursesRouter / adminEventsRouter / adminGroupsRouter / adminRuleSetsRouter):
 *
 *   GET    /event-rounds/:eventRoundId/sub-games   — fetch event_round + event + roster + existing config
 *   POST   /event-rounds/:eventRoundId/sub-games   — upsert opt-in config (DELETE-then-INSERT in tx)
 *
 * Both gated by requireSession → requireOrganizer. POST has bodyLimit(8 KB);
 * GET has no bodyLimit.
 *
 * **5th /api/admin mount.** Per Winston's review threshold note across
 * T3-3/T3-5/T3-6, T3-9 is the threshold case for promoting an umbrella
 * adminRouter. T3-9 holds the existing pattern; promotion is a future
 * scope-disciplined refactor story.
 *
 * **v1 enables `skins` only.** The schema CHECK accepts all 4 sub-game
 * types (`skins`/`ctp`/`sandies`/`putting_contest`) for forward-compat with
 * v1.5; T3-9 backend rejects the 3 non-skins types with 400
 * `sub_game_type_not_enabled` to prevent inert config rows that the
 * UI's disabled-section design wouldn't allow organizers to clear.
 * Mirror of admin-groups' v1 guard on `money_visibility_mode`.
 *
 * **Upsert (DELETE-then-INSERT inside a transaction):** re-saving the form
 * replaces existing config for that event_round_id, not deltas. Idempotent
 * under retry; the composite PK on `(sub_game_id, player_id)` makes per-row
 * diffs delicate, so the upsert eliminates that surface area.
 *
 * **Error code precedence (deterministic):** validation failures are checked
 * in this exact order — first match wins:
 *   1. `invalid_body` (400) — Zod parse fails.
 *   2. `event_round_not_found` (404) — :eventRoundId doesn't exist OR foreign tenant.
 *   3. `sub_game_type_not_enabled` (400) — non-skins type in v1.
 *   4. `duplicate_sub_game_type` (400) — two entries with the same type.
 *   5. `duplicate_participant` (400) — duplicate playerId in any participantPlayerIds.
 *   6. `player_not_in_event` (400) — playerId not in any group_member under the event.
 *
 * **Tenant scoping (NEW code only):** every SELECT/UPDATE/DELETE on
 * sub_games / sub_game_participants / event_rounds / events / groups /
 * group_members filters on `tenant_id = TENANT_ID`. Defense-in-depth for
 * v1.5+ multi-tenant. Pre-T3-7 admin routes (T3-2/T3-3/T3-5) are NOT
 * tenant-scoped — separate retrofit followup.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import {
  eventRounds,
  events,
  groups,
  groupMembers,
  players,
  subGames,
  subGameParticipants,
} from '../db/schema/index.js';

const SAVE_BODY_LIMIT_BYTES = 8 * 1024;
const TENANT_ID = 'guyan';

// v1 sub-game type allowlist. v1.5+ enabling = add types to this set; no
// schema migration required (the schema CHECK already accepts all 4).
const V1_ENABLED_SUB_GAME_TYPES = new Set(['skins'] as const);
const ALL_SUB_GAME_TYPES = ['skins', 'ctp', 'sandies', 'putting_contest'] as const;
type SubGameType = (typeof ALL_SUB_GAME_TYPES)[number];

const PostSubGamesRequestSchema = z.object({
  subGames: z.array(
    z.object({
      type: z.enum(ALL_SUB_GAME_TYPES),
      buyInPerParticipant: z.number().int().nonnegative(),
      participantPlayerIds: z.array(z.string().min(1)),
    }),
  ),
});

export const adminEventRoundsRouter = new Hono();

adminEventRoundsRouter.use('/event-rounds/*', requireSession);
adminEventRoundsRouter.use('/event-rounds/*', requireOrganizer);

// ---------------------------------------------------------------------
// GET /event-rounds/:eventRoundId/sub-games
// ---------------------------------------------------------------------
adminEventRoundsRouter.get('/event-rounds/:eventRoundId/sub-games', async (c) => {
  const requestId = c.get('requestId');
  const eventRoundId = c.req.param('eventRoundId');

  const erRows = await db
    .select()
    .from(eventRounds)
    .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, TENANT_ID)));
  if (erRows.length === 0) {
    return c.json(
      { error: 'not_found', code: 'event_round_not_found', requestId },
      404,
    );
  }
  const eventRound = erRows[0]!;

  const eventRows = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(and(eq(events.id, eventRound.eventId), eq(events.tenantId, TENANT_ID)));
  if (eventRows.length === 0) {
    return c.json(
      { error: 'internal', code: 'event_missing', requestId },
      500,
    );
  }
  const event = eventRows[0]!;

  // Roster: dedupe across groups under this event. Mirror T3-6 invites.ts.
  const groupRows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.eventId, event.id), eq(groups.tenantId, TENANT_ID)));
  const groupIds = groupRows.map((g) => g.id);
  const roster: Array<{ playerId: string; name: string }> = [];
  if (groupIds.length > 0) {
    const memberRows = await db
      .select({ playerId: players.id, name: players.name })
      .from(groupMembers)
      .innerJoin(players, eq(groupMembers.playerId, players.id))
      .where(
        and(
          inArray(groupMembers.groupId, groupIds),
          eq(groupMembers.tenantId, TENANT_ID),
          eq(players.tenantId, TENANT_ID),
        ),
      )
      .orderBy(asc(players.name));
    const seen = new Set<string>();
    for (const row of memberRows) {
      if (!seen.has(row.playerId)) {
        seen.add(row.playerId);
        roster.push(row);
      }
    }
  }

  // Existing sub-games + participants for this round.
  const existingSubGames = await db
    .select()
    .from(subGames)
    .where(
      and(
        eq(subGames.eventRoundId, eventRoundId),
        eq(subGames.tenantId, TENANT_ID),
      ),
    );

  const subGameOut: Array<{
    type: SubGameType;
    buyInPerParticipant: number;
    participantPlayerIds: string[];
  }> = [];
  for (const sg of existingSubGames) {
    const participantRows = await db
      .select({ playerId: subGameParticipants.playerId })
      .from(subGameParticipants)
      .where(
        and(
          eq(subGameParticipants.subGameId, sg.id),
          eq(subGameParticipants.tenantId, TENANT_ID),
        ),
      )
      .orderBy(asc(subGameParticipants.playerId));
    subGameOut.push({
      type: sg.type as SubGameType,
      buyInPerParticipant: sg.buyInPerParticipant,
      participantPlayerIds: participantRows.map((r) => r.playerId),
    });
  }

  return c.json({
    eventRound: {
      id: eventRound.id,
      eventId: eventRound.eventId,
      roundNumber: eventRound.roundNumber,
      roundDate: eventRound.roundDate,
    },
    event: { id: event.id, name: event.name },
    roster,
    subGames: subGameOut,
    requestId,
  });
});

// ---------------------------------------------------------------------
// POST /event-rounds/:eventRoundId/sub-games
// ---------------------------------------------------------------------
adminEventRoundsRouter.post(
  '/event-rounds/:eventRoundId/sub-games',
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
    const eventRoundId = c.req.param('eventRoundId');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    // Step 1 — Zod parse.
    const parsed = PostSubGamesRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parsed.error.issues,
        },
        400,
      );
    }
    const body = parsed.data;

    // Step 2 — event_round existence + tenant.
    const erRows = await db
      .select({ id: eventRounds.id, eventId: eventRounds.eventId })
      .from(eventRounds)
      .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, TENANT_ID)));
    if (erRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'event_round_not_found', requestId },
        404,
      );
    }
    const er = erRows[0]!;

    // Step 3 — sub_game_type_not_enabled (v1 rejects non-skins).
    for (const entry of body.subGames) {
      if (!V1_ENABLED_SUB_GAME_TYPES.has(entry.type as 'skins')) {
        return c.json(
          {
            error: 'bad_request',
            code: 'sub_game_type_not_enabled',
            requestId,
            type: entry.type,
          },
          400,
        );
      }
    }

    // Step 4 — duplicate_sub_game_type.
    const seenTypes = new Set<string>();
    for (const entry of body.subGames) {
      if (seenTypes.has(entry.type)) {
        return c.json(
          {
            error: 'bad_request',
            code: 'duplicate_sub_game_type',
            requestId,
            type: entry.type,
          },
          400,
        );
      }
      seenTypes.add(entry.type);
    }

    // Step 5 — duplicate_participant within an entry.
    for (const entry of body.subGames) {
      const seenPlayers = new Set<string>();
      for (const pid of entry.participantPlayerIds) {
        if (seenPlayers.has(pid)) {
          return c.json(
            {
              error: 'bad_request',
              code: 'duplicate_participant',
              requestId,
              type: entry.type,
              playerId: pid,
            },
            400,
          );
        }
        seenPlayers.add(pid);
      }
    }

    // Step 6 — player_not_in_event. Pre-flight one SELECT against the
    // event's group_members for the union of all participantPlayerIds.
    const allParticipants = new Set<string>();
    for (const entry of body.subGames) {
      for (const pid of entry.participantPlayerIds) {
        allParticipants.add(pid);
      }
    }
    if (allParticipants.size > 0) {
      const groupRows = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.eventId, er.eventId), eq(groups.tenantId, TENANT_ID)));
      const groupIds = groupRows.map((g) => g.id);
      if (groupIds.length === 0) {
        // No groups under this event → no valid participants possible.
        return c.json(
          {
            error: 'bad_request',
            code: 'player_not_in_event',
            requestId,
            playerId: [...allParticipants][0],
          },
          400,
        );
      }
      const validRows = await db
        .select({ playerId: groupMembers.playerId })
        .from(groupMembers)
        .where(
          and(
            inArray(groupMembers.groupId, groupIds),
            inArray(groupMembers.playerId, [...allParticipants]),
            eq(groupMembers.tenantId, TENANT_ID),
          ),
        );
      const validIds = new Set(validRows.map((r) => r.playerId));
      for (const pid of allParticipants) {
        if (!validIds.has(pid)) {
          return c.json(
            {
              error: 'bad_request',
              code: 'player_not_in_event',
              requestId,
              playerId: pid,
            },
            400,
          );
        }
      }
    }

    // Upsert in a transaction. DELETE existing sub_games for this round
    // (sub_game_participants cascade-delete via FK). Then INSERT new rows.
    const expectedContextId = `event:${er.eventId}`;
    const now = Date.now();
    let subGameCount = 0;
    let participantCount = 0;

    try {
      await db.transaction(async (tx) => {
        await tx
          .delete(subGames)
          .where(
            and(
              eq(subGames.eventRoundId, eventRoundId),
              eq(subGames.tenantId, TENANT_ID),
            ),
          );

        for (const entry of body.subGames) {
          const sgId = randomUUID();
          await tx.insert(subGames).values({
            id: sgId,
            eventRoundId,
            type: entry.type,
            configJson: '{}',
            buyInPerParticipant: entry.buyInPerParticipant,
            createdAt: now,
            tenantId: TENANT_ID,
            contextId: expectedContextId,
          });
          subGameCount += 1;

          for (const pid of entry.participantPlayerIds) {
            await tx.insert(subGameParticipants).values({
              subGameId: sgId,
              playerId: pid,
              optedInAt: now,
              tenantId: TENANT_ID,
              contextId: expectedContextId,
            });
            participantCount += 1;
          }
        }
      });
    } catch (err) {
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'sub_game_upsert_failed',
        eventRoundId,
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json(
        { error: 'internal', code: 'upsert_failed', requestId },
        500,
      );
    }

    log.info({
      event: 'sub_game_upserted',
      eventRoundId,
      eventId: er.eventId,
      subGameCount,
      participantCount,
    });

    return c.json({ subGameCount, participantCount, requestId }, 200);
  },
);
