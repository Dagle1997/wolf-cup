import { describe, it, expect } from 'vitest';
import { calculateSandbaggerStatus } from './sandbagger.js';
import type { SandbaggerRoundInput } from './types.js';

/** Helper: create a round input where the player beats (or doesn't beat) their HI */
function makeRound(beats: boolean): SandbaggerRoundInput {
  // Course: CR=69.7, slope=121
  // beats=true: gross=80 → diff=(80-69.7)*113/121 = 9.62 < HI=16 ✓
  // beats=false: gross=95 → diff=(95-69.7)*113/121 = 23.62 > HI=16 ✗
  return {
    gross18: beats ? 80 : 95,
    courseRating: 69.7,
    slopeRating: 121,
    handicapIndex: 16,
  };
}

describe('calculateSandbaggerStatus', () => {
  it('0 rounds → tier 0, ratio 0', () => {
    const r = calculateSandbaggerStatus([]);
    expect(r).toEqual({ beatsCount: 0, totalRounds: 0, ratio: 0, tier: 0 });
  });

  it('3 rounds, all beats → tier 0 (not enough rounds)', () => {
    const r = calculateSandbaggerStatus([makeRound(true), makeRound(true), makeRound(true)]);
    expect(r.tier).toBe(0);
    expect(r.beatsCount).toBe(3);
    expect(r.totalRounds).toBe(3);
  });

  it('4 rounds, 3 beats → tier 1 (0.75 >= 0.60, 4 >= 4)', () => {
    const r = calculateSandbaggerStatus([
      makeRound(true), makeRound(true), makeRound(true), makeRound(false),
    ]);
    expect(r.tier).toBe(1);
    expect(r.beatsCount).toBe(3);
    expect(r.ratio).toBe(0.75);
  });

  it('5 rounds, 2 beats → tier 0 (0.40 < 0.60)', () => {
    const r = calculateSandbaggerStatus([
      makeRound(true), makeRound(true), makeRound(false), makeRound(false), makeRound(false),
    ]);
    expect(r.tier).toBe(0);
  });

  it('5 rounds, 3 beats → tier 1 (0.60 >= 0.60)', () => {
    const r = calculateSandbaggerStatus([
      makeRound(true), makeRound(true), makeRound(true), makeRound(false), makeRound(false),
    ]);
    expect(r.tier).toBe(1);
    expect(r.ratio).toBe(0.6);
  });

  it('7 rounds, 5 beats → tier 2 (0.714 >= 0.71, 7 >= 7)', () => {
    const rounds = [
      ...Array(5).fill(null).map(() => makeRound(true)),
      ...Array(2).fill(null).map(() => makeRound(false)),
    ];
    const r = calculateSandbaggerStatus(rounds);
    expect(r.tier).toBe(2);
    expect(r.beatsCount).toBe(5);
  });

  it('7 rounds, 4 beats → tier 0 (0.571 < 0.60)', () => {
    const rounds = [
      ...Array(4).fill(null).map(() => makeRound(true)),
      ...Array(3).fill(null).map(() => makeRound(false)),
    ];
    const r = calculateSandbaggerStatus(rounds);
    expect(r.tier).toBe(0);
  });

  it('11 rounds, 8 beats → tier 2 (0.727 < 0.73 for tier 3, but >= 0.71 for tier 2)', () => {
    const rounds = [
      ...Array(8).fill(null).map(() => makeRound(true)),
      ...Array(3).fill(null).map(() => makeRound(false)),
    ];
    const r = calculateSandbaggerStatus(rounds);
    expect(r.tier).toBe(2);
  });

  it('15 rounds, 11 beats → tier 3 (0.733 >= 0.73, 15 >= 11)', () => {
    const rounds = [
      ...Array(11).fill(null).map(() => makeRound(true)),
      ...Array(4).fill(null).map(() => makeRound(false)),
    ];
    const r = calculateSandbaggerStatus(rounds);
    expect(r.tier).toBe(3);
  });

  it('11 rounds, 7 beats → tier 1 (0.636 — below 0.71, above 0.60)', () => {
    const rounds = [
      ...Array(7).fill(null).map(() => makeRound(true)),
      ...Array(4).fill(null).map(() => makeRound(false)),
    ];
    const r = calculateSandbaggerStatus(rounds);
    expect(r.tier).toBe(1);
  });

  it('10 rounds, 8 beats → tier 2 (0.80 >= 0.71, 10 >= 7 but < 11)', () => {
    const rounds = [
      ...Array(8).fill(null).map(() => makeRound(true)),
      ...Array(2).fill(null).map(() => makeRound(false)),
    ];
    const r = calculateSandbaggerStatus(rounds);
    expect(r.tier).toBe(2);
  });

  it('differential math: gross 85, CR 69.7, slope 121, HI 16 → beats', () => {
    const r = calculateSandbaggerStatus([{
      gross18: 85, courseRating: 69.7, slopeRating: 121, handicapIndex: 16,
    }]);
    // diff = (85-69.7)*113/121 = 14.28 < 16 → beats
    expect(r.beatsCount).toBe(1);
  });

  it('differential math: gross 85, CR 69.7, slope 121, HI 14 → does not beat', () => {
    const r = calculateSandbaggerStatus([{
      gross18: 85, courseRating: 69.7, slopeRating: 121, handicapIndex: 14,
    }]);
    // diff = 14.28 > 14 → does not beat
    expect(r.beatsCount).toBe(0);
  });
});
