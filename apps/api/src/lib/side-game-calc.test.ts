import { describe, it, expect } from 'vitest';
import {
  calcMostNetPars,
  calcMostSkins,
  calcLeastPutts,
  calcMostNetUnderPar,
  calcMostPolies,
} from './side-game-calc.js';
import type { ScoreRow, PlayerHandicap, WolfDecisionRow } from './side-game-calc.js';

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeScores(playerScores: Record<number, number[]>): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (const [pid, scores] of Object.entries(playerScores)) {
    for (let h = 0; h < scores.length; h++) {
      rows.push({ playerId: Number(pid), holeNumber: h + 1, grossScore: scores[h]!, putts: null });
    }
  }
  return rows;
}

function makeScoresWithPutts(playerData: Record<number, { gross: number[]; putts: number[] }>): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (const [pid, data] of Object.entries(playerData)) {
    for (let h = 0; h < data.gross.length; h++) {
      rows.push({ playerId: Number(pid), holeNumber: h + 1, grossScore: data.gross[h]!, putts: data.putts[h]! });
    }
  }
  return rows;
}

// Guyan G&CC pars: [5,4,4,4,4,3,3,5,4,4,5,3,4,4,3,4,4,4] = par 71
const PARS = [5, 4, 4, 4, 4, 3, 3, 5, 4, 4, 5, 3, 4, 4, 3, 4, 4, 4];

// ---------------------------------------------------------------------------
// calcMostNetPars
// ---------------------------------------------------------------------------

describe('calcMostNetPars', () => {
  it('counts net pars correctly with handicap strokes', () => {
    // Player 1: HI 10, blue tee → CH 9. Gets 1 stroke on SI 1-9 holes.
    // Scoring par gross → net birdie on stroke holes, net par on non-stroke holes → 9 net pars
    // Player 2: HI 20, blue → CH ~18. Gets 1 stroke on every hole.
    // Scoring par gross → net birdie on every hole → 0 net pars
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 10 },
      { playerId: 2, handicapIndex: 20 },
    ];

    const scores = makeScores({ 1: PARS.slice(), 2: PARS.slice() });
    const result = calcMostNetPars(scores, handicaps, 'blue');

    // Player 1 has 9 net pars (non-stroke holes), player 2 has 0
    expect(result.winnerPlayerIds).toEqual([1]);
  });

  it('returns co-winners on tie', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 10 },
      { playerId: 2, handicapIndex: 10 },
    ];
    const scores = makeScores({ 1: PARS, 2: PARS });
    const result = calcMostNetPars(scores, handicaps, 'blue');
    expect(result.winnerPlayerIds.sort()).toEqual([1, 2]);
  });

  it('returns empty for no-contest (zero net pars)', () => {
    // Everyone scores way over par — no net pars possible
    const handicaps: PlayerHandicap[] = [{ playerId: 1, handicapIndex: 0 }];
    const scores = makeScores({ 1: PARS.map((p) => p + 3) }); // 3 over par on every hole
    const result = calcMostNetPars(scores, handicaps, 'blue');
    expect(result.winnerPlayerIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calcMostSkins
// ---------------------------------------------------------------------------

describe('calcMostSkins', () => {
  it('awards skin only when one player has unique lowest net', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
    ];
    // Player 1 birdies hole 1 (scores 4 on par 5), player 2 scores par (5)
    const p1Scores = [...PARS];
    p1Scores[0] = 4; // birdie on hole 1
    const scores = makeScores({ 1: p1Scores, 2: PARS });
    const result = calcMostSkins(scores, handicaps, 'blue');
    expect(result.winnerPlayerIds).toEqual([1]);
    expect(result.detail).toBe('1 skins');
  });

  it('no skin when two players tie on a hole', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
    ];
    // Both players score same on every hole
    const scores = makeScores({ 1: PARS, 2: PARS });
    const result = calcMostSkins(scores, handicaps, 'blue');
    expect(result.winnerPlayerIds).toEqual([]); // no-contest
  });

  it('works cross-group with FULL course handicap', () => {
    // Two players with different HI — skins uses full CH, not relative
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 20 },
      { playerId: 2, handicapIndex: 5 },
    ];
    // Both score same gross, but player 1 gets more strokes → lower net
    const scores = makeScores({ 1: PARS, 2: PARS });
    const result = calcMostSkins(scores, handicaps, 'blue');
    // Player 1 (HI 20) gets more strokes → lower net on those holes → wins skins
    expect(result.winnerPlayerIds).toContain(1);
  });
});

