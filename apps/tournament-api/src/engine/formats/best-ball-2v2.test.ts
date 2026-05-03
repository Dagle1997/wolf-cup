/**
 * T6-1 — compute2v2BestBall fixture-driven tests + structural invariants.
 *
 * AC-14: 6 fixtures (a)–(f) + AC-15 determinism replay + AC-9 anti-symmetry +
 * AC-10 perRound vs perPair sum invariant + AC-11 integer-only sanity.
 *
 * Fixture format (partial expected): each JSON declares:
 *   - input: full Compute2v2BestBallInput
 *   - expectedRound: deep-equal against output.perRound
 *   - expectedHoleSummary: array of partial HoleResult claims (subset match)
 *
 * Structural invariants are checked uniformly across every fixture in the
 * `assertResultStructure` helper — these don't need to be in the fixture.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compute2v2BestBall,
  type Compute2v2BestBallInput,
  type Compute2v2BestBallOutput,
} from './best-ball-2v2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '__fixtures__');

interface FixtureFile {
  name: string;
  input: Compute2v2BestBallInput;
  expectedRound: {
    teamTotalCents: number;
    holesPlayed: number;
    sandiesAwardedCount: number;
    greeniesAwardedCount: number;
  };
  expectedHoleSummary: Array<{
    holeNumber: number;
    winner?: 'teamA' | 'teamB' | 'tie';
    teamDeltaCents?: number;
    teamABestNet?: number;
    teamBBestNet?: number;
    sandiesApplied?: boolean;
    greenieAwardedNonNull?: boolean;
    greeniePlayerId?: string;
  }>;
}

function loadFixture(filename: string): FixtureFile {
  const raw = readFileSync(join(fixturesDir, filename), 'utf8');
  return JSON.parse(raw) as FixtureFile;
}

/**
 * Verify the structural invariants required by AC-9 / AC-10 / AC-11
 * across every fixture: anti-symmetry, integer-only, perPair sum equals
 * perRound.teamTotalCents.
 */
function assertResultStructure(
  output: Compute2v2BestBallOutput,
  pairings: { teamA: [string, string]; teamB: [string, string] },
): void {
  // (1) Integer-only on every money cell.
  expect(Number.isInteger(output.perRound.teamTotalCents)).toBe(true);
  for (const h of output.perHole) {
    expect(Number.isInteger(h.teamDeltaCents)).toBe(true);
    if (h.greenieAwarded) {
      expect(Number.isInteger(h.greenieAwarded.valueCents)).toBe(true);
    }
  }
  for (const a of Object.keys(output.perPair)) {
    for (const b of Object.keys(output.perPair[a]!)) {
      expect(Number.isInteger(output.perPair[a]![b])).toBe(true);
    }
  }

  // (2) Anti-symmetry: pair[a][b] === −pair[b][a] for every populated cell.
  for (const a of Object.keys(output.perPair)) {
    for (const b of Object.keys(output.perPair[a]!)) {
      const ab = output.perPair[a]![b]!;
      const ba = output.perPair[b]?.[a] ?? 0;
      expect(ab).toBe(-ba);
    }
  }

  // (3) Sum of team-A-side cross-team cells === perRound.teamTotalCents.
  const [a1, a2] = pairings.teamA;
  const [b1, b2] = pairings.teamB;
  const sumA =
    (output.perPair[a1]?.[b1] ?? 0) +
    (output.perPair[a1]?.[b2] ?? 0) +
    (output.perPair[a2]?.[b1] ?? 0) +
    (output.perPair[a2]?.[b2] ?? 0);
  expect(sumA).toBe(output.perRound.teamTotalCents);

  // (4) No intra-team pair cells.
  expect(output.perPair[a1]?.[a2]).toBeUndefined();
  expect(output.perPair[a2]?.[a1]).toBeUndefined();
  expect(output.perPair[b1]?.[b2]).toBeUndefined();
  expect(output.perPair[b2]?.[b1]).toBeUndefined();
}

