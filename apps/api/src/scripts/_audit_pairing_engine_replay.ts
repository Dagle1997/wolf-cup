/**
 * _audit_pairing_engine_replay.ts — counterfactual engine replay (minimize-max spec, Task 5).
 *
 * Read-only. Replays each finalized 2026 week's REAL roster + First/Last pins
 * through the NEW pairing engine (convex c² penalty + worst-player tie-break),
 * feeding the pairing matrix FORWARD week-by-week from the replay's OWN prior
 * groupings (not from history). This answers: "what if the new engine had run
 * the whole season?" — directional evidence, not a guarantee for future fields.
 *
 *   cd apps/api
 *   DB_PATH=../../_audit/wolf-cup-prod.db npx tsx src/scripts/_audit_pairing_engine_replay.ts
 *
 * DB_PATH must point at the snapshot so BOTH the libsql reads here AND the
 * drizzle `db` used by buildGroupRequestPins see the same database.
 *
 * Metric definitions match _audit_pairing_balance.ts exactly (re-declared here
 * because that script keeps them module-local):
 *   - timesTogether(pair) = # weeks both players were in the SAME group
 *   - totalRepeats        = Σ over pairs max(0, timesTogether − 1)
 *   - repeatSlots(player) = Σ over partners max(0, timesTogether − 1)
 *   - worst-player        = max over players of repeatSlots
 *
 * Bars to beat (from the original evaluation, reproduced live):
 *   - old-actual worst-player = 7 (Jason Moses), totalRepeats = 12
 *   - random baseline: avg worst 7.46, avg total 29.2 (we also report the random MEDIAN)
 *
 * Pass condition (AC9): the replay's MEDIAN worst-player over ≥20 seeds is
 * BELOW the random median AND below the old-actual 7, with total repeats well
 * under random (~29.2).
 */
import { createClient } from '@libsql/client';
import { suggestGroups, type PairingMatrix } from '@wolf-cup/engine';
import { buildGroupRequestPins } from '../lib/group-request-pins.js';

const DB = process.env['DB_PATH'] ?? '../../_audit/wolf-cup-prod.db';
const N_SEEDS = 200; // ≥ 20 per the spec; 200 tightens the median (review F9)
const RANDOM_SIMS = 2000;
const BASE_SEED = 0x9e3779b9;
const GROUP_SIZE = 4;

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

function accumulate(matrix: PairingMatrix, groups: readonly (readonly number[])[]): void {
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const k = pairKey(g[i]!, g[j]!);
        matrix.set(k, (matrix.get(k) ?? 0) + 1);
      }
    }
  }
}

function totalRepeats(counts: PairingMatrix): number {
  let t = 0;
  for (const c of counts.values()) t += Math.max(0, c - 1);
  return t;
}

function repeatSlotsByPlayer(counts: PairingMatrix): Map<number, number> {
  const byPlayer = new Map<number, number>();
  for (const [k, c] of counts) {
    if (c < 2) continue;
    const [a, b] = k.split('-').map(Number) as [number, number];
    byPlayer.set(a, (byPlayer.get(a) ?? 0) + (c - 1));
    byPlayer.set(b, (byPlayer.get(b) ?? 0) + (c - 1));
  }
  return byPlayer;
}

const worstPlayer = (counts: PairingMatrix): number =>
  Math.max(0, ...repeatSlotsByPlayer(counts).values());

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

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

interface RoundData {
  roundId: number;
  date: string;
  seasonId: number;
  roster: number[];
  groupSizes: number[];
  pins: Map<number, number>;
}

