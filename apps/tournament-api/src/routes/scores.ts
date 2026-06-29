/**
 * T5-6 score POST endpoint + integration with require-scorer-for-round
 * middleware. Single-writer enforcement boundary (FR-B10, NFR-S3, FR-H3).
 *
 * Mount: `app.route('/api/rounds', scoresRouter)`. Effective URL:
 * `POST /api/rounds/:roundId/holes/:holeNumber/scores`.
 *
 * Chain: requireSession → requireScorerForRound → handler.
 *
 * The middleware does Zod parse on the body and stores the parsed shape
 * via `c.set('scorePostBody', ...)`; the handler reads via
 * `c.get('scorePostBody')` (typed via ContextVariableMap in
 * `apps/tournament-api/src/types/hono.d.ts`). No second parse.
 *
 * The 14-path error taxonomy is documented in T5-6 spec §9. The handler
 * implements steps 1-8 of the transaction logic. State-transition logic
 * is INLINE here; T5-8 will refactor into a `transitionState` service
 * (audit-row payload contract `{ from, to }` is stable; T5-8's refactor
 * is call-site only).
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  holeScores,
  pairings,
  pairingMembers,
  players,
  rounds,
  roundPins,
  roundStates,
  scorerAssignments,
  subGames,
  subGameParticipants,
} from '../db/schema/index.js';
import { perPlayerHandicapsSchema, parseGameConfig } from '../engine/games/config-schema.js';
import { requireSession } from '../middleware/require-session.js';
import { requireScorerForRound } from '../middleware/require-scorer-for-round.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import {
  courses,
  courseRevisions,
  courseHoles,
  courseTees,
  eventRounds,
  events,
} from '../db/schema/index.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import { deriveCurrentClaims } from '../services/claim-write.js';
import {
  BusinessRuleError,
  computeExpectedCells,
  getRoundState,
  transitionState,
} from '../services/round-state.js';
import { runPressOrchestrator } from '../services/press-orchestrator.js';
import { evaluateAwards } from '../services/awards.js';
import type { ScoreCommittedEvent } from '../engine/types/activity-events.js';
import { logger as moduleLogger } from '../lib/log.js';

const TENANT_ID = 'guyan';

export const scorePostBodySchema = z.object({
  playerId: z.string().uuid(),
  grossStrokes: z.number().int().min(1).max(20),
  putts: z.number().int().min(0).max(15).nullable().optional(),
  clientEventId: z.string().min(1).max(128),
});

export type ScorePostBody = z.infer<typeof scorePostBodySchema>;

export const scoresRouter = new Hono();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * T5-2 score-entry-context GET. Read-only; gated by requireSession only
 * (non-scorers must be able to fetch the round to render the read-only
 * placeholder). Returns 404 round_not_found uniformly for: round doesn't
 * exist OR foreign tenant OR session.userId is not a member of any
 * foursome for this round (round-existence obfuscation pattern).
 *
 * Returns the score-entry-context shape per T5-2 spec §3.
 */
