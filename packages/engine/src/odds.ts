// ---------------------------------------------------------------------------
// Weekly Harvey-points win odds — "The Line".
//
// A deterministic, seedable Monte-Carlo / paired-bootstrap model that prices
// each full member's probability of winning the MOST Harvey points in an
// upcoming round, then converts to American odds with a book-like overround.
//
// Determinism is mandatory (the scouting report is frozen to form going into
// the week): seed the PRNG from `roundId` and never touch `Math.random()` /
// `Date.now()`. Same inputs ⇒ byte-identical odds on every read.
//
// The model reuses the production `calculateHarveyPoints` ranker verbatim so the
// simulated points are consistent with real scoring. Multiplier/bonus are
// argmax-invariant, so the sim ranks with ('regular', 0).
//
// Where the edge comes from (first-principles): net Stableford is engineered to
// equalize members, so the forecastable signal is NOT "predicting golf" — it's
// pricing the part the handicap doesn't erase: (1) handicap lag / current form,
// and (2) the money half of Harvey (wolf/skins/birdies are not handicap-
// equalized). A near-flat early-season board is therefore CORRECT, not a bug
// (gated below MIN_FIELD_ROUNDS, rendered "wide-open" when present).
// ---------------------------------------------------------------------------

import { calculateHarveyPoints } from './harvey.js';
import type { HarveyRoundInput } from './types.js';
import { mulberry32, pickWeightedIndex } from './rng.js';

// ---------------------------------------------------------------------------
// Pinned constants (F10). Each carries its rationale.
// ---------------------------------------------------------------------------

export interface OddsConstants {
  /** Monte-Carlo sample size. SE at p≈0.05 ≈ 0.15pp — below display resolution, still ms. */
  SIM_COUNT: number;
  /** Pseudo-rounds at the field baseline mixed into each member's draw pool — thin samples regress to baseline. */
  SHRINKAGE_PSEUDO_ROUNDS: number;
  /** A round ~this many weeks back is weighted ½ vs. the latest (recency weighting). */
  RECENCY_HALF_LIFE: number;
  /** Honesty gate — below this many prior finalized rounds the line is withheld ("books open after week 3"). */
  MIN_FIELD_ROUNDS: number;
  /** A member below this many personal rounds is shrunk to baseline and shows "—" instead of a price (F15). */
  MIN_PLAYER_ROUNDS: number;
  /** Proportional overround (vig). hold = 1 − 1/OVERROUND ≈ 15.3% at 1.18. */
  OVERROUND: number;
  /** Displayed longshot ceiling (dignity cap). Capping changes effective hold (recomputed from posted prices). */
  LONGSHOT_CAP: number;
  /** Displayed favorite floor (magnitude). A lock/heavy favorite posts no worse than −FAVORITE_CAP rather than −99999900. */
  FAVORITE_CAP: number;
  /** wideOpen triggers when the favorite's fair prob < this × (1/N) — "nobody separated from the pack". */
  WIDE_OPEN_FACTOR: number;
}

export const DEFAULT_ODDS_CONSTANTS: OddsConstants = {
  SIM_COUNT: 20000,
  SHRINKAGE_PSEUDO_ROUNDS: 4,
  RECENCY_HALF_LIFE: 4,
  MIN_FIELD_ROUNDS: 3,
  MIN_PLAYER_ROUNDS: 2,
  OVERROUND: 1.18,
  LONGSHOT_CAP: 2500,
  FAVORITE_CAP: 10000,
  WIDE_OPEN_FACTOR: 1.5,
};

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface OddsHistoryRound {
  readonly stableford: number;
  readonly money: number;
  /** Chronological position (0 = oldest); higher = more recent. Drives recency weight. */
  readonly orderIndex: number;
}

export interface OddsFieldEntry {
  readonly playerId: number;
  /** Subs are non-bettable rank fillers — included in the sim field, never emitted as a line. */
  readonly isSub: boolean;
  readonly history: readonly OddsHistoryRound[];
}

export interface ComputeOddsInput {
  readonly field: readonly OddsFieldEntry[];
  /** Pooled sub-class prior tuples (historical is_sub=1 rounds). Field-baseline fallback when empty. */
  readonly subPrior?: ReadonlyArray<{ stableford: number; money: number }>;
  /** Distinct prior finalized round count — drives the honesty gate. */
  readonly priorRoundCount: number;
  /** PRNG seed (the API passes roundId). */
  readonly seed: number;
  readonly constants?: Partial<OddsConstants>;
}

