import { Hono } from "hono";
import { eq, and, or, inArray, desc, countDistinct } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  rounds,
  groups,
  roundPlayers,
  players,
  holeScores,
  roundResults,
  harveyResults,
  seasons,
  sideGames,
  sideGameResults,
} from "../db/schema.js";
import {
  getCourseHole,
  getHandicapStrokes,
  calculateHarveyPoints,
} from "@wolf-cup/engine";
import type { HoleNumber, Tee } from "@wolf-cup/engine";

const DEFAULT_TEE: Tee = "blue";
import { computeSideGameLeaderLive } from "../lib/side-game-calc-db.js";
import { wolfDecisions } from "../db/schema.js";

const app = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaderboardPlayer = {
  playerId: number;
  name: string;
  handicapIndex: number;
  groupId: number;
  groupNumber: number;
  thruHole: number;
  grossTotal: number;
  netToPar: number;
  stablefordTotal: number;
  moneyTotal: number;
  rank: number; // primary: netToPar ascending
  stablefordRank: number; // for Harvey computation
  moneyRank: number;
  harveyStableford: number | null;
  harveyMoney: number | null;
  harveyTotal: number | null;
  totalPutts: number | null;
};

type RoundRow = {
  id: number;
  type: string;
  status: string;
  scheduledDate: string;
  autoCalculateMoney: number;
  seasonId: number;
  tee: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dense rank, descending — higher total = better (stableford / money) */
function assignRanks(
  items: { playerId: number; total: number }[],
): Map<number, number> {
  const sorted = [...items].sort((a, b) => b.total - a.total);
  const ranks = new Map<number, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]!.total < sorted[i - 1]!.total) rank = i + 1;
    ranks.set(sorted[i]!.playerId, rank);
  }
  return ranks;
}

/** Dense rank, ascending — lower total = better (net-to-par) */
function assignRanksAsc(
  items: { playerId: number; total: number }[],
): Map<number, number> {
  const sorted = [...items].sort((a, b) => a.total - b.total);
  const ranks = new Map<number, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]!.total > sorted[i - 1]!.total) rank = i + 1;
    ranks.set(sorted[i]!.playerId, rank);
  }
  return ranks;
}

