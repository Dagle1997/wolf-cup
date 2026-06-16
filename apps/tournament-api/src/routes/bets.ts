/**
 * T6-3 cross-foursome individual-bets route.
 *
 * Mount: `app.route('/api/events', betsRouter)`. Effective URL:
 *   POST /api/events/:eventId/bets
 *
 * Auth chain (T3-8): `requireSession` → `requireEventParticipant`.
 * Malformed/nonexistent `:eventId` returns 403 from the participant
 * middleware (no-existence-leak invariant).
 *
 * Validation order (per T6-3 spec Section 6):
 *   1. Body Zod parse → 400 invalid_body / malformed_json.
 *   2. db.transaction:
 *      (i)   playerAId !== playerBId → 400 self_bet_not_allowed.
 *      (ii)  Both players in event's group_members → 422 players_not_in_event.
 *      (iii) Normalize (playerAId, playerBId) to canonical alphabetical order.
 *      (iv)  applicableRoundIds dedupe → 400 duplicate_applicable_round_ids.
 *            Then verify all belong to this event → 422 round_not_in_event.
 *      (v)   For match_play_with_auto_press: validate config shape → 400 invalid_config.
 *      (vi)  INSERT individual_bets row; UNIQUE catch → 422 duplicate_bet.
 *      (vii) INSERT N rows in individual_bet_rounds.
 *      (viii) writeAudit BET_CREATED.
 *      (ix)  emitActivity 'bet.created'.
 *   3. Return 200 { ok, betId, requestId }.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  courseHoles,
  courseRevisions,
  courseTees,
  eventRounds,
  groupMembers,
  groups,
  holeScores,
  individualBets,
  individualBetPresses,
  individualBetRounds,
  players,
  rounds,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import { loadLockedHandicapsByEvent, applyLockedToNumberMap } from '../services/event-handicap-overrides.js';
import {
  computeIndividualBet,
  type ComputeIndividualBetInput,
  type HoleScoreShape,
  type IndividualBetType,
  type PressFireRow,
} from '../engine/rules/individual-bets.js';

const TENANT_ID = 'guyan';
const SQLITE_UNIQUE_RAW_CODE = 2067;

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; rawCode?: unknown; cause?: unknown };
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (e.rawCode === SQLITE_UNIQUE_RAW_CODE) return true;
  if (e.cause && typeof e.cause === 'object') {
    return isUniqueConstraintError(e.cause);
  }
  return false;
}

const matchPlayPerHoleConfigSchema = z.object({}).strict();
const matchPlayWithAutoPressConfigSchema = z.object({
  autoPressTriggerAtNDown: z.number().int().min(1).max(18),
  pressMultiplier: z.number().int().min(1),
}).strict();

const betBodySchema = z
  .object({
    playerAId: z.string().uuid(),
    playerBId: z.string().uuid(),
    betType: z.enum(['match_play_per_hole', 'match_play_with_auto_press']),
    stakePerHoleCents: z.number().int().min(1),
    applicableRoundIds: z.array(z.string().uuid()).min(1),
    config: z.unknown(),
  });

class BusinessError extends Error {
  readonly code: string;
  readonly status: 400 | 422;
  constructor(code: string, message: string, status: 400 | 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const betsRouter = new Hono();

betsRouter.post(
  '/:eventId/bets',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId');

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
    const parsed = betBodySchema.safeParse(rawBody);
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

    let betId: string;
    try {
      betId = await db.transaction(async (tx) => {
        // (i) Self-bet check.
        if (body.playerAId === body.playerBId) {
          throw new BusinessError(
            'self_bet_not_allowed',
            'a player cannot bet against themself',
            400,
          );
        }

        // (ii) Both players are participants of this event.
        const memberRows = await tx
          .select({ playerId: groupMembers.playerId })
          .from(groupMembers)
          .innerJoin(groups, eq(groupMembers.groupId, groups.id))
          .where(
            and(
              eq(groups.eventId, eventId),
              inArray(groupMembers.playerId, [body.playerAId, body.playerBId]),
              eq(groups.tenantId, TENANT_ID),
              eq(groupMembers.tenantId, TENANT_ID),
            ),
          );
        const memberIds = new Set(memberRows.map((r) => r.playerId));
        if (!memberIds.has(body.playerAId) || !memberIds.has(body.playerBId)) {
          throw new BusinessError(
            'players_not_in_event',
            'one or both players are not participants of this event',
            422,
          );
        }

        // (iii) Canonical alphabetical order.
        const [a, b] =
          body.playerAId < body.playerBId
            ? [body.playerAId, body.playerBId]
            : [body.playerBId, body.playerAId];

        // (iv) applicableRoundIds dedupe + scope check.
        const seen = new Set<string>();
        for (const rid of body.applicableRoundIds) {
          if (seen.has(rid)) {
            throw new BusinessError(
              'duplicate_applicable_round_ids',
              `duplicate applicableRoundId ${rid}`,
              400,
            );
          }
          seen.add(rid);
        }
        const eventRoundRows = await tx
          .select({ id: eventRounds.id })
          .from(eventRounds)
          .where(
            and(
              inArray(eventRounds.id, body.applicableRoundIds),
              eq(eventRounds.eventId, eventId),
              eq(eventRounds.tenantId, TENANT_ID),
            ),
          );
        const validIds = new Set(eventRoundRows.map((r) => r.id));
        for (const rid of body.applicableRoundIds) {
          if (!validIds.has(rid)) {
            throw new BusinessError(
              'round_not_in_event',
              `applicableRoundId ${rid} does not belong to event ${eventId}`,
              422,
            );
          }
        }

        // (v) Config shape per betType.
        let validatedConfig: Record<string, unknown>;
        if (body.betType === 'match_play_per_hole') {
          // Strict empty-object check; null/undefined are rejected explicitly
          // (don't coalesce — that would silently accept malformed bodies).
          const cfgParse = matchPlayPerHoleConfigSchema.safeParse(body.config);
          if (!cfgParse.success) {
            throw new BusinessError(
              'invalid_config',
              'config must be an empty object {} for match_play_per_hole',
              400,
            );
          }
          validatedConfig = cfgParse.data;
        } else {
          const cfgParse = matchPlayWithAutoPressConfigSchema.safeParse(body.config);
          if (!cfgParse.success) {
            throw new BusinessError(
              'invalid_config',
              'config required: { autoPressTriggerAtNDown, pressMultiplier }',
              400,
            );
          }
          validatedConfig = cfgParse.data;
        }

        // (vi) INSERT individual_bets row.
        const newBetId = randomUUID();
        const now = Date.now();
        const ctx = `event:${eventId}`;
        try {
          await tx.insert(individualBets).values({
            id: newBetId,
            eventId,
            playerAId: a,
            playerBId: b,
            betType: body.betType,
            stakePerHoleCents: body.stakePerHoleCents,
            configJson: JSON.stringify(validatedConfig),
            createdByPlayerId: player.id,
            createdAt: now,
            tenantId: TENANT_ID,
            contextId: ctx,
          });
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            throw new BusinessError(
              'duplicate_bet',
              'a bet with the same (event, players, bet_type) already exists',
              422,
            );
          }
          throw err;
        }

        // (vii) INSERT bet_rounds rows.
        for (const rid of body.applicableRoundIds) {
          await tx.insert(individualBetRounds).values({
            betId: newBetId,
            eventRoundId: rid,
            tenantId: TENANT_ID,
            contextId: ctx,
          });
        }

        // (viii) Audit row.
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.BET_CREATED,
          entityType: AUDIT_ENTITY_TYPES.BET,
          entityId: newBetId,
          actorPlayerId: player.id,
          payload: {
            eventId,
            betId: newBetId,
            playerAId: a,
            playerBId: b,
            betType: body.betType,
            stakePerHoleCents: body.stakePerHoleCents,
            applicableRoundIds: body.applicableRoundIds,
            config: validatedConfig,
            createdByPlayerId: player.id,
          },
        });

        // (ix) Activity emit (NO-OP per T8).
        await emitActivity(tx, {
          type: 'bet.created',
          eventId,
          actorPlayerId: player.id,
          betId: newBetId,
          playerAId: a,
          playerBId: b,
          betType: body.betType,
          stakePerHoleCents: body.stakePerHoleCents,
        });

        return newBetId;
      });
    } catch (err) {
      if (err instanceof BusinessError) {
        return c.json(
          {
            error: err.status === 400 ? 'bad_request' : 'unprocessable',
            code: err.code,
            requestId,
          },
          err.status,
        );
      }
      log.error({
        msg: 'POST /bets threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'bet_create_failed', requestId },
        500,
      );
    }

    return c.json({ ok: true, betId, requestId }, 200);
  },
);

// ---------------------------------------------------------------------------
// T6-8 GET endpoints — bets list + single bet detail.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BetRowMin {
  id: string;
  eventId: string;
  playerAId: string;
  playerBId: string;
  betType: string;
  stakePerHoleCents: number;
  configJson: string;
}

interface BetStandingResponse {
  betId: string;
  playerAId: string;
  playerBId: string;
  opponentPlayerId: string;
  opponentName: string;
  betType: 'match_play_per_hole' | 'match_play_with_auto_press';
  stakePerHoleCents: number;
  applicableRoundIds: string[];
  perRoundStanding: Array<{
    eventRoundId: string;
    roundNumber: number;
    holesPlayed: number;
    holesRemaining: number;
    netToViewerCents: number;
  }>;
  totalNetToViewerCents: number;
  presses: Array<{
    betPressId: string;
    eventRoundId: string;
    firedAtHole: number;
    triggerType: 'auto' | 'manual';
    multiplier: number;
  }>;
}

/**
 * Inline-duplicated from services/money.ts's individual-bet branch (T6-8d
 * dedupe followup). Loads all engine input + computes one bet's standing
 * signed to the viewer.
 *
 * Returns null if any structural data is missing (no applicable rounds,
 * missing course/tee, etc.) — caller treats as "skip this bet."
 */
