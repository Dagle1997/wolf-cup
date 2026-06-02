/**
 * _audit_pairing_balance.ts — co-play balance evaluation (Task 9).
 *
 * Reproducible, evidence-first measurement of how well the weighted-average
 * pairing engine (packages/engine/src/pairing.ts) spreads partners over a
 * season, using the real production snapshot. Read-only.
 *
 *   cd apps/api
 *   DB_PATH=../../_audit/wolf-cup-prod.db npx tsx src/scripts/_audit_pairing_balance.ts
 *
 * Metric definitions (stated so the numbers are reproducible):
 *   - co-attendance(pair)     = # finalized rounds where BOTH players were in the field
 *   - timesTogether(pair)     = # finalized rounds where both were in the SAME group
 *   - repeat-pairing          = a pair with timesTogether >= 2
 *   - totalRepeats            = Σ over pairs max(0, timesTogether − 1)
 *   - repeatSlots(player)     = Σ over partners max(0, timesTogether − 1)
 *
 * Random baseline: SEED-fixed mulberry32 PRNG, N sims. Each sim re-partitions
 * each round's ACTUAL roster into that round's ACTUAL group sizes (Fisher–Yates),
 * then recomputes the same metrics. It does NOT replicate First/Last pins — so
 * the baseline gives the engine a slightly HARDER target (random is unconstrained),
 * which makes the engine's win conservative, not flattered.
 */
import { createClient } from '@libsql/client';

const DB = process.env['DB_PATH'] ?? '../../_audit/wolf-cup-prod.db';
const N_SIMS = 2000;
const SEED = 0x9e3779b9;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

interface RoundData {
  roundId: number;
  date: string;
  groups: number[][]; // each group = playerIds
  roster: number[]; // all players in the round
  groupSizes: number[];
}

