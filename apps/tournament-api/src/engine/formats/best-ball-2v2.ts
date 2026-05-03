/**
 * T6-1 — 2v2 best-ball pure engine.
 *
 * Per-hole pipeline:
 *   1. Iterate `course.holes` (every hole on the course is a candidate).
 *   2. Complete-cell gate (AC-2): all 4 foursome members MUST have a
 *      `holeScores` row whose `holeNumber === n`. If any missing, SKIP
 *      the hole (not in `perHole`, no pair-cell mutations).
 *   3. Compute each player's NET = grossStrokes − getHandicapStrokes(...).
 *   4. Team best = min(player1.net, player2.net) for each team.
 *   5. Compare team-A best vs team-B best. Lower-net WINS the hole;
 *      equal → tie.
 *   6. Award base $: teamDeltaCents = signed(4 × basePerHoleCents).
 *      Distribute pair-wise across 4 cross-team pair cells.
 *   7. Sandies: if winning team has ≥1 player with sandyFromBunker=true
 *      AND that player's GROSS strokes ≤ par → add bonus (once per hole).
 *   8. Greenies (par 3 only): if hole is won AND closestToPinPlayerId is
 *      set AND that player is on the winning team AND validation passes
 *      → award greenieBaseCents pair-wise.
 *
 * Pure function — no DB, no I/O, no env, no clock, no crypto, no input
 * mutation. AC-15 (replay determinism) is byte-for-byte stable.
 *
 * Money values throughout are INTEGER CENTS (integer-only enforced at
 * config-validation boundary; never division at this layer).
 */

import {
  getHandicapStrokes,
  type TeeShape,
} from '../handicap-strokes.js';

export type { TeeShape };

export type HoleShape = {
  holeNumber: number;
  par: 3 | 4 | 5;
  strokeIndex: number;
};

export type HoleScoreInput = {
  playerId: string;
  holeNumber: number;
  grossStrokes: number;
  putts: number | null;
  sandyFromBunker?: boolean;
};

export type HoleMetaInput = {
  holeNumber: number;
  closestToPinPlayerId?: string | null;
};

export type BestBall2v2Config = {
  basePerHoleCents: number;
  sandies: boolean;
  sandiesBonusPerHoleCents: number;
  greenieCarryover: boolean;
  greenieValidation: '2-putt' | 'none';
  greenieBaseCents: number;
};

export type Compute2v2BestBallInput = {
  holeScores: HoleScoreInput[];
  holeMeta: HoleMetaInput[];
  pairings: { teamA: [string, string]; teamB: [string, string] };
  config: BestBall2v2Config;
  course: { tee: TeeShape; holes: HoleShape[] };
  handicapIndexByPlayer: Record<string, number>;
};

export type GreenieAward = {
  team: 'teamA' | 'teamB';
  playerId: string;
  valueCents: number;
  carriedFromHoles: number[];
  multiplier: 1 | 2 | 3 | 4;
};

export type HoleResult = {
  holeNumber: number;
  par: 3 | 4 | 5;
  teamABestNet: number;
  teamBBestNet: number;
  winner: 'teamA' | 'teamB' | 'tie';
  teamDeltaCents: number;
  sandiesApplied: boolean;
  greenieAwarded: GreenieAward | null;
};

export type PairLedger = Record<string, Record<string, number>>;

export type RoundResult = {
  teamTotalCents: number;
  holesPlayed: number;
  sandiesAwardedCount: number;
  greeniesAwardedCount: number;
};

export type Compute2v2BestBallOutput = {
  perHole: HoleResult[];
  perRound: RoundResult;
  perPair: PairLedger;
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(
      `${name} must be an integer (got ${value}); money is integer cents per epic T6 discipline`,
    );
  }
  if (value < 0) {
    throw new RangeError(
      `${name} must be ≥ 0 (got ${value})`,
    );
  }
}

function getRequiredHandicapIndex(
  map: Record<string, number>,
  playerId: string,
): number {
  const hi = map[playerId];
  if (hi === undefined) {
    throw new Error(
      `compute2v2BestBall: missing handicapIndex for player ${playerId} — caller must populate handicapIndexByPlayer for all 4 foursome members`,
    );
  }
  return hi;
}