export type OddsTier = 'favorite' | 'live' | 'longshot' | 'unpriced';

export interface OddsLine {
  readonly playerId: number;
  /** True win probability (sums to ≈1 across members). The % shown to users on expand. */
  readonly fairProb: number;
  /** Posted American odds (vig'd, rounded, capped). null when the member is under-sampled ("—"). */
  readonly postedAmerican: number | null;
  /** Posted implied probability = fairProb × OVERROUND (sums to ≈OVERROUND). */
  readonly impliedProb: number;
  readonly tier: OddsTier;
  readonly confidence: { readonly rounds: number; readonly level: 'low' | 'medium' | 'high' };
}

export type OddsResult =
  | { readonly gated: true; readonly reason: string }
  | {
      readonly gated: false;
      /** Nominal hold = 1 − 1/OVERROUND. */
      readonly theoreticalHold: number;
      /** Effective hold recomputed from the actually-posted prices after LONGSHOT_CAP + rounding (codex cap/vig). */
      readonly effectiveHold: number;
      readonly wideOpen: boolean;
      readonly simCount: number;
      /** One line per MEMBER (subs excluded), sorted favorites → longshots. */
      readonly lines: readonly OddsLine[];
    };

// ---------------------------------------------------------------------------
// American-odds conversion
// ---------------------------------------------------------------------------

