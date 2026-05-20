/**
 * T6-4 press orchestrator.
 *
 * Invoked from the score-commit transaction (apps/tournament-api/src/
 * routes/scores.ts step 5b) AFTER the hole_score insert + audit/activity
 * for `score.committed`. Detects hole-complete (all 4 foursome members
 * scored hole N), then runs the press engine and persists newlyFired
 * rows into team_press_log + emits press.auto_fired activities.
 *
 * **Engine pipeline:**
 *   compute2v2BestBall(perHoleResults) → evaluatePresses(perHoleResults,
 *   manualPresses=[], existingPressLog, config, throughHole=N)
 *
 * **Hole-complete detection (T6-4 spec Section 3 + codex C#1 fix):**
 * The query is event_round_id-scoped via the rounds.event_round_id
 * link, NOT just foursome_number — otherwise a foursome_number could
 * match a different round's foursome and false-trigger.
 *
 * **4-player guard rail (codex H#2 fix):** if the foursome's
 * pairing_members count != 4, skip press evaluation entirely with a
 * warning log. The compute2v2BestBall + evaluatePresses engines are
 * 2v2-only.
 *
 * **UNIQUE-violation handling (T6-4 spec Section 5):** the INSERT
 * into team_press_log may UNIQUE-violate under SQLite WAL snapshot
 * residual races. Catch + log + continue; do NOT abort the tx.
 *
 * **Engine error handling (T6-4 spec Section 6):** the orchestrator
 * catches throws from compute2v2BestBall / evaluatePresses and rethrows
 * as `BusinessRuleError('press_engine_error', message, 422)`. The
 * scores.ts route's outer try/catch maps this to a 422 response and
 * rolls back the tx.
 *
 * **v1 scope (T6-4 spec Section 7):** TEAM PRESSES ONLY. Individual-bet
 * press orchestration is Followup T6-4a.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  courseHoles,
  courseRevisions,
  courseTees,
  eventRounds,
  holeScores,
  pairingMembers,
  pairings,
  players,
  rounds,
  ruleSetRevisions,
  ruleSets,
  teamPressLog,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { pressesDisabled } from '../lib/env.js';
import { buildTeeByPlayer } from './per-player-tee.js';
import { emitActivity } from '../lib/activity.js';
import { BusinessRuleError } from './round-state.js';
import {
  compute2v2BestBall,
  type Compute2v2BestBallInput,
  type HoleScoreInput,
  type HoleMetaInput,
  type HoleShape,
} from '../engine/formats/best-ball-2v2.js';
import {
  evaluatePresses,
  type Press,
  type PressLogEntry,
} from '../engine/rules/press.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type RunPressOrchestratorInput = {
  roundId: string;
  /** The hole number whose just-committed score may complete the hole. */
  holeNumber: number;
  /** The player whose score was just committed. */
  scoredPlayerId: string;
  /** The player who committed the score (for activity attribution). */
  scorerPlayerId: string;
};

/**
 * v1 helper to fetch the press + 2v2 config from the latest rule_set_revision.
 * Returns null if no rule_set exists in tenant scope OR if config can't be parsed.
 *
 * This is a SIMPLE v1 lookup — it picks the most-recent revision regardless of
 * effective-hole boundary. Followup T6-4f tracks proper effective-from-hole-aware
 * revision selection (will use T5-11's revision boundary semantics).
 */
async function fetchActivePressConfig(
  tx: Tx | Db,
  tenantId: string,
): Promise<
  | {
      autoPressTriggerAtNDown: number | null;
      pressMultiplier: number;
      basePerHoleCents: number;
      sandies: boolean;
      sandiesBonusPerHoleCents: number;
      greenieCarryover: boolean;
      greenieValidation: '2-putt' | 'none';
      greenieBaseCents: number;
    }
  | null