async function main() {
  const c = createClient({ url: `file:${DB}` });

  const roundsRes = await c.execute(
    "SELECT id, scheduled_date, season_id FROM rounds WHERE status='finalized' ORDER BY scheduled_date",
  );
  const players = await c.execute('SELECT id, name FROM players');
  const nameOf = new Map<number, string>();
  for (const p of players.rows) nameOf.set(Number(p['id']), String(p['name']));

  const rounds: RoundData[] = [];
  for (const r of roundsRes.rows) {
    const roundId = Number(r['id']);
    const seasonId = Number(r['season_id']);
    const scheduledDate = String(r['scheduled_date']);
    // Roster + actual group sizes (stable order for reproducibility).
    const rpRes = await c.execute({
      sql: `SELECT rp.player_id, g.group_number
            FROM round_players rp JOIN groups g ON g.id = rp.group_id
            WHERE rp.round_id = ? ORDER BY rp.player_id`,
      args: [roundId],
    });
    const roster = rpRes.rows.map((row) => Number(row['player_id']));
    const sizeByGroup = new Map<number, number>();
    for (const row of rpRes.rows) {
      const gn = Number(row['group_number']);
      sizeByGroup.set(gn, (sizeByGroup.get(gn) ?? 0) + 1);
    }
    const groupSizes = [...sizeByGroup.values()];
    // First/Last pins for this week — production logic, against the snapshot.
    const { pins } = await buildGroupRequestPins({
      seasonId,
      scheduledDate,
      playerIds: roster,
      groupSize: GROUP_SIZE,
    });
    rounds.push({ roundId, date: scheduledDate, seasonId, roster, groupSizes, pins });
  }

  // ---- Validate roster shape (review F1) ---------------------------------
  // The engine arm runs with a uniform `groupSize` and drops any leftover into
  // `remainder` (NOT accumulated), while the random arm partitions the FULL
  // roster via the actual group sizes. If those diverge the comparison is no
  // longer apples-to-apples. Every finalized 2026 round is clean groups of 4,
  // so assert that here and FAIL LOUDLY if a future snapshot isn't — rather
  // than silently dropping players and reporting an over-optimistic engine.
  for (const r of rounds) {
    if (r.roster.length % GROUP_SIZE !== 0) {
      throw new Error(
        `Round ${r.roundId} (${r.date}) roster ${r.roster.length} is not a multiple of ` +
          `GROUP_SIZE ${GROUP_SIZE}; the engine arm would drop ${r.roster.length % GROUP_SIZE} ` +
          `player(s) the random arm keeps. Handle non-uniform groups before trusting AC9.`,
      );
    }
    if (r.groupSizes.some((s) => s !== GROUP_SIZE)) {
      throw new Error(
        `Round ${r.roundId} (${r.date}) actual group sizes [${r.groupSizes.join(',')}] are not all ` +
          `${GROUP_SIZE}; engine arm and random arm would group different shapes. Reconcile first.`,
      );
    }
  }

  // ---- Counterfactual replay across seeds --------------------------------
  const replayWorsts: number[] = [];
  const replayTotals: number[] = [];
  // Track which player is most often the worst-off, for color.
  const worstNameTally = new Map<number, number>();

  for (let s = 0; s < N_SEEDS; s++) {
    const rng = mulberry32((BASE_SEED + Math.imul(s, 2654435761)) >>> 0);
    const matrix: PairingMatrix = new Map();
    for (const round of rounds) {
      const res = suggestGroups({
        matrix,
        playerIds: round.roster,
        pins: round.pins,
        groupSize: GROUP_SIZE,
        rng,
      });
      // Upfront validation guarantees this, but assert per-week so a regression
      // can never silently drop players from the engine arm's accounting.
      if (res.remainder.length !== 0) {
        throw new Error(`Round ${round.roundId} produced ${res.remainder.length} remainder players`);
      }
      accumulate(matrix, res.groups);
    }
    replayWorsts.push(worstPlayer(matrix));
    replayTotals.push(totalRepeats(matrix));
    // identify worst player(s)
    const slots = repeatSlotsByPlayer(matrix);
    const w = Math.max(0, ...slots.values());
    for (const [pid, sl] of slots) if (sl === w) worstNameTally.set(pid, (worstNameTally.get(pid) ?? 0) + 1);
  }

  // ---- Random baseline (unpinned, matches existing audit) ----------------
  const rng = mulberry32(BASE_SEED);
  const randWorsts: number[] = [];
  const randTotals: number[] = [];
  for (let i = 0; i < RANDOM_SIMS; i++) {
    const counts: PairingMatrix = new Map();
    for (const round of rounds) {
      accumulate(counts, randomPartition(round.roster, round.groupSizes, rng));
    }
    randWorsts.push(worstPlayer(counts));
    randTotals.push(totalRepeats(counts));
  }
  const randMedianWorst = median(randWorsts);
  const randAvgWorst = randWorsts.reduce((a, b) => a + b, 0) / RANDOM_SIMS;
  const randMedianTotal = median(randTotals);
  const randAvgTotal = randTotals.reduce((a, b) => a + b, 0) / RANDOM_SIMS;

  // ---- Report ------------------------------------------------------------
  const fmt = (xs: number[]) =>
    `min ${Math.min(...xs)} / median ${median(xs)} / max ${Math.max(...xs)}`;
  const OLD_WORST = 7;
  const OLD_TOTAL = 12;
  const medReplayWorst = median(replayWorsts);
  const medReplayTotal = median(replayTotals);

  console.log('==== Counterfactual engine replay (NEW convex + tie-break engine) ====');
  console.log(`Snapshot: ${DB}`);
  console.log(`Finalized rounds: ${rounds.length} (${rounds.map((r) => r.date).join(', ')})`);
  console.log(`Seeds: ${N_SEEDS}   Random sims: ${RANDOM_SIMS} (seed ${BASE_SEED})`);
  console.log('');
  console.log('-- Pins recovered per week (First/Last) --');
  for (const r of rounds) console.log(`   ${r.date}: ${r.pins.size} pinned`);
  console.log('');
  console.log('-- Worst-player repeat-slots --');
  console.log(`   NEW engine (replay) : ${fmt(replayWorsts)}`);
  console.log(`   old-actual          : ${OLD_WORST} (Jason Moses)`);
  console.log(`   random baseline     : median ${randMedianWorst}, avg ${randAvgWorst.toFixed(2)}`);
  console.log('');
  console.log('-- Total repeats --');
  console.log(`   NEW engine (replay) : ${fmt(replayTotals)}`);
  console.log(`   old-actual          : ${OLD_TOTAL}`);
  console.log(`   random baseline     : median ${randMedianTotal}, avg ${randAvgTotal.toFixed(1)}`);
  console.log('');
  const worstByCount = [...worstNameTally.entries()].sort((a, b) => b[1] - a[1]);
  console.log('-- Who is the worst-off player across replay seeds --');
  for (const [pid, n] of worstByCount.slice(0, 6))
    console.log(`   ${nameOf.get(pid) ?? pid}: worst in ${n}/${N_SEEDS} seeds`);
  console.log('');
  // Both gates compare median-to-median for a consistent statistic (review F10).
  const passWorst = medReplayWorst < randMedianWorst && medReplayWorst < OLD_WORST;
  const passTotal = medReplayTotal < randMedianTotal;
  console.log('-- AC9 gate --');
  console.log(`   median worst-player ${medReplayWorst} < random median ${randMedianWorst} AND < old-actual ${OLD_WORST}: ${passWorst ? 'PASS' : 'FAIL'}`);
  console.log(`   median total ${medReplayTotal} < random median ${randMedianTotal} (avg ${randAvgTotal.toFixed(1)}): ${passTotal ? 'PASS' : 'FAIL'}`);
  console.log(`   OVERALL: ${passWorst && passTotal ? 'PASS ✅' : 'FAIL ❌'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