function bumpPair(
  pair: PairLedger,
  winnerId: string,
  loserId: string,
  cents: number,
): void {
  if (!pair[winnerId]) pair[winnerId] = {};
  if (!pair[loserId]) pair[loserId] = {};
  pair[winnerId][loserId] = (pair[winnerId][loserId] ?? 0) + cents;
  pair[loserId][winnerId] = (pair[loserId][winnerId] ?? 0) - cents;
}

function distributePairWise(
  pair: PairLedger,
  winningTeam: [string, string],
  losingTeam: [string, string],
  perPairCents: number,
): void {
  for (const w of winningTeam) {
    for (const l of losingTeam) {
      bumpPair(pair, w, l, perPairCents);
    }
  }
}

// ---------------------------------------------------------------------------
// compute2v2BestBall
// ---------------------------------------------------------------------------

export function compute2v2BestBall(
  input: Compute2v2BestBallInput,
): Compute2v2BestBallOutput {
  const { config, course, pairings, handicapIndexByPlayer, holeScores, holeMeta } = input;

  // Fast-fail integer-cents + non-negativity validation at the boundary.
  assertNonNegativeInteger('config.basePerHoleCents', config.basePerHoleCents);
  assertNonNegativeInteger('config.sandiesBonusPerHoleCents', config.sandiesBonusPerHoleCents);
  assertNonNegativeInteger('config.greenieBaseCents', config.greenieBaseCents);

  // Runtime-validate config enum + booleans (TypeScript doesn't enforce
  // at runtime; a JSON-payload caller could send arbitrary strings).
  if (config.greenieValidation !== '2-putt' && config.greenieValidation !== 'none') {
    throw new RangeError(
      `config.greenieValidation must be '2-putt' or 'none' (got ${String(config.greenieValidation)})`,
    );
  }
  if (typeof config.sandies !== 'boolean') {
    throw new TypeError('config.sandies must be a boolean');
  }
  if (typeof config.greenieCarryover !== 'boolean') {
    throw new TypeError('config.greenieCarryover must be a boolean');
  }

  // Index lookups for O(1) access during per-hole iteration.
  // Key: `${playerId}|${holeNumber}` → HoleScoreInput. Duplicate cells
  // throw — silently overwriting would mask caller bugs (double-write
  // on score correction, malformed input).
  const scoresByCell = new Map<string, HoleScoreInput>();
  for (const s of holeScores) {
    const key = `${s.playerId}|${s.holeNumber}`;
    if (scoresByCell.has(key)) {
      throw new Error(
        `compute2v2BestBall: duplicate holeScores entry for player ${s.playerId} hole ${s.holeNumber}`,
      );
    }
    scoresByCell.set(key, s);
  }
  const metaByHole = new Map<number, HoleMetaInput>();
  for (const m of holeMeta) {
    if (metaByHole.has(m.holeNumber)) {
      throw new Error(
        `compute2v2BestBall: duplicate holeMeta entry for hole ${m.holeNumber}`,
      );
    }
    metaByHole.set(m.holeNumber, m);
  }

  const teamA = pairings.teamA;
  const teamB = pairings.teamB;
  const perHole: HoleResult[] = [];
  const perPair: PairLedger = {};
  let teamTotalCents = 0;
  let sandiesAwardedCount = 0;
  let greeniesAwardedCount = 0;

  for (const hole of course.holes) {
    const n = hole.holeNumber;

    // (i) Complete-cell gate: all 4 foursome members must have a row for this hole.
    const a1 = scoresByCell.get(`${teamA[0]}|${n}`);
    const a2 = scoresByCell.get(`${teamA[1]}|${n}`);
    const b1 = scoresByCell.get(`${teamB[0]}|${n}`);
    const b2 = scoresByCell.get(`${teamB[1]}|${n}`);
    if (!a1 || !a2 || !b1 || !b2) continue;

    // (ii) Compute net for each player. Missing handicapIndex throws at the
    // boundary — silently treating missing entries as scratch would mask a
    // caller bug (e.g. a forgotten GHIN sync).
    const hiA1 = getRequiredHandicapIndex(handicapIndexByPlayer, teamA[0]);
    const hiA2 = getRequiredHandicapIndex(handicapIndexByPlayer, teamA[1]);
    const hiB1 = getRequiredHandicapIndex(handicapIndexByPlayer, teamB[0]);
    const hiB2 = getRequiredHandicapIndex(handicapIndexByPlayer, teamB[1]);
    const netA1 = a1.grossStrokes - getHandicapStrokes(hiA1, hole.strokeIndex, course.tee);
    const netA2 = a2.grossStrokes - getHandicapStrokes(hiA2, hole.strokeIndex, course.tee);
    const netB1 = b1.grossStrokes - getHandicapStrokes(hiB1, hole.strokeIndex, course.tee);
    const netB2 = b2.grossStrokes - getHandicapStrokes(hiB2, hole.strokeIndex, course.tee);

    const teamABestNet = Math.min(netA1, netA2);
    const teamBBestNet = Math.min(netB1, netB2);

    // (iii) Determine winner.
    let winner: 'teamA' | 'teamB' | 'tie';
    let winningTeam: [string, string] | null = null;
    let losingTeam: [string, string] | null = null;
    if (teamABestNet < teamBBestNet) {
      winner = 'teamA';
      winningTeam = teamA;
      losingTeam = teamB;
    } else if (teamBBestNet < teamABestNet) {
      winner = 'teamB';
      winningTeam = teamB;
      losingTeam = teamA;
    } else {
      winner = 'tie';
    }

    // (iv) Base $ pair attribution (if winner).
    let baseDeltaCents = 0;
    if (winner !== 'tie' && winningTeam && losingTeam) {
      baseDeltaCents = 4 * config.basePerHoleCents;
      distributePairWise(perPair, winningTeam, losingTeam, config.basePerHoleCents);
    }

    // (v) Sandies bonus (only on a won hole).
    let sandiesApplied = false;
    let sandiesBonusCents = 0;
    if (config.sandies && winner !== 'tie' && winningTeam && losingTeam) {
      const winningCells = winningTeam === teamA ? [a1, a2] : [b1, b2];
      const eligible = winningCells.some(
        (cell) =>
          cell.sandyFromBunker === true && cell.grossStrokes <= hole.par,
      );
      if (eligible) {
        sandiesApplied = true;
        sandiesBonusCents = 4 * config.sandiesBonusPerHoleCents;
        distributePairWise(perPair, winningTeam, losingTeam, config.sandiesBonusPerHoleCents);
        sandiesAwardedCount += 1;
      }
    }

    // (vi) Greenie award (par 3 + won hole + valid CTP).
    let greenieAwarded: GreenieAward | null = null;
    let greenieDeltaCents = 0;
    if (hole.par === 3 && winner !== 'tie' && winningTeam && losingTeam) {
      const meta = metaByHole.get(n);
      const ctpId = meta?.closestToPinPlayerId ?? null;
      if (ctpId) {
        const ctpOnWinningTeam = winningTeam.includes(ctpId);
        if (ctpOnWinningTeam) {
          const ctpCell = scoresByCell.get(`${ctpId}|${n}`)!;
          let validates = true;
          if (config.greenieValidation === '2-putt') {
            validates = ctpCell.putts !== null && ctpCell.putts <= 2;
          }
          if (validates) {
            greenieAwarded = {
              team: winner,
              playerId: ctpId,
              valueCents: config.greenieBaseCents,
              carriedFromHoles: [],
              multiplier: 1,
            };
            greenieDeltaCents = 4 * config.greenieBaseCents;
            distributePairWise(perPair, winningTeam, losingTeam, config.greenieBaseCents);
            greeniesAwardedCount += 1;
          }
        }
      }
    }

    // (vii) Sign the hole delta by winner team and accumulate round total.
    const totalHoleCents = baseDeltaCents + sandiesBonusCents + greenieDeltaCents;
    const signedDelta = winner === 'teamB' ? -totalHoleCents : totalHoleCents;

    perHole.push({
      holeNumber: n,
      par: hole.par,
      teamABestNet,
      teamBBestNet,
      winner,
      teamDeltaCents: signedDelta,
      sandiesApplied,
      greenieAwarded,
    });

    teamTotalCents += signedDelta;
  }

  return {
    perHole,
    perRound: {
      teamTotalCents,
      holesPlayed: perHole.length,
      sandiesAwardedCount,
      greeniesAwardedCount,
    },
    perPair,
  };
}
