import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sideGames, sideGameResults, holeScores, roundPlayers, wolfDecisions } from '../db/schema.js';
import {
  calcMostNetPars,
  calcMostSkins,
  calcLeastPutts,
  calcMostNetUnderPar,
  calcMostPolies,
} from './side-game-calc.js';
import type {
  ScoreRow,
  PlayerHandicap,
  WolfDecisionRow,
  SideGameResult,
} from './side-game-calc.js';
import type { Tee } from '@wolf-cup/engine';

/**
 * Compute and store side game results for a round.
 * Called after finalization (non-fatal).
 *
 * ALL players' scores participate in the computation (subs can block skins,
 * affect unique-low determinations, etc.). But only active (non-sub) players
 * are eligible to WIN. Subs didn't pay into the prize money.
 */
export async function computeSideGameWinnerForRound(
  roundId: number,
  seasonId: number,
  tee: Tee,
): Promise<void> {
  // Find side games scheduled for this round
  const allGames = await db
    .select()
    .from(sideGames)
    .where(eq(sideGames.seasonId, seasonId));

  for (const game of allGames) {
    const calcType = game.calculationType;
    if (!calcType || calcType === 'manual') continue;

    // Check if this game is scheduled for this round
    let scheduledIds: number[];
    try {
      scheduledIds = JSON.parse(game.scheduledRoundIds ?? '[]') as number[];
    } catch { continue; }
    if (!scheduledIds.includes(roundId)) continue;

    // auto_skins is a list-display game: no Champion-track winner persisted.
    // skin-holders are computed live by the leaderboard route on every fetch
    // (including post-finalization) so corrections flow through automatically.
    // Wipe ANY persisted rows (auto + manual) for this game+round to enforce
    // the invariant "skins has no persisted results" regardless of upstream
    // state — covers historical auto rows AND any manual rows that bypassed
    // the admin-endpoint guard. Done BEFORE the completeness gate below so
    // partial rounds still get cleaned up.
    if (calcType === 'auto_skins') {
      await db.transaction(async (tx) => {
        await tx
          .delete(sideGameResults)
          .where(
            and(
              eq(sideGameResults.sideGameId, game.id),
              eq(sideGameResults.roundId, roundId),
            ),
          );
      });
      continue;
    }

    // Fetch ALL scores for this round (subs included — their scores affect the field)
    const scores = await db
      .select({
        playerId: holeScores.playerId,
        holeNumber: holeScores.holeNumber,
        grossScore: holeScores.grossScore,
        putts: holeScores.putts,
      })
      .from(holeScores)
      .where(eq(holeScores.roundId, roundId));

    // Fetch ALL players + handicaps (subs included for net score computation)
    const allRoundPlayers = await db
      .select({
        playerId: roundPlayers.playerId,
        handicapIndex: roundPlayers.handicapIndex,
        isSub: roundPlayers.isSub,
      })
      .from(roundPlayers)
      .where(eq(roundPlayers.roundId, roundId));

    // ALL handicaps (including subs — needed for net score computation)
    const handicaps: PlayerHandicap[] = allRoundPlayers.map((p) => ({
      playerId: p.playerId,
      handicapIndex: p.handicapIndex,
    }));

    // Eligible = active (non-sub) players only — subs can't win
    const eligible = new Set(
      allRoundPlayers.filter((p) => !p.isSub).map((p) => p.playerId),
    );
    if (eligible.size === 0) continue;

    // Verify all players have 18 holes scored (completeness check on full field)
    const allPlayerIds = [...new Set(allRoundPlayers.map((p) => p.playerId))];
    const allComplete = allPlayerIds.every((pid) => {
      const playerScores = scores.filter((s) => s.playerId === pid);
      return playerScores.length >= 18;
    });
    if (!allComplete) continue;

    // For putts weeks, also verify all 18 putts entries exist for eligible players
    if (calcType === 'auto_putts') {
      const allPuttsComplete = [...eligible].every((pid) => {
        const playerScores = scores.filter((s) => s.playerId === pid);
        return playerScores.every((s) => s.putts !== null && s.putts !== undefined);
      });
      if (!allPuttsComplete) continue;
    }

    const scoreRows: ScoreRow[] = scores;
    let result: { winnerPlayerIds: number[]; detail: string };

    switch (calcType) {
      case 'auto_net_pars':
        result = calcMostNetPars(scoreRows, handicaps, tee, eligible);
        break;
      case 'auto_putts':
        result = calcLeastPutts(scoreRows, eligible);
        break;
      case 'auto_net_under_par':
        result = calcMostNetUnderPar(scoreRows, handicaps, tee, eligible);
        break;
      case 'auto_polies': {
        const decisions = await db
          .select({
            wolfPlayerId: wolfDecisions.wolfPlayerId,
            holeNumber: wolfDecisions.holeNumber,
            bonusesJson: wolfDecisions.bonusesJson,
          })
          .from(wolfDecisions)
          .where(eq(wolfDecisions.roundId, roundId));
        const wdRows: WolfDecisionRow[] = decisions.map((d) => ({
          wolfPlayerId: d.wolfPlayerId ?? 0,
          holeNumber: d.holeNumber,
          bonusesJson: d.bonusesJson,
        }));
        result = calcMostPolies(wdRows, eligible);
        break;
      }
      default:
        continue;
    }

    // No-contest: no winners
    if (result.winnerPlayerIds.length === 0) {
      // Delete any previous auto results for this game+round (idempotent)
      await db.transaction(async (tx) => {
        await tx
          .delete(sideGameResults)
          .where(
            and(
              eq(sideGameResults.sideGameId, game.id),
              eq(sideGameResults.roundId, roundId),
              eq(sideGameResults.source, 'auto'),
            ),
          );
      });
      continue;
    }

    // Transactional delete+insert for idempotent recomputation
    await db.transaction(async (tx) => {
      // Delete only auto results (preserve manual overrides)
      await tx
        .delete(sideGameResults)
        .where(
          and(
            eq(sideGameResults.sideGameId, game.id),
            eq(sideGameResults.roundId, roundId),
            eq(sideGameResults.source, 'auto'),
          ),
        );

      // Insert one row per winner
      const now = Date.now();
      for (const winnerId of result.winnerPlayerIds) {
        await tx.insert(sideGameResults).values({
          sideGameId: game.id,
          roundId,
          winnerPlayerId: winnerId,
          winnerName: null,
          notes: result.detail,
          source: 'auto',
          createdAt: now,
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Live leader — in-progress equivalent of computeSideGameWinnerForRound.
//
// Runs the same pure calcs without the 18-hole completeness gate so a partial
// round surfaces a running leader. Returns null for manual (CTP) games and
// for putts weeks when no putts have been entered yet. Subs excluded from
// winning via eligible set — identical to finalization.
//
// Caller passes pre-fetched scores/handicaps/isSub flags to avoid refetching
// data the leaderboard endpoint already has in hand.
// ---------------------------------------------------------------------------

export interface LiveLeaderInput {
  calculationType: string | null;
  scores: ScoreRow[];
  players: Array<{ playerId: number; handicapIndex: number; isSub: boolean }>;
  tee: Tee;
  // 'scheduled' | 'active' | 'finalized' | 'completed' | 'cancelled'.
  // Skins applies the per-hole completeness gate ONLY for in-progress
  // rounds. For finalized rounds we trust the stored scores and want
  // every earned skin to surface — applying the gate could empty the
  // list if any roster row lacks a score (late-added sub, data tweak).
  roundStatus?: string;
  decisions?: WolfDecisionRow[]; // required only for auto_polies
}

export function computeSideGameLeaderLive(input: LiveLeaderInput): SideGameResult | null {
  const { calculationType, scores, players: roster, tee, roundStatus, decisions } = input;
  if (!calculationType || calculationType === 'manual') return null;

  const handicaps: PlayerHandicap[] = roster.map((p) => ({
    playerId: p.playerId,
    handicapIndex: p.handicapIndex,
  }));
  const eligible = new Set(roster.filter((p) => !p.isSub).map((p) => p.playerId));
  if (eligible.size === 0) return null;

  // Full field (eligible + subs) — used by skins to gate per-hole counting
  // on completeness so cross-group lag doesn't surface phantom skins.
  // Skipped for any non-active status (finalized/completed/cancelled): once
  // a round is done, scores are authoritative and a missing roster row
  // shouldn't suppress earned skins.
  const fieldPlayerIds = roundStatus && roundStatus !== 'active' && roundStatus !== 'scheduled'
    ? undefined
    : new Set(roster.map((p) => p.playerId));

  switch (calculationType) {
    case 'auto_net_pars':
      return calcMostNetPars(scores, handicaps, tee, eligible);
    case 'auto_skins':
      return calcMostSkins(scores, handicaps, tee, eligible, fieldPlayerIds);
    case 'auto_putts': {
      const anyPutts = scores.some((s) => s.putts !== null && s.putts !== undefined);
      if (!anyPutts) return null;
      // On a live round, only rank COMPLETE putt cards (all 18 holes entered) so
      // a player who has logged putts on fewer holes can't win on a smaller sum.
      // Finalized rounds are authoritative and rank whatever is recorded.
      const isLive = roundStatus === 'active' || roundStatus === 'scheduled';
      if (isLive) {
        const holesWithPutts = new Map<number, number>();
        for (const s of scores) {
          if (s.putts !== null && s.putts !== undefined) {
            holesWithPutts.set(s.playerId, (holesWithPutts.get(s.playerId) ?? 0) + 1);
          }
        }
        const complete = new Set(
          [...holesWithPutts].filter(([, n]) => n >= 18).map(([pid]) => pid),
        );
        if (complete.size === 0) return null;
        const eligibleComplete = eligible
          ? new Set([...eligible].filter((p) => complete.has(p)))
          : complete;
        if (eligibleComplete.size === 0) return null;
        return calcLeastPutts(scores, eligibleComplete);
      }
      return calcLeastPutts(scores, eligible);
    }
    case 'auto_net_under_par':
      return calcMostNetUnderPar(scores, handicaps, tee, eligible);
    case 'auto_polies':
      return calcMostPolies(decisions ?? [], eligible);
    default:
      return null;
  }
}