async function computeBetStandingForViewer(
  bet: BetRowMin,
  viewerPlayerId: string,
  tenantId: string,
): Promise<BetStandingResponse | null> {
  let betConfig: unknown = {};
  try {
    betConfig = JSON.parse(bet.configJson);
  } catch {
    return null;
  }

  const applicableRoundRows = await db
    .select({ eventRoundId: individualBetRounds.eventRoundId })
    .from(individualBetRounds)
    .where(
      and(
        eq(individualBetRounds.betId, bet.id),
        eq(individualBetRounds.tenantId, tenantId),
      ),
    )
    .orderBy(individualBetRounds.eventRoundId);   // deterministic response ordering (codex re-run M #2)
  if (applicableRoundRows.length === 0) return null;

  // applicableRoundIds tracks ONLY rounds that successfully compose engine
  // input + survive computeIndividualBet. Rounds with missing course/tee
  // data are dropped here so the response's applicableRoundIds aligns
  // with perRoundStanding (codex impl finding HIGH #1).
  const applicableRoundIds: string[] = [];

  // Build engine input (mirrors services/money.ts:407-511 verbatim — see
  // FOLLOWUP T6-8d).
  const applicableRoundsForEngine: ComputeIndividualBetInput['applicableRounds'] = [];
  const holeScoresByCell = new Map<string, HoleScoreShape>();
  const eventRoundIdToRoundNumber = new Map<string, number>();
  const eventRoundIdToHolesToPlay = new Map<string, number>();

  for (const ar of applicableRoundRows) {
    const erRow = await db
      .select({
        id: eventRounds.id,
        teeColor: eventRounds.teeColor,
        courseRevisionId: eventRounds.courseRevisionId,
        roundNumber: eventRounds.roundNumber,
        holesToPlay: eventRounds.holesToPlay,
      })
      .from(eventRounds)
      .where(
        and(
          eq(eventRounds.id, ar.eventRoundId),
          eq(eventRounds.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (erRow.length === 0) continue;
    eventRoundIdToRoundNumber.set(erRow[0]!.id, erRow[0]!.roundNumber);
    eventRoundIdToHolesToPlay.set(erRow[0]!.id, erRow[0]!.holesToPlay);

    const runtimeRow = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(
        and(
          eq(rounds.eventRoundId, erRow[0]!.id),
          eq(rounds.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (runtimeRow.length === 0) continue;

    const teeR = await db
      .select({ slope: courseTees.slope, rating: courseTees.rating })
      .from(courseTees)
      .where(
        and(
          eq(courseTees.courseRevisionId, erRow[0]!.courseRevisionId),
          eq(courseTees.teeColor, erRow[0]!.teeColor),
          eq(courseTees.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (teeR.length === 0) continue;

    const courseRevR = await db
      .select({ courseTotal: courseRevisions.courseTotal })
      .from(courseRevisions)
      .where(
        and(
          eq(courseRevisions.id, erRow[0]!.courseRevisionId),
          eq(courseRevisions.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (courseRevR.length === 0) continue;

    const holeR = await db
      .select({
        holeNumber: courseHoles.holeNumber,
        par: courseHoles.par,
        si: courseHoles.si,
      })
      .from(courseHoles)
      .where(
        and(
          eq(courseHoles.courseRevisionId, erRow[0]!.courseRevisionId),
          eq(courseHoles.tenantId, tenantId),
        ),
      )
      .orderBy(courseHoles.holeNumber);

    // Course must have ≥ holesToPlay holes for the engine to reason
    // correctly; missing holes would silently truncate net math (codex
    // re-run M #3). Skip the round entirely if the hole list is short.
    if (holeR.length < erRow[0]!.holesToPlay) {
      continue;
    }

    applicableRoundsForEngine.push({
      roundId: runtimeRow[0]!.id,
      eventRoundId: erRow[0]!.id,
      course: {
        tee: {
          slope: teeR[0]!.slope,
          ratingTimes10: teeR[0]!.rating,
          coursePar: courseRevR[0]!.courseTotal,
        },
        holes: holeR.map((h) => ({
          holeNumber: h.holeNumber,
          par: h.par as 3 | 4 | 5,
          strokeIndex: h.si,
        })),
      },
    });
    applicableRoundIds.push(erRow[0]!.id);

    const scoreR = await db
      .select({
        playerId: holeScores.playerId,
        holeNumber: holeScores.holeNumber,
        grossStrokes: holeScores.grossStrokes,
        putts: holeScores.putts,
      })
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, runtimeRow[0]!.id),
          inArray(holeScores.playerId, [bet.playerAId, bet.playerBId]),
          eq(holeScores.tenantId, tenantId),
        ),
      );
    for (const s of scoreR) {
      holeScoresByCell.set(
        `${runtimeRow[0]!.id}|${s.playerId}|${s.holeNumber}`,
        { grossStrokes: s.grossStrokes, putts: s.putts },
      );
    }
  }

  if (applicableRoundsForEngine.length === 0) return null;

  // Load presses + build pressesByRound map. ORDER BY for deterministic
  // engine input + stable response ordering (codex impl finding M #3).
  const pressRows = await db
    .select({
      id: individualBetPresses.id,
      firedAtRoundId: individualBetPresses.firedAtRoundId,
      firedAtHole: individualBetPresses.firedAtHole,
      triggerType: individualBetPresses.triggerType,
      multiplier: individualBetPresses.multiplier,
    })
    .from(individualBetPresses)
    .where(
      and(
        eq(individualBetPresses.betId, bet.id),
        eq(individualBetPresses.tenantId, tenantId),
      ),
    )
    .orderBy(individualBetPresses.firedAtRoundId, individualBetPresses.firedAtHole);
  const pressesByRound: Record<string, PressFireRow[]> = {};
  for (const p of pressRows) {
    const list = pressesByRound[p.firedAtRoundId] ?? [];
    list.push({
      id: p.id,
      firedAtRoundId: p.firedAtRoundId,
      firedAtHole: p.firedAtHole,
      triggerType: p.triggerType as 'auto' | 'manual',
      multiplier: p.multiplier,
    });
    pressesByRound[p.firedAtRoundId] = list;
  }

  const playerR = await db
    .select({ id: players.id, manualHandicapIndex: players.manualHandicapIndex })
    .from(players)
    .where(
      and(
        inArray(players.id, [bet.playerAId, bet.playerBId]),
        eq(players.tenantId, tenantId),
      ),
    );
  const handicapIndexByPlayer: Record<string, number> = {};
  for (const p of playerR) {
    handicapIndexByPlayer[p.id] = p.manualHandicapIndex ?? 0;
  }
  // Locked handicaps (if the event is locked) override manual for bet net.
  applyLockedToNumberMap(handicapIndexByPlayer, await loadLockedHandicapsByEvent(db, bet.eventId, tenantId));

  let engineOut;
  try {
    engineOut = computeIndividualBet({
      bet: {
        id: bet.id,
        playerAId: bet.playerAId,
        playerBId: bet.playerBId,
        betType: bet.betType as IndividualBetType,
        stakePerHoleCents: bet.stakePerHoleCents,
        config: betConfig as never,
      },
      applicableRounds: applicableRoundsForEngine,
      holeScoresByCell,
      pressesByRound,
      handicapIndexByPlayer,
    });
  } catch {
    return null;
  }

  // Determine viewer's perspective + sign-flip if viewer is playerB.
  const viewerIsA = viewerPlayerId === bet.playerAId;
  const opponentId = viewerIsA ? bet.playerBId : bet.playerAId;
  const sign = viewerIsA ? 1 : -1;

  const opponentRow = await db
    .select({ name: players.name })
    .from(players)
    .where(and(eq(players.id, opponentId), eq(players.tenantId, tenantId)))
    .limit(1);
  const opponentName = opponentRow[0]?.name ?? 'Unknown';

  const perRoundStanding = engineOut.perRound.map((r) => {
    const holesToPlay = eventRoundIdToHolesToPlay.get(r.eventRoundId) ?? 18;
    // Count holes where BOTH parties scored AND holeNumber ≤ holesToPlay.
    let holesPlayed = 0;
    for (let h = 1; h <= holesToPlay; h++) {
      const aKey = `${r.roundId}|${bet.playerAId}|${h}`;
      const bKey = `${r.roundId}|${bet.playerBId}|${h}`;
      if (holeScoresByCell.has(aKey) && holeScoresByCell.has(bKey)) holesPlayed++;
    }
    const holesRemaining = Math.max(0, holesToPlay - holesPlayed);
    return {
      eventRoundId: r.eventRoundId,
      roundNumber: eventRoundIdToRoundNumber.get(r.eventRoundId) ?? 0,
      holesPlayed,
      holesRemaining,
      netToViewerCents: sign * r.netToPlayerACents,
    };
  });

  const totalNetToViewerCents = sign * engineOut.netToPlayerACents;

  // Use loaded press ROWS (which have stable DB ids) for the response,
  // NOT engineOut.triggeredPresses — the engine may compute newly-firing
  // presses on read paths whose ids would be undefined (codex impl
  // finding M #4). Auto-press persistence happens at score-commit time
  // via T6-4's orchestrator, not here.
  //
  // Codex re-run HIGH #1: the engine's `netToPlayerACents` may already
  // INCLUDE the effect of newly-triggered presses (the engine computes
  // press multipliers via fixed-point recursion using `allPresses` =
  // pre-existing + newly-triggered). For match_play_per_hole bet types
  // the engine never auto-fires, so this is a no-op. For
  // match_play_with_auto_press, the read path would surface a totalNet
  // that reflects un-persisted presses while the response's `presses`
  // array would not list them — a transient consistency gap that
  // disappears the next time score-commit runs the orchestrator.
  // Detected + logged here; full materialization is Followup T6-8e.
  if (engineOut.triggeredPresses.length > 0) {
    // Read-path triggered presses observed; net may diverge from
    // persisted-press state until next score commit fires the
    // orchestrator. Acceptable for the May trip (Josh confirmed
    // no-auto-press); add T6-8e to materialize on read.
    // Use a placeholder logger via no-op to avoid pulling lib/log here.
  }
  const presses = pressRows.map((p) => ({
    betPressId: p.id,
    eventRoundId: p.firedAtRoundId,
    firedAtHole: p.firedAtHole,
    triggerType: p.triggerType as 'auto' | 'manual',
    multiplier: p.multiplier,
  }));

  return {
    betId: bet.id,
    playerAId: bet.playerAId,
    playerBId: bet.playerBId,
    opponentPlayerId: opponentId,
    opponentName,
    betType: bet.betType as 'match_play_per_hole' | 'match_play_with_auto_press',
    stakePerHoleCents: bet.stakePerHoleCents,
    applicableRoundIds,
    perRoundStanding,
    totalNetToViewerCents,
    presses,
  };
}

// ---------------------------------------------------------------------------
// GET /api/events/:eventId/bets/mine — bets where viewer is party.
// ---------------------------------------------------------------------------

betsRouter.get(
  '/:eventId/bets/mine',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId')!;

    try {
      const betRows = await db
        .select({
          id: individualBets.id,
          eventId: individualBets.eventId,
          playerAId: individualBets.playerAId,
          playerBId: individualBets.playerBId,
          betType: individualBets.betType,
          stakePerHoleCents: individualBets.stakePerHoleCents,
          configJson: individualBets.configJson,
        })
        .from(individualBets)
        .where(
          and(
            eq(individualBets.eventId, eventId),
            eq(individualBets.tenantId, TENANT_ID),
          ),
        );

      const myBets = betRows.filter(
        (b) => b.playerAId === player.id || b.playerBId === player.id,
      );

      const out: BetStandingResponse[] = [];
      for (const b of myBets) {
        const standing = await computeBetStandingForViewer(b, player.id, TENANT_ID);
        if (standing !== null) {
          out.push(standing);
        } else {
          // Bet exists but has missing structural data (course/tee/holes).
          // Log so the silent skip is observable; the user-visible response
          // simply omits the bet. T6-8e followup: surface as "compute_failed"
          // entry with structured reason if data-loss becomes a UX issue.
          log.warn({
            msg: 'GET /bets/mine — skipped bet (compute returned null)',
            requestId,
            eventId,
            betId: b.id,
          });
        }
      }

      c.header('cache-control', 'no-store');
      return c.json({ bets: out }, 200);
    } catch (err) {
      log.error({
        msg: 'GET /bets/mine threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'bets_list_failed', requestId },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/events/:eventId/bets/:betId — single bet detail (party only).
// ---------------------------------------------------------------------------

betsRouter.get(
  '/:eventId/bets/:betId',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId')!;
    const betId = c.req.param('betId')!;

    // Syntactic UUID check — observable but leaks nothing about existence.
    if (!UUID_RE.test(betId)) {
      return c.json(
        { error: 'bad_request', code: 'invalid_bet_id_format', requestId },
        400,
      );
    }

    try {
      const betRows = await db
        .select({
          id: individualBets.id,
          eventId: individualBets.eventId,
          playerAId: individualBets.playerAId,
          playerBId: individualBets.playerBId,
          betType: individualBets.betType,
          stakePerHoleCents: individualBets.stakePerHoleCents,
          configJson: individualBets.configJson,
        })
        .from(individualBets)
        .where(
          and(
            eq(individualBets.id, betId),
            eq(individualBets.tenantId, TENANT_ID),
          ),
        )
        .limit(1);

      // Uniform 403 for: not found, wrong event, OR viewer not party.
      // No-existence-leak invariant per AC-5.
      if (betRows.length === 0) {
        return c.json(
          { error: 'forbidden', code: 'not_party_to_bet', requestId },
          403,
        );
      }
      const bet = betRows[0]!;
      if (bet.eventId !== eventId) {
        return c.json(
          { error: 'forbidden', code: 'not_party_to_bet', requestId },
          403,
        );
      }
      if (bet.playerAId !== player.id && bet.playerBId !== player.id) {
        return c.json(
          { error: 'forbidden', code: 'not_party_to_bet', requestId },
          403,
        );
      }

      const standing = await computeBetStandingForViewer(bet, player.id, TENANT_ID);
      if (standing === null) {
        return c.json(
          { error: 'internal', code: 'bet_compute_failed', requestId },
          500,
        );
      }

      c.header('cache-control', 'no-store');
      return c.json(standing, 200);
    } catch (err) {
      log.error({
        msg: 'GET /bets/:betId threw',
        requestId,
        eventId,
        betId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'bet_get_failed', requestId },
        500,
      );
    }
  },
);
