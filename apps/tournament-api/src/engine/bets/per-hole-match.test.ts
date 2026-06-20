/**
 * Story 1.2 — per-hole match-play golden hand-calc fixtures (the HARD GATE).
 *
 * Hand-authored and hand-APPROVED by Josh on 2026-06-20 (margin × stake payout,
 * lower-value-wins-hole, tie pushes — locked). The engine must match these,
 * never the reverse. Per-hole values are supplied as a GIVEN input (P2).
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleBet } from './index.js';
import type { H2hInput, SettlementOutcome } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '__fixtures__');

interface FixtureFile {
  name: string;
  input: H2hInput;
  expected: SettlementOutcome;
}

function loadFixture(filename: string): FixtureFile {
  return JSON.parse(readFileSync(join(fixturesDir, filename), 'utf8')) as FixtureFile;
}

const fixtures: Array<{ file: string; label: string }> = [
  { file: 'per-hole-match-a-net-clean-win.json', label: '(a) net clean win — 3 up × stake, loser stakeholder pays winner' },
  { file: 'per-hole-match-b-net-push.json', label: '(b) all square — level match is a push, no money (FR26)' },
  { file: 'per-hole-match-c-gross-openbook.json', label: '(c) gross + open book — subject B wins, backer Kyle pays Steven (FR8/FR10/FR38)' },
];

describe('settlePerHoleMatch — golden hand-calc fixtures (hard gate)', () => {
  for (const { file, label } of fixtures) {
    test(label, () => {
      const fx = loadFixture(file);
      const out = settleBet(fx.input);
      expect(out).toEqual(fx.expected);
    });
  }

  test('determinism — same input yields identical output', () => {
    const fx = loadFixture('per-hole-match-a-net-clean-win.json');
    expect(settleBet(fx.input)).toEqual(settleBet(fx.input));
  });

  test('provisional — an unscored scoped hole never settles (FR25)', () => {
    const fx = loadFixture('per-hole-match-a-net-clean-win.json');
    const vals = [...fx.input.netPerHoleBySubject[fx.input.bet.sides[0]!.subjectPlayerId]!];
    vals[17] = null; // last hole not yet entered
    const out = settleBet({
      ...fx.input,
      netPerHoleBySubject: {
        ...fx.input.netPerHoleBySubject,
        [fx.input.bet.sides[0]!.subjectPlayerId]: vals,
      },
    });
    expect(out.state).toBe('provisional');
    expect(out.edges).toEqual([]);
  });

  test('putts basis on per_hole_match fails loud (P6) — unsupported, never silent $0', () => {
    const fx = loadFixture('per-hole-match-a-net-clean-win.json');
    const out = settleBet({ ...fx.input, bet: { ...fx.input.bet, basis: 'putts' } });
    expect(out.state).toBe('unsupported');
    expect(out.edges).toEqual([]);
  });
});
