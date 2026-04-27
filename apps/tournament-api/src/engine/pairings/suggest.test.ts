/**
 * T4-1 pairings suggest engine tests. Pure-function golden-file fixtures
 * + state-machine coverage. No DB, no fetch, no fixtures from the
 * tournament-api workspace's test-setup beyond vitest.
 */

import { describe, expect, it } from 'vitest';
import { suggestPairings } from './suggest.js';

const ROSTER_8 = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

/** Helper: every C(roster.length, 2) pair shares ≥1 foursome across the grid. */
function assertEveryPairMet(grid: ReturnType<typeof suggestPairings>['grid'], roster: string[]) {
  const meetings = new Map<string, number>();
  for (const round of grid.rounds) {
    for (const f of round.foursomes) {
      for (let i = 0; i < f.playerIds.length; i++) {
        for (let j = i + 1; j < f.playerIds.length; j++) {
          const a = f.playerIds[i]!;
          const b = f.playerIds[j]!;
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          meetings.set(k, (meetings.get(k) ?? 0) + 1);
        }
      }
    }
  }
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = roster[i]!;
      const b = roster[j]!;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const count = meetings.get(k) ?? 0;
      expect(count, `pair ${a}-${b} should meet at least once`).toBeGreaterThan(0);
    }
  }
}

