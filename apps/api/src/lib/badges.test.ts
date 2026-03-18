import { describe, it, expect } from 'vitest';
import {
  computeDynasty,
  computeRickieFowler,
  computePhBalance,
  computeMoneyMan,
  computePhilanthropist,
  computeOG,
  computeEverySeason,
  computeIronman,
  computeAllAwards,
  computePlayerBadges,
} from './badges.js';
import {
  HISTORICAL_CHAMPIONS,
  HISTORICAL_STANDINGS,
  HISTORICAL_ROSTERS,
  HISTORICAL_CASH,
  HISTORICAL_IRONMAN,
} from '../db/history-data.js';

// ---------------------------------------------------------------------------
// Unit tests with real data
// ---------------------------------------------------------------------------

describe('computeDynasty', () => {
  it('Preston qualifies with 4 wins', () => {
    const result = computeDynasty(HISTORICAL_CHAMPIONS);
    expect(result).toHaveLength(1);
    expect(result[0]!.playerName).toBe('Chris Preston');
    expect(result[0]!.years).toEqual([2017, 2018, 2020, 2022]);
  });

  it('player with 3 wins does NOT qualify', () => {
    const champs = [
      { year: 2020, playerName: 'Alice' },
      { year: 2021, playerName: 'Alice' },
      { year: 2022, playerName: 'Alice' },
    ];
    expect(computeDynasty(champs)).toHaveLength(0);
  });

  it('empty data returns empty', () => {
    expect(computeDynasty([])).toHaveLength(0);
  });
});

describe('computeRickieFowler', () => {
  it('Jay Patterson wins with 2 runner-ups (2019, 2025)', () => {
    const result = computeRickieFowler(HISTORICAL_STANDINGS, HISTORICAL_CHAMPIONS);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const jay = result.find((r) => r.playerName === 'Jay Patterson');
    expect(jay).toBeDefined();
    expect(jay!.runnerUpCount).toBe(2);
    expect(jay!.years).toEqual([2019, 2025]);
  });

  it('Moses excluded (has title)', () => {
    const result = computeRickieFowler(HISTORICAL_STANDINGS, HISTORICAL_CHAMPIONS);
    expect(result.find((r) => r.playerName === 'Moses')).toBeUndefined();
  });

  it('tie for most runner-ups — both get badge', () => {
    const champs = [{ year: 2020, playerName: 'Champ' }];
    const standings = [
      { year: 2020, standings: [{ name: 'A', rank: 2 }, { name: 'B', rank: 2 }] },
      { year: 2021, standings: [{ name: 'A', rank: 2 }, { name: 'B', rank: 2 }] },
    ];
    const result = computeRickieFowler(standings, champs);
    expect(result).toHaveLength(2);
  });

  it('empty data returns empty', () => {
    expect(computeRickieFowler([], [])).toHaveLength(0);
  });
});

describe('computePhBalance', () => {
  it('Matt White and Ben McGinnis qualify', () => {
    const result = computePhBalance(HISTORICAL_STANDINGS);
    const names = result.map((r) => r.playerName);
    expect(names).toContain('Matt White');
    expect(names).toContain('Ben McGinnis');
  });

  it('Matt White has 3rd in 2015, 2016, 2025', () => {
    const result = computePhBalance(HISTORICAL_STANDINGS);
    const mw = result.find((r) => r.playerName === 'Matt White');
    expect(mw).toBeDefined();
    expect(mw!.years).toEqual([2015, 2016, 2025]);
  });

  it('Ben McGinnis has 3rd in 2022, 2024', () => {
    const result = computePhBalance(HISTORICAL_STANDINGS);
    const bm = result.find((r) => r.playerName === 'Ben McGinnis');
    expect(bm).toBeDefined();
    expect(bm!.years).toEqual([2022, 2024]);
  });
});

describe('computeMoneyMan', () => {
  it('Jaquint 2x (2023, 2024) and Patterson 1x (2025)', () => {
    const result = computeMoneyMan(HISTORICAL_CASH);
    const jaquint = result.find((r) => r.playerName === 'Matt Jaquint');
    expect(jaquint).toBeDefined();
    expect(jaquint!.count).toBe(2);
    expect(jaquint!.years).toEqual([2023, 2024]);

    const patterson = result.find((r) => r.playerName === 'Jay Patterson');
    expect(patterson).toBeDefined();
    expect(patterson!.count).toBe(1);
    expect(patterson!.years).toEqual([2025]);
  });
});