> {
  // Deterministic: most-recent rule_set in tenant by created_at desc, id desc tiebreak.
  // v1 trip-day reality has 1 rule_set per tenant; followup T6-4f tracks proper
  // event-rule-set linkage when the schema gains it.
  const ruleSetRows = await tx
    .select({ id: ruleSets.id })
    .from(ruleSets)
    .where(eq(ruleSets.tenantId, tenantId))
    .orderBy(desc(ruleSets.createdAt), desc(ruleSets.id))
    .limit(1);
  if (ruleSetRows.length === 0) return null;

  const revRows = await tx
    .select({ configJson: ruleSetRevisions.configJson })
    .from(ruleSetRevisions)
    .where(
      and(
        eq(ruleSetRevisions.ruleSetId, ruleSetRows[0]!.id),
        eq(ruleSetRevisions.tenantId, tenantId),
      ),
    )
    .orderBy(desc(ruleSetRevisions.revisionNumber))
    .limit(1);
  if (revRows.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(revRows[0]!.configJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const cfg = parsed as Record<string, unknown>;

  const autoPressTriggerAtNDown =
    typeof cfg['autoPressTriggerAtNDown'] === 'number'
      ? (cfg['autoPressTriggerAtNDown'] as number)
      : null;
  const pressMultiplier =
    typeof cfg['pressMultiplier'] === 'number'
      ? (cfg['pressMultiplier'] as number)
      : 2;
  const basePerHoleCents =
    typeof cfg['basePerHoleCents'] === 'number' ? (cfg['basePerHoleCents'] as number) : 100;
  const sandies = typeof cfg['sandies'] === 'boolean' ? (cfg['sandies'] as boolean) : false;
  const sandiesBonusPerHoleCents =
    typeof cfg['sandiesBonusPerHoleCents'] === 'number'
      ? (cfg['sandiesBonusPerHoleCents'] as number)
      : 0;
  const greenieCarryover =
    typeof cfg['greenieCarryover'] === 'boolean' ? (cfg['greenieCarryover'] as boolean) : false;
  const greenieValidation =
    cfg['greenieValidation'] === '2-putt' ? '2-putt' : 'none';
  const greenieBaseCents =
    typeof cfg['greenieBaseCents'] === 'number' ? (cfg['greenieBaseCents'] as number) : 0;

  return {
    autoPressTriggerAtNDown,
    pressMultiplier,
    basePerHoleCents,
    sandies,
    sandiesBonusPerHoleCents,
    greenieCarryover,
    greenieValidation,
    greenieBaseCents,
  };
}

export async function runPressOrchestrator(
  tx: Tx,
  input: RunPressOrchestratorInput,
  tenantId: string,
  logger = moduleLogger,
): Promise<void> {
  const { roundId, holeNumber, scoredPlayerId, scorerPlayerId } = input;

  // ── (0) Operational kill switch. ──────────────────────────────────────────
  // The original 2026-05-07 reason for this gate (foursome-blind UNIQUE in
  // team_press_log) was resolved by T10-1's migration 0012: the schema now
  // includes `foursome_number` in both the column set and the UNIQUE index,
  // and both INSERT sites + the existingPressLog filter + the DELETE-undo
  // lookup thread it through. The env flag is retained as an operational
  // override — if presses misbehave in production for any future reason,
  // setting TOURNAMENT_PRESSES_DISABLED=true on the VPS turns them off
  // without a redeploy. The flag is read at call time (see
  // `pressesDisabled()` in lib/env.ts) so tests can stub it.
  if (pressesDisabled()) {
    logger.info({
      msg: 'press_orchestrator: skipped (TOURNAMENT_PRESSES_DISABLED=true)',
      roundId,
      holeNumber,
    });
    return;
  }

  // ── (1) Find the foursome the scored player belongs to in this round. ──
  // The pairing_members → pairings → event_rounds chain is event_round_id-scoped
  // via rounds.event_round_id (codex spec C#1 fix).
  const myFoursomeRows = await tx
    .select({ foursomeNumber: pairings.foursomeNumber })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairings.id, pairingMembers.pairingId))
    .innerJoin(rounds, eq(rounds.eventRoundId, pairings.eventRoundId))
    .where(
      and(
        eq(rounds.id, roundId),
        eq(pairingMembers.playerId, scoredPlayerId),
        eq(pairings.tenantId, tenantId),
        eq(pairingMembers.tenantId, tenantId),
        eq(rounds.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (myFoursomeRows.length === 0) {
    logger.warn({
      msg: 'press_orchestrator: scored player not in any pairing for this round',
      roundId,
      scoredPlayerId,
    });
    return;
  }
  const foursomeNumber = myFoursomeRows[0]!.foursomeNumber;

  // ── (2) Identify the foursome's expected members. ──
  const memberRows = await tx
    .select({ playerId: pairingMembers.playerId })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairings.id, pairingMembers.pairingId))
    .innerJoin(rounds, eq(rounds.eventRoundId, pairings.eventRoundId))
    .where(
      and(
        eq(rounds.id, roundId),
        eq(pairings.foursomeNumber, foursomeNumber),
        eq(pairings.tenantId, tenantId),
        eq(pairingMembers.tenantId, tenantId),
        eq(rounds.tenantId, tenantId),
      ),
    );
  const expectedMembers = memberRows.map((r) => r.playerId);

  // ── (3) 4-player guard rail (codex spec H#2 fix). ──
  if (expectedMembers.length !== 4) {
    logger.warn({
      msg: 'press_orchestrator: foursome member count != 4; skipping press eval',
      roundId,
      foursomeNumber,
      memberCount: expectedMembers.length,
    });
    return;
  }

  // ── (4) Hole-complete check: count distinct player_ids in hole_scores
  // for the foursome members at hole N. The hole_scores schema's cell-
  // level UNIQUE on (round_id, player_id, hole_number) already guarantees
  // at most one row per (round, player, hole), so distinctness is
  // schema-enforced — but we use a Set defense-in-depth. ──
  const scoredRows = await tx
    .select({ playerId: holeScores.playerId })
    .from(holeScores)
    .where(
      and(
        eq(holeScores.roundId, roundId),
        eq(holeScores.holeNumber, holeNumber),
        inArray(holeScores.playerId, expectedMembers),
        eq(holeScores.tenantId, tenantId),
      ),
    );
  const distinctScored = new Set(scoredRows.map((r) => r.playerId));
  if (distinctScored.size < 4) {
    // Hole not complete; skip press eval. Score commit succeeded.
    return;
  }

  // ── (5) Read round + event for activity scope. ──
  const roundRows = await tx
    .select({
      id: rounds.id,
      eventId: rounds.eventId,
      eventRoundId: rounds.eventRoundId,
      holesToPlay: rounds.holesToPlay,
    })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, tenantId)))
    .limit(1);
  if (roundRows.length === 0) return; // defense; round must exist
  const round = roundRows[0]!;

  // ── (6) Read course (tee + holes) from event_round → courseRevision. ──
  // Engine needs course config for handicap math.
  if (!round.eventRoundId) {
    logger.warn({
      msg: 'press_orchestrator: round missing eventRoundId; skipping press eval',
      roundId,
    });
    return;
  }

  // Fetch course holes + tee shape via courseRevision.
  // Build via a flat query joining event_rounds → course_revisions →
  // course_tees → course_holes. v1 keeps queries narrow; T6-4f will
  // consolidate into a service helper.
  const eventRoundRows = await tx
    .select({
      teeColor: eventRounds.teeColor,
      courseRevisionId: eventRounds.courseRevisionId,
    })
    .from(eventRounds)
    .where(
      and(
        eq(eventRounds.id, round.eventRoundId),
        eq(eventRounds.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (eventRoundRows.length === 0) return;
  // Fetch course shape (tee + holes) for compute2v2BestBall input.
  // Schema notes: course_tees.tee_color (not color), course_tees.rating (stored
  // ×10 already), course_holes.si (not strokeIndex).
  const teeRows = await tx
    .select({
      slope: courseTees.slope,
      rating: courseTees.rating,
    })
    .from(courseTees)
    .where(
      and(
        eq(courseTees.courseRevisionId, eventRoundRows[0]!.courseRevisionId),
        eq(courseTees.teeColor, eventRoundRows[0]!.teeColor),
        eq(courseTees.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (teeRows.length === 0) return;
  const courseRevRows = await tx
    .select({ courseTotal: courseRevisions.courseTotal })
    .from(courseRevisions)
    .where(
      and(
        eq(courseRevisions.id, eventRoundRows[0]!.courseRevisionId),
        eq(courseRevisions.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (courseRevRows.length === 0) return;
  const tee = {
    slope: teeRows[0]!.slope,
    ratingTimes10: teeRows[0]!.rating,  // course_tees.rating is already stored ×10
    coursePar: courseRevRows[0]!.courseTotal,
  };
  const holeRows = await tx
    .select({
      holeNumber: courseHoles.holeNumber,
      par: courseHoles.par,
      si: courseHoles.si,
    })
    .from(courseHoles)
    .where(
      and(
        eq(courseHoles.courseRevisionId, eventRoundRows[0]!.courseRevisionId),
        eq(courseHoles.tenantId, tenantId),
      ),
    )
    .orderBy(courseHoles.holeNumber);
  if (holeRows.length === 0) return;
  const courseShape: { tee: typeof tee; holes: HoleShape[] } = {
    tee,
    holes: holeRows.map((h) => ({
      holeNumber: h.holeNumber,
      par: h.par as 3 | 4 | 5,
      strokeIndex: h.si,
    })),
  };

  // ── (7) Fetch press config (v1 simple lookup). ──
  const config = await fetchActivePressConfig(tx, tenantId);
  if (!config) return;
  if (config.autoPressTriggerAtNDown === null || config.autoPressTriggerAtNDown <= 0) {
    // Auto-press disabled in active rule-set; nothing to fire.
    return;
  }

  // ── (8) Fetch all hole scores through current hole for the 4 members. ──
  const allHoleScores = await tx
    .select({
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
      grossStrokes: holeScores.grossStrokes,
      putts: holeScores.putts,
    })
    .from(holeScores)
    .where(
      and(
        eq(holeScores.roundId, roundId),
        inArray(holeScores.playerId, expectedMembers),
        eq(holeScores.tenantId, tenantId),
      ),
    );
  const holeScoresEngine: HoleScoreInput[] = allHoleScores
    .filter((s) => s.holeNumber <= holeNumber)
    .map((s) => ({
      playerId: s.playerId,
      holeNumber: s.holeNumber,
      grossStrokes: s.grossStrokes,
      putts: s.putts,
    }));

  // ── (9) Player-handicap fetch. ──
  const playerHIRows = await tx
    .select({
      id: players.id,
      manualHandicapIndex: players.manualHandicapIndex,
    })
    .from(players)
    .where(
      and(
        inArray(players.id, expectedMembers),
        eq(players.tenantId, tenantId),
      ),
    );
  const handicapIndexByPlayer: Record<string, number> = {};
  for (const p of playerHIRows) {
    handicapIndexByPlayer[p.id] = p.manualHandicapIndex ?? 0;
  }

  // ── (10) Pair the 4 members into teamA / teamB by alphabetical playerId.
  // v1 acceptance: deterministic but ignores any "slot-based" team
  // semantics the wizard might have. The engines (compute2v2BestBall,
  // evaluatePresses) are LABEL-AGNOSTIC — they just need two pairs of
  // two — so this assignment is mathematically correct. The "teamA" /
  // "teamB" label that surfaces in activity payloads + team_press_log
  // rows is informational. Followup T6-4g tracks an explicit team
  // assignment table (e.g., a `pairing_teams` join) when T6-7's manual
  // press UI needs to display real-world team identities.
  const sortedMembers = [...expectedMembers].sort();
  const teamA: [string, string] = [sortedMembers[0]!, sortedMembers[1]!];
  const teamB: [string, string] = [sortedMembers[2]!, sortedMembers[3]!];

  // ── (11) Run engines under try/catch — any throw maps to press_engine_error 422. ──
  // Per-player tee overrides (T10): same helper used by money.ts + sub-games.ts.
  // Empty map → engine falls back to courseShape.tee. Note: the kill switch
  // at step (0) means this orchestrator is gated off in trip-1 prod, but
  // wiring teeByPlayer here keeps the v1.5 re-enable path correct.
  const teeByPlayer = await buildTeeByPlayer(tx, roundId, tenantId);
  let perHoleResults: ReturnType<typeof compute2v2BestBall>['perHole'];
  try {
    const bbInput: Compute2v2BestBallInput = {
      holeScores: holeScoresEngine,
      holeMeta: [] as HoleMetaInput[],
      pairings: { teamA, teamB },
      config: {
        basePerHoleCents: config.basePerHoleCents,
        sandies: config.sandies,
        sandiesBonusPerHoleCents: config.sandiesBonusPerHoleCents,
        greenieCarryover: config.greenieCarryover,
        greenieValidation: config.greenieValidation,
        greenieBaseCents: config.greenieBaseCents,
      },
      course: courseShape,
      handicapIndexByPlayer,
      teeByPlayer,
    };
    const bbResult = compute2v2BestBall(bbInput);
    perHoleResults = bbResult.perHole;
  } catch (err) {
    throw new BusinessRuleError(
      'press_engine_error',
      `compute2v2BestBall threw: ${(err as Error).message ?? String(err)}`,
      422,
    );
  }

  // ── (12) Load existingPressLog from team_press_log. ──
  // Filter by foursomeNumber (T10-1): without this, the dedupe inside
  // evaluatePresses sees sibling-foursome rows and cross-suppresses
  // emission for THIS foursome.
  const existingPressLogRows = await tx
    .select()
    .from(teamPressLog)
    .where(
      and(
        eq(teamPressLog.roundId, roundId),
        eq(teamPressLog.foursomeNumber, foursomeNumber),
        eq(teamPressLog.tenantId, tenantId),
      ),
    );
  const existingPressLog: PressLogEntry[] = existingPressLogRows.map((r) => ({
    type: r.triggerType as 'auto' | 'manual',
    team: r.team as 'teamA' | 'teamB',
    startHole: r.startHole,
    multiplier: r.multiplier,
    ...(r.trigger !== null ? { trigger: r.trigger } : {}),
  }));

  // ── (13) Run evaluatePresses. ──
  let newlyFired: Press[];
  try {
    const evalResult = evaluatePresses({
      perHoleResults,
      manualPresses: [],
      existingPressLog,
      config: {
        autoPressTriggerAtNDown: config.autoPressTriggerAtNDown,
        pressMultiplier: config.pressMultiplier,
      },
      throughHole: holeNumber,
    });
    newlyFired = evalResult.newlyFired;
  } catch (err) {
    throw new BusinessRuleError(
      'press_engine_error',
      `evaluatePresses threw: ${(err as Error).message ?? String(err)}`,
      422,
    );
  }

  // ── (14) Persist newlyFired + emit activity. ──
  const now = Date.now();
  const ctx = round.eventId !== null ? `event:${round.eventId}` : `round:${roundId}`;

  for (const press of newlyFired) {
    const pressId = randomUUID();
    try {
      await tx.insert(teamPressLog).values({
        id: pressId,
        roundId,
        team: press.team,
        startHole: press.startHole,
        triggerType: press.type,
        trigger: press.trigger ?? null,
        foursomeNumber,
        multiplier: press.multiplier,
        firedAt: now,
        firedByPlayerId: press.type === 'manual' ? scorerPlayerId : null,
        tenantId,
        contextId: ctx,
      });
    } catch (err) {
      // UNIQUE-violation residual under SQLite WAL: log + continue (T6-4 spec Section 5).
      if (isUniqueConstraintError(err)) {
        logger.warn({
          msg: 'press_orchestrator: UNIQUE collision on team_press_log insert; skipping',
          roundId,
          team: press.team,
          startHole: press.startHole,
          triggerType: press.type,
        });
        continue;
      }
      throw err;
    }

    // Emit activity for each successfully-inserted press.
    if (round.eventId !== null) {
      if (press.type === 'auto') {
        await emitActivity(tx, {
          type: 'press.auto_fired',
          eventId: round.eventId,
          roundId,
          actorPlayerId: scorerPlayerId,
          triggerHole: holeNumber,
          team: press.team,
          trigger: press.trigger ?? 'auto',
          multiplier: press.multiplier,
        });
      } else {
        await emitActivity(tx, {
          type: 'press.manual_fired',
          eventId: round.eventId,
          roundId,
          actorPlayerId: scorerPlayerId,
          fromHole: press.startHole,
          team: press.team,
          multiplier: press.multiplier,
          filedByPlayerId: scorerPlayerId,
        });
      }
    }
  }
}

const SQLITE_UNIQUE_RAW_CODE = 2067;

/**
 * Detects libsql/Drizzle's UNIQUE constraint violation error shape.
 * Mirrors the existing pattern from routes/scores.ts:567 — checks `code`,
 * `extendedCode`, AND `rawCode` on both the wrapper error AND its `cause`,
 * since libsql wraps SQLite errors with all three fields in different
 * combinations across versions.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  const sources = [err as Record<string, unknown>];
  if (cause && typeof cause === 'object') sources.push(cause as Record<string, unknown>);
  for (const src of sources) {
    // libsql variants: code/extendedCode may be the string sentinel OR
    // the numeric extended-result-code (2067). rawCode is always numeric.
    if (
      src['code'] === 'SQLITE_CONSTRAINT_UNIQUE' ||
      src['extendedCode'] === 'SQLITE_CONSTRAINT_UNIQUE' ||
      src['code'] === SQLITE_UNIQUE_RAW_CODE ||
      src['extendedCode'] === SQLITE_UNIQUE_RAW_CODE ||
      src['rawCode'] === SQLITE_UNIQUE_RAW_CODE
    ) {
      return true;
    }
  }
  return false;
}