scoresRouter.get('/:roundId', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const player = c.get('player')!;
  const roundId = c.req.param('roundId')!;

  if (!UUID_RE.test(roundId)) {
    return c.json(
      { error: 'bad_request', code: 'invalid_round_id', requestId },
      400,
    );
  }

  // (1) Round existence — uniform 404 for nonexistent / foreign-tenant.
  const roundRows = await db
    .select({
      id: rounds.id,
      eventId: rounds.eventId,
      eventRoundId: rounds.eventRoundId,
      holesToPlay: rounds.holesToPlay,
    })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
    .limit(1);
  if (roundRows.length === 0) {
    return c.json(
      { error: 'not_found', code: 'round_not_found', requestId },
      404,
    );
  }
  const round = roundRows[0]!;

  // (2) round_states — 422 if absent (no silent default).
  const rsRows = await db
    .select({ state: roundStates.state })
    .from(roundStates)
    .where(
      and(
        eq(roundStates.roundId, roundId),
        eq(roundStates.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  if (rsRows.length === 0) {
    return c.json(
      { error: 'unprocessable', code: 'round_state_missing', requestId },
      422,
    );
  }
  const state = rsRows[0]!.state;

  // (3) Locate the session player's foursome via pairing_members + pairings.
  // Returns 404 (uniform with foreign-tenant) for non-participants — round
  // existence obfuscation per T5-2 spec §3.
  if (round.eventRoundId === null) {
    // v1.5 standalone-round shape; v1 never writes nulls. Treat as
    // non-participant (404 uniform).
    return c.json(
      { error: 'not_found', code: 'round_not_found', requestId },
      404,
    );
  }

  const myFoursomeRows = await db
    .select({ foursomeNumber: pairings.foursomeNumber })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairingMembers.playerId, player.id),
        eq(pairings.tenantId, TENANT_ID),
        eq(pairingMembers.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  let myFoursomeNumber = myFoursomeRows[0]?.foursomeNumber;
  // Captured BEFORE the scorer/organizer fallbacks reassign myFoursomeNumber:
  // is the VIEWER an actual pairing member of the group they're viewing? If so
  // they may score it directly (group-member gate — Josh 2026-06-28), no
  // designated-scorer handoff. Organizer-only viewers (no pairing) stay false
  // and keep the pick-a-group + Claim-scoring flow.
  const viewerIsFoursomeMember = myFoursomeRows[0]?.foursomeNumber !== undefined;
  if (myFoursomeNumber === undefined) {
    // T13-3: a DESIGNATED SCORER who is not a pairing member (e.g. the event
    // organizer running a foursome they aren't playing in) still resolves to
    // the foursome they score. Mirrors requireScorerForRound, which already
    // authorizes the POST path this exact way (scorer_assignments, not
    // membership) — without this fallback, score-entry 404s an organizer-scorer
    // that the start endpoint explicitly allowed, leaving them unable to score.
    const scorerFoursomeRows = await db
      .select({ foursomeNumber: scorerAssignments.foursomeNumber })
      .from(scorerAssignments)
      .where(
        and(
          eq(scorerAssignments.roundId, roundId),
          eq(scorerAssignments.scorerPlayerId, player.id),
          eq(scorerAssignments.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    myFoursomeNumber = scorerFoursomeRows[0]?.foursomeNumber;
  }
  // Organizer fallback: the event organizer is logged in as the organizer (not
  // a player), so they're in no foursome and may not be a designated scorer —
  // yet they need to open any group to score/verify. Let them pick the group
  // via ?foursome=N (default: the lowest foursome). With the 'open' scorer
  // policy they can then "Claim scoring" to become the writer for that group.
  let viewerIsOrganizer = false;
  let availableFoursomes: number[] = [];
  if (myFoursomeNumber === undefined && round.eventId !== null) {
    const evtRow = await db
      .select({ organizerPlayerId: events.organizerPlayerId })
      .from(events)
      .where(and(eq(events.id, round.eventId), eq(events.tenantId, TENANT_ID)))
      .limit(1);
    if (evtRow[0]?.organizerPlayerId === player.id) {
      viewerIsOrganizer = true;
      const fsRows = await db
        .select({ foursomeNumber: pairings.foursomeNumber })
        .from(pairings)
        .where(and(eq(pairings.eventRoundId, round.eventRoundId), eq(pairings.tenantId, TENANT_ID)))
        .orderBy(asc(pairings.foursomeNumber));
      availableFoursomes = fsRows.map((r) => r.foursomeNumber);
      if (availableFoursomes.length > 0) {
        const requested = Number(c.req.query('foursome'));
        myFoursomeNumber = availableFoursomes.includes(requested) ? requested : availableFoursomes[0];
      }
    }
  }
  if (myFoursomeNumber === undefined) {
    return c.json(
      { error: 'not_found', code: 'round_not_found', requestId },
      404,
    );
  }

  // (4) Members of my foursome (ordered by slot_number ASC — load-bearing
  // for ref-positional indexing in the UI).
  const memberRows = await db
    .select({
      playerId: pairingMembers.playerId,
      slotNumber: pairingMembers.slotNumber,
      name: players.name,
      handicapIndex: players.manualHandicapIndex,
    })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .innerJoin(players, eq(pairingMembers.playerId, players.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairings.foursomeNumber, myFoursomeNumber),
        eq(pairings.tenantId, TENANT_ID),
        eq(pairingMembers.tenantId, TENANT_ID),
        eq(players.tenantId, TENANT_ID),
      ),
    )
    .orderBy(pairingMembers.slotNumber);

  // Per-player COURSE handicap, read from the round PIN (the strokes-received
  // number the round was locked at). Absent on un-pinned rounds (non-F1 / not yet
  // started) → courseHandicap is null and the UI shows HI only. Parsed via the
  // canonical schema; a corrupt pin degrades to null, never throws.
  const pinRows = await db
    .select({
      perPlayerHandicapsJson: roundPins.perPlayerHandicapsJson,
      resolvedConfigJson: roundPins.resolvedConfigJson,
      foursomeConfigsJson: roundPins.foursomeConfigsJson,
    })
    .from(roundPins)
    .where(and(eq(roundPins.roundId, roundId), eq(roundPins.tenantId, TENANT_ID)))
    .limit(1);
  let courseHandicapByPlayer: Record<string, number | null> = {};
  const pinJson = pinRows[0]?.perPlayerHandicapsJson;
  if (pinJson !== undefined) {
    try {
      const parsed = perPlayerHandicapsSchema.safeParse(JSON.parse(pinJson));
      if (parsed.success) {
        courseHandicapByPlayer = Object.fromEntries(
          Object.entries(parsed.data).map(([pid, v]) => [pid, v.ch]),
        );
      }
    } catch {
      // Corrupt pin JSON → leave the map empty (HI-only display).
    }
  }

  // Which claim-modifiers (greenie/polie/sandie) does the VIEWER'S FOURSOME settle?
  // The score-entry hides a claim button for any modifier that is OFF (Josh
  // 2026-06-25 — "if they are off they don't show up on the score entry screen").
  // Epic 6: a foursome with its own pinned rules (foursome_configs_json) gates off
  // ITS config; everyone else off the round default. Gating is display-only; the
  // engine settles each foursome from the same pin regardless. `null` = no
  // parseable pinned config (un-pinned / non-F1) → client shows all three (no
  // regression). EMPTY array = every claim-modifier OFF for this foursome.
  const CLAIM_MODIFIER_TYPES = ['greenie', 'polie', 'sandie'] as const;
  let enabledClaimTypes: Array<'greenie' | 'polie' | 'sandie'> | null = null;
  const resolvedJson = pinRows[0]?.resolvedConfigJson;
  if (resolvedJson !== undefined) {
    try {
      // Effective config for THIS viewer's foursome: its override (Epic 6), else
      // the round default.
      let effectiveConfigRaw: unknown = JSON.parse(resolvedJson);
      const foursomeJson = pinRows[0]?.foursomeConfigsJson;
      if (foursomeJson != null) {
        const map = JSON.parse(foursomeJson) as Record<string, unknown>;
        const override = map?.[String(myFoursomeNumber)];
        if (override !== undefined) effectiveConfigRaw = override;
      }
      const parsed = parseGameConfig(effectiveConfigRaw);
      if (parsed.ok) {
        const onTypes = new Set(
          parsed.config.modifiers.filter((m) => m.enabled).map((m) => m.type),
        );
        enabledClaimTypes = CLAIM_MODIFIER_TYPES.filter((t) => onTypes.has(t));
      } else {
        // A PINNED config that exists but won't parse is a real anomaly (the pin
        // was validated at write time). It fails OPEN (all buttons), so it can't
        // break scoring — but log it so a misconfigured/corrupt pin is diagnosable
        // during a live money event rather than silently reintroducing every claim
        // button (codex review 2026-06-25).
        (c.get('logger') ?? moduleLogger).warn({
          msg: 'round-detail: pinned config did not parse; claim buttons fail open',
          requestId,
          roundId,
          reason: parsed.reason,
        });
      }
    } catch (err) {
      // Corrupt JSON in the pin → leave null (client shows all three) + log.
      (c.get('logger') ?? moduleLogger).warn({
        msg: 'round-detail: pinned config JSON is corrupt; claim buttons fail open',
        requestId,
        roundId,
        err: String(err),
      });
    }
  }

  const members = memberRows.map((m) => ({
    playerId: m.playerId,
    name: m.name,
    handicapIndex: m.handicapIndex,
    courseHandicap: courseHandicapByPlayer[m.playerId] ?? null,
  }));

  // (5) Scorer assignment for my foursome (may be null pre-T5-7).
  const scorerRows = await db
    .select({
      scorerPlayerId: scorerAssignments.scorerPlayerId,
      scorerName: players.name,
    })
    .from(scorerAssignments)
    .innerJoin(players, eq(scorerAssignments.scorerPlayerId, players.id))
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.foursomeNumber, myFoursomeNumber),
        eq(scorerAssignments.tenantId, TENANT_ID),
        eq(players.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  const scorerPlayerId = scorerRows[0]?.scorerPlayerId ?? null;
  const scorerName = scorerRows[0]?.scorerName ?? null;
  const isScorer = scorerPlayerId === player.id;

  // (6) hole_scores filtered to my foursome's player_ids — pushed into
  // the SQL WHERE so we don't read+filter-in-memory all of the round's
  // hole_scores (could be 4 foursomes × 18 holes = 72 rows for a
  // typical Pinehurst round; small, but tighter is better).
  const memberPlayerIds = members.map((m) => m.playerId);
  const myHoleScores = memberPlayerIds.length > 0
    ? await db
        .select({
          holeNumber: holeScores.holeNumber,
          playerId: holeScores.playerId,
          grossStrokes: holeScores.grossStrokes,
          putts: holeScores.putts,
        })
        .from(holeScores)
        .where(
          and(
            eq(holeScores.roundId, roundId),
            eq(holeScores.tenantId, TENANT_ID),
            inArray(holeScores.playerId, memberPlayerIds),
          ),
        )
    : [];

  // (7) Current F1 claims (Story 2.1) for this foursome's players — derived
  // from the append-only hole_claim_writes log (latest-set-write-per-cell).
  // Scoped to the foursome members so the score-entry UI can render existing
  // claim chips. Empty array when none / not an F1 event.
  const myClaims =
    memberPlayerIds.length > 0
      ? await deriveCurrentClaims(db, {
          roundId,
          tenantId: TENANT_ID,
          restrictToPlayerIds: memberPlayerIds,
        })
      : [];

  // (8) Putts tracking: which of THIS foursome's members are in an active
  // putting-game (sub_game type 'putting_contest') for the round. The score
  // entry UI asks those players for putts; everyone else is unchanged. Empty
  // unless a putting game was enabled for these players.
  const puttsPlayerIds =
    memberPlayerIds.length > 0
      ? (
          await db
            .select({ playerId: subGameParticipants.playerId })
            .from(subGameParticipants)
            .innerJoin(subGames, eq(subGameParticipants.subGameId, subGames.id))
            .where(
              and(
                eq(subGames.eventRoundId, round.eventRoundId),
                eq(subGames.type, 'putting_contest'),
                eq(subGames.tenantId, TENANT_ID),
                eq(subGameParticipants.tenantId, TENANT_ID),
                inArray(subGameParticipants.playerId, memberPlayerIds),
              ),
            )
        ).map((r) => r.playerId)
      : [];

  return c.json(
    {
      roundId,
      eventId: round.eventId,
      state,
      holesToPlay: round.holesToPlay,
      myFoursome: {
        foursomeNumber: myFoursomeNumber,
        isScorer,
        // A foursome member may always score their own group; the designated
        // scorer still can too (covers the organizer-as-scorer non-member case).
        canScore: isScorer || viewerIsFoursomeMember,
        viewerIsFoursomeMember,
        scorerPlayerId,
        scorerName,
        members,
        holeScores: myHoleScores,
        claims: myClaims,
        enabledClaimTypes,
        puttsPlayerIds,
        // Organizer-scoring affordances: when the organizer opened a group they
        // aren't in, the UI shows a group switcher (the other foursomes).
        viewerIsOrganizer,
        availableFoursomes,
      },
    },
    200,
  );
});

scoresRouter.post(
  '/:roundId/holes/:holeNumber/scores',
  requireSession,
  requireScorerForRound,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const body = c.get('scorePostBody');
    const roundId = c.req.param('roundId')!;
    const holeNumber = Number(c.req.param('holeNumber'));

    if (!body) {
      // Defensive: middleware mis-mount would leave this undefined.
      // Should never fire in practice; FK middleware contract is the
      // primary guarantee.
      return c.json(
        { error: 'internal', code: 'middleware_misuse_no_body', requestId },
        500,
      );
    }
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
      // Defensive: middleware validates this. Reaching here implies
      // mis-mount or test-only bypass.
      return c.json(
        { error: 'internal', code: 'middleware_misuse_no_hole_number', requestId },
        500,
      );
    }

    // T6-4: outer try/catch maps press-engine errors to 422.
    // Other errors propagate to hono's default 500 handler.
    try {
      return await db.transaction(async (tx) => {
      // (1) Fetch round (defense-in-depth; middleware already returned 404)
      const roundRows = await tx
        .select()
        .from(rounds)
        .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
        .limit(1);
      if (roundRows.length === 0) {
        return c.json(
          { error: 'not_found', code: 'round_not_found', requestId },
          404,
        );
      }
      const round = roundRows[0]!;

      // (2) holeNumber must be within the round's holes_to_play
      if (holeNumber > round.holesToPlay) {
        return c.json(
          {
            error: 'unprocessable',
            code: 'hole_number_exceeds_holes_to_play',
            holesToPlay: round.holesToPlay,
            requestId,
          },
          422,
        );
      }

      // (3) Fetch round_states + writability gate
      const rsRows = await tx
        .select()
        .from(roundStates)
        .where(
          and(
            eq(roundStates.roundId, roundId),
            eq(roundStates.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      if (rsRows.length === 0) {
        return c.json(
          { error: 'unprocessable', code: 'round_state_missing', requestId },
          422,
        );
      }
      const rs = rsRows[0]!;
      const writableStates = new Set([
        'not_started',
        'in_progress',
        'complete_editable',
      ]);
      if (!writableStates.has(rs.state)) {
        return c.json(
          {
            error: 'unprocessable',
            code: 'round_not_writable',
            currentState: rs.state,
            requestId,
          },
          422,
        );
      }

      // Putts are REQUIRED for putting-game players, but enforced at the score-
      // entry UI (the Save gate), NOT here: a valid gross is money-critical and
      // must always persist, so the write path never rejects a gross for a
      // missing secondary stat (post-trip review 2026-06-29 — rejecting the
      // whole write risked silently dropping a queued gross on sync).

      // (4) INSERT with idempotent dedupe target. Catch UNIQUE-collision separately.
      const insertId = randomUUID();
      const now = Date.now();
      let didInsert: boolean;
      try {
        const result = await tx
          .insert(holeScores)
          .values({
            id: insertId,
            roundId,
            playerId: body.playerId,
            holeNumber,
            grossStrokes: body.grossStrokes,
            putts: body.putts ?? null,
            scorerPlayerId: player.id,
            clientEventId: body.clientEventId,
            createdAt: now,
            updatedAt: now,
            tenantId: TENANT_ID,
            contextId: round.contextId,
          })
          .onConflictDoNothing({
            target: [
              holeScores.roundId,
              holeScores.playerId,
              holeScores.holeNumber,
              holeScores.clientEventId,
            ],
          })
          .returning({ id: holeScores.id });
        didInsert = result.length === 1;
      } catch (err) {
        // The cell-level UNIQUE fired (different client_event_id at same cell).
        if (isUniqueConstraintError(err)) {
          const existing = await tx
            .select({
              scorerPlayerId: holeScores.scorerPlayerId,
              createdAt: holeScores.createdAt,
              clientEventId: holeScores.clientEventId,
            })
            .from(holeScores)
            .where(
              and(
                eq(holeScores.roundId, roundId),
                eq(holeScores.playerId, body.playerId),
                eq(holeScores.holeNumber, holeNumber),
                eq(holeScores.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          const conflictingEntry =
            existing.length > 0
              ? {
                  scorer_player_id: existing[0]!.scorerPlayerId,
                  created_at: existing[0]!.createdAt,
                  client_event_id: existing[0]!.clientEventId,
                }
              : null;
          return c.json(
            {
              error: 'conflict',
              code: 'hole_already_scored',
              conflictingEntry,
              requestId,
            },
            409,
          );
        }
        throw err;
      }

      // (4b) Idempotent replay path: same clientEventId → no insert, no audit.
      if (!didInsert) {
        return c.json(
          {
            status: 'ok',
            clientEventId: body.clientEventId,
            deduped: true,
          },
          200,
        );
      }

      // (5) Audit + activity for the new cell.
      await writeAudit(tx, {
        eventType: AUDIT_EVENT_TYPES.SCORE_COMMITTED,
        entityType: AUDIT_ENTITY_TYPES.HOLE_SCORE,
        entityId: insertId,
        actorPlayerId: player.id,
        payload: {
          roundId,
          playerId: body.playerId,
          holeNumber,
          grossStrokes: body.grossStrokes,
          putts: body.putts ?? null,
        },
      });
      // T8-1 typed activity emit. Skip when round.eventId is null
      // (legacy non-event rounds); the chk_rounds_event_pairing CHECK
      // guarantees eventRoundId is also null in that case, so the par
      // lookup wouldn't have a course_revision to resolve against.
      // T8-4: capture the typed score event so it can be passed to
      // both emitActivity (here) AND evaluateAwards (after the press
      // orchestrator below). Awards evaluation is best-effort.
      let scoreEventForAwards: ScoreCommittedEvent | null = null;
      if (round.eventId !== null && round.eventRoundId !== null) {
        // Course-revision par lookup. O(1) via the
        // uniq_course_holes_revision_hole_number UNIQUE index.
        // Defense-in-depth: filter both tables by tenant_id AND verify
        // event_rounds.event_id matches round.eventId so a cross-tenant
        // or cross-event corrupt FK can't accidentally pull the wrong
        // par into a score-committed activity.
        const parRows = await tx
          .select({ par: courseHoles.par })
          .from(courseHoles)
          .innerJoin(
            eventRounds,
            eq(eventRounds.courseRevisionId, courseHoles.courseRevisionId),
          )
          .where(
            and(
              eq(eventRounds.id, round.eventRoundId),
              eq(eventRounds.eventId, round.eventId),
              eq(eventRounds.tenantId, TENANT_ID),
              eq(courseHoles.holeNumber, holeNumber),
              eq(courseHoles.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        const par = parRows[0]?.par;
        if (par !== undefined) {
          const toPar = body.grossStrokes - par;
          const scoreEvent: ScoreCommittedEvent = {
            type: 'score.committed',
            eventId: round.eventId,
            roundId,
            actorPlayerId: player.id,
            playerId: body.playerId,
            holeNumber,
            grossStrokes: body.grossStrokes,
            par,
            toPar,
            isBirdieOrBetter: toPar < 0,
            scorerPlayerId: player.id,
          };
          await emitActivity(tx, scoreEvent);
          scoreEventForAwards = scoreEvent;
        }
        // par-not-found is a course-data integrity gap; skip emit
        // silently rather than fail the score-post. The audit_log row
        // (above) records the score regardless.
      }

      // (5b) T6-4 press orchestrator. Runs hole-complete detection internally;
      // skips press eval when hole isn't complete. Engine errors throw
      // BusinessRuleError('press_engine_error', ..., 422) — caught by the
      // outer try/catch added below and mapped to a 422 response.
      await runPressOrchestrator(
        tx,
        {
          roundId,
          holeNumber,
          scoredPlayerId: body.playerId,
          scorerPlayerId: player.id,
        },
        TENANT_ID,
      );

      // (5c) T8-4 awards evaluation. Best-effort posture (Josh call 6,
      // epic line 2705-2707): a throw here MUST NOT roll back the
      // score commit. Missing a celebratory animation is acceptable;
      // rejecting a legitimate score because the decorative engine
      // threw is not. Asymmetric vs. T6.4 press engine which is
      // fail-loud (presses affect money; awards don't).
      if (scoreEventForAwards !== null) {
        try {
          await evaluateAwards(tx, scoreEventForAwards, log);
        } catch (err) {
          log.error({
            msg: 'awards_evaluate_failed',
            requestId,
            eventId: scoreEventForAwards.eventId,
            roundId: scoreEventForAwards.roundId,
            holeNumber: scoreEventForAwards.holeNumber,
            playerId: scoreEventForAwards.playerId,
            err: String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          // Swallow — score commit continues.
        }
      }

      // (6) First-commit transition not_started → in_progress.
      // Promoted to services/round-state.ts in T5-8. The service handles
      // race-safe conditional UPDATE + audit row + rounds.opened_at side
      // effect. transitionState is idempotent on already-target state.
      let postState = rs.state;
      if (rs.state === 'not_started') {
        try {
          const result = await transitionState(
            tx,
            roundId,
            'in_progress',
            player.id,
            TENANT_ID,
          );
          postState = result.to;
        } catch (err) {
          // T5-8's transitionState throws BusinessRuleError on illegal
          // transitions or schema-level missing rows. For score-commit's
          // first-write context, the only realistic case is a concurrent
          // transition winning to a non-in_progress state (rare; would
          // need a /cancel during an in-flight first-commit). Re-read
          // and continue if the round is now in another writable state.
          const newState = await getRoundState(tx, roundId, TENANT_ID);
          postState = (newState ?? rs.state) as typeof postState;
          // If the round became finalized/cancelled mid-flight, we need
          // to roll the entire score-commit transaction back to keep the
          // hole_score insert from landing on a now-locked round.
          if (postState === 'finalized' || postState === 'cancelled') {
            throw err;
          }
        }
      }

      // (7) Auto-complete detection. Now driven by computeExpectedCells +
      // hole-count compare (unchanged); the transition itself goes through
      // transitionState, which encapsulates the race-safe conditional UPDATE.
      if (postState === 'in_progress') {
        const expected = await computeExpectedCells(tx, round, TENANT_ID);
        const actualResult = await tx
          .select({ count: sql<number>`count(*)` })
          .from(holeScores)
          .where(
            and(
              eq(holeScores.roundId, roundId),
              eq(holeScores.tenantId, TENANT_ID),
              sql`${holeScores.holeNumber} <= ${round.holesToPlay}`,
            ),
          );
        const actualCount = actualResult[0]?.count ?? 0;
        if (expected > 0 && actualCount >= expected) {
          // transitionState handles the race-safe conditional UPDATE +
          // audit row write. Idempotent if a concurrent commit raced to
          // the same target (returns {from: 'in_progress', to: same}).
          // Wrap in try/catch in case a /cancel raced in mid-flight; we
          // ignore illegal_state_transition to avoid blocking the score
          // commit itself (the score insert already landed earlier in
          // this tx).
          try {
            await transitionState(
              tx,
              roundId,
              'complete_editable',
              player.id,
              TENANT_ID,
            );
          } catch (err) {
            if (err instanceof BusinessRuleError && err.code === 'illegal_state_transition') {
              // Concurrent /cancel or other transition won the race.
              // Score insert already committed-in-tx; transition is best-effort.
            } else {
              throw err;
            }
          }
        }
      }

      // (8) 201 Created
      return c.json(
        {
          status: 'ok',
          clientEventId: body.clientEventId,
          holeScoreId: insertId,
          deduped: false,
        },
        201,
      );
    });
    } catch (err) {
      if (err instanceof BusinessRuleError && err.code === 'press_engine_error') {
        return c.json(
          { error: 'unprocessable', code: 'press_engine_error', requestId },
          422,
        );
      }
      throw err;
    }
  },
);

// `computeExpectedCells` was promoted to `services/round-state.ts` in T5-8.
// Imported at the top; no local definition needed.

/**
 * Detect SQLite's UNIQUE constraint failure via libsql's wrapped error
 * shape. libsql raises `LibsqlError` with one of:
 *   - `code` (string) = `'SQLITE_CONSTRAINT_UNIQUE'`
 *   - `extendedCode` (string) = same
 *   - `rawCode` (number) = 2067 (SQLITE_CONSTRAINT_UNIQUE extended result code)
 *
 * Drizzle re-throws preserving these fields. We check ALL three on both
 * the wrapping error and its `cause`. We do NOT fall back to message
 * substring matching because that's both too broad ("UNIQUE" appears in
 * error messages for unrelated index issues) and brittle across libsql
 * version updates.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  const sources = [err as Record<string, unknown>];
  if (cause && typeof cause === 'object')
    sources.push(cause as Record<string, unknown>);
  for (const src of sources) {
    const code = src['code'];
    const extendedCode = src['extendedCode'];
    const rawCode = src['rawCode'];
    if (
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
      rawCode === 2067
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// T5-4 course endpoint: GET /api/events/:eventId/rounds/:roundId/course
// Mounted in app.ts at `/api/events` via this separately-exported router.
// Chain: requireSession → requireEventParticipant. Returns the course
// payload (holes, tees, course meta) for the round. Read-only; cache
// hydration target for the offline scorecard-shell cache.
// ---------------------------------------------------------------------------

export const eventRoundsCourseRouter = new Hono();

/**
 * Path-param UUID validator. Runs BEFORE requireEventParticipant so a
 * malformed :eventId returns 400 rather than 403 (the participant
 * lookup with a malformed ID would silently 0-row → 403, masking the
 * bad-request shape). Round-1 codex catch.
 */
const courseRouterParamGuard: import('hono').MiddlewareHandler = async (
  c,
  next,
) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const eventId = c.req.param('eventId');
  const roundId = c.req.param('roundId');
  if (!eventId || !UUID_RE.test(eventId)) {
    return c.json(
      { error: 'bad_request', code: 'invalid_event_id', requestId },
      400,
    );
  }
  if (!roundId || !UUID_RE.test(roundId)) {
    return c.json(
      { error: 'bad_request', code: 'invalid_round_id', requestId },
      400,
    );
  }
  await next();
  return;
};

eventRoundsCourseRouter.get(
  '/:eventId/rounds/:roundId/course',
  // Order matters: requireSession first so an unauthenticated request
  // returns 401 even with malformed params (standard auth-first
  // convention). Then param guard (validates UUID-shape; returns 400
  // before requireEventParticipant runs a tenant query with a malformed
  // ID). Then requireEventParticipant (the actual participant gate).
  // Round-2 codex catch on auth precedence.
  requireSession,
  courseRouterParamGuard,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const eventId = c.req.param('eventId')!;
    const roundId = c.req.param('roundId')!;

    // (1) Fetch round + verify event_id matches the URL :eventId.
    const roundRows = await db
      .select({
        id: rounds.id,
        eventId: rounds.eventId,
        eventRoundId: rounds.eventRoundId,
      })
      .from(rounds)
      .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
      .limit(1);
    if (roundRows.length === 0 || roundRows[0]!.eventId !== eventId) {
      return c.json(
        { error: 'not_found', code: 'round_not_found', requestId },
        404,
      );
    }
    const round = roundRows[0]!;

    if (round.eventRoundId === null) {
      // v1.5 standalone-round shape; v1 never writes nulls.
      return c.json(
        { error: 'not_found', code: 'course_not_found', requestId },
        404,
      );
    }

    // (2) event_rounds → course_revision → course chain. Defense-in-depth:
    // verify event_round.event_id matches the URL :eventId. If a data-
    // integrity bug ever points an event_round to the wrong event,
    // this guards against cross-event course leakage within the tenant.
    // Round-1 codex catch.
    const erRows = await db
      .select({
        eventId: eventRounds.eventId,
        teeColor: eventRounds.teeColor,
        courseRevisionId: eventRounds.courseRevisionId,
      })
      .from(eventRounds)
      .where(
        and(
          eq(eventRounds.id, round.eventRoundId),
          eq(eventRounds.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (erRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'course_not_found', requestId },
        404,
      );
    }
    if (erRows[0]!.eventId !== eventId) {
      // Defense-in-depth: event_round.event_id MUST match URL :eventId.
      // Mismatch implies a data-integrity bug; return round_not_found
      // (uniform with the rounds.event_id mismatch path above) so a
      // caller can't infer the inconsistency.
      return c.json(
        { error: 'not_found', code: 'round_not_found', requestId },
        404,
      );
    }
    const eventRound = erRows[0]!;

    const crRows = await db
      .select({
        id: courseRevisions.id,
        courseId: courseRevisions.courseId,
      })
      .from(courseRevisions)
      .where(
        and(
          eq(courseRevisions.id, eventRound.courseRevisionId),
          eq(courseRevisions.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (crRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'course_not_found', requestId },
        404,
      );
    }
    const courseRevision = crRows[0]!;

    const courseRows = await db
      .select({ name: courses.name, clubName: courses.clubName })
      .from(courses)
      .where(
        and(
          eq(courses.id, courseRevision.courseId),
          eq(courses.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (courseRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'course_not_found', requestId },
        404,
      );
    }
    const course = courseRows[0]!;

    // (3) holes (ordered by hole_number ASC) + tees.
    const holeRows = await db
      .select({
        holeNumber: courseHoles.holeNumber,
        par: courseHoles.par,
        si: courseHoles.si,
        yardagePerTeeJson: courseHoles.yardagePerTeeJson,
      })
      .from(courseHoles)
      .where(
        and(
          eq(courseHoles.courseRevisionId, courseRevision.id),
          eq(courseHoles.tenantId, TENANT_ID),
        ),
      )
      .orderBy(courseHoles.holeNumber);

    const teeRows = await db
      .select({
        teeColor: courseTees.teeColor,
        rating: courseTees.rating,
        slope: courseTees.slope,
      })
      .from(courseTees)
      .where(
        and(
          eq(courseTees.courseRevisionId, courseRevision.id),
          eq(courseTees.tenantId, TENANT_ID),
        ),
      );

    const holes = holeRows.map((h) => {
      let yardagePerTee: Record<string, number> = {};
      try {
        yardagePerTee = JSON.parse(h.yardagePerTeeJson) as Record<
          string,
          number
        >;
      } catch {
        yardagePerTee = {};
      }
      return {
        holeNumber: h.holeNumber,
        par: h.par,
        si: h.si,
        yardagePerTee,
      };
    });

    return c.json(
      {
        roundId,
        courseRevisionId: courseRevision.id,
        course: {
          name: course.name,
          clubName: course.clubName,
        },
        holes,
        tees: teeRows,
        selectedTeeColor: eventRound.teeColor,
      },
      200,
    );
  },
);
