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
  it('returns skin holders — solo skin earner appears in the list', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
    ];
    // Player 1 birdies hole 1 (scores 4 on par 5), player 2 scores par (5)
    const p1Scores = [...PARS];
    p1Scores[0] = 4; // birdie on hole 1
    const scores = makeScores({ 1: p1Scores, 2: PARS });
    const result = calcMostSkins(scores, handicaps, 'blue');
    // Skins is a list-display game — no single winner.
    expect(result.winnerPlayerIds).toEqual([]);
    expect(result.skinHolders).toEqual([{ playerId: 1, skins: 1 }]);
    expect(result.detail).toBe('1 skin');
  });

  it('empty list when two players tie on every hole', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
    ];
    // Both players score same on every hole — no unique lows
    const scores = makeScores({ 1: PARS, 2: PARS });
    const result = calcMostSkins(scores, handicaps, 'blue');
    expect(result.winnerPlayerIds).toEqual([]);
    expect(result.skinHolders).toEqual([]);
    expect(result.detail).toBe('0 skins');
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
    expect(result.skinHolders?.some((h) => h.playerId === 1 && h.skins > 0)).toBe(true);
  });

  it('lists every skin holder, sorted desc by skins then by playerId asc', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
      { playerId: 3, handicapIndex: 0 },
    ];
    // Player 2 birdies holes 1+2; player 1 birdies hole 3; player 3 just pars.
    const p1 = [...PARS]; p1[2] = PARS[2]! - 1;
    const p2 = [...PARS]; p2[0] = PARS[0]! - 1; p2[1] = PARS[1]! - 1;
    const p3 = [...PARS];
    const scores = makeScores({ 1: p1, 2: p2, 3: p3 });
    const result = calcMostSkins(scores, handicaps, 'blue');
    expect(result.skinHolders).toEqual([
      { playerId: 2, skins: 2 },
      { playerId: 1, skins: 1 },
    ]);
    expect(result.detail).toBe('3 skins');
  });

  it('detail string singularizes for exactly one skin', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
    ];
    const p1 = [...PARS]; p1[0] = PARS[0]! - 1;
    const scores = makeScores({ 1: p1, 2: PARS });
    const result = calcMostSkins(scores, handicaps, 'blue');
    expect(result.detail).toBe('1 skin'); // not "1 skins"
  });

  it('per-hole completeness gate skips holes the field hasn\'t fully posted', () => {
    // Three-player field. Player 1 birdies hole 1; players 2 and 3 haven't
    // posted hole 1 yet (cross-group lag). With fieldPlayerIds, hole 1 is
    // skipped and no skin awarded. Without the gate, player 1 would get a
    // phantom skin since they're the lone scorer.
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
      { playerId: 3, handicapIndex: 0 },
    ];
    // Only player 1 has a score for hole 1
    const partialScores = [
      { playerId: 1, holeNumber: 1, grossScore: PARS[0]! - 1, putts: null },
    ];
    const fieldPlayerIds = new Set([1, 2, 3]);
    const gated = calcMostSkins(partialScores, handicaps, 'blue', undefined, fieldPlayerIds);
    expect(gated.skinHolders).toEqual([]);
    expect(gated.detail).toBe('0 skins');

    // Without the gate: player 1 picks up a phantom skin.
    const ungated = calcMostSkins(partialScores, handicaps, 'blue');
    expect(ungated.skinHolders).toEqual([{ playerId: 1, skins: 1 }]);
  });

  it('per-hole gate awards skin once every field player posts the hole', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 0 },
      { playerId: 2, handicapIndex: 0 },
    ];
    // Both players posted hole 1 — player 1 birdied, player 2 parred.
    const scores = [
      { playerId: 1, holeNumber: 1, grossScore: PARS[0]! - 1, putts: null },
      { playerId: 2, holeNumber: 1, grossScore: PARS[0]!, putts: null },
    ];
    const fieldPlayerIds = new Set([1, 2]);
    const result = calcMostSkins(scores, handicaps, 'blue', undefined, fieldPlayerIds);
    expect(result.skinHolders).toEqual([{ playerId: 1, skins: 1 }]);
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
      { wolfPlayerId: 10, holeNumber: 1, bonusesJson: JSON.stringify({ polies: [1, 2], sandies: [] }) },
      { wolfPlayerId: 10, holeNumber: 2, bonusesJson: JSON.stringify({ polies: [1], sandies: [] }) },
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
      { wolfPlayerId: 10, holeNumber: 1, bonusesJson: JSON.stringify({ polies: [1, 2], sandies: [] }) },
    ];
    const result = calcMostPolies(decisions);
    expect(result.winnerPlayerIds.sort()).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Sub exclusion (eligible set)
