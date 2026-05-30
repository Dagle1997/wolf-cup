import { describe, it, expect } from 'vitest';
import { handicapTrend, volatility, bestWorstHoles, loneWolfWhenBehindRate } from './scouting.js';

describe('handicapTrend', () => {
  it('flat with <2 rounds', () => {
    expect(handicapTrend([12.4])).toEqual({ direction: 'flat', delta: 0, sample: 1 });
  });
  it('rising handicap over last 3 → up', () => {
    const t = handicapTrend([10.0, 11.0, 12.0, 13.0]); // last 3: 11→13
    expect(t).toEqual({ direction: 'up', delta: 2, sample: 3 });
  });
  it('improving handicap → down', () => {
    const t = handicapTrend([15.0, 14.0, 13.2]);
    expect(t.direction).toBe('down');
    expect(t.delta).toBeCloseTo(-1.8, 5);
  });
  it('within the noise band → flat', () => {
    expect(handicapTrend([12.0, 12.0, 12.0]).direction).toBe('flat');
  });
});

describe('volatility', () => {
  it('0 with <2 rounds', () => {
    expect(volatility([30]).stdDev).toBe(0);
  });
  it('steady player → low std-dev, swingy player → high', () => {
    expect(volatility([30, 30, 30, 30]).stdDev).toBe(0);
    expect(volatility([10, 40, 12, 38]).stdDev).toBeGreaterThan(13);
  });
});

describe('bestWorstHoles', () => {
  it('picks min/worst by avg-to-par, gating on minRounds', () => {
    const r = bestWorstHoles([
      { hole: 10, avgToPar: -0.5, rounds: 4 },
      { hole: 12, avgToPar: 1.8, rounds: 4 },
      { hole: 7, avgToPar: 0.2, rounds: 4 },
      { hole: 3, avgToPar: -2.0, rounds: 1 }, // below minRounds — excluded
    ]);
    expect(r.best).toEqual([10]);
    expect(r.worst).toEqual([12]);
  });
  it('returns empty when no spread', () => {
    expect(bestWorstHoles([{ hole: 1, avgToPar: 0, rounds: 3 }, { hole: 2, avgToPar: 0, rounds: 3 }])).toEqual({ best: [], worst: [] });
  });
  it('ties → multiple holes', () => {
    const r = bestWorstHoles([
      { hole: 10, avgToPar: -1, rounds: 3 },
      { hole: 17, avgToPar: -1, rounds: 3 },
      { hole: 12, avgToPar: 2, rounds: 3 },
    ]);
    expect(r.best).toEqual([10, 17]);
  });
});

describe('loneWolfWhenBehindRate', () => {
  it('rate is over behind rounds only', () => {
    const r = loneWolfWhenBehindRate([
      { wentAlone: true, behindInMoney: true },
      { wentAlone: true, behindInMoney: true },
      { wentAlone: false, behindInMoney: true },
      { wentAlone: true, behindInMoney: false }, // ahead — ignored
    ]);
    expect(r).toEqual({ alone: 2, behind: 3, rate: 0.67 });
  });
  it('no behind rounds → rate 0', () => {
    expect(loneWolfWhenBehindRate([{ wentAlone: true, behindInMoney: false }])).toEqual({ alone: 0, behind: 0, rate: 0 });
  });
});
