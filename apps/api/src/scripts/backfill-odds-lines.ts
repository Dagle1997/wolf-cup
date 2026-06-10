// ---------------------------------------------------------------------------
// Backfill odds_lines snapshots for finalized official rounds that predate the
// snapshot-at-finalize hook. SKIPS rounds that already have a snapshot so a
// historically-frozen line (possibly at an older model version) is never
// clobbered. Run: tsx src/scripts/backfill-odds-lines.ts
// ---------------------------------------------------------------------------
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { rounds, oddsLines } from "../db/schema.js";
import { snapshotRoundOddsLine } from "../lib/odds-line.js";

async function main(): Promise<void> {
  const finalized = await db
    .select({ id: rounds.id, date: rounds.scheduledDate })
    .from(rounds)
    .where(and(eq(rounds.type, "official"), eq(rounds.status, "finalized")))
    .orderBy(rounds.scheduledDate, rounds.id);

  const existing = new Set(
    (await db.select({ roundId: oddsLines.roundId }).from(oddsLines)).map(
      (r) => r.roundId,
    ),
  );

  let snapped = 0;
  let skipped = 0;
  for (const r of finalized) {
    if (existing.has(r.id)) {
      skipped++;
      continue;
    }
    await snapshotRoundOddsLine(r.id, Date.now());
    snapped++;
    console.log(`snapshotted round ${r.id} (${r.date})`);
  }
  console.log(
    `Done. ${snapped} snapshotted, ${skipped} already had a snapshot, ${finalized.length} finalized rounds total.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