// ---------------------------------------------------------------------------

describe('eligible player filtering (subs excluded)', () => {
  it('sub with most net pars is skipped — best active player wins', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 10 }, // sub
      { playerId: 2, handicapIndex: 10 }, // active
    ];
    // Player 1 (sub) scores bogey on every hole → with CH 9, 9 holes become net par
    // Player 2 (active) scores double bogey on every hole → with CH 9, 0 net pars
    // But player 1 is a sub, so player 2 should NOT win (0 net pars = no-contest)
    const scores = makeScores({ 1: PARS.map((p) => p + 1), 2: PARS.map((p) => p + 2) });
    const eligible = new Set([2]); // only player 2 is active
    const result = calcMostNetPars(scores, handicaps, 'blue', eligible);
    expect(result.winnerPlayerIds).toEqual([]); // no-contest — player 2 has 0 net pars
  });

  it('sub unique low on a hole blocks the skin — active player does not inherit it', () => {
    // Use blue tee. HI 10 for both to make it simpler.
    // Player 1 (HI 10, sub): CH 9. Player 2 (HI 10, active): CH 9. Same handicap.
    // Player 1 birdies hole 1 (scores 4 on par 5), player 2 scores par (5).
    // Hole 1 SI=3, both get 1 stroke: P1 net=4-1=3, P2 net=5-1=4. P1 has unique low.
    // But P1 is a sub — that skin is blocked.
    const handicaps2: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 10 },
      { playerId: 2, handicapIndex: 10 },
    ];
    const p1 = [...PARS]; p1[0] = 4; // birdie hole 1
    const scores = makeScores({ 1: p1, 2: PARS });
    const eligible = new Set([2]); // only player 2 is active
    const result = calcMostSkins(scores, handicaps2, 'blue', eligible);
    // Player 1's skin is blocked because they're a sub. Player 2 has 0 skins.
    expect(result.skinHolders).toEqual([]);
    expect(result.detail).toBe('0 skins');
  });

  it('active player still earns skins on holes where they have unique low', () => {
    const handicaps: PlayerHandicap[] = [
      { playerId: 1, handicapIndex: 10 }, // sub
      { playerId: 2, handicapIndex: 10 }, // active
    ];
    // Player 2 (active) birdies hole 1, player 1 (sub) scores par
    const p2 = [...PARS]; p2[0] = 4; // birdie hole 1
    const scores = makeScores({ 1: PARS, 2: p2 });
    const eligible = new Set([2]);
    const result = calcMostSkins(scores, handicaps, 'blue', eligible);
    expect(result.skinHolders).toEqual([{ playerId: 2, skins: 1 }]);
    expect(result.detail).toBe('1 skin');
  });

  it('sub excluded from least putts — active player with fewer putts wins', () => {
    const scores = makeScoresWithPutts({
      1: { gross: PARS, putts: Array(18).fill(1) }, // sub: 18 total (best)
      2: { gross: PARS, putts: Array(18).fill(2) }, // active: 36 total
    });
    const eligible = new Set([2]);
    const result = calcLeastPutts(scores, eligible);
    expect(result.winnerPlayerIds).toEqual([2]);
    expect(result.detail).toBe('36 putts');
  });

  it('sub excluded from polies — active player wins', () => {
    const decisions: WolfDecisionRow[] = [
      { wolfPlayerId: 10, holeNumber: 1, bonusesJson: JSON.stringify({ polies: [1, 2], sandies: [] }) }, // sub 1 and active 2 each get a polie
      { wolfPlayerId: 10, holeNumber: 2, bonusesJson: JSON.stringify({ polies: [1], sandies: [] }) }, // sub 1 gets another
    ];
    const eligible = new Set([2]);
    const result = calcMostPolies(decisions, eligible);
    expect(result.winnerPlayerIds).toEqual([2]);
    expect(result.detail).toBe('1 polies');
  });
});