/** Implied probability of an American price (no vig removal). */
export function americanToImplied(american: number): number {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

/**
 * Probability → posted American odds with book-like rounding and a longshot
 * cap. Fine resolution near favorites (handicaps equalize members, so net
 * spreads are tight — coarse rounding would cluster everyone at one price);
 * coarser deep in longshot territory; positive odds floored at the dignity cap.
 *
 * `favoriteCap` is the magnitude floor on the favorite side: with a proportional
 * overround, `fairProb × OVERROUND` can exceed 1 for a lock/heavy favorite, which
 * would otherwise produce an absurd price like −99999900. We clamp to −favoriteCap
 * (e.g. −10000) so a lock reads as a heavy favorite, not a glitch (codex F2).
 */
export function probToAmerican(prob: number, cap: number, favoriteCap = 10000): number {
  const p = Math.min(0.999999, Math.max(1e-9, prob));
  const raw = p >= 0.5 ? -(100 * p) / (1 - p) : (100 * (1 - p)) / p;
  const sign = raw < 0 ? -1 : 1;
  const abs = Math.abs(raw);
  const bucket = abs < 200 ? 5 : abs < 1000 ? 10 : 50;
  let rounded = sign * Math.round(abs / bucket) * bucket;
  if (rounded > 0 && rounded > cap) rounded = cap; // dignity cap on longshots
  if (rounded < 0 && rounded < -favoriteCap) rounded = -favoriteCap; // floor on favorites
  // Avoid a degenerate +0 / -0; the tightest favorite still posts at least -100.
  if (rounded === 0) rounded = sign < 0 ? -100 : 100;
  return rounded;
}

// ---------------------------------------------------------------------------
// computeOddsLine
// ---------------------------------------------------------------------------

interface DrawPool {
  readonly tuples: ReadonlyArray<{ stableford: number; money: number }>;
  readonly weights: readonly number[];
}

export function computeOddsLine(input: ComputeOddsInput): OddsResult {
  const C = { ...DEFAULT_ODDS_CONSTANTS, ...(input.constants ?? {}) };
  const { priorRoundCount, seed } = input;

  // Determinism normalization (codex F1/F3): the report is frozen, so the result
  // must NOT depend on the order the caller's DB rows happened to arrive in. The
  // RNG stream attaches to the field by array index, and pickWeightedIndex walks
  // the draw pool in array order — so we sort the field by playerId, each history
  // by chronological orderIndex, and the pooled sub prior by its tuple. This makes
  // the odds byte-identical regardless of query plan / insertion order.
  const field = [...input.field]
    .map((f) => ({
      ...f,
      history: [...f.history].sort((a, b) => a.orderIndex - b.orderIndex || a.stableford - b.stableford || a.money - b.money),
    }))
    .sort((a, b) => a.playerId - b.playerId);
  const subPrior = [...(input.subPrior ?? [])].sort((a, b) => a.stableford - b.stableford || a.money - b.money);

  // 1. Gate — too few finalized rounds in the season, or no roster yet.
  if (priorRoundCount < C.MIN_FIELD_ROUNDS) {
    return { gated: true, reason: 'odds open in a few weeks' };
  }
  if (field.length === 0) {
    return { gated: true, reason: 'line opens when pairings are set' };
  }

  const members = field.filter((f) => !f.isSub);
  if (members.length === 0) {
    return { gated: true, reason: 'line opens when pairings are set' };
  }

  // 2. Field baseline — pooled mean (stableford, money) over all members' history.
  let baseStab = 0;
  let baseMoney = 0;
  let baseN = 0;
  for (const m of members) {
    for (const r of m.history) {
      baseStab += r.stableford;
      baseMoney += r.money;
      baseN += 1;
    }
  }
  const baseline =
    baseN > 0 ? { stableford: baseStab / baseN, money: baseMoney / baseN } : { stableford: 0, money: 0 };

  // Recency anchor (codex F4): age is measured against the TRUE prior-round
  // horizon (the most recent finalized round before the target = priorRoundCount−1),
  // not the latest round this particular field happened to play. A player who sat
  // out the last few weeks is then correctly down-weighted relative to "now".
  const horizon = priorRoundCount - 1;
  const recencyWeight = (orderIndex: number): number =>
    Math.pow(0.5, (horizon - orderIndex) / C.RECENCY_HALF_LIFE);

  // 3. Per-entry draw pool: recency-weighted real rounds + shrinkage pseudo-rounds
  //    at baseline (one synthetic baseline tuple carrying the full pseudo-weight).
  //    Subs draw from the pooled sub prior (baseline fallback) — rank fillers only.
  const subPoolTuples = subPrior.length > 0 ? subPrior.map((t) => ({ stableford: t.stableford, money: t.money })) : [baseline];
  const subPoolWeights = subPoolTuples.map(() => 1);

  const pools: DrawPool[] = field.map((f) => {
    if (f.isSub) return { tuples: subPoolTuples, weights: subPoolWeights };
    const tuples = f.history.map((r) => ({ stableford: r.stableford, money: r.money }));
    const weights = f.history.map((r) => recencyWeight(r.orderIndex));
    // Shrinkage: one baseline pseudo-tuple carrying SHRINKAGE_PSEUDO_ROUNDS of weight.
    tuples.push({ ...baseline });
    weights.push(C.SHRINKAGE_PSEUDO_ROUNDS);
    return { tuples, weights };
  });

  // 4. Simulate. Each entry draws a (stableford, money) tuple; rank the FULL field
  //    (incl. subs) via calculateHarveyPoints; take argmax over MEMBERS ONLY; ties
  //    split 1/k. calculateHarveyPoints is wrapped so a (theoretically impossible
  //    at multiplier=1/bonus=0) HarveySumViolationError can't take the whole read
  //    down — a failed sim is simply skipped (F13).
  const rng = mulberry32(seed);
  const wins = new Map<number, number>();
  for (const m of members) wins.set(m.playerId, 0);
  const memberIdx = field.map((f, i) => (f.isSub ? -1 : i)).filter((i) => i >= 0);

  const simInputs: HarveyRoundInput[] = field.map(() => ({ stableford: 0, money: 0 }));
  let validSims = 0;
  for (let s = 0; s < C.SIM_COUNT; s++) {
    for (let i = 0; i < field.length; i++) {
      const pool = pools[i]!;
      const t = pool.tuples[pickWeightedIndex(rng, pool.weights)]!;
      simInputs[i] = { stableford: t.stableford, money: t.money };
    }
    let points: readonly { stablefordPoints: number; moneyPoints: number }[];
    try {
      points = calculateHarveyPoints(simInputs, 'regular', 0);
    } catch {
      continue; // skip a degenerate sim rather than 500 the response
    }
    // Float-safe tie detection: combined points are always multiples of 0.5 (rank
    // points are k/2 and multiplier=1, bonus=0), so 2× is an exact integer.
    let bestScaled = -Infinity;
    for (const i of memberIdx) {
      const scaled = Math.round((points[i]!.stablefordPoints + points[i]!.moneyPoints) * 2);
      if (scaled > bestScaled) bestScaled = scaled;
    }
    const winners: number[] = [];
    for (const i of memberIdx) {
      const scaled = Math.round((points[i]!.stablefordPoints + points[i]!.moneyPoints) * 2);
      if (scaled === bestScaled) winners.push(field[i]!.playerId);
    }
    const share = 1 / winners.length;
    for (const pid of winners) wins.set(pid, (wins.get(pid) ?? 0) + share);
    validSims += 1;
  }

  if (validSims === 0) {
    return { gated: true, reason: 'odds open in a few weeks' };
  }

  // 5. fairProb per member.
  const M = members.length;
  const u = 1 / M;
  const fairByPlayer = new Map<number, number>();
  for (const m of members) fairByPlayer.set(m.playerId, (wins.get(m.playerId) ?? 0) / validSims);

  // 6. Posted line + tier per member.
  const lines: OddsLine[] = members.map((m) => {
    const fairProb = fairByPlayer.get(m.playerId)!;
    const impliedProb = fairProb * C.OVERROUND;
    const rounds = m.history.length;
    const underSampled = rounds < C.MIN_PLAYER_ROUNDS;
    const postedAmerican = underSampled ? null : probToAmerican(impliedProb, C.LONGSHOT_CAP, C.FAVORITE_CAP);
    const level: 'low' | 'medium' | 'high' = rounds >= 6 ? 'high' : rounds >= 3 ? 'medium' : 'low';

    let tier: OddsTier;
    if (underSampled) {
      tier = 'unpriced';
    } else if (fairProb >= 2 * u || (postedAmerican !== null && postedAmerican < 0)) {
      tier = 'favorite';
    } else if (fairProb <= 0.5 * u || (postedAmerican !== null && postedAmerican >= 1500)) {
      tier = 'longshot';
    } else {
      tier = 'live';
    }
    return { playerId: m.playerId, fairProb, postedAmerican, impliedProb, tier, confidence: { rounds, level } };
  });

  // Sort favorites → longshots (by fair prob desc; stable tiebreak on playerId).
  lines.sort((a, b) => b.fairProb - a.fairProb || a.playerId - b.playerId);

  // 7. wideOpen — nobody meaningfully separated from the pack.
  const maxFair = lines.length ? Math.max(...lines.map((l) => l.fairProb)) : 0;
  const wideOpen = maxFair < C.WIDE_OPEN_FACTOR * u;

  // 8. Holds. Theoretical = 1 − 1/OVERROUND. Effective recomputed from the
  //    actually-posted (capped/rounded) prices over priced lines (codex cap/vig).
  const theoreticalHold = 1 - 1 / C.OVERROUND;
  let postedImpliedSum = 0;
  for (const l of lines) if (l.postedAmerican !== null) postedImpliedSum += americanToImplied(l.postedAmerican);
  const effectiveHold = postedImpliedSum > 0 ? 1 - 1 / postedImpliedSum : theoreticalHold;

  return { gated: false, theoreticalHold, effectiveHold, wideOpen, simCount: validSims, lines };
}

// ---------------------------------------------------------------------------
// estimateStrengthOrder — genuinely INDEPENDENT cross-check (Task 4, F17).
//
// NOT mean-Harvey-finish through calculateHarveyPoints (that would be circular).
// Uses a different basis: each member's mean raw-Stableford z-score + mean
// raw-money z-score across their own rounds. It need only agree with the
// bootstrap on gross favorite ordering — divergence flags a real bug.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// House P&L + calibration helpers (Block C). Pure — the route does the DB
// aggregation and passes pre-computed inputs.
// ---------------------------------------------------------------------------

/** Pinned House-ledger constants. */
export const HOUSE_CONSTANTS = {
  N_BETTORS: 20,
  STAKE_UNIT: 1,
  /** Public favorite-leaning bias for the softmax over recent-form z-scores. */
  PUBLIC_FAV_BIAS: 1.0,
  /** Last-week-winner baseline: mass placed on last week's actual winner. */
  LAST_WEEK_P: 0.5,
  /** floor for fair_p before log-loss so a never-simulated winner can't give Infinity. */
  PROB_FLOOR: 1e-6,
} as const;

/** Profit multiple of an American price (e.g. +150 → 1.5; −200 → 0.5). */
export function profitMultiple(american: number): number {
  return american < 0 ? 100 / -american : american / 100;
}

export interface WeekBettorInput {
  /** Bettable (priced) member ids — bettors only back these. */
  readonly pricedMemberIds: readonly number[];
  /** Posted American price aligned to pricedMemberIds (all non-null). */
  readonly postedAmerican: readonly number[];
  /** Recent-form z-score aligned to pricedMemberIds (drives the public model — NEVER the posted odds). */
  readonly formZ: readonly number[];
  /** Actual top MEMBER(s) this week — more than one on a dead-heat. */
  readonly winningMemberIds: readonly number[];
  /** Dead-heat share for each winner (1/k; 1 when no tie). */
  readonly winnerShare: number;
  readonly seed: number;
  readonly nBettors: number;
  readonly stakeUnit: number;
  readonly bias: number;
}

/**
 * Simulate one week's flat-stake public bettors and return the HOUSE P&L.
 *
 * The public backs members multinomially by `softmax(bias × recent-form z)` —
 * a perception signal computed only from historical results, NEVER from our
 * posted prices (else the P&L just returns the vig regardless of who wins). The
 * house collects every stake and pays winners at the posted price; dead-heats
 * settle on `winnerShare` of stake. An off-board winning member (not in
 * pricedMemberIds) means no ticket can cash ⇒ house keeps all stakes (AC-C2).
 */
export function simulateWeekHousePnl(inp: WeekBettorInput): { housePnl: number; totalStakes: number } {
  const { pricedMemberIds, postedAmerican, formZ, winningMemberIds, winnerShare, seed, nBettors, stakeUnit, bias } = inp;
  if (pricedMemberIds.length === 0) return { housePnl: 0, totalStakes: 0 };
  const winners = new Set(winningMemberIds);
  const maxZ = Math.max(...formZ);
  const weights = formZ.map((z) => Math.exp(bias * (z - maxZ))); // numerically-stable softmax (un-normalised is fine for pickWeightedIndex)
  const rng = mulberry32(seed);
  let housePnl = 0;
  let totalStakes = 0;
  for (let b = 0; b < nBettors; b++) {
    const idx = pickWeightedIndex(rng, weights);
    totalStakes += stakeUnit;
    const f = winners.has(pricedMemberIds[idx]!) ? winnerShare : 0;
    const m = profitMultiple(postedAmerican[idx]!);
    // House P&L from this ticket = stake − payout; payout = f·stake·(1+m).
    housePnl += stakeUnit * (1 - f * (1 + m));
  }
  return { housePnl, totalStakes };
}

/**
 * Log-loss (winner) + Brier for a probability map over the week's members.
 * `fair_p` of the winner is floored at PROB_FLOOR so log-loss stays finite even
 * when a winner never appeared in any sim (AC-C4).
 */
export function logLossAndBrier(
  probByMember: ReadonlyMap<number, number>,
  memberIds: readonly number[],
  winnerId: number,
  floor = HOUSE_CONSTANTS.PROB_FLOOR,
): { logLoss: number; brier: number } {
  const pWin = Math.max(floor, probByMember.get(winnerId) ?? 0);
  const logLoss = -Math.log(pWin);
  let brier = 0;
  for (const id of memberIds) {
    const p = probByMember.get(id) ?? 0;
    const outcome = id === winnerId ? 1 : 0;
    brier += (outcome - p) ** 2;
  }
  return { logLoss, brier: memberIds.length ? brier / memberIds.length : 0 };
}

/**
 * Bootstrap mean + 95% CI over a per-week metric series (resampling weeks).
 * Deterministic given `seed`. Returns the raw mean and the [2.5%, 97.5%]
 * percentile interval. The ~20-round season is low-power — report uncertainty.
 */
export function bootstrapMeanCI(
  series: readonly number[],
  seed: number,
  iterations = 2000,
): { mean: number; lo: number; hi: number } {
  const n = series.length;
  if (n === 0) return { mean: 0, lo: 0, hi: 0 };
  const mean = series.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, lo: mean, hi: mean };
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += series[Math.min(n - 1, Math.floor(rng() * n))]!;
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.floor(q * means.length))]!;
  return { mean, lo: at(0.025), hi: at(0.975) };
}

export function estimateStrengthOrder(field: readonly OddsFieldEntry[]): number[] {
  const members = field.filter((f) => !f.isSub && f.history.length > 0);
  if (members.length === 0) return [];

  // Field-wide mean/std over all member-rounds.
  const allStab: number[] = [];
  const allMoney: number[] = [];
  for (const m of members) for (const r of m.history) { allStab.push(r.stableford); allMoney.push(r.money); }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = (xs: number[], mu: number) => {
    if (xs.length < 2) return 0;
    return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length);
  };
  const muS = mean(allStab);
  const muM = mean(allMoney);
  const sdS = std(allStab, muS) || 1;
  const sdM = std(allMoney, muM) || 1;

  const scored = members.map((m) => {
    const zS = mean(m.history.map((r) => r.stableford)) - muS;
    const zM = mean(m.history.map((r) => r.money)) - muM;
    return { playerId: m.playerId, score: zS / sdS + zM / sdM };
  });
  scored.sort((a, b) => b.score - a.score || a.playerId - b.playerId);
  return scored.map((s) => s.playerId);
}