/** Build full leaderboard response for a given round */
async function buildLeaderboard(round: RoundRow) {
  const roundInfo = {
    id: round.id,
    type: round.type as "official" | "casual",
    status: round.status,
    scheduledDate: round.scheduledDate,
    autoCalculateMoney: Boolean(round.autoCalculateMoney),
  };

  // Season — harveyLiveEnabled flag (always enabled for casual/practice rounds)
  const isCasual = round.type === "casual";
  const season = await db
    .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
    .from(seasons)
    .where(eq(seasons.id, round.seasonId))
    .get();
  const harveyLiveEnabled = isCasual || Boolean(season?.harveyLiveEnabled);

  // All round_players with group info and handicap
  const playerRows = await db
    .select({
      playerId: roundPlayers.playerId,
      groupId: roundPlayers.groupId,
      groupNumber: groups.groupNumber,
      name: players.name,
      handicapIndex: roundPlayers.handicapIndex,
      isSub: roundPlayers.isSub,
    })
    .from(roundPlayers)
    .innerJoin(players, eq(players.id, roundPlayers.playerId))
    .innerJoin(groups, eq(groups.id, roundPlayers.groupId))
    .where(eq(roundPlayers.roundId, round.id));

  // All hole scores → compute thruHole per group + grossTotal/netToPar per player
  const handicapMap = new Map(
    playerRows.map((p) => [p.playerId, p.handicapIndex]),
  );

  const allHoleScoreRows = await db
    .select({
      playerId: holeScores.playerId,
      groupId: holeScores.groupId,
      holeNumber: holeScores.holeNumber,
      grossScore: holeScores.grossScore,
      putts: holeScores.putts,
    })
    .from(holeScores)
    .where(eq(holeScores.roundId, round.id));

  const thruHoleMap = new Map<number, number>(); // groupId → max holeNumber
  const playerStatsMap = new Map<
    number,
    { grossTotal: number; netToPar: number }
  >();

  const roundTee = (round.tee as Tee | null) ?? DEFAULT_TEE;
  for (const row of allHoleScoreRows) {
    const courseHole = getCourseHole(row.holeNumber as HoleNumber);
    const hi = handicapMap.get(row.playerId) ?? 0;
    const strokes = getHandicapStrokes(hi, courseHole.strokeIndex, roundTee);
    const net = row.grossScore - strokes;

    thruHoleMap.set(
      row.groupId,
      Math.max(thruHoleMap.get(row.groupId) ?? 0, row.holeNumber),
    );

    const stats = playerStatsMap.get(row.playerId) ?? {
      grossTotal: 0,
      netToPar: 0,
    };
    stats.grossTotal += row.grossScore;
    stats.netToPar += net - courseHole.par;
    playerStatsMap.set(row.playerId, stats);
  }

  // round_results for stablefordTotal / moneyTotal
  const resultRows = await db
    .select({
      playerId: roundResults.playerId,
      stablefordTotal: roundResults.stablefordTotal,
      moneyTotal: roundResults.moneyTotal,
    })
    .from(roundResults)
    .where(eq(roundResults.roundId, round.id));
  const resultMap = new Map(resultRows.map((r) => [r.playerId, r]));

  // Harvey points — try DB first (finalized rounds), fall back to live computation
  let harveyMap = new Map<
    number,
    { stablefordPoints: number; moneyPoints: number }
  >();
  if (harveyLiveEnabled) {
    // Try stored results first (finalized rounds with harvey_results)
    if (round.status !== "active") {
      const harveyRows = await db
        .select({
          playerId: harveyResults.playerId,
          stablefordPoints: harveyResults.stablefordPoints,
          moneyPoints: harveyResults.moneyPoints,
        })
        .from(harveyResults)
        .where(eq(harveyResults.roundId, round.id));
      if (harveyRows.length > 0) {
        harveyMap = new Map(harveyRows.map((r) => [r.playerId, r]));
      }
    }
    // Compute on the fly if no stored results (active rounds or missing harvey_results)
    if (harveyMap.size === 0 && playerRows.length > 0) {
      const playerCount = playerRows.length;
      const bonusPerPlayer =
        ({ 1: 8, 2: 6, 3: 4, 4: 2 } as Record<number, number>)[
          Math.floor(playerCount / 4)
        ] ?? 0;
      const harveyInput = playerRows.map((p) => {
        const r = resultMap.get(p.playerId);
        return {
          stableford: r?.stablefordTotal ?? 0,
          money: r?.moneyTotal ?? 0,
        };
      });
      const liveHarvey = calculateHarveyPoints(
        harveyInput,
        "regular",
        bonusPerPlayer,
      );
      harveyMap = new Map(
        playerRows.map((p, i) => [
          p.playerId,
          {
            stablefordPoints: liveHarvey[i]!.stablefordPoints,
            moneyPoints: liveHarvey[i]!.moneyPoints,
          },
        ]),
      );
    }
  }

  // Active side game
  const allSideGames = await db
    .select({
      id: sideGames.id,
      name: sideGames.name,
      format: sideGames.format,
      calculationType: sideGames.calculationType,
      scheduledRoundIds: sideGames.scheduledRoundIds,
    })
    .from(sideGames)
    .where(eq(sideGames.seasonId, round.seasonId));
  const activeSideGame = allSideGames.find((sg) => {
    try {
      const ids = JSON.parse(sg.scheduledRoundIds ?? "[]") as number[];
      return Array.isArray(ids) && ids.includes(round.id);
    } catch {
      return false;
    }
  });
  const sideGame = activeSideGame
    ? {
        name: activeSideGame.name,
        format: activeSideGame.format,
        calculationType: activeSideGame.calculationType ?? null,
      }
    : null;

  // Rank assignments
  const netToParRanks = assignRanksAsc(
    playerRows.map((p) => ({
      playerId: p.playerId,
      total: playerStatsMap.get(p.playerId)?.netToPar ?? 0,
    })),
  );
  const stablefordRanks = assignRanks(
    playerRows.map((p) => ({
      playerId: p.playerId,
      total: resultMap.get(p.playerId)?.stablefordTotal ?? 0,
    })),
  );
  const moneyRanks = assignRanks(
    playerRows.map((p) => ({
      playerId: p.playerId,
      total: resultMap.get(p.playerId)?.moneyTotal ?? 0,
    })),
  );

  // Compute Harvey totals and determine primary rank
  const harveyTotalMap = new Map<number, number>();
  if (harveyLiveEnabled) {
    for (const p of playerRows) {
      const h = harveyMap.get(p.playerId);
      harveyTotalMap.set(
        p.playerId,
        h ? h.stablefordPoints + h.moneyPoints : 0,
      );
    }
  }
  const primaryRanks = harveyLiveEnabled
    ? assignRanks(
        playerRows.map((p) => ({
          playerId: p.playerId,
          total: harveyTotalMap.get(p.playerId) ?? 0,
        })),
      )
    : netToParRanks;

  // Putts totals (only on Least Putts weeks)
  const isPuttsWeek = sideGame?.calculationType === "auto_putts";
  const puttsTotalMap = new Map<number, number>();
  if (isPuttsWeek) {
    for (const score of allHoleScoreRows) {
      if (score.putts !== null && score.putts !== undefined) {
        puttsTotalMap.set(
          score.playerId,
          (puttsTotalMap.get(score.playerId) ?? 0) + score.putts,
        );
      }
    }
  }

  // Side game live leader — running in-progress leader for auto-calc games.
  // Computed for non-finalized rounds; finalized rounds show sideGameWinner
  // (below) instead, which reflects the stored result.
  //
  // auto_skins is the exception: it's a list-display game with no single
  // winner, so we always compute live (live + finalized) and emit the full
  // skin-holder list via sideGameSkinHolders. sideGameLeader/sideGameWinner
  // stay null for skins.
  let sideGameLeader: { playerName: string; detail: string } | null = null;
  let sideGameSkinHolders: { playerName: string; skins: number }[] | null =
    null;
  // Defense-in-depth: also treat rows named 'Skins'/'Most Skins' as skins
  // even if calculationType is NULL (legacy seeds, partial migrations).
  // Migration 0028 promotes those rows; this is the boot-order belt.
  const isSkinsGame =
    !!activeSideGame &&
    (activeSideGame.calculationType === "auto_skins" ||
      activeSideGame.name === "Skins" ||
      activeSideGame.name === "Most Skins");
  // Effective calc type: a legacy skins row with NULL calculationType still
  // routes through the auto_skins compute path. Without this, the guard
  // below would short-circuit on the falsy calc-type and the skins card
  // would render empty even though we knew it was skins by name.
  const effectiveCalcType = activeSideGame
    ? (activeSideGame.calculationType ?? (isSkinsGame ? "auto_skins" : null))
    : null;
  if (
    activeSideGame &&
    effectiveCalcType &&
    effectiveCalcType !== "manual" &&
    (round.status !== "finalized" || isSkinsGame)
  ) {
    const scoreRows = allHoleScoreRows.map((s) => ({
      playerId: s.playerId,
      holeNumber: s.holeNumber,
      grossScore: s.grossScore,
      putts: s.putts,
    }));
    let decisions:
      | {
          wolfPlayerId: number;
          holeNumber: number;
          bonusesJson: string | null;
        }[]
      | undefined;
    if (effectiveCalcType === "auto_polies") {
      const wdRows = await db
        .select({
          wolfPlayerId: wolfDecisions.wolfPlayerId,
          holeNumber: wolfDecisions.holeNumber,
          bonusesJson: wolfDecisions.bonusesJson,
        })
        .from(wolfDecisions)
        .where(eq(wolfDecisions.roundId, round.id));
      decisions = wdRows.map((d) => ({
        wolfPlayerId: d.wolfPlayerId ?? 0,
        holeNumber: d.holeNumber,
        bonusesJson: d.bonusesJson,
      }));
    }
    const live = computeSideGameLeaderLive({
      calculationType: effectiveCalcType,
      scores: scoreRows,
      players: playerRows.map((p) => ({
        playerId: p.playerId,
        handicapIndex: p.handicapIndex,
        isSub: Boolean(p.isSub),
      })),
      tee: (round.tee ?? "blue") as Tee,
      roundStatus: round.status,
      ...(decisions ? { decisions } : {}),
    });
    if (live && isSkinsGame && live.skinHolders) {
      // Map IDs → names. Sort: skins desc, then name asc (calc already
      // returns desc-by-skins; we re-stabilize the ties alphabetically).
      const annotated = live.skinHolders.map((h) => ({
        playerName:
          playerRows.find((p) => p.playerId === h.playerId)?.name ?? "Unknown",
        skins: h.skins,
      }));
      annotated.sort(
        (a, b) => b.skins - a.skins || a.playerName.localeCompare(b.playerName),
      );
      sideGameSkinHolders = annotated;
    } else if (live && !isSkinsGame && live.winnerPlayerIds.length > 0) {
      const names = live.winnerPlayerIds
        .map(
          (id) => playerRows.find((p) => p.playerId === id)?.name ?? "Unknown",
        )
        .join(" & ");
      sideGameLeader = { playerName: names, detail: live.detail };
    }
  }

  // Side game winner (after finalization). Skipped for auto_skins — that
  // game writes no sideGameResults rows; its display goes through
  // sideGameSkinHolders above.
  let sideGameWinner: { playerName: string; detail: string } | null = null;
  if (activeSideGame && !isSkinsGame && round.status === "finalized") {
    const results = await db
      .select({
        winnerPlayerId: sideGameResults.winnerPlayerId,
        winnerName: sideGameResults.winnerName,
        notes: sideGameResults.notes,
      })
      .from(sideGameResults)
      .where(
        and(
          eq(sideGameResults.sideGameId, activeSideGame.id),
          eq(sideGameResults.roundId, round.id),
        ),
      );
    if (results.length > 0) {
      // Join player names
      const winnerNames: string[] = [];
      for (const r of results) {
        if (r.winnerPlayerId) {
          const player = playerRows.find(
            (p) => p.playerId === r.winnerPlayerId,
          );
          winnerNames.push(player?.name ?? "Unknown");
        } else if (r.winnerName) {
          winnerNames.push(r.winnerName);
        }
      }
      sideGameWinner = {
        playerName: winnerNames.join(" & "),
        detail: results[0]?.notes ?? "",
      };
    }
  }

  const leaderboard: LeaderboardPlayer[] = playerRows
    .map((p) => {
      const result = resultMap.get(p.playerId);
      const stats = playerStatsMap.get(p.playerId);
      const harvey = harveyMap.get(p.playerId);
      return {
        playerId: p.playerId,
        name: p.name,
        handicapIndex: p.handicapIndex,
        groupId: p.groupId,
        groupNumber: p.groupNumber,
        thruHole: thruHoleMap.get(p.groupId) ?? 0,
        grossTotal: stats?.grossTotal ?? 0,
        netToPar: stats?.netToPar ?? 0,
        stablefordTotal: result?.stablefordTotal ?? 0,
        moneyTotal: result?.moneyTotal ?? 0,
        rank: primaryRanks.get(p.playerId) ?? playerRows.length,
        stablefordRank: stablefordRanks.get(p.playerId) ?? playerRows.length,
        moneyRank: moneyRanks.get(p.playerId) ?? playerRows.length,
        harveyStableford: harveyLiveEnabled
          ? (harvey?.stablefordPoints ?? null)
          : null,
        harveyMoney: harveyLiveEnabled ? (harvey?.moneyPoints ?? null) : null,
        harveyTotal: harveyLiveEnabled
          ? (harveyTotalMap.get(p.playerId) ?? null)
          : null,
        totalPutts: isPuttsWeek
          ? (puttsTotalMap.get(p.playerId) ?? null)
          : null,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  return {
    round: roundInfo,
    harveyLiveEnabled,
    sideGame,
    sideGameWinner,
    sideGameLeader,
    sideGameSkinHolders,
    leaderboard,
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /leaderboard/live — public, no auth middleware
// ---------------------------------------------------------------------------

app.get("/leaderboard/live", async (c) => {
  try {
    // Show the current round: any active or scheduled round, regardless of date.
    // A round appears on the live board as soon as it's set up (scheduled), so
    // its leaderboard and scouting report are reachable before game day.
    // Official rounds win over casual on tie — an active practice round must
    // never hijack the public live board when an official round is set up.
    const candidates = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        scheduledDate: rounds.scheduledDate,
        autoCalculateMoney: rounds.autoCalculateMoney,
        seasonId: rounds.seasonId,
        tee: rounds.tee,
      })
      .from(rounds)
      .where(or(eq(rounds.status, "active"), eq(rounds.status, "scheduled")))
      .orderBy(desc(rounds.id))
      .all();

    const round =
      candidates.find((r) => r.type === "official") ?? candidates[0] ?? null;

    if (!round) {
      return c.json(
        {
          round: null,
          harveyLiveEnabled: false,
          sideGame: null,
          sideGameWinner: null,
          sideGameLeader: null,
          sideGameSkinHolders: null,
          leaderboard: [],
          lastUpdated: new Date().toISOString(),
        },
        200,
      );
    }

    return c.json(await buildLeaderboard(round), 200);
  } catch {
    return c.json({ error: "Internal error", code: "INTERNAL_ERROR" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /leaderboard/history — list of completed rounds (most recent first)
// ---------------------------------------------------------------------------

app.get("/leaderboard/history", async (c) => {
  try {
    const roundRows = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        scheduledDate: rounds.scheduledDate,
      })
      .from(rounds)
      .where(inArray(rounds.status, ["finalized", "active", "completed"]))
      .orderBy(desc(rounds.scheduledDate), desc(rounds.id));

    // Get player counts per round
    const playerCounts = await db
      .select({
        roundId: roundPlayers.roundId,
        count: countDistinct(roundPlayers.playerId),
      })
      .from(roundPlayers)
      .groupBy(roundPlayers.roundId);
    const countMap = new Map(playerCounts.map((r) => [r.roundId, r.count]));

    const rows = roundRows.map((r) => ({
      ...r,
      playerCount: countMap.get(r.id) ?? 0,
    }));

    return c.json({ rounds: rows }, 200);
  } catch {
    return c.json({ error: "Internal error", code: "INTERNAL_ERROR" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /leaderboard/:roundId — leaderboard for a specific round
// ---------------------------------------------------------------------------

app.get("/leaderboard/:roundId", async (c) => {
  try {
    const roundId = Number(c.req.param("roundId"));
    if (!Number.isInteger(roundId) || roundId <= 0) {
      return c.json({ error: "Invalid round ID", code: "INVALID_ID" }, 400);
    }

    const round = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        scheduledDate: rounds.scheduledDate,
        autoCalculateMoney: rounds.autoCalculateMoney,
        seasonId: rounds.seasonId,
        tee: rounds.tee,
      })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();

    if (!round) {
      return c.json({ error: "Round not found", code: "NOT_FOUND" }, 404);
    }

    return c.json(await buildLeaderboard(round), 200);
  } catch {
    return c.json({ error: "Internal error", code: "INTERNAL_ERROR" }, 500);
  }
});

export default app;
