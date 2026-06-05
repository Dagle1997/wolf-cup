import { describe, it, expect } from 'vitest';
import { calculateSideGameRotation } from './side-game-rotation.js';
import type { WeekRotationInput, SideGameRotationInput } from './side-game-rotation.js';

function makeWeeks(count: number, inactiveIndexes: number[] = []): WeekRotationInput[] {
  // Generate valid Friday dates starting from 2026-04-10 (a Friday)
  const start = new Date('2026-04-10T12:00:00');
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return {
      friday: `${y}-${m}-${day}`,
      isActive: inactiveIndexes.includes(i) ? 0 : 1,
    };
  });
}

function makeGames(count: number): SideGameRotationInput[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
}

// Friday string for week index i in the makeWeeks sequence
function fri(i: number): string {
  const d = new Date('2026-04-10T12:00:00');
  d.setDate(d.getDate() + i * 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('calculateSideGameRotation', () => {
  it('assigns one game per Friday for a single full cycle (6 games, 6 weeks)', () => {
    const result = calculateSideGameRotation(makeGames(6), makeWeeks(6));
    expect(result).toEqual([
      { gameId: 1, fridays: [fri(0)] },
      { gameId: 2, fridays: [fri(1)] },
      { gameId: 3, fridays: [fri(2)] },
      { gameId: 4, fridays: [fri(3)] },
      { gameId: 5, fridays: [fri(4)] },
      { gameId: 6, fridays: [fri(5)] },
    ]);
  });

  it('repeats the cycle across multiple rounds (6 games, 12 weeks)', () => {
    const result = calculateSideGameRotation(makeGames(6), makeWeeks(12));
    expect(result[0]).toEqual({ gameId: 1, fridays: [fri(0), fri(6)] });
    expect(result[1]).toEqual({ gameId: 2, fridays: [fri(1), fri(7)] });
    expect(result[5]).toEqual({ gameId: 6, fridays: [fri(5), fri(11)] });
  });

  it('holds the rotation past an inactive week — everything after shifts back one slot', () => {
    // The rainout case: week index 1 (second Friday) goes inactive.
    // Without it, the active Fridays are [w0, w2, w3, w4, w5, w6], so the
    // game that used to be on w2 now lands on the slot w1 vacated.
    const result = calculateSideGameRotation(makeGames(6), makeWeeks(7, [1]));
    // active Fridays in order: w0, w2, w3, w4, w5, w6
    expect(result[0]).toEqual({ gameId: 1, fridays: [fri(0)] }); // activeIdx 0
    expect(result[1]).toEqual({ gameId: 2, fridays: [fri(2)] }); // activeIdx 1 (was w1)
    expect(result[2]).toEqual({ gameId: 3, fridays: [fri(3)] }); // activeIdx 2
    expect(result[3]).toEqual({ gameId: 4, fridays: [fri(4)] });
    expect(result[4]).toEqual({ gameId: 5, fridays: [fri(5)] });
    expect(result[5]).toEqual({ gameId: 6, fridays: [fri(6)] });
    // The inactive Friday is assigned to no game
    const allAssigned = result.flatMap((r) => r.fridays);
    expect(allAssigned).not.toContain(fri(1));
  });

  it('reproduces the live 5/22-style replay: the rained game moves to the next active week', () => {
    // 6 games; the 6th game (Most Polies analogue, gameIdx 5) lands on week 5.
    // Make week 5 inactive → game 6 should move to week 6 (the next active slot).
    const before = calculateSideGameRotation(makeGames(6), makeWeeks(7));
    expect(before[5]).toEqual({ gameId: 6, fridays: [fri(5)] });

    const after = calculateSideGameRotation(makeGames(6), makeWeeks(7, [5]));
    // active Fridays: w0..w4, w6 → activeIdx 5 is now w6
    expect(after[5]).toEqual({ gameId: 6, fridays: [fri(6)] });
  });

  it('orders games by id regardless of input order', () => {
    const shuffled: SideGameRotationInput[] = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const result = calculateSideGameRotation(shuffled, makeWeeks(3));
    expect(result).toEqual([
      { gameId: 1, fridays: [fri(0)] },
      { gameId: 2, fridays: [fri(1)] },
      { gameId: 3, fridays: [fri(2)] },
    ]);
  });

  it('returns empty Friday lists when there are no active weeks', () => {
    const result = calculateSideGameRotation(makeGames(6), makeWeeks(3, [0, 1, 2]));
    expect(result.every((r) => r.fridays.length === 0)).toBe(true);
  });

  it('returns empty array when there are no games', () => {
    const result = calculateSideGameRotation([], makeWeeks(6));
    expect(result).toEqual([]);
  });

  it('handles fewer weeks than games (some games get no Friday)', () => {
    const result = calculateSideGameRotation(makeGames(6), makeWeeks(3));
    expect(result[0]!.fridays).toEqual([fri(0)]);
    expect(result[2]!.fridays).toEqual([fri(2)]);
    expect(result[3]!.fridays).toEqual([]);
    expect(result[5]!.fridays).toEqual([]);
  });
});
