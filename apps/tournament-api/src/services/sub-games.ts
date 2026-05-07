/**
 * T6-13 sub-game dispatcher.
 *
 * Single entry point: `computeSubGame(tx, subGameId, actorPlayerId, tenantId)`
 * dispatches by `sub_games.type`:
 *   - 'skins'           → calcSkins (T6-11) + persist sub_game_results row.
 *   - 'ctp' | 'sandies' | 'putting_contest' → throws BusinessRuleError(501)
 *     stub. Future stories add ONE case each.
 *
 * **Append-only semantics (FD-10/11):** every successful compute INSERTs
 * a NEW sub_game_results row. Score-correction-triggered recomputes
 * preserve history; downstream consumers (T6-14 leaderboard column)
 * read `ORDER BY computed_at DESC LIMIT 1` per sub-game for current truth.
 *
 * **Config snapshot:** the row captures the in-effect rule-set / sub-
 * game config at compute time so historical rows remain reproducible
 * even if the rule-set changes via T5-11 mid-event-edit.
 *
 * **Caller is responsible for the transaction.** This function takes a
 * `tx` parameter; it does NOT open one. Pattern matches T5-8's
 * transitionState: domain-side-effect-isolating service; mutation IS
 * the domain semantic.
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
  players,
  rounds,
  roundStates,
  subGames,
  subGameParticipants,
  subGameResults,
} from '../db/schema/index.js';
import { BusinessRuleError } from './round-state.js';
import {
  calcSkins,
  type CalcSkinsInput,
  type HoleScoresByPlayer,
  type SkinsMode,
  type LastHoleUnclaimedResolution,
} from '../engine/formats/skins.js';
import { buildTeeByPlayer } from './per-player-tee.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Compute and persist a sub-game's results. Returns the inserted row's id.
 */
