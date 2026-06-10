// ---------------------------------------------------------------------------
// Shared "The Line" odds builder + snapshot store.
//
// One source of truth for computing a round's win-odds line, used by:
//   - the live scouting route (GET /scouting/:roundId) — current form,
//   - the finalize handler — freezes a snapshot into odds_lines,
//   - the backtest script — scores the model against actual winners.
//
// The line uses form going INTO the round: this season's finalized official
// rounds dated before the target round. Because it never looks at later rounds,
// the value is identical whether computed live pre-round or snapshotted at
// finalize — so freezing at finalize captures the true opening line.
// ---------------------------------------------------------------------------

import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  rounds,
  groups,
  roundPlayers,
  players,
  roundResults,
  oddsLines,
} from "../db/schema.js";
import { computeOddsLine } from "@wolf-cup/engine";
import type { OddsFieldEntry, OddsResult } from "@wolf-cup/engine";

/** Bump when the odds model changes so stored snapshots stay distinguishable. */
export const ODDS_MODEL_VERSION = "v1-bootstrap";

export type GatedOdds = { gated: true; reason: string };
export type RoundOddsResult = OddsResult | GatedOdds;

type ResultRow = {
  roundId: number;
  playerId: number;
  stableford: number;
  money: number;
};

/** Build a sim field (members + subs) from per-player history rows. */
function buildField(
  roster: Array<{ playerId: number; isSub: boolean }>,
  results: ResultRow[],
  order: Map<number, number>,
): OddsFieldEntry[] {
  const byPlayer = new Map<number, ResultRow[]>();
  for (const r of results) {
    const arr = byPlayer.get(r.playerId) ?? [];
    arr.push(r);
    byPlayer.set(r.playerId, arr);
  }
  return roster.map((rp) => ({
    playerId: rp.playerId,
    isSub: rp.isSub,
    history: (byPlayer.get(rp.playerId) ?? []).map((r) => ({
      stableford: r.stableford,
      money: r.money,
      orderIndex: order.get(r.roundId) ?? 0,
    })),
  }));
}

export interface RoundOddsLine {
  odds: RoundOddsResult;
  nameOf: Map<number, string>;
  targetRoster: Array<{ playerId: number; isSub: boolean }>;
  seasonRoundIds: number[];
}

/**
 * Compute "The Line" for a round from form going into it. Read-only.
 * Returns null only if the round does not exist. A throw inside the odds math is
 * isolated to a gated line (never propagates) so callers can't be taken down.
 */
export async function computeRoundOddsLine(
  roundId: number,
): Promise<RoundOddsLine | null> {
  const round = await db
    .select({ seasonId: rounds.seasonId, scheduledDate: rounds.scheduledDate })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  if (!round) return null;

  const seasonRounds = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(
      and(
        eq(rounds.seasonId, round.seasonId),
        eq(rounds.type, "official"),
        eq(rounds.status, "finalized"),
        lt(rounds.scheduledDate, round.scheduledDate),
      ),
    )
    .orderBy(rounds.scheduledDate, rounds.id);
  const seasonRoundIds = seasonRounds.map((r) => r.id);
  const roundOrder = new Map(seasonRounds.map((r, i) => [r.id, i]));

  const rosterRows = await db
    .select({
      playerId: roundPlayers.playerId,
      name: players.name,
      isSub: roundPlayers.isSub,
      groupNumber: groups.groupNumber,
    })
    .from(roundPlayers)
    .innerJoin(groups, eq(groups.id, roundPlayers.groupId))
    .innerJoin(players, eq(players.id, roundPlayers.playerId))
    .where(eq(roundPlayers.roundId, roundId))
    .orderBy(groups.groupNumber);

  const scoutedIds = [...new Set(rosterRows.map((r) => r.playerId))];
  const nameOf = new Map(rosterRows.map((r) => [r.playerId, r.name]));
  const targetRoster = scoutedIds.map((id) => ({
    playerId: id,
    isSub: (rosterRows.find((r) => r.playerId === id)?.isSub ?? 0) === 1,
  }));

  let odds: RoundOddsResult;
  try {
    if (targetRoster.length === 0) {
      odds = { gated: true, reason: "line opens when pairings are set" };
    } else if (seasonRoundIds.length === 0) {
      odds = { gated: true, reason: "odds open in a few weeks" };
    } else {
      const oddsResultRows = await db
        .select({
          roundId: roundResults.roundId,
          playerId: roundResults.playerId,
          stableford: roundResults.stablefordTotal,
          money: roundResults.moneyTotal,
        })
        .from(roundResults)
        .where(
          and(
            inArray(roundResults.roundId, seasonRoundIds),
            inArray(roundResults.playerId, scoutedIds),
          ),
        );
      const subPriorRows = await db
        .select({
          stableford: roundResults.stablefordTotal,
          money: roundResults.moneyTotal,
        })
        .from(roundResults)
        .innerJoin(
          roundPlayers,
          and(
            eq(roundPlayers.roundId, roundResults.roundId),
            eq(roundPlayers.playerId, roundResults.playerId),
          ),
        )
        .where(
          and(
            inArray(roundResults.roundId, seasonRoundIds),
            eq(roundPlayers.isSub, 1),
          ),
        );

      const field = buildField(targetRoster, oddsResultRows, roundOrder);
      odds = computeOddsLine({
        field,
        subPrior: subPriorRows,
        priorRoundCount: seasonRoundIds.length,
        seed: roundId,
      });
    }
  } catch (err) {
    console.error("computeRoundOddsLine failed (non-fatal):", err);
    odds = { gated: true, reason: "odds unavailable" };
  }

  return { odds, nameOf, targetRoster, seasonRoundIds };
}

/** Read the frozen snapshot (if any) for a round. Null when none stored. */
export async function getStoredOddsLine(
  roundId: number,
): Promise<RoundOddsResult | null> {
  const row = await db
    .select({ payloadJson: oddsLines.payloadJson })
    .from(oddsLines)
    .where(eq(oddsLines.roundId, roundId))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.payloadJson) as RoundOddsResult;
  } catch {
    return null;
  }
}

/**
 * Freeze the round's line into odds_lines (idempotent upsert). Called at finalize
 * so the graded retrospective stays stable across future model changes. Caller
 * passes `now` (no Date.now() here) for testability. Non-fatal at the call site.
 */
export async function snapshotRoundOddsLine(
  roundId: number,
  now: number,
): Promise<void> {
  const line = await computeRoundOddsLine(roundId);
  if (!line) return;
  const payloadJson = JSON.stringify(line.odds);
  await db
    .insert(oddsLines)
    .values({
      roundId,
      modelVersion: ODDS_MODEL_VERSION,
      payloadJson,
      computedAt: now,
    })
    .onConflictDoUpdate({
      target: oddsLines.roundId,
      set: { modelVersion: ODDS_MODEL_VERSION, payloadJson, computedAt: now },
    });
}
