import { describe, it, expect } from 'vitest';
import {
  resolvePerHoleWinners,
  tallyByPlayer,
  isPar3Hole,
  type CtpEntry,
} from './ctp.js';

function entry(partial: Partial<CtpEntry> & Pick<CtpEntry, 'holeNumber' | 'groupId' | 'holeCompletedAt'>): CtpEntry {
  return {
    id: partial.id ?? Math.floor(Math.random() * 1_000_000),
    roundId: partial.roundId ?? 1,
    groupId: partial.groupId,
    holeNumber: partial.holeNumber,
    winnerPlayerId: partial.winnerPlayerId ?? null,
    winnerName: partial.winnerName ?? null,
    holeCompletedAt: partial.holeCompletedAt,
  };
}

describe('isPar3Hole', () => {
  it('returns true only for holes 6, 7, 12, 15', () => {
    expect(isPar3Hole(6)).toBe(true);
    expect(isPar3Hole(7)).toBe(true);
    expect(isPar3Hole(12)).toBe(true);
    expect(isPar3Hole(15)).toBe(true);
    expect(isPar3Hole(1)).toBe(false);
    expect(isPar3Hole(5)).toBe(false);
    expect(isPar3Hole(8)).toBe(false);
    expect(isPar3Hole(18)).toBe(false);
  });
});

describe('resolvePerHoleWinners', () => {
  it('returns all nulls when no entries exist', () => {
    const winners = resolvePerHoleWinners([]);
    expect(winners).toEqual({ 6: null, 7: null, 12: null, 15: null });
  });

  it('returns null for a hole where every entry is a "nobody" (winnerPlayerId null)', () => {
    const winners = resolvePerHoleWinners([
      entry({ groupId: 1, holeNumber: 6, holeCompletedAt: 100 }),
      entry({ groupId: 2, holeNumber: 6, holeCompletedAt: 200 }),
      entry({ groupId: 3, holeNumber: 6, holeCompletedAt: 300 }),
    ]);
    expect(winners[6]).toBeNull();
  });

  it('returns the lone winner when exactly one group claims', () => {
    const winners = resolvePerHoleWinners([
      entry({ groupId: 2, holeNumber: 7, holeCompletedAt: 500, winnerPlayerId: 42, winnerName: 'Alice' }),
    ]);
    expect(winners[7]).not.toBeNull();
    expect(winners[7]!.playerId).toBe(42);
    expect(winners[7]!.playerName).toBe('Alice');
    expect(winners[7]!.groupId).toBe(2);
  });

  it('later hole_completed_at beats earlier — matches "next group lands closer" pattern', () => {
    const winners = resolvePerHoleWinners([
      entry({ groupId: 1, holeNumber: 12, holeCompletedAt: 1000, winnerPlayerId: 10, winnerName: 'Early' }),
      entry({ groupId: 2, holeNumber: 12, holeCompletedAt: 2000, winnerPlayerId: 20, winnerName: 'Later' }),
    ]);
    expect(winners[12]!.playerId).toBe(20);
    expect(winners[12]!.playerName).toBe('Later');
  });

  it('offline-late-arrival entries do NOT jump ahead — ordering uses hole_completed_at, not updated_at', () => {
    // Group 1 played hole 15 at t=1000 (completed early), but synced late.
    // Group 2 played hole 15 at t=2000, synced immediately.
    // Correct result: group 2 wins regardless of sync/insert order.
    const winners = resolvePerHoleWinners([
      entry({ groupId: 2, holeNumber: 15, holeCompletedAt: 2000, winnerPlayerId: 22, winnerName: 'Online' }),
      entry({ groupId: 1, holeNumber: 15, holeCompletedAt: 1000, winnerPlayerId: 11, winnerName: 'Offline-Drained-Later' }),
    ]);
    expect(winners[15]!.playerId).toBe(22);
    expect(winners[15]!.playerName).toBe('Online');
  });

  it('a "nobody" entry with a later timestamp does NOT displace an earlier real winner', () => {
    // This is the "group 2 missed the green but group 1 hit it" case.
    const winners = resolvePerHoleWinners([
      entry({ groupId: 1, holeNumber: 6, holeCompletedAt: 1000, winnerPlayerId: 7, winnerName: 'Claimant' }),
      entry({ groupId: 2, holeNumber: 6, holeCompletedAt: 2000 }), // winnerPlayerId null
    ]);
    expect(winners[6]!.playerId).toBe(7);
    expect(winners[6]!.playerName).toBe('Claimant');
  });

  it('ties on hole_completed_at are broken by MAX(groupId)', () => {
    const winners = resolvePerHoleWinners([
      entry({ groupId: 1, holeNumber: 7, holeCompletedAt: 5000, winnerPlayerId: 100, winnerName: 'Group One' }),
      entry({ groupId: 3, holeNumber: 7, holeCompletedAt: 5000, winnerPlayerId: 300, winnerName: 'Group Three' }),
      entry({ groupId: 2, holeNumber: 7, holeCompletedAt: 5000, winnerPlayerId: 200, winnerName: 'Group Two' }),
    ]);
    expect(winners[7]!.playerId).toBe(300);
    expect(winners[7]!.playerName).toBe('Group Three');
  });

  it('resolves all 4 par-3 holes independently', () => {
    const winners = resolvePerHoleWinners([
      entry({ groupId: 1, holeNumber: 6, holeCompletedAt: 100, winnerPlayerId: 10, winnerName: 'A' }),
      entry({ groupId: 1, holeNumber: 7, holeCompletedAt: 200, winnerPlayerId: 20, winnerName: 'B' }),
      // hole 12 — every group missed
      entry({ groupId: 2, holeNumber: 12, holeCompletedAt: 300 }),
      entry({ groupId: 1, holeNumber: 15, holeCompletedAt: 400, winnerPlayerId: 40, winnerName: 'D' }),
      entry({ groupId: 2, holeNumber: 15, holeCompletedAt: 500, winnerPlayerId: 41, winnerName: 'D2' }),
    ]);
    expect(winners[6]!.playerId).toBe(10);
    expect(winners[7]!.playerId).toBe(20);
    expect(winners[12]).toBeNull();
    expect(winners[15]!.playerId).toBe(41);
  });

  it('falls back winnerName to "Unknown" when snapshot was never stored', () => {
    const winners = resolvePerHoleWinners([
      entry({ groupId: 1, holeNumber: 6, holeCompletedAt: 1, winnerPlayerId: 999, winnerName: null }),
    ]);
    expect(winners[6]!.playerName).toBe('Unknown');
  });
});