const fixtures: Array<{ file: string; label: string }> = [
  { file: 'best-ball-2v2-a-straight-win.json',         label: '(a) straight win'           },
  { file: 'best-ball-2v2-b-sandies-scattered.json',    label: '(b) sandies scattered'      },
  { file: 'best-ball-2v2-c-greenies-every-par3.json',  label: '(c) greenies every par-3'   },
  { file: 'best-ball-2v2-d-no-valid-greenies.json',    label: '(d) no valid greenies'      },
  { file: 'best-ball-2v2-e-handicap-shifts.json',      label: '(e) handicap shifts'        },
  { file: 'best-ball-2v2-f-tie-hole.json',             label: '(f) tie hole'               },
];

describe('compute2v2BestBall — golden fixtures', () => {
  for (const { file, label } of fixtures) {
    test(label, () => {
      const fx = loadFixture(file);
      const out = compute2v2BestBall(fx.input);

      // Round-level deep-equal.
      expect(out.perRound).toEqual(fx.expectedRound);

      // Per-hole partial assertions.
      expect(out.perHole.length).toBe(fx.expectedHoleSummary.length);
      for (const expected of fx.expectedHoleSummary) {
        const actual = out.perHole.find((h) => h.holeNumber === expected.holeNumber);
        expect(actual).toBeDefined();
        if (expected.winner !== undefined) expect(actual!.winner).toBe(expected.winner);
        if (expected.teamDeltaCents !== undefined) expect(actual!.teamDeltaCents).toBe(expected.teamDeltaCents);
        if (expected.teamABestNet !== undefined) expect(actual!.teamABestNet).toBe(expected.teamABestNet);
        if (expected.teamBBestNet !== undefined) expect(actual!.teamBBestNet).toBe(expected.teamBBestNet);
        if (expected.sandiesApplied !== undefined) expect(actual!.sandiesApplied).toBe(expected.sandiesApplied);
        if (expected.greenieAwardedNonNull !== undefined) {
          if (expected.greenieAwardedNonNull) {
            expect(actual!.greenieAwarded).not.toBeNull();
          } else {
            expect(actual!.greenieAwarded).toBeNull();
          }
        }
        if (expected.greeniePlayerId !== undefined) {
          expect(actual!.greenieAwarded?.playerId).toBe(expected.greeniePlayerId);
        }
      }

      // Structural invariants (AC-9 / AC-10 / AC-11).
      assertResultStructure(out, fx.input.pairings);
    });
  }
});

describe('compute2v2BestBall — AC-15 deterministic replay', () => {
  test('identical input twice → deep-equal output (no input mutation)', () => {
    const fx = loadFixture('best-ball-2v2-a-straight-win.json');
    const inputClone = structuredClone(fx.input);
    const out1 = compute2v2BestBall(fx.input);
    const out2 = compute2v2BestBall(fx.input);
    expect(out2).toEqual(out1);
    // Input not mutated.
    expect(fx.input).toEqual(inputClone);
  });
});

describe('compute2v2BestBall — fast-fail on non-integer money config (AC-11)', () => {
  test('throws when basePerHoleCents is a float', () => {
    const fx = loadFixture('best-ball-2v2-f-tie-hole.json');
    const bogus = {
      ...fx.input,
      config: { ...fx.input.config, basePerHoleCents: 100.5 },
    };
    expect(() => compute2v2BestBall(bogus)).toThrow(/integer cents/);
  });
});

describe('compute2v2BestBall — AC-2 missing-cell skip', () => {
  test('hole without all 4 player rows is skipped (no perHole entry, no pair-cell mutation)', () => {
    const fx = loadFixture('best-ball-2v2-f-tie-hole.json');
    // Drop one player's score on hole 1 → no row for B2.
    const partialInput = {
      ...fx.input,
      holeScores: fx.input.holeScores.filter(
        (s) => !(s.playerId === 'B2' && s.holeNumber === 1),
      ),
    };
    const out = compute2v2BestBall(partialInput);
    expect(out.perHole.length).toBe(0);
    expect(out.perRound.holesPlayed).toBe(0);
    expect(out.perRound.teamTotalCents).toBe(0);
    // perPair has no populated cells.
    expect(Object.keys(out.perPair).length).toBe(0);
  });
});
