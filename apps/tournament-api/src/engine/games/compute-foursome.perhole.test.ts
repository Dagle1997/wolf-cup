/**
 * compute-foursome.perhole.test.ts (Story 3-3) — unit tests for the additive
 * per-hole money decomposition (`Ledger.perHole`). The golden fixtures
 * (perhole-money.golden.test.ts) cover exact hand-calc values; this file covers
 * the structural edges the goldens don't: an INCOMPLETE hole emits no row, a
 * settled PUSH emits an explicit zero row, the per-player loss-less invariant,
 * and order-independence (reverse-input determinism).
 */
import { describe, it, expect } from 'vitest';
import { computeFoursome } from './compute-foursome.js';
import type { FoursomeInput, GameConfig, HoleState, TeamSplit } from './types.js';

const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const config: GameConfig = {
  scope: 'foursome',
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }],
  lockState: 'locked',
  configVersion: 1,
};

// Hole 1: complete, team A clearly lower → A wins money.
// Hole 2: INCOMPLETE (b2 has no net) → must emit NO per-hole row.
// Hole 3: complete PUSH (all nets == par) → must emit an all-ZERO row.
const holes: HoleState[] = [
  { holeNumber: 1, par: 4, net: { a1: 3, a2: 4, b1: 5, b2: 5 } },
  { holeNumber: 2, par: 4, net: { a1: 4, a2: 4, b1: 4 /* b2 missing */ } },
  { holeNumber: 3, par: 4, net: { a1: 4, a2: 4, b1: 4, b2: 4 } },
];
const members = ['a1', 'a2', 'b1', 'b2'];

describe('computeFoursome perHole (Story 3-3)', () => {
  it('emits a row for each SETTLED hole and NONE for an incomplete hole', () => {
    const ledger = computeFoursome(config, { teamSplit, holes });
    const ph = ledger.perHole ?? [];
    expect(ph.map((h) => h.holeNumber)).toEqual([1, 3]); // hole 2 (incomplete) absent
  });

  it('a settled PUSH hole emits an explicit all-zero row (not omitted)', () => {
    const ledger = computeFoursome(config, { teamSplit, holes });
    const push = (ledger.perHole ?? []).find((h) => h.holeNumber === 3);
    expect(push).toBeDefined();
    expect(push!.teamPointsA).toBe(0);
    expect(push!.teamASignedPerPlayerCents).toBe(0);
    expect(push!.perPlayerCents).toEqual({ a1: 0, a2: 0, b1: 0, b2: 0 });
    // No negative zero leaks into a push row.
    for (const p of members) expect(Object.is(push!.perPlayerCents[p], -0)).toBe(false);
  });

  it('loss-less: Σ per-hole per-player === round per-player (every player)', () => {
    const ledger = computeFoursome(config, { teamSplit, holes });
    const ph = ledger.perHole ?? [];
    for (const p of members) {
      const summed = ph.reduce((acc, h) => acc + (h.perPlayerCents[p] ?? 0), 0);
      expect(summed).toBe(ledger.perPlayerCents[p]);
    }
  });

  it('order-independent: reversed input yields identical perHole (sorted by hole)', () => {
    const forward = computeFoursome(config, { teamSplit, holes });
    const reversedInput: FoursomeInput = { teamSplit, holes: [...holes].reverse() };
    const reversed = computeFoursome(config, reversedInput);
    expect(reversed.perHole).toEqual(forward.perHole);
  });

  it('a hole the winning team takes shows + for team A, − for team B (signed)', () => {
    const ledger = computeFoursome(config, { teamSplit, holes });
    const h1 = (ledger.perHole ?? []).find((h) => h.holeNumber === 1)!;
    expect(h1.teamPointsA).toBeGreaterThan(0);
    expect(h1.perPlayerCents['a1']).toBe(h1.teamASignedPerPlayerCents);
    expect(h1.perPlayerCents['a2']).toBe(h1.teamASignedPerPlayerCents);
    expect(h1.perPlayerCents['b1']).toBe(-h1.teamASignedPerPlayerCents);
    expect(h1.perPlayerCents['b2']).toBe(-h1.teamASignedPerPlayerCents);
  });
});
