import { describe, it, expect } from 'vitest';
import { calculateHarveyPoints, calculateSeasonTotal } from './harvey.js';
import type { RoundFixture, SeasonStandings } from './fixtures/season-2025/fixture-types.js';
import type { HarveyRoundResult } from './types.js';

// ---------------------------------------------------------------------------
// Load fixture JSON files via Vitest's native import.meta.glob (no node:fs)
// ---------------------------------------------------------------------------

const roundGlob = import.meta.glob<{ default: RoundFixture }>(
  './fixtures/season-2025/round-*.json',
  { eager: true },
);
const standingsGlob = import.meta.glob<{ default: SeasonStandings }>(
  './fixtures/season-2025/season-standings.json',
  { eager: true },
);

const roundFiles: RoundFixture[] = Object.entries(roundGlob)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, mod]) => mod.default);

const standings: SeasonStandings = Object.values(standingsGlob)[0]!.default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wolf Cup group-size bonus: fewer players → more bonus per player per category.
 * Matches Excel formula: VLOOKUP(playerCount/4, {1:8, 2:6, 3:4, 4:2, 5:0}, 2, FALSE)
 * Only applies when playerCount is a multiple of 4.
 */
function getBonusPerPlayer(playerCount: number): number {
  if (playerCount % 4 !== 0) return 0;
  const groups = playerCount / 4;
  const table: Record<number, number> = { 1: 8, 2: 6, 3: 4, 4: 2, 5: 0 };
  return table[groups] ?? 0;
}

// ---------------------------------------------------------------------------
// Round-by-round Harvey Cup point validation
// ---------------------------------------------------------------------------

describe('2025 season Harvey Cup — per-round validation', () => {
  for (const fixture of roundFiles) {
    it(`Round ${fixture.round} (${fixture.date}): Harvey points match Excel`, () => {
      const N = fixture.players.length;
      const bonus = getBonusPerPlayer(N);
      const inputs = fixture.players.map(p => ({ stableford: p.stableford, money: p.money }));
      const results = calculateHarveyPoints(inputs, 'regular', bonus);

      for (const [i, player] of fixture.players.entries()) {
        const result = results[i];
        if (result === undefined) throw new Error(`Missing result at index ${i}`);

        expect(
          result.stablefordPoints,
          `Round ${fixture.round} (${fixture.date}): ${player.name} stablefordPoints — engine: ${result.stablefordPoints}, expected: ${player.expectedHarveyStableford}`,
        ).toBeCloseTo(player.expectedHarveyStableford, 1);

        expect(
          result.moneyPoints,
          `Round ${fixture.round} (${fixture.date}): ${player.name} moneyPoints — engine: ${result.moneyPoints}, expected: ${player.expectedHarveyMoney}`,
        ).toBeCloseTo(player.expectedHarveyMoney, 1);
      }
    });

    it(`Round ${fixture.round} (${fixture.date}): sum invariant holds`, () => {
      const N = fixture.players.length;
      const bonus = getBonusPerPlayer(N);
      const inputs = fixture.players.map(p => ({ stableford: p.stableford, money: p.money }));
      const results = calculateHarveyPoints(inputs, 'regular', bonus);

      const expectedSum = (N * (N + 1)) / 2 + N * bonus;
      const stablefordSum = results.reduce((acc, r) => acc + r.stablefordPoints, 0);
      const moneySum = results.reduce((acc, r) => acc + r.moneyPoints, 0);

      expect(stablefordSum).toBeCloseTo(expectedSum, 1);
      expect(moneySum).toBeCloseTo(expectedSum, 1);
    });
  }
});

// ---------------------------------------------------------------------------
// Season totals validation
// ---------------------------------------------------------------------------

describe('2025 season Harvey Cup — season totals', () => {
  it('each player season total (stableford + money, best-10 drops) matches Excel', () => {
    // Build per-player round results from fixtures
    const playerResults = new Map<string, HarveyRoundResult[]>();

    for (const fixture of roundFiles) {
      const N = fixture.players.length;
      const bonus = getBonusPerPlayer(N);
      const inputs = fixture.players.map(p => ({ stableford: p.stableford, money: p.money }));
      const results = calculateHarveyPoints(inputs, 'regular', bonus);

      for (const [i, player] of fixture.players.entries()) {
        const result = results[i];
        if (result === undefined) continue;
        const existing = playerResults.get(player.name) ?? [];
        existing.push(result);
        playerResults.set(player.name, existing);
      }
    }

    for (const expected of standings.players) {
      const rounds = playerResults.get(expected.name) ?? [];
      const season = calculateSeasonTotal(rounds);

      const actualTotal = season.stableford + season.money;

      expect(
        actualTotal,
        `${expected.name}: season total — engine: ${actualTotal}, expected: ${expected.expectedSeasonTotal} (stab: ${season.stableford}, money: ${season.money})`,
      ).toBeCloseTo(expected.expectedSeasonTotal, 1);

      expect(
        season.roundsPlayed,
        `${expected.name}: roundsPlayed`,
      ).toBe(expected.roundsPlayed);

      expect(
        season.roundsDropped,
        `${expected.name}: roundsDropped`,
      ).toBe(expected.roundsDropped);
    }
  });
});
