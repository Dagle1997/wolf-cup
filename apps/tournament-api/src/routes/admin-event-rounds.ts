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
  eventScorerDesignees,
  groups,
  groupMembers,
  players,
  subGames,
  subGameParticipants,
  pairings,
  pairingMembers,
  rounds,
  roundStates,
  scorerAssignments,
  courseRevisions,
  courseTees,
} from '../db/schema/index.js';
import { INITIAL_ROUND_STATE, isEventOrganizerByEventId } from '../services/round-state.js';
import { isEligibleScorer, isScorerPolicy } from '../lib/scorer-eligibility.js';
import { isF1Event } from '../services/games-money.js';
import { pinRoundAtStart } from '../services/pin-round-at-start.js';

const SAVE_BODY_LIMIT_BYTES = 8 * 1024;
const TENANT_ID = 'guyan';

// v1 sub-game type allowlist. v1.5+ enabling = add types to this set; no
// schema migration required (the schema CHECK already accepts all 4).
const V1_ENABLED_SUB_GAME_TYPES = new Set(['skins'] as const);
const ALL_SUB_GAME_TYPES = ['skins', 'ctp', 'sandies', 'putting_contest'] as const;
type SubGameType = (typeof ALL_SUB_GAME_TYPES)[number];

// Skins modes (the engine's three): net / gross / Canadian (= gross-OR-net wins,
// engine `gross_beats_net`). Each enabled mode is its OWN sub_game row = its own
// $ pot (Josh 2026-06-25), so the dup guard keys on type+mode for skins.
const SKINS_MODES = ['net', 'gross', 'gross_beats_net'] as const;

const PostSubGamesRequestSchema = z.object({
  subGames: z.array(
    z.object({
      type: z.enum(ALL_SUB_GAME_TYPES),
      /** Skins only: which scoring mode this pot uses. Defaults to 'gross'. */
      mode: z.enum(SKINS_MODES).optional(),
      buyInPerParticipant: z.number().int().nonnegative(),
      participantPlayerIds: z.array(z.string().min(1)),
    }),
  ),
});