describe('suggestPairings', () => {
  // ---- Test A — 8-player no-pins everyone-once: golden + pair coverage. ---
  it('A: 8 players × 4 rounds × foursomeSize 4 + everyone-once + no pins → all pairs met, no warnings', () => {
    const result = suggestPairings({
      roster: ROSTER_8,
      numRounds: 4,
      foursomeSize: 4,
      constraint: 'everyone-once',
    });
    expect(result.warnings).toEqual([]);
    expect(result.grid.rounds).toHaveLength(4);
    for (const round of result.grid.rounds) {
      expect(round.foursomes).toHaveLength(2);
      for (const f of round.foursomes) {
        expect(f.playerIds).toHaveLength(4);
      }
    }
    assertEveryPairMet(result.grid, ROSTER_8);

    // Golden: pin the canonical schedule shape.
    expect(result.grid).toEqual({
      rounds: [
        {
          round: 1,
          foursomes: [
            { foursome: 1, playerIds: ['p0', 'p1', 'p2', 'p3'] },
            { foursome: 2, playerIds: ['p4', 'p5', 'p6', 'p7'] },
          ],
        },
        {
          round: 2,
          foursomes: [
            { foursome: 1, playerIds: ['p0', 'p1', 'p4', 'p5'] },
            { foursome: 2, playerIds: ['p2', 'p3', 'p6', 'p7'] },
          ],
        },
        {
          round: 3,
          foursomes: [
            { foursome: 1, playerIds: ['p0', 'p2', 'p4', 'p6'] },
            { foursome: 2, playerIds: ['p1', 'p3', 'p5', 'p7'] },
          ],
        },
        {
          round: 4,
          foursomes: [
            { foursome: 1, playerIds: ['p0', 'p3', 'p4', 'p7'] },
            { foursome: 2, playerIds: ['p1', 'p2', 'p5', 'p6'] },
          ],
        },
      ],
    });
  });

  // ---- Test B — partial-pinned regenerate. ----------------------------------
  it('B: pins honored verbatim; remaining slots filled greedily (no canonical fixture path)', () => {
    const result = suggestPairings({
      roster: ROSTER_8,
      numRounds: 4,
      foursomeSize: 4,
      constraint: 'everyone-once',
      pins: [
        { round: 1, foursome: 1, playerId: 'p0' },
        { round: 1, foursome: 1, playerId: 'p1' },
      ],
    });
    // Both pins must appear in round 1 foursome 1.
    const r1f1 = result.grid.rounds[0]!.foursomes[0]!.playerIds;
    expect(r1f1).toContain('p0');
    expect(r1f1).toContain('p1');
    // Foursome size honored.
    expect(r1f1).toHaveLength(4);
    // No `pin references unknown` warnings.
    expect(result.warnings.filter((w) => w.startsWith('pin references unknown'))).toHaveLength(0);
  });

  // ---- Test C — fully-pinned no-regen. --------------------------------------
  it('C: every slot pinned → suggest returns the pinned grid unchanged; warnings empty', () => {
    const pins: Array<{ round: number; foursome: number; playerId: string }> = [];
    // Pin the canonical schedule explicitly.
    const SCHED: number[][][] = [
      [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
      [
        [0, 1, 4, 5],
        [2, 3, 6, 7],
      ],
      [
        [0, 2, 4, 6],
        [1, 3, 5, 7],
      ],
      [
        [0, 3, 4, 7],
        [1, 2, 5, 6],
      ],
    ];
    for (let rIdx = 0; rIdx < 4; rIdx++) {
      for (let fIdx = 0; fIdx < 2; fIdx++) {
        for (const playerIdx of SCHED[rIdx]![fIdx]!) {
          pins.push({
            round: rIdx + 1,
            foursome: fIdx + 1,
            playerId: ROSTER_8[playerIdx]!,
          });
        }
      }
    }
    const result = suggestPairings({
      roster: ROSTER_8,
      numRounds: 4,
      foursomeSize: 4,
      constraint: 'everyone-once',
      pins,
    });
    expect(result.warnings).toEqual([]);
    // Every foursome's playerIds match the pinned schedule (order may
    // differ since pin placement is per-foursome).
    for (let rIdx = 0; rIdx < 4; rIdx++) {
      for (let fIdx = 0; fIdx < 2; fIdx++) {
        const expected = SCHED[rIdx]![fIdx]!.map((i) => ROSTER_8[i]!).sort();
        const actual = [...result.grid.rounds[rIdx]!.foursomes[fIdx]!.playerIds].sort();
        expect(actual).toEqual(expected);
      }
    }
  });

  // ---- Test D — invalid pin (unknown playerId). -----------------------------
  it('D: unknown playerId in pins → grid returned without the pin; warning emitted', () => {
    const result = suggestPairings({
      roster: ROSTER_8,
      numRounds: 4,
      foursomeSize: 4,
      constraint: 'everyone-once',
      pins: [{ round: 1, foursome: 1, playerId: 'p99' }],
    });
    expect(result.warnings).toContain('pin references unknown playerId p99');
    // Grid is still complete (canonical fixture path is NOT taken because
    // pins are present, but greedy fallback fills all slots).
    expect(result.grid.rounds).toHaveLength(4);
    for (const round of result.grid.rounds) {
      for (const f of round.foursomes) {
        expect(f.playerIds).toHaveLength(4);
      }
    }
  });

  // ---- Test E — determinism. ------------------------------------------------
  it('E: same input twice → byte-for-byte identical output', () => {
    const input = {
      roster: ROSTER_8,
      numRounds: 4,
      foursomeSize: 4,
      constraint: 'everyone-once' as const,
    };
    const a = suggestPairings(input);
    const b = suggestPairings(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  // ---- Test F — insufficient roster. ----------------------------------------
  it('F: 2-player roster + foursomeSize 4 → empty grid + insufficient-roster warning', () => {
    const result = suggestPairings({
      roster: ['p0', 'p1'],
      numRounds: 1,
      foursomeSize: 4,
      constraint: 'everyone-once',
    });
    expect(result.grid).toEqual({ rounds: [] });
    expect(result.warnings).toEqual(['insufficient roster: need at least 4, got 2']);
  });

  // ---- Test G — duplicate pin same round, different foursomes. -------------
  it('G: same playerId pinned to two foursomes in one round → first honored, second dropped + warning', () => {
    const result = suggestPairings({
      roster: ROSTER_8,
      numRounds: 4,
      foursomeSize: 4,
      constraint: 'everyone-once',
      pins: [
        { round: 1, foursome: 1, playerId: 'p0' },
        { round: 1, foursome: 2, playerId: 'p0' },
      ],
    });
    // p0 in round 1 foursome 1 (the first pin).
    const r1f1 = result.grid.rounds[0]!.foursomes[0]!.playerIds;
    const r1f2 = result.grid.rounds[0]!.foursomes[1]!.playerIds;
    expect(r1f1).toContain('p0');
    expect(r1f2).not.toContain('p0');
    expect(result.warnings).toContain(
      'player p0 pinned to multiple foursomes in round 1',
    );
  });

  // ---- Test H — pin overrides sit-out (round-2 codex catch). ----------------
  it('H: pinned player who would otherwise be sat out → pin honored; sit-out goes elsewhere', () => {
    const ROSTER_9 = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    // Without the pin, the sit-out for round 1 (rIdx=0) would start at
    // candidate(0) = roster[(0 * 1 + 0) % 9] = p0. Pinning p0 to (1, 1)
    // forces the algorithm to skip p0 and select p1 as the sit-out for
    // round 1.
    const result = suggestPairings({
      roster: ROSTER_9,
      numRounds: 2,
      foursomeSize: 4,
      constraint: 'everyone-once',
      pins: [{ round: 1, foursome: 1, playerId: 'p0' }],
    });
    const r1Players = result.grid.rounds[0]!.foursomes.flatMap((f) => f.playerIds);
    expect(r1Players).toContain('p0');
    expect(r1Players).not.toContain('p1'); // sat out instead
  });

  // ---- NEVER-throw on invalid sizing (impl-codex round-1 High #2). ---------
  it('NEVER throws on numRounds=0 or NaN: returns empty grid + invalid sizing warning', () => {
    const r1 = suggestPairings({
      roster: ROSTER_8,
      numRounds: 0,
      foursomeSize: 4,
      constraint: 'everyone-once',
    });
    expect(r1.grid).toEqual({ rounds: [] });
    expect(r1.warnings.some((w) => w.includes('invalid sizing'))).toBe(true);

    const r2 = suggestPairings({
      roster: ROSTER_8,
      numRounds: Number.NaN,
      foursomeSize: 4,
      constraint: 'everyone-once',
    });
    expect(r2.grid).toEqual({ rounds: [] });
    expect(r2.warnings.some((w) => w.includes('invalid sizing'))).toBe(true);
  });

  // ---- NEVER-throw on NaN/float pin round (impl-codex round-1 Critical). ---
  it('NEVER throws on NaN/float pin round: drops pin + emits out-of-range warning', () => {
    const result = suggestPairings({
      roster: ROSTER_8,
      numRounds: 4,
      foursomeSize: 4,
      constraint: 'everyone-once',
      pins: [
        { round: Number.NaN, foursome: 1, playerId: 'p0' },
        { round: 1.5, foursome: 1, playerId: 'p1' },
      ],
    });
    expect(result.warnings.filter((w) => w.includes('out of range'))).toHaveLength(2);
    // Grid still complete.
    expect(result.grid.rounds).toHaveLength(4);
  });

  // ---- Test I — no-permanent-benching guarantee (round-4 codex catch). -----
  it('I: 9-player × 9 rounds × foursomeSize 4 (sitOutCount=1) → every player plays at least once; no never-plays warning', () => {
    const ROSTER_9 = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const result = suggestPairings({
      roster: ROSTER_9,
      numRounds: 9,
      foursomeSize: 4,
      constraint: 'custom', // skip pair-coverage warnings (irrelevant here)
    });
    const everPlayed = new Set<string>();
    for (const round of result.grid.rounds) {
      for (const f of round.foursomes) {
        for (const p of f.playerIds) everPlayed.add(p);
      }
    }
    for (const p of ROSTER_9) {
      expect(everPlayed.has(p), `${p} should play at least once`).toBe(true);
    }
    expect(result.warnings.filter((w) => w.includes('never plays'))).toHaveLength(0);
  });
});