export async function computeSubGame(
  tx: Tx,
  subGameId: string,
  actorPlayerId: string | null,
  tenantId: string,
): Promise<{ subGameResultId: string; totalPotCents: number; resultsJson: string }> {
  // (1) Read sub-game row.
  const subGameRows = await tx
    .select()
    .from(subGames)
    .where(and(eq(subGames.id, subGameId), eq(subGames.tenantId, tenantId)))
    .limit(1);
  if (subGameRows.length === 0) {
    throw new BusinessRuleError('subgame_not_found', 'sub_games row not found', 404);
  }
  const subGame = subGameRows[0]!;

  // (2) Dispatch by type.
  if (subGame.type === 'ctp' || subGame.type === 'sandies' || subGame.type === 'putting_contest') {
    throw new BusinessRuleError(
      'subgame_type_stub',
      `sub-game type '${subGame.type}' is not implemented v1`,
      501,
    );
  }
  if (subGame.type !== 'skins') {
    throw new BusinessRuleError(
      'subgame_type_unknown',
      `unknown sub-game type '${subGame.type}'`,
      422,
    );
  }

  // (3) Skins: gather inputs.
  // Find the runtime rounds row for this sub-game's event_round_id.
  const runtimeRoundRows = await tx
    .select({ id: rounds.id, contextId: rounds.contextId })
    .from(rounds)
    .where(
      and(
        eq(rounds.eventRoundId, subGame.eventRoundId),
        eq(rounds.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (runtimeRoundRows.length === 0) {
    throw new BusinessRuleError(
      'round_not_found',
      'no runtime rounds row for this sub-game event_round_id',
      422,
    );
  }
  const runtimeRound = runtimeRoundRows[0]!;

  // Participants opted into this sub-game.
  const participantRows = await tx
    .select({ playerId: subGameParticipants.playerId })
    .from(subGameParticipants)
    .where(
      and(
        eq(subGameParticipants.subGameId, subGameId),
        eq(subGameParticipants.tenantId, tenantId),
      ),
    );
  const participants = participantRows.map((p) => p.playerId);

  // Course (tee + holes) via event_round.
  const erRows = await tx
    .select({
      teeColor: eventRounds.teeColor,
      courseRevisionId: eventRounds.courseRevisionId,
      holesToPlay: eventRounds.holesToPlay,
    })
    .from(eventRounds)
    .where(
      and(
        eq(eventRounds.id, subGame.eventRoundId),
        eq(eventRounds.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (erRows.length === 0) {
    throw new BusinessRuleError('event_round_not_found', 'event_round missing', 422);
  }
  const er = erRows[0]!;

  const teeRows = await tx
    .select({ slope: courseTees.slope, rating: courseTees.rating })
    .from(courseTees)
    .where(
      and(
        eq(courseTees.courseRevisionId, er.courseRevisionId),
        eq(courseTees.teeColor, er.teeColor),
        eq(courseTees.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (teeRows.length === 0) {
    throw new BusinessRuleError('course_tee_not_found', 'course_tees row missing', 422);
  }
  const courseRevRow = await tx
    .select({ courseTotal: courseRevisions.courseTotal })
    .from(courseRevisions)
    .where(
      and(
        eq(courseRevisions.id, er.courseRevisionId),
        eq(courseRevisions.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (courseRevRow.length === 0) {
    throw new BusinessRuleError('course_revision_not_found', 'course_revisions row missing', 422);
  }
  const holeRows = await tx
    .select({
      holeNumber: courseHoles.holeNumber,
      par: courseHoles.par,
      si: courseHoles.si,
    })
    .from(courseHoles)
    .where(
      and(
        eq(courseHoles.courseRevisionId, er.courseRevisionId),
        eq(courseHoles.tenantId, tenantId),
      ),
    )
    .orderBy(courseHoles.holeNumber);

  const tee = {
    slope: teeRows[0]!.slope,
    ratingTimes10: teeRows[0]!.rating,
    coursePar: courseRevRow[0]!.courseTotal,
  };
  const courseHolesEngine = holeRows
    .filter((h) => h.holeNumber <= er.holesToPlay)
    .map((h) => ({
      holeNumber: h.holeNumber,
      par: h.par as 3 | 4 | 5,
      strokeIndex: h.si,
    }));

  // Hole scores for participants on this round.
  const holeScoresByPlayer: HoleScoresByPlayer = new Map();
  if (participants.length > 0) {
    const scoreRows = await tx
      .select({
        playerId: holeScores.playerId,
        holeNumber: holeScores.holeNumber,
        grossStrokes: holeScores.grossStrokes,
      })
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, runtimeRound.id),
          inArray(holeScores.playerId, participants),
          eq(holeScores.tenantId, tenantId),
        ),
      );
    for (const s of scoreRows) {
      holeScoresByPlayer.set(`${s.playerId}|${s.holeNumber}`, s.grossStrokes);
    }
  }

  // Player handicaps.
  const handicapsByPlayer: Record<string, number> = {};
  if (participants.length > 0) {
    const playerHIRows = await tx
      .select({
        id: players.id,
        manualHandicapIndex: players.manualHandicapIndex,
      })
      .from(players)
      .where(
        and(
          inArray(players.id, participants),
          eq(players.tenantId, tenantId),
        ),
      );
    for (const p of playerHIRows) {
      handicapsByPlayer[p.id] = p.manualHandicapIndex ?? 0;
    }
  }

  // Parse sub-game config. Defaults if config malformed.
  let subGameCfg: { mode?: unknown; lastHoleUnclaimedResolution?: unknown } = {};
  try {
    subGameCfg = JSON.parse(subGame.configJson) as {
      mode?: unknown;
      lastHoleUnclaimedResolution?: unknown;
    };
  } catch {
    // Use defaults below.
  }
  const mode: SkinsMode =
    subGameCfg.mode === 'gross' ||
    subGameCfg.mode === 'net' ||
    subGameCfg.mode === 'gross_beats_net'
      ? subGameCfg.mode
      : 'gross';
  const lastHoleUnclaimedResolution: LastHoleUnclaimedResolution =
    subGameCfg.lastHoleUnclaimedResolution === 'carry-to-next-round'
      ? 'carry-to-next-round'
      : 'split-among-winners';

  // Per-player tee overrides (T10). Only consulted in net / gross_beats_net
  // modes; gross-mode skins ignores `teeByPlayer` entirely so this query
  // is wasted work in that case but trivially cheap (single roundId scope).
  const teeByPlayer = await buildTeeByPlayer(tx, runtimeRound.id, tenantId);

  const calcInput: CalcSkinsInput = {
    holeScores: holeScoresByPlayer,
    mode,
    participants,
    buyInPerParticipantCents: subGame.buyInPerParticipant,
    lastHoleUnclaimedResolution,
    course: { tee, holes: courseHolesEngine },
    handicapsByPlayer,
    teeByPlayer,
  };

  let result;
  try {
    result = calcSkins(calcInput);
  } catch (err) {
    throw new BusinessRuleError(
      'subgame_engine_error',
      `calcSkins threw: ${(err as Error).message ?? String(err)}`,
      422,
    );
  }

  // (4) Persist sub_game_results row.
  const subGameResultId = randomUUID();
  const now = Date.now();
  const configSnapshot = {
    type: subGame.type,
    mode,
    lastHoleUnclaimedResolution,
    buyInPerParticipantCents: subGame.buyInPerParticipant,
  };
  const resultsJson = JSON.stringify(result);
  await tx.insert(subGameResults).values({
    id: subGameResultId,
    subGameId,
    computedAt: now,
    configSnapshotJson: JSON.stringify(configSnapshot),
    resultsJson,
    totalPotCents: result.totalPotCents,
    createdByPlayerId: actorPlayerId,
    tenantId,
    contextId: runtimeRound.contextId,
  });

  return { subGameResultId, totalPotCents: result.totalPotCents, resultsJson };
}

/**
 * Auto-compute all sub-games attached to a round at finalize time (T5-8 hook).
 * Stub-typed sub-games are SKIPPED with a logged note (do NOT fail finalization).
 */
export async function computeSubGamesForRound(
  tx: Tx,
  roundId: string,
  tenantId: string,
  log: { warn: (o: unknown) => void; info: (o: unknown) => void },
): Promise<{ computed: number; skipped: number }> {
  const runtimeRoundRows = await tx
    .select({ eventRoundId: rounds.eventRoundId })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, tenantId)))
    .limit(1);
  if (runtimeRoundRows.length === 0 || runtimeRoundRows[0]!.eventRoundId === null) {
    return { computed: 0, skipped: 0 };
  }
  const eventRoundId = runtimeRoundRows[0]!.eventRoundId;

  const subGameRows = await tx
    .select({ id: subGames.id, type: subGames.type })
    .from(subGames)
    .where(
      and(
        eq(subGames.eventRoundId, eventRoundId),
        eq(subGames.tenantId, tenantId),
      ),
    );

  let computed = 0;
  let skipped = 0;
  for (const sg of subGameRows) {
    try {
      await computeSubGame(tx, sg.id, null, tenantId);
      computed += 1;
    } catch (err) {
      if (err instanceof BusinessRuleError && (err.code === 'subgame_type_stub' || err.status === 501)) {
        log.info({
          msg: 'sub_games_compute_skipped_stub_type',
          subGameId: sg.id,
          type: sg.type,
        });
        skipped += 1;
      } else {
        log.warn({
          msg: 'sub_games_compute_failed_at_finalize',
          subGameId: sg.id,
          type: sg.type,
          err: String(err),
        });
        skipped += 1;
      }
    }
  }
  return { computed, skipped };
}

/**
 * T6-14: aggregate skins pot shares per player across all FINALIZED rounds'
 * skins sub-games for an event. Returns Map<playerId, totalCents>.
 *
 * For each skins sub-game attached to a finalized round, reads the LATEST
 * sub_game_results row (per FD-10/11 append-only convention; latest wins).
 * Parses resultsJson.potShares and sums dollarsCents per player.
 *
 * Pre-finalize rounds are EXCLUDED — leaderboard renders `null` for skinsCents
 * on rows where no finalized skins sub-game has contributed (per epic AC line
 * 2218: "for rounds that haven't yet finalized, displays — not $0.00").
 */
export async function aggregateSkinsForEvent(
  txOrDb: Tx | Db,
  eventId: string,
  tenantId: string,
): Promise<Map<string, number>> {
  // Find all FINALIZED runtime rounds in this event.
  const finalizedRoundRows = await txOrDb
    .select({
      eventRoundId: rounds.eventRoundId,
    })
    .from(rounds)
    .innerJoin(roundStates, eq(roundStates.roundId, rounds.id))
    .where(
      and(
        eq(rounds.eventId, eventId),
        eq(rounds.tenantId, tenantId),
        eq(roundStates.state, 'finalized'),
        eq(roundStates.tenantId, tenantId),
      ),
    );
  const finalizedEventRoundIds = finalizedRoundRows
    .map((r) => r.eventRoundId)
    .filter((id): id is string => id !== null);
  if (finalizedEventRoundIds.length === 0) return new Map();

  // Find skins sub-games attached to those event_rounds.
  const skinsSubGameRows = await txOrDb
    .select({ id: subGames.id })
    .from(subGames)
    .where(
      and(
        eq(subGames.type, 'skins'),
        eq(subGames.tenantId, tenantId),
        // event_round_id IN (...)
        ...(finalizedEventRoundIds.length === 1
          ? [eq(subGames.eventRoundId, finalizedEventRoundIds[0]!)]
          : []),
      ),
    );
  // For multi-id IN, fall back to inArray (single-ID was an optimization).
  const skinsIds: string[] = [];
  if (finalizedEventRoundIds.length > 1) {
    const allRows = await txOrDb
      .select({ id: subGames.id, eventRoundId: subGames.eventRoundId })
      .from(subGames)
      .where(
        and(
          eq(subGames.type, 'skins'),
          eq(subGames.tenantId, tenantId),
        ),
      );
    for (const r of allRows) {
      if (finalizedEventRoundIds.includes(r.eventRoundId)) {
        skinsIds.push(r.id);
      }
    }
  } else {
    for (const r of skinsSubGameRows) skinsIds.push(r.id);
  }
  if (skinsIds.length === 0) return new Map();

  // For each skins sub-game, fetch the LATEST sub_game_results row.
  const totals = new Map<string, number>();
  for (const sgId of skinsIds) {
    const latestRows = await txOrDb
      .select({ resultsJson: subGameResults.resultsJson })
      .from(subGameResults)
      .where(
        and(
          eq(subGameResults.subGameId, sgId),
          eq(subGameResults.tenantId, tenantId),
        ),
      )
      .orderBy(desc(subGameResults.computedAt))
      .limit(1);
    if (latestRows.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(latestRows[0]!.resultsJson);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const potShares = (parsed as { potShares?: unknown }).potShares;
    if (!Array.isArray(potShares)) continue;
    for (const ps of potShares) {
      if (!ps || typeof ps !== 'object') continue;
      const psObj = ps as { playerId?: unknown; dollarsCents?: unknown };
      if (typeof psObj.playerId !== 'string') continue;  // skip null sentinel (carried to next round)
      if (typeof psObj.dollarsCents !== 'number' || !Number.isInteger(psObj.dollarsCents)) continue;
      totals.set(psObj.playerId, (totals.get(psObj.playerId) ?? 0) + psObj.dollarsCents);
    }
  }
  return totals;
}

/**
 * T6-5a: per-skins-sub-game pairwise breakdown for the money matrix.
 *
 * For each FINALIZED skins sub-game, returns the participants list +
 * potShares + buyIn so the caller can attribute pairwise.
 *
 * Pairwise attribution model (per-sub-game):
 *   matrix[a][b] += floor((potShares[a] - potShares[b]) / N)  for a !== b
 *   matrix[b][a] -= same value
 *
 * This preserves anti-symmetry. Sum-to-zero is guaranteed (each row sums
 * to potShares[a] - buyIn — the player's net), with potential ≤N-cents
 * drift due to integer division. Tracked under Followup T6-5h; trip-day
 * buy-ins are small enough that drift is invisible (≤ ~$0.04 across the
 * event).
 *
 * The carry-to-next-round sentinel (playerId === null) is excluded from
 * pairwise attribution — only player-bearing pot shares contribute.
 */
export type SkinsSubGameSnapshot = {
  subGameId: string;
  participants: string[];
  potShares: Map<string, number>;  // playerId → dollarsCents (excluding null sentinel)
};

export async function loadSkinsSnapshotsForEvent(
  txOrDb: Tx | Db,
  eventId: string,
  tenantId: string,
): Promise<SkinsSubGameSnapshot[]> {
  // Find FINALIZED rounds in this event.
  const finalizedRoundRows = await txOrDb
    .select({ eventRoundId: rounds.eventRoundId })
    .from(rounds)
    .innerJoin(roundStates, eq(roundStates.roundId, rounds.id))
    .where(
      and(
        eq(rounds.eventId, eventId),
        eq(rounds.tenantId, tenantId),
        eq(roundStates.state, 'finalized'),
        eq(roundStates.tenantId, tenantId),
      ),
    );
  const finalizedEventRoundIds = finalizedRoundRows
    .map((r) => r.eventRoundId)
    .filter((id): id is string => id !== null);
  if (finalizedEventRoundIds.length === 0) return [];

  // Find skins sub-games attached to those event_rounds.
  const allRows = await txOrDb
    .select({ id: subGames.id, eventRoundId: subGames.eventRoundId })
    .from(subGames)
    .where(
      and(
        eq(subGames.type, 'skins'),
        eq(subGames.tenantId, tenantId),
      ),
    );
  const skinsIds = allRows
    .filter((r) => finalizedEventRoundIds.includes(r.eventRoundId))
    .map((r) => r.id);
  if (skinsIds.length === 0) return [];

  const snapshots: SkinsSubGameSnapshot[] = [];
  for (const sgId of skinsIds) {
    // Latest results row.
    const latestRows = await txOrDb
      .select({ resultsJson: subGameResults.resultsJson })
      .from(subGameResults)
      .where(
        and(
          eq(subGameResults.subGameId, sgId),
          eq(subGameResults.tenantId, tenantId),
        ),
      )
      .orderBy(desc(subGameResults.computedAt))
      .limit(1);
    if (latestRows.length === 0) continue;

    // Participants list.
    const partRows = await txOrDb
      .select({ playerId: subGameParticipants.playerId })
      .from(subGameParticipants)
      .where(
        and(
          eq(subGameParticipants.subGameId, sgId),
          eq(subGameParticipants.tenantId, tenantId),
        ),
      );
    const participants = partRows.map((r) => r.playerId);

    let parsed: unknown;
    try {
      parsed = JSON.parse(latestRows[0]!.resultsJson);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const potShares = (parsed as { potShares?: unknown }).potShares;
    if (!Array.isArray(potShares)) continue;

    const potSharesMap = new Map<string, number>();
    for (const ps of potShares) {
      if (!ps || typeof ps !== 'object') continue;
      const psObj = ps as { playerId?: unknown; dollarsCents?: unknown };
      if (typeof psObj.playerId !== 'string') continue;
      if (typeof psObj.dollarsCents !== 'number' || !Number.isInteger(psObj.dollarsCents)) continue;
      potSharesMap.set(psObj.playerId, psObj.dollarsCents);
    }
    snapshots.push({ subGameId: sgId, participants, potShares: potSharesMap });
  }
  return snapshots;
}
