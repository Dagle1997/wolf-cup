import { describe, it, expect } from 'vitest';
import { getHoleTeamFor, isSkinsHole } from './hole-teams.js';

const GROUP = [10, 12, 9, 16]; // stand-in: A=10, B=12, C=9, D=16

describe('isSkinsHole', () => {
  it('returns true for holes 1 and 3', () => {
    expect(isSkinsHole(1)).toBe(true);
    expect(isSkinsHole(3)).toBe(true);
  });
  it('returns false for any other hole', () => {
    for (const h of [2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      expect(isSkinsHole(h)).toBe(false);
    }
  });
});

describe('getHoleTeamFor — skins holes', () => {
  it('everyone is opponent on hole 1 (from any perspective)', () => {
    for (const me of GROUP) {
      const t = getHoleTeamFor(me, 1, GROUP, null);
      expect([...t.teammates]).toEqual([]);
      expect([...t.opponents].sort((a, b) => a - b)).toEqual(GROUP.filter((id) => id !== me).sort((a, b) => a - b));
    }
  });
  it('everyone is opponent on hole 3', () => {
    const t = getHoleTeamFor(10, 3, GROUP, null);
    expect([...t.opponents].sort((a, b) => a - b)).toEqual([9, 12, 16]);
  });
});

describe('getHoleTeamFor — wolf alone', () => {
  const dec = { decision: 'alone' as const, wolfPlayerId: 10, partnerPlayerId: null };

  it("wolf's perspective: all 3 others are opponents", () => {
    const t = getHoleTeamFor(10, 2, GROUP, dec);
    expect([...t.teammates]).toEqual([]);
    expect([...t.opponents].sort((a, b) => a - b)).toEqual([9, 12, 16]);
  });

  it("non-wolf: other 2 non-wolf are teammates, wolf is opponent", () => {
    const t = getHoleTeamFor(12, 2, GROUP, dec);
    expect([...t.teammates].sort((a, b) => a - b)).toEqual([9, 16]);
    expect([...t.opponents]).toEqual([10]);
  });
});

describe('getHoleTeamFor — blind wolf', () => {
  const dec = { decision: 'blind_wolf' as const, wolfPlayerId: 9, partnerPlayerId: null };
  it('behaves like alone (1v3 split)', () => {
    const t = getHoleTeamFor(9, 4, GROUP, dec);
    expect([...t.opponents].sort((a, b) => a - b)).toEqual([10, 12, 16]);
    const nonWolf = getHoleTeamFor(16, 4, GROUP, dec);
    expect([...nonWolf.teammates].sort((a, b) => a - b)).toEqual([10, 12]);
    expect([...nonWolf.opponents]).toEqual([9]);
  });
});

describe('getHoleTeamFor — partner (2v2)', () => {
  const dec = { decision: 'partner' as const, wolfPlayerId: 10, partnerPlayerId: 16 };

  it("wolf's perspective: partner is teammate, other 2 are opponents", () => {
    const t = getHoleTeamFor(10, 5, GROUP, dec);
    expect([...t.teammates]).toEqual([16]);
    expect([...t.opponents].sort((a, b) => a - b)).toEqual([9, 12]);
  });

  it("partner's perspective: wolf is teammate, other 2 are opponents", () => {
    const t = getHoleTeamFor(16, 5, GROUP, dec);
    expect([...t.teammates]).toEqual([10]);
    expect([...t.opponents].sort((a, b) => a - b)).toEqual([9, 12]);
  });

  it('non-wolf-team player: teammate is the other non-wolf-team, opponents are wolf+partner', () => {
    const t = getHoleTeamFor(12, 5, GROUP, dec);
    expect([...t.teammates]).toEqual([9]);
    expect([...t.opponents].sort((a, b) => a - b)).toEqual([10, 16]);
    const t2 = getHoleTeamFor(9, 5, GROUP, dec);
    expect([...t2.teammates]).toEqual([12]);
    expect([...t2.opponents].sort((a, b) => a - b)).toEqual([10, 16]);
  });
});

describe('getHoleTeamFor — edge cases', () => {
  it('perspective not in group returns empty sets', () => {
    const dec = { decision: 'partner' as const, wolfPlayerId: 10, partnerPlayerId: 16 };
    const t = getHoleTeamFor(999, 5, GROUP, dec);
    expect([...t.teammates]).toEqual([]);
    expect([...t.opponents]).toEqual([]);
  });

  it("wolf hole with no decision returns empty sets", () => {
    const t = getHoleTeamFor(10, 5, GROUP, null);
    expect([...t.teammates]).toEqual([]);
    expect([...t.opponents]).toEqual([]);
  });

  it("decision=partner but partnerPlayerId null falls back to alone-like behavior", () => {
    const dec = { decision: 'partner' as const, wolfPlayerId: 10, partnerPlayerId: null };
    const t = getHoleTeamFor(10, 5, GROUP, dec);
    expect([...t.opponents].sort((a, b) => a - b)).toEqual([9, 12, 16]);
  });
});