function pairCountsFromRounds(rounds: RoundData[], grouper: (r: RoundData) => number[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rounds) {
    for (const g of grouper(r)) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const k = pairKey(g[i]!, g[j]!);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

function totalRepeats(counts: Map<string, number>): number {
  let t = 0;
  for (const c of counts.values()) t += Math.max(0, c - 1);
  return t;
}

function repeatSlotsByPlayer(counts: Map<string, number>): Map<number, number> {
  const byPlayer = new Map<number, number>();
  for (const [k, c] of counts) {
    if (c < 2) continue;
    const [a, b] = k.split('-').map(Number) as [number, number];
    byPlayer.set(a, (byPlayer.get(a) ?? 0) + (c - 1));
    byPlayer.set(b, (byPlayer.get(b) ?? 0) + (c - 1));
  }
  return byPlayer;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function randomPartition(roster: number[], sizes: number[], rng: () => number): number[][] {
  const pool = [...roster];
  shuffleInPlace(pool, rng);
  const out: number[][] = [];
  let idx = 0;
  for (const s of sizes) {
    out.push(pool.slice(idx, idx + s));
    idx += s;
  }
  return out;
}

async function main() {
  const c = createClient({ url: `file:${DB}` });

  const roundsRes = await c.execute(
    "SELECT id, scheduled_date FROM rounds WHERE status='finalized' ORDER BY scheduled_date",
  );
  const players = await c.execute('SELECT id, name FROM players');
  const nameOf = new Map<number, string>();
  for (const p of players.rows) nameOf.set(Number(p['id']), String(p['name']));

  const rounds: RoundData[] = [];
  for (const r of roundsRes.rows) {
    const roundId = Number(r['id']);
    const rpRes = await c.execute({
      sql: `SELECT rp.player_id, g.group_number
            FROM round_players rp JOIN groups g ON g.id = rp.group_id
            WHERE rp.round_id = ? ORDER BY g.group_number`,
      args: [roundId],
    });
    const byGroup = new Map<number, number[]>();
    for (const row of rpRes.rows) {
      const gn = Number(row['group_number']);
      const pid = Number(row['player_id']);
      (byGroup.get(gn) ?? byGroup.set(gn, []).get(gn)!).push(pid);
    }
    const groups = [...byGroup.values()];
    const roster = groups.flat();
    rounds.push({
      roundId,
      date: String(r['scheduled_date']),
      groups,
      roster,
      groupSizes: groups.map((g) => g.length),
    });
  }

  // ---- Engine (actual) metrics -------------------------------------------
  const engineCounts = pairCountsFromRounds(rounds, (r) => r.groups);
  const engineTotal = totalRepeats(engineCounts);
  const engineSlots = repeatSlotsByPlayer(engineCounts);
  const engineWorst = Math.max(0, ...engineSlots.values());
  const repeatPairs = [...engineCounts.values()].filter((v) => v >= 2).length;
  const maxPair = Math.max(0, ...engineCounts.values());

  // Co-attendance denominator
  const coAttend = new Map<string, number>();
  for (const r of rounds) {
    const ro = r.roster;
    for (let i = 0; i < ro.length; i++)
      for (let j = i + 1; j < ro.length; j++) {
        const k = pairKey(ro[i]!, ro[j]!);
        coAttend.set(k, (coAttend.get(k) ?? 0) + 1);
      }
  }
  const repeatCapable = [...coAttend.entries()].filter(([, v]) => v >= 2);
  const repeatedAmongCapable = repeatCapable.filter(([k]) => (engineCounts.get(k) ?? 0) >= 2).length;

  // ---- Random baseline ----------------------------------------------------
  const rng = mulberry32(SEED);
  let sumTotal = 0;
  let beatOrTie = 0; // sims with totalRepeats <= engine
  let sumWorst = 0;
  let worstBeatOrTie = 0; // sims whose worst-player <= engine worst
  for (let s = 0; s < N_SIMS; s++) {
    const simCounts = pairCountsFromRounds(rounds, (r) => randomPartition(r.roster, r.groupSizes, rng));
    const t = totalRepeats(simCounts);
    sumTotal += t;
    if (t <= engineTotal) beatOrTie++;
    const w = Math.max(0, ...repeatSlotsByPlayer(simCounts).values());
    sumWorst += w;
    if (w <= engineWorst) worstBeatOrTie++;
  }
  const randAvgTotal = sumTotal / N_SIMS;
  const randAvgWorst = sumWorst / N_SIMS;

  // ---- Most-concentrated player breakdown --------------------------------
  let topPlayer = -1;
  let topSlots = -1;
  for (const [pid, sl] of engineSlots) if (sl > topSlots) { topSlots = sl; topPlayer = pid; }
  // partner multiplicities for top player
  const partnerCounts = new Map<number, number>();
  for (const [k, cnt] of engineCounts) {
    const [a, b] = k.split('-').map(Number) as [number, number];
    if (a === topPlayer) partnerCounts.set(b, cnt);
    else if (b === topPlayer) partnerCounts.set(a, cnt);
  }
  const partnersSorted = [...partnerCounts.entries()].sort((x, y) => y[1] - x[1]);

  // First/Last pin effect on the top player
  const reqRes = await c.execute({
    sql: `SELECT sw.friday, a.group_request
          FROM attendance a JOIN season_weeks sw ON sw.id = a.season_week_id
          WHERE a.player_id = ? AND a.group_request IS NOT NULL`,
    args: [topPlayer],
  });

  // ---- Report -------------------------------------------------------------
  const pct = (n: number) => `${((n / N_SIMS) * 100).toFixed(1)}%`;
  console.log('==== Co-play balance evaluation ====');
  console.log(`Snapshot: ${DB}`);
  console.log(`Finalized rounds: ${rounds.length} (${rounds.map((r) => r.date).join(', ')})`);
  console.log('');
  console.log('-- Aggregate spread --');
  console.log(`Engine totalRepeats          : ${engineTotal}`);
  console.log(`Repeat pairs (timesTogether>=2): ${repeatPairs}`);
  console.log(`Max any pair played together  : ${maxPair}`);
  console.log(`Random avg totalRepeats (N=${N_SIMS}, seed ${SEED}): ${randAvgTotal.toFixed(1)}`);
  console.log(`Sims with totalRepeats <= engine: ${beatOrTie}/${N_SIMS} (${pct(beatOrTie)})`);
  console.log('');
  console.log('-- Honest denominator --');
  console.log(`Pairs co-attending >=2 weeks  : ${repeatCapable.length}`);
  const repeatRate =
    repeatCapable.length > 0
      ? `${((repeatedAmongCapable / repeatCapable.length) * 100).toFixed(1)}%`
      : 'n/a (no repeat-capable pairs yet)';
  console.log(`...that actually repeated     : ${repeatedAmongCapable} (${repeatRate})`);
  console.log('');
  console.log('-- Individual fairness --');
  console.log(`Engine worst-player repeatSlots: ${engineWorst} (${nameOf.get(topPlayer) ?? topPlayer})`);
  console.log(`Random avg worst-player slots  : ${randAvgWorst.toFixed(2)}`);
  console.log(`Sims whose worst <= engine worst: ${worstBeatOrTie}/${N_SIMS} (${pct(worstBeatOrTie)})`);
  console.log('');
  console.log(`-- Most-concentrated player: ${nameOf.get(topPlayer) ?? topPlayer} (slots ${topSlots}, ${partnersSorted.length} distinct partners) --`);
  for (const [pid, cnt] of partnersSorted) console.log(`   ${cnt}x  ${nameOf.get(pid) ?? pid}`);
  console.log('');
  console.log('-- First/Last requests by the most-concentrated player --');
  if (reqRes.rows.length === 0) console.log('   none on record');
  else for (const row of reqRes.rows) console.log(`   ${row['friday']}: ${row['group_request']}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