// ---------------------------------------------------------------------------
// calcLeastPutts
// ---------------------------------------------------------------------------

describe('calcLeastPutts', () => {
  it('lowest total putts wins', () => {
    const scores = makeScoresWithPutts({
      1: { gross: PARS, putts: Array(18).fill(2) }, // 36 total
      2: { gross: PARS, putts: Array(18).fill(1) }, // 18 total
    });
    const result = calcLeastPutts(scores);
    expect(result.winnerPlayerIds).toEqual([2]);
    expect(result.detail).toBe('18 putts');
  });

  it('co-winners on tie', () => {
    const scores = makeScoresWithPutts({
      1: { gross: PARS, putts: Array(18).fill(2) },
      2: { gross: PARS, putts: Array(18).fill(2) },
    });
    const result = calcLeastPutts(scores);
    expect(result.winnerPlayerIds.sort()).toEqual([1, 2]);
  });

  it('returns empty when no putts data', () => {
    const scores = makeScores({ 1: PARS }); // putts are null
    const result = calcLeastPutts(scores);
    expect(result.winnerPlayerIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calcMostNetUnderPar
// ---------------------------------------------------------------------------

describe('calcMostNetUnderPar', () => {
  it('player with more net-under-par holes wins', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 10 },
      { playerId: 2, handicapIndex: 10 },
    ];
    // Player 1 scores 1 under par on holes 1,2,3 vs player 2 at par
    const p1 = [...PARS];
    p1[0] = 4; p1[1] = 3; p1[2] = 3;
    const scores = makeScores({ 1: p1, 2: PARS });
    const result = calcMostNetUnderPar(scores, handicaps, 'blue');
    // Both get same handicap strokes but player 1 has better gross → more net-under-par holes
    expect(result.winnerPlayerIds).toEqual([1]);
    expect(Number(result.detail.split(' ')[0])).toBeGreaterThan(0);
  });

  it('no-contest when nobody goes under par', () => {
    const handicaps: PlayerHandicap[] = [{ playerId: 1, handicapIndex: 10 }];
    // All bogeys → gross = par + 1 on every hole. With CH 9, only 9 holes get a stroke.
    // Those 9: net = (par+1) - 1 = par. The other 9: net = par+1. No holes under par.
    const scores = makeScores({ 1: PARS.map((p) => p + 1) });
    const result = calcMostNetUnderPar(scores, handicaps, 'blue');
    expect(result.winnerPlayerIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calcMostPolies
// ---------------------------------------------------------------------------

describe('calcMostPolies', () => {
  it('counts polies by recipient from bonusesJson', () => {
    const decisions: WolfDecisionRow[] = [
      { wolfPlayerId: 10, holeNumber: 1, bonusesJson: JSON.stringify({ polies: [1, 2] }) },
      { wolfPlayerId: 10, holeNumber: 2, bonusesJson: JSON.stringify({ polies: [1] }) },
      { wolfPlayerId: 10, holeNumber: 3, bonusesJson: null },
    ];
    const result = calcMostPolies(decisions);
    expect(result.winnerPlayerIds).toEqual([1]);
    expect(result.detail).toBe('2 polies');
  });

  it('no-contest when zero polies', () => {
    const decisions: WolfDecisionRow[] = [
      { wolfPlayerId: 10, holeNumber: 1, bonusesJson: JSON.stringify({ greenies: [1] }) },
    ];
    const result = calcMostPolies(decisions);
    expect(result.winnerPlayerIds).toEqual([]);
  });

  it('co-winners when tied', () => {
    const decisions: WolfDecisionRow[] = [
      { wolfPlayerId: 10, holeNumber: 1, bonusesJson: JSON.stringify({ polies: [1, 2] }) },
    ];
    const result = calcMostPolies(decisions);
    expect(result.winnerPlayerIds.sort()).toEqual([1, 2]);
  });
});