/** Resolve a skins entry's mode (default 'gross'); non-skins types have no mode. */
function resolveSkinsMode(entry: { type: string; mode?: (typeof SKINS_MODES)[number] | undefined }): (typeof SKINS_MODES)[number] | null {
  return entry.type === 'skins' ? (entry.mode ?? 'gross') : null;
}

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
    mode: (typeof SKINS_MODES)[number] | null;
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
    // Skins carries its mode in config_json; other types have no mode.
    let mode: (typeof SKINS_MODES)[number] | null = null;
    if (sg.type === 'skins') {
      try {
        const cfg = JSON.parse(sg.configJson) as { mode?: unknown };
        mode = SKINS_MODES.includes(cfg.mode as (typeof SKINS_MODES)[number])
          ? (cfg.mode as (typeof SKINS_MODES)[number])
          : 'gross';
      } catch {
        mode = 'gross';
      }
    }
    subGameOut.push({
      type: sg.type as SubGameType,
      mode,
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

    // Step 4 — duplicate_sub_game_type. Skins is keyed by type+MODE (each mode is
    // its own pot, so Net + Gross + Canadian skins coexist); other types by type.
    const seenKeys = new Set<string>();
    for (const entry of body.subGames) {
      const mode = resolveSkinsMode(entry);
      const key = mode === null ? entry.type : `${entry.type}:${mode}`;
      if (seenKeys.has(key)) {
        return c.json(
          {
            error: 'bad_request',
            code: 'duplicate_sub_game_type',
            requestId,
            type: entry.type,
            ...(mode !== null ? { mode } : {}),
          },
          400,
        );
      }
      seenKeys.add(key);
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
          // Skins stores its mode; payoutModel defaults to even-per-skin in
          // computeSubGame (Josh's game), so it need not be persisted here.
          const mode = resolveSkinsMode(entry);
          const configJson = mode === null ? '{}' : JSON.stringify({ mode });
          await tx.insert(subGames).values({
            id: sgId,
            eventRoundId,
            type: entry.type,
            configJson,
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

// =====================================================================
// T13-2: POST /event-rounds/:eventRoundId/start — instantiate scoring.
//
// Closes the confirmed gap: the app had NO path to create the scoring
// `rounds` row, its `round_states`, or `scorer_assignments` (score entry
// requires all three). The organizer "starts" a round from an event_round
// whose pairings are locked, designating a scorer per foursome.
//
// Creates (one transaction): the `rounds` row (event_id sourced from the
// event_round, holes_to_play copied), the `round_states` row at
// `not_started` (the FSM's entry state per round-state.ts; immediately
// scorable since not_started is writable, and the first score transitions
// it to in_progress), and one `scorer_assignments` row per foursome.
//
// Idempotent + race-safe via the partial UNIQUE on rounds.event_round_id
// (migration 0013): insert-then-recover — a concurrent loser catches the
// UNIQUE violation and returns the winner's roundId (mirrors
// resolveOrInsertGhinPlayer; no pre-check, so the recovery branch is the
// single idempotency path and is unit-testable by pre-inserting a round).
//
// Auth: requireSession → requireOrganizer (global organizer flag — the
// interim guard until the multi-organizer auth pass makes it event-scoped).
// =====================================================================

const StartRoundRequestSchema = z
  .object({
    scorers: z
      .array(
        z
          .object({
            foursomeNumber: z.number().int().positive(),
            scorerPlayerId: z.string().uuid(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

// Local UNIQUE/PK constraint detector (mirror of admin-groups'
// isUniqueOrPkConstraintError, which is not exported). libsql surfaces the
// constraint code on the error or its cause; the raw codes are
// SQLITE_CONSTRAINT_UNIQUE (2067) and SQLITE_CONSTRAINT_PRIMARYKEY (1555).
function isUniqueOrPkConstraintError(err: unknown): boolean {
  const e = err as {
    code?: string;
    extendedCode?: string;
    rawCode?: number;
    cause?: { code?: string; rawCode?: number };
  } | null;
  const hasUniqueStr = (v: unknown) =>
    typeof v === 'string' &&
    (v.includes('SQLITE_CONSTRAINT_UNIQUE') ||
      v.includes('SQLITE_CONSTRAINT_PRIMARYKEY'));
  return (
    hasUniqueStr(e?.code) ||
    hasUniqueStr(e?.extendedCode) ||
    hasUniqueStr(e?.cause?.code) ||
    e?.rawCode === 2067 ||
    e?.rawCode === 1555 ||
    e?.cause?.rawCode === 2067 ||
    e?.cause?.rawCode === 1555
  );
}

adminEventRoundsRouter.post(
  '/event-rounds/:eventRoundId/start',
  // requireSession + requireOrganizer are applied router-wide via
  // `.use('/event-rounds/*', ...)` above — not repeated here.
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json({ error: 'bad_request', code: 'body_too_large', requestId }, 400);
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const player = c.get('player')!;
    const eventRoundId = c.req.param('eventRoundId');

    // 1. Body validation (strict).
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'bad_request', code: 'invalid_body', requestId, issues: [] }, 400);
    }
    const parsed = StartRoundRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: parsed.error.issues },
        400,
      );
    }
    const { scorers } = parsed.data;

    // 2. event_round exists (tenant-scoped). event_id + holes_to_play come
    //    from this row — NEVER from the request (satisfies chk_rounds_event_pairing).
    const erRows = await db
      .select({ eventId: eventRounds.eventId, holesToPlay: eventRounds.holesToPlay })
      .from(eventRounds)
      .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, TENANT_ID)))
      .limit(1);
    if (erRows.length === 0) {
      return c.json({ error: 'not_found', code: 'event_round_not_found', requestId }, 404);
    }
    const { eventId, holesToPlay } = erRows[0]!;
    const contextId = `event:${eventId}`;

    // 3. Pairings must exist AND every pairing must be locked.
    const pairingRows = await db
      .select({ id: pairings.id, foursomeNumber: pairings.foursomeNumber, locked: pairings.locked })
      .from(pairings)
      .where(and(eq(pairings.eventRoundId, eventRoundId), eq(pairings.tenantId, TENANT_ID)));
    if (pairingRows.length === 0 || pairingRows.some((p) => !p.locked)) {
      return c.json({ error: 'unprocessable', code: 'pairings_not_ready', requestId }, 422);
    }

    // 4. Members per foursome.
    const pairingIds = pairingRows.map((p) => p.id);
    const memberRows = await db
      .select({ pairingId: pairingMembers.pairingId, playerId: pairingMembers.playerId })
      .from(pairingMembers)
      .where(
        and(
          inArray(pairingMembers.pairingId, pairingIds),
          eq(pairingMembers.tenantId, TENANT_ID),
        ),
      );
    const pairingIdToFoursome = new Map(pairingRows.map((p) => [p.id, p.foursomeNumber]));
    const foursomeMembers = new Map<number, Set<string>>();
    for (const m of memberRows) {
      const fn = pairingIdToFoursome.get(m.pairingId)!;
      if (!foursomeMembers.has(fn)) foursomeMembers.set(fn, new Set());
      foursomeMembers.get(fn)!.add(m.playerId);
    }
    const pairingFoursomes = new Set(pairingRows.map((p) => p.foursomeNumber));

    // 5. Validate the scorer mapping (deterministic order, all 400s).
    const seen = new Set<number>();
    for (const s of scorers) {
      if (seen.has(s.foursomeNumber)) {
        return c.json({ error: 'bad_request', code: 'duplicate_foursome', requestId, foursomeNumber: s.foursomeNumber }, 400);
      }
      seen.add(s.foursomeNumber);
      if (!pairingFoursomes.has(s.foursomeNumber)) {
        return c.json({ error: 'bad_request', code: 'unknown_foursome', requestId, foursomeNumber: s.foursomeNumber }, 400);
      }
    }
    for (const fn of pairingFoursomes) {
      if (!seen.has(fn)) {
        return c.json({ error: 'bad_request', code: 'missing_scorer_for_foursome', requestId, foursomeNumber: fn }, 400);
      }
    }
    // T13-4: scorer eligibility is policy-driven. Fetch the event's policy +
    // organizer + (for 'designated') the designee pool + (for 'open') the
    // participant set. 'foursome' default reproduces the prior member-or-
    // organizer rule exactly.
    const evtRows = await db
      .select({
        scorerPolicy: events.scorerPolicy,
        organizerPlayerId: events.organizerPlayerId,
        cancelledAt: events.cancelledAt,
      })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
      .limit(1);
    // A cancelled event cannot start new scoring rounds (restore it first).
    if (evtRows[0]?.cancelledAt != null) {
      return c.json({ error: 'unprocessable', code: 'event_cancelled', requestId }, 422);
    }
    const policy = isScorerPolicy(evtRows[0]?.scorerPolicy) ? evtRows[0]!.scorerPolicy : 'foursome';
    const organizerPlayerId = evtRows[0]?.organizerPlayerId ?? player.id;

    const designatedIds = new Set<string>();
    if (policy === 'designated') {
      const rows = await db
        .select({ playerId: eventScorerDesignees.playerId })
        .from(eventScorerDesignees)
        .where(and(eq(eventScorerDesignees.eventId, eventId), eq(eventScorerDesignees.tenantId, TENANT_ID)));
      for (const r of rows) designatedIds.add(r.playerId);
    }

    const participantIds = new Set<string>();
    if (policy === 'open') {
      const rows = await db
        .select({ playerId: groupMembers.playerId })
        .from(groupMembers)
        .innerJoin(groups, eq(groupMembers.groupId, groups.id))
        .where(and(eq(groups.eventId, eventId), eq(groups.tenantId, TENANT_ID), eq(groupMembers.tenantId, TENANT_ID)));
      for (const r of rows) participantIds.add(r.playerId);
    }

    for (const s of scorers) {
      const members = foursomeMembers.get(s.foursomeNumber) ?? new Set<string>();
      const eligible = isEligibleScorer({
        policy,
        designatedIds,
        foursomeMemberIds: members,
        organizerPlayerId,
        candidateId: s.scorerPlayerId,
        candidateIsParticipant: participantIds.has(s.scorerPlayerId) || members.has(s.scorerPlayerId),
      });
      if (!eligible) {
        return c.json({ error: 'bad_request', code: 'invalid_scorer', requestId, foursomeNumber: s.foursomeNumber }, 400);
      }
    }

    // F1 (Story 1.4): an event with an event-level game_config row pins its
    // resolved config + per-player CH + course-rev at round-start so money +
    // leaderboard recompute deterministically off the pin (never live HI). This
    // routing key is read BEFORE the tx; the pin write rides INSIDE the tx so it
    // is atomic with the round creation. A pin FAILURE must never block the
    // round from starting (logged + skipped → the round is fail-closed
    // unsettleable on read, never settled against live data).
    const eventIsF1 = await isF1Event(db, eventId, TENANT_ID);

    // 6. Create rounds + round_states + scorer_assignments atomically.
    const roundId = randomUUID();
    const now = Date.now();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(rounds).values({
          id: roundId,
          eventId,
          eventRoundId,
          holesToPlay,
          // opened_at / opened_by_player_id are LEFT NULL at creation: the FSM
          // (round-state.ts transitionState) owns them, setting opened_at on
          // the first not_started→in_progress transition (first score) under
          // `WHERE opened_at IS NULL`. Pre-setting here would mean "created"
          // not "first scored" and would block the FSM's first-open set.
          openedAt: null,
          openedByPlayerId: null,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId,
        });
        await tx.insert(roundStates).values({
          roundId,
          state: INITIAL_ROUND_STATE,
          enteredAt: now,
          enteredByPlayerId: player.id,
          tenantId: TENANT_ID,
          contextId,
        });
        for (const s of scorers) {
          await tx.insert(scorerAssignments).values({
            roundId,
            foursomeNumber: s.foursomeNumber,
            scorerPlayerId: s.scorerPlayerId,
            assignedAt: now,
            assignedByPlayerId: player.id,
            tenantId: TENANT_ID,
            contextId,
          });
        }
        // F1 pin (atomic with round creation). A config/data problem returns
        // `{ ok: false }` (logged, round still starts → fail-closed on read);
        // an unexpected throw would roll back the tx, so it is caught + logged
        // OUTSIDE the round-creation invariant below (we do NOT abort the start
        // for a pin error).
        if (eventIsF1) {
          try {
            const pinRes = await pinRoundAtStart(tx, {
              roundId,
              eventRoundId,
              eventId,
              tenantId: TENANT_ID,
              createdAt: now,
              actorPlayerId: player.id,
            });
            if (!pinRes.ok) {
              log.warn({ event: 'f1_pin_skipped', roundId, eventRoundId, reason: pinRes.reason });
            }
          } catch (pinErr) {
            // Swallow inside the tx so the round still commits + starts. The
            // unpinned F1 round is fail-closed (unsettleable) on read.
            log.warn({
              event: 'f1_pin_failed',
              roundId,
              eventRoundId,
              message: (pinErr as { message?: unknown } | null)?.message ?? null,
            });
          }
        }
      });
    } catch (err) {
      // 7. Race-safe idempotency: a concurrent winner already created the
      //    round for this event_round (partial UNIQUE fired). Recover the
      //    existing round OUTSIDE the aborted transaction.
      if (isUniqueOrPkConstraintError(err)) {
        const existing = await db
          .select({ id: rounds.id })
          .from(rounds)
          .where(and(eq(rounds.eventRoundId, eventRoundId), eq(rounds.tenantId, TENANT_ID)))
          .limit(1);
        if (existing[0]) {
          // Defensive: a rounds row implies its round_state (atomic create).
          const stateRows = await db
            .select({ roundId: roundStates.roundId })
            .from(roundStates)
            .where(
              and(
                eq(roundStates.roundId, existing[0].id),
                eq(roundStates.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          if (stateRows.length === 0) {
            return c.json({ error: 'conflict', code: 'round_state_corrupt', requestId }, 409);
          }
          return c.json({ roundId: existing[0].id, alreadyStarted: true, requestId }, 200);
        }
      }
      log.error({
        event: 'start_round_failed',
        eventRoundId,
        message: (err as { message?: unknown } | null)?.message ?? null,
      });
      return c.json({ error: 'internal', code: 'start_failed', requestId }, 500);
    }

    log.info({ event: 'round_started', roundId, eventRoundId, foursomeCount: scorers.length });
    return c.json({ roundId, requestId }, 201);
  },
);

// =====================================================================
// PATCH /event-rounds/:eventRoundId/course — change a round's course + tee
// AFTER event creation (B3 / fixes the misleading post-creation "add course"
// affordance: you can now actually assign/swap the course).
//
// Event-scoped organizer auth. Refuses the change once a scoring round has
// been started for this event_round (changing the course mid-scoring would
// invalidate handicaps/scores) → 422 round_already_started; restore by not
// starting, or correct via score tools. Validates the new course revision
// exists and the tee is one of that course's tees.
// =====================================================================
const ChangeCourseSchema = z
  .object({
    courseRevisionId: z.string().min(1),
    teeColor: z.string().min(1),
  })
  .strict();

adminEventRoundsRouter.patch(
  '/event-rounds/:eventRoundId/course',
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: 'bad_request', code: 'body_too_large', requestId: c.get('requestId') }, 400),
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const player = c.get('player')!;
    const eventRoundId = c.req.param('eventRoundId');

    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'bad_request', code: 'invalid_body', requestId }, 400); }
    const parsed = ChangeCourseSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'bad_request', code: 'invalid_body', requestId, issues: parsed.error.issues }, 400);
    }
    const { courseRevisionId, teeColor } = parsed.data;

    // 1. event_round exists (tenant-scoped) → its event for the auth check.
    const erRows = await db
      .select({ eventId: eventRounds.eventId })
      .from(eventRounds)
      .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, TENANT_ID)))
      .limit(1);
    if (erRows.length === 0) {
      return c.json({ error: 'not_found', code: 'event_round_not_found', requestId }, 404);
    }
    const eventId = erRows[0]!.eventId;

    // 2. Event-scoped organizer (multi-organizer; false covers wrong-org too).
    if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
      return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
    }

    // 3. Refuse if a scoring round already exists for this event_round.
    const startedRows = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.eventRoundId, eventRoundId), eq(rounds.tenantId, TENANT_ID)))
      .limit(1);
    if (startedRows.length > 0) {
      return c.json({ error: 'unprocessable', code: 'round_already_started', requestId }, 422);
    }

    // 4. New course revision must exist (tenant-scoped).
    const revRows = await db
      .select({ id: courseRevisions.id })
      .from(courseRevisions)
      .where(and(eq(courseRevisions.id, courseRevisionId), eq(courseRevisions.tenantId, TENANT_ID)))
      .limit(1);
    if (revRows.length === 0) {
      return c.json({ error: 'bad_request', code: 'unknown_course_revision', requestId }, 400);
    }

    // 5. Tee must be one of that course revision's tees.
    const teeRows = await db
      .select({ teeColor: courseTees.teeColor })
      .from(courseTees)
      .where(and(eq(courseTees.courseRevisionId, courseRevisionId), eq(courseTees.teeColor, teeColor), eq(courseTees.tenantId, TENANT_ID)))
      .limit(1);
    if (teeRows.length === 0) {
      return c.json({ error: 'bad_request', code: 'invalid_tee', requestId }, 400);
    }

    await db
      .update(eventRounds)
      .set({ courseRevisionId, teeColor })
      .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, TENANT_ID)));

    log.info({ event: 'event_round_course_changed', eventRoundId, eventId, courseRevisionId, teeColor, actorPlayerId: player.id });
    return c.json({ ok: true, eventRoundId, courseRevisionId, teeColor, requestId }, 200);
  },
);
