// ---------------------------------------------------------------------------
// Backtest the CURRENT odds model against actual winners on every finalized
// round, scoring log-loss + Brier (engine helpers) with a 95% bootstrap CI.
//
// This is the gate: any model change (e.g. group-aware money) must BEAT this
// baseline here before it ships. Uniform 1/N would score log-loss = ln(N); a
// useful model beats that.
//
// Run: tsx src/scripts/backtest-odds.ts [seasonYear]
// ---------------------------------------------------------------------------
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { rounds, harveyResults, seasons } from "../db/schema.js";
import { computeRoundOddsLine, ODDS_MODEL_VERSION } from "../lib/odds-line.js";
import { logLossAndBrier, bootstrapMeanCI } from "@wolf-cup/engine";

async function main(): Promise<void> {
  const yearArg = process.argv[2] ? Number(process.argv[2]) : null;
  let seasonId: number | null = null;
  if (yearArg) {
    const s = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.year, yearArg))
      .get();
    if (!s) {
      console.error(`No season for year ${yearArg}`);
      process.exit(1);
    }
    seasonId = s.id;
  }

  const finalized = await db
    .select({
      id: rounds.id,
      date: rounds.scheduledDate,
      seasonId: rounds.seasonId,
    })
    .from(rounds)
    .where(and(eq(rounds.type, "official"), eq(rounds.status, "finalized")))
    .orderBy(rounds.scheduledDate, rounds.id);
  const rows = finalized.filter(
    (r) => seasonId == null || r.seasonId === seasonId,
  );

  const logLosses: number[] = [];
  const briers: number[] = [];
  let graded = 0;
  let skippedGated = 0;
  let skippedNoWinner = 0;

  for (const r of rows) {
    const line = await computeRoundOddsLine(r.id);
    if (!line || ("gated" in line.odds && line.odds.gated)) {
      skippedGated++;
      continue;
    }
    const lines = line.odds.lines;
    const memberIds = line.targetRoster
      .filter((t) => !t.isSub)
      .map((t) => t.playerId);
    const memberSet = new Set(memberIds);
    const probByMember = new Map(lines.map((l) => [l.playerId, l.fairProb]));

    // Actual winner = top MEMBER by Harvey points (stableford + money), lowest id on a tie.
    const hr = await db
      .select({
        playerId: harveyResults.playerId,
        sp: harveyResults.stablefordPoints,
        mp: harveyResults.moneyPoints,
      })
      .from(harveyResults)
      .where(eq(harveyResults.roundId, r.id));
    const memberPts = hr.filter((h) => memberSet.has(h.playerId));
    if (memberPts.length === 0) {
      skippedNoWinner++;
      continue;
    }
    const max = Math.max(...memberPts.map((h) => h.sp + h.mp));
    const winnerId = memberPts
      .filter((h) => h.sp + h.mp === max)
      .map((h) => h.playerId)
      .sort((a, b) => a - b)[0]!;

    const { logLoss, brier } = logLossAndBrier(
      probByMember,
      memberIds,
      winnerId,
    );
    logLosses.push(logLoss);
    briers.push(brier);
    graded++;
    console.log(
      `R${r.id} ${r.date}: winner=${winnerId} fairP=${(probByMember.get(winnerId) ?? 0).toFixed(3)} ` +
        `logLoss=${logLoss.toFixed(3)} brier=${brier.toFixed(3)}`,
    );
  }

  if (graded === 0) {
    console.log(
      "No graded rounds (all gated / no winner). Need >= 3 prior finalized rounds for a priced week.",
    );
    return;
  }

  const ll = bootstrapMeanCI(logLosses, 12345);
  const br = bootstrapMeanCI(briers, 23456);
  console.log(
    `\nModel: ${ODDS_MODEL_VERSION} | graded=${graded} skipped(gated=${skippedGated}, noWinner=${skippedNoWinner})`,
  );
  console.log(
    `log-loss: mean=${ll.mean.toFixed(4)}  95% CI [${ll.lo.toFixed(4)}, ${ll.hi.toFixed(4)}]`,
  );
  console.log(
    `brier:    mean=${br.mean.toFixed(4)}  95% CI [${br.lo.toFixed(4)}, ${br.hi.toFixed(4)}]`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
