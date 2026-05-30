// ---------------------------------------------------------------------------
// Pure stat helpers for the current-season (2026) group scouting report.
// Each takes pre-aggregated per-round inputs — the API does the DB aggregation
// (per-hole scores, round_players.handicap_index snapshots, wolf_decisions) and
// these turn them into the "scouting" framing. All pure + deterministic.
// ---------------------------------------------------------------------------

/**
 * Handicap-index trend over a player's last `window` rounds (chronological,
 * oldest→newest). delta>0 = handicap rising (playing worse), <0 = improving.
 */
export function handicapTrend(
  hiByRoundAsc: readonly number[],
  window = 3,
): { direction: 'up' | 'down' | 'flat'; delta: number; sample: number } {
  const recent = hiByRoundAsc.slice(-window);
  if (recent.length < 2) return { direction: 'flat', delta: 0, sample: recent.length };
  const delta = Math.round((recent[recent.length - 1]! - recent[0]!) * 10) / 10;
  const direction = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
  return { direction, delta, sample: recent.length };
}

/** "Boom or bust" — population std-dev of a player's per-round Stableford. */
export function volatility(stablefordByRound: readonly number[]): { stdDev: number; sample: number } {
  const n = stablefordByRound.length;
  if (n < 2) return { stdDev: 0, sample: n };
  const mean = stablefordByRound.reduce((a, b) => a + b, 0) / n;
  const variance = stablefordByRound.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { stdDev: Math.round(Math.sqrt(variance) * 10) / 10, sample: n };
}

/**
 * Best & worst holes from a player's per-hole average score-to-par. Only holes
 * with >= minRounds of data are eligible. Returns empty when there's no
 * meaningful spread (all eligible holes equal) so the card doesn't show noise.
 */
export function bestWorstHoles(
  holes: ReadonlyArray<{ hole: number; avgToPar: number; rounds: number }>,
  minRounds = 2,
): { best: number[]; worst: number[] } {
  const eligible = holes.filter((h) => h.rounds >= minRounds);
  if (eligible.length === 0) return { best: [], worst: [] };
  const min = Math.min(...eligible.map((h) => h.avgToPar));
  const max = Math.max(...eligible.map((h) => h.avgToPar));
  if (min === max) return { best: [], worst: [] };
  return {
    best: eligible.filter((h) => h.avgToPar === min).map((h) => h.hole).sort((a, b) => a - b),
    worst: eligible.filter((h) => h.avgToPar === max).map((h) => h.hole).sort((a, b) => a - b),
  };
}

/**
 * "Goes lone wolf when behind" — rate at which a player went alone/blind on the
 * wolf, among rounds where they were down money. rate is over BEHIND rounds.
 */
export function loneWolfWhenBehindRate(
  rounds: ReadonlyArray<{ wentAlone: boolean; behindInMoney: boolean }>,
): { alone: number; behind: number; rate: number } {
  const behindRounds = rounds.filter((r) => r.behindInMoney);
  const alone = behindRounds.filter((r) => r.wentAlone).length;
  const behind = behindRounds.length;
  return { alone, behind, rate: behind === 0 ? 0 : Math.round((alone / behind) * 100) / 100 };
}
