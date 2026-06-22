import { describe, it, expect } from 'vitest';
import { ledgerToEdges } from './ledger-to-edges.js';
import type { Ledger, TeamSplit } from './types.js';

/**
 * Story 2.1a — whole-dollar 1-to-1 settle-up edges. The 2v2 ledger is symmetric
 * within a team (compute-foursome adds the same half to all 4 cross cells), so
 * each loser pays ONE winner the FULL per-player amount: no pv/2 half-leg, and
 * per-player / total are unchanged vs the old 4-leg layout.
 */
const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const opts = { sourceId: 'r:1' };

/** A symmetric 2v2 ledger: each A player up by `aUp` cents, each B player down by `aUp`. */
function symLedger(aUp: number): Ledger {
  const half = aUp / 2;
  return {
    cross: { a1: { b1: half, b2: half }, a2: { b1: half, b2: half } },
    perPlayerCents: { a1: aUp, a2: aUp, b1: -aUp, b2: -aUp },
    totalCents: Math.abs(aUp) * 2,
  };
}

describe('ledgerToEdges — whole-dollar 1-to-1 (Story 2.1a)', () => {
  it('A up: two whole-dollar legs, slot-paired b->a, sorted by (from,to)', () => {
    const edges = ledgerToEdges(symLedger(1500), teamSplit, opts);
    expect(edges).toEqual([
      { fromPlayerId: 'b1', toPlayerId: 'a1', cents: 1500, sourceType: 'f1_game', sourceId: 'r:1' },
      { fromPlayerId: 'b2', toPlayerId: 'a2', cents: 1500, sourceType: 'f1_game', sourceId: 'r:1' },
    ]);
  });

  it('B up: legs reverse direction (a pays b), still 1-to-1', () => {
    const edges = ledgerToEdges(symLedger(-1500), teamSplit, opts);
    expect(edges).toEqual([
      { fromPlayerId: 'a1', toPlayerId: 'b1', cents: 1500, sourceType: 'f1_game', sourceId: 'r:1' },
      { fromPlayerId: 'a2', toPlayerId: 'b2', cents: 1500, sourceType: 'f1_game', sourceId: 'r:1' },
    ]);
  });

  it('push (all per-player 0): no edges, no crash (teams from teamSplit, never inferred)', () => {
    expect(ledgerToEdges(symLedger(0), teamSplit, opts)).toEqual([]);
  });

  it('the old half-dollar bug case is gone: a single $5 point settles as one whole $5 leg', () => {
    // 1 net point at $5 => per-player +/-500c. Old layout: 4 legs of 250c ($2.50).
    // New layout: 2 legs of 500c ($5) — no half-dollar.
    const edges = ledgerToEdges(symLedger(500), teamSplit, opts);
    expect(edges).toEqual([
      { fromPlayerId: 'b1', toPlayerId: 'a1', cents: 500, sourceType: 'f1_game', sourceId: 'r:1' },
      { fromPlayerId: 'b2', toPlayerId: 'a2', cents: 500, sourceType: 'f1_game', sourceId: 'r:1' },
    ]);
    for (const e of edges) expect(e.cents % 100).toBe(0); // whole-dollar
  });

  it('loss-less (NFR-C3): sum(edges) === ledger.totalCents and edges reconstruct per-player', () => {
    const ledger = symLedger(1500);
    const edges = ledgerToEdges(ledger, teamSplit, opts);
    expect(edges.reduce((s, e) => s + e.cents, 0)).toBe(ledger.totalCents);
    const recon: Record<string, number> = { a1: 0, a2: 0, b1: 0, b2: 0 };
    for (const e of edges) {
      recon[e.toPlayerId]! += e.cents;
      recon[e.fromPlayerId]! -= e.cents;
    }
    expect(recon).toEqual(ledger.perPlayerCents);
  });

  it('fail-closed: throws asymmetric_2v2_ledger when slot-pairing cannot reconstruct per-player', () => {
    // Zero-sum but NOT slot-symmetric: perPlayer[b1] (-100) !== -perPlayer[a1] (-300).
    const asymmetric: Ledger = {
      cross: { a1: { b1: 0, b2: 0 }, a2: { b1: 0, b2: 0 } },
      perPlayerCents: { a1: 300, a2: 100, b1: -100, b2: -300 },
      totalCents: 400,
    };
    expect(() => ledgerToEdges(asymmetric, teamSplit, opts)).toThrow(/asymmetric_2v2_ledger/);
  });

  it('fail-closed: a MISSING perPlayerCents key throws (never silently treated as 0)', () => {
    const incomplete: Ledger = {
      cross: { a1: { b1: 750, b2: 750 }, a2: { b1: 750, b2: 750 } },
      // a2 omitted — an upstream bug must fail closed, not drop a2's leg.
      perPlayerCents: { a1: 1500, b1: -1500, b2: -1500 },
      totalCents: 3000,
    };
    expect(() => ledgerToEdges(incomplete, teamSplit, opts)).toThrow(/incomplete_ledger/);
  });

  it('fail-closed: edge total inconsistent with ledger.totalCents throws (loss-less, NFR-C3)', () => {
    const badTotal: Ledger = {
      cross: { a1: { b1: 750, b2: 750 }, a2: { b1: 750, b2: 750 } },
      perPlayerCents: { a1: 1500, a2: 1500, b1: -1500, b2: -1500 }, // reconstructs fine
      totalCents: 9999, // ...but the claimed total is wrong
    };
    expect(() => ledgerToEdges(badTotal, teamSplit, opts)).toThrow(/ledger_total_mismatch/);
  });

  it('fail-closed: a malformed teamSplit (duplicate / empty party) throws', () => {
    const ledger = symLedger(1500);
    expect(() =>
      ledgerToEdges(ledger, { teamA: ['a1', 'a1'], teamB: ['b1', 'b2'] }, opts),
    ).toThrow(/invalid_2v2_team_split/);
    expect(() =>
      ledgerToEdges(ledger, { teamA: ['a1', ''], teamB: ['b1', 'b2'] }, opts),
    ).toThrow(/invalid_2v2_team_split/);
    // array-like (e.g. a string has .length and indexing) is rejected too
    expect(() =>
      ledgerToEdges(ledger, { teamA: 'ab' as unknown as readonly [string, string], teamB: ['b1', 'b2'] }, opts),
    ).toThrow(/invalid_2v2_team_split/);
  });

  it('fail-closed: a null perPlayerCents throws the classified error (not a raw TypeError)', () => {
    const bad = { cross: {}, perPlayerCents: null as unknown as Record<string, number>, totalCents: 0 };
    expect(() => ledgerToEdges(bad, teamSplit, opts)).toThrow(/incomplete_ledger/);
  });
});