describe('tallyByPlayer', () => {
  it('returns empty map when no par 3 has a winner', () => {
    const tally = tallyByPlayer({ 6: null, 7: null, 12: null, 15: null });
    expect(tally.size).toBe(0);
  });

  it('credits each unique winner with the holes they won', () => {
    const tally = tallyByPlayer({
      6: { playerId: 10, playerName: 'Alice', groupId: 1, holeCompletedAt: 100 },
      7: { playerId: 20, playerName: 'Bob', groupId: 1, holeCompletedAt: 200 },
      12: { playerId: 10, playerName: 'Alice', groupId: 1, holeCompletedAt: 300 },
      15: null,
    });
    expect(tally.size).toBe(2);
    expect(tally.get(10)).toEqual({ playerName: 'Alice', holes: [6, 12] });
    expect(tally.get(20)).toEqual({ playerName: 'Bob', holes: [7] });
  });

  it('produces a player with 3 holes when they sweep 3 of 4 par 3s', () => {
    const tally = tallyByPlayer({
      6: { playerId: 5, playerName: 'Sweeper', groupId: 1, holeCompletedAt: 1 },
      7: { playerId: 5, playerName: 'Sweeper', groupId: 2, holeCompletedAt: 2 },
      12: null,
      15: { playerId: 5, playerName: 'Sweeper', groupId: 3, holeCompletedAt: 3 },
    });
    expect(tally.size).toBe(1);
    expect(tally.get(5)).toEqual({ playerName: 'Sweeper', holes: [6, 7, 15] });
  });
});