describe('computePhilanthropist', () => {
  it('Keaton three-peat (2023, 2024, 2025)', () => {
    const result = computePhilanthropist(HISTORICAL_CASH);
    expect(result).toHaveLength(1);
    expect(result[0]!.playerName).toBe('Chris Keaton');
    expect(result[0]!.count).toBe(3);
    expect(result[0]!.years).toEqual([2023, 2024, 2025]);
  });
});

describe('computeOG', () => {
  it('exactly 6 players qualify', () => {
    const result = computeOG(HISTORICAL_ROSTERS);
    expect(result).toHaveLength(6);
    expect(result.sort()).toEqual([
      'Chris Keaton', 'Chris McNeely', 'Josh Stoll', 'Matt Jaquint', 'Matt White', 'Moses',
    ]);
  });

  it('Preston excluded (not on 2025 roster)', () => {
    const result = computeOG(HISTORICAL_ROSTERS);
    expect(result).not.toContain('Chris Preston');
  });
});

describe('computeEverySeason', () => {
  it('exactly 5 players qualify (all 11 years)', () => {
    const result = computeEverySeason(HISTORICAL_ROSTERS);
    expect(result).toHaveLength(5);
    expect(result.sort()).toEqual([
      'Chris Keaton', 'Chris McNeely', 'Josh Stoll', 'Matt White', 'Moses',
    ]);
  });

  it('Jaquint excluded (not in every year)', () => {
    const result = computeEverySeason(HISTORICAL_ROSTERS);
    expect(result).not.toContain('Matt Jaquint');
  });

  it('empty rosters returns empty', () => {
    expect(computeEverySeason({})).toHaveLength(0);
  });
});

describe('computeIronman', () => {
  it('Jay Patterson 2020 (18/18)', () => {
    const result = computeIronman(HISTORICAL_IRONMAN);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ playerName: 'Jay Patterson', year: 2020, rounds: 18 });
  });

  it('empty data returns empty', () => {
    expect(computeIronman([])).toHaveLength(0);
  });
});

describe('computeAllAwards', () => {
  it('returns awards with no empty recipients', () => {
    const awards = computeAllAwards(
      HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS,
      HISTORICAL_CASH, HISTORICAL_IRONMAN,
    );
    for (const award of awards) {
      expect(award.recipients.length).toBeGreaterThan(0);
    }
  });

  it('has both hall_of_fame and superlatives categories', () => {
    const awards = computeAllAwards(
      HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS,
      HISTORICAL_CASH, HISTORICAL_IRONMAN,
    );
    const categories = new Set(awards.map((a) => a.category));
    expect(categories.has('hall_of_fame')).toBe(true);
    expect(categories.has('superlatives')).toBe(true);
  });

  it('empty data returns empty awards', () => {
    const awards = computeAllAwards([], [], {}, [], []);
    expect(awards).toHaveLength(0);
  });
});

describe('computePlayerBadges', () => {
  const awards = computeAllAwards(
    HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS,
    HISTORICAL_CASH, HISTORICAL_IRONMAN,
  );

  it('Keaton gets Every Season + OG + Philanthropist', () => {
    const badges = computePlayerBadges('Chris Keaton', awards);
    const ids = badges.map((b) => b.id);
    expect(ids).toContain('every_season');
    expect(ids).toContain('og');
    expect(ids).toContain('philanthropist');
  });

  it('Jay Patterson gets Rickie Fowler + Ironman + Money Man', () => {
    const badges = computePlayerBadges('Jay Patterson', awards);
    const ids = badges.map((b) => b.id);
    expect(ids).toContain('rickie_fowler');
    expect(ids).toContain('ironman');
    expect(ids).toContain('money_man');
  });

  it('does NOT include dynasty badge (trophies rendered separately)', () => {
    const badges = computePlayerBadges('Chris Preston', awards);
    expect(badges.find((b) => b.id === 'dynasty')).toBeUndefined();
  });

  it('unknown player returns empty', () => {
    expect(computePlayerBadges('Nobody', awards)).toHaveLength(0);
  });
});
