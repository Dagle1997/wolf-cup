/**
 * Story 1.1 — h2h NET golden hand-calc fixtures (the HARD GATE).
 *
 * These fixtures were hand-authored and hand-APPROVED by Josh on 2026-06-20
 * (math + conventions locked). They are the source of truth: the engine must
 * match them, never the reverse. Net is supplied as a GIVEN input (P2).
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
  { file: 'h2h-net-a-clean-win.json', label: '(a) clean win — loser stakeholder pays winner stakeholder, full stake' },
  { file: 'h2h-net-b-push.json', label: '(b) push — level totals, no money moves (FR26)' },
  { file: 'h2h-net-c-nonplaying-backer.json', label: '(c) open book — non-playing backer Kyle collects from Steven (FR8/FR10/FR38)' },
];

describe('settleH2h — golden hand-calc fixtures (hard gate)', () => {
  for (const { file, label } of fixtures) {
    test(label, () => {
      const fx = loadFixture(file);
      const out = settleBet(fx.input);
      expect(out).toEqual(fx.expected);
    });
  }

  test('determinism — same input yields identical output', () => {
    const fx = loadFixture('h2h-net-a-clean-win.json');
    expect(settleBet(fx.input)).toEqual(settleBet(fx.input));
  });

  test('unknown bet type fails loud (P6) — unsupported, never silent push/$0', () => {
    const fx = loadFixture('h2h-net-a-clean-win.json');
    const out = settleBet({ ...fx.input, bet: { ...fx.input.bet, betType: 'roulette' } });
    expect(out.state).toBe('unsupported');
    expect(out.edges).toEqual([]);
  });
});
