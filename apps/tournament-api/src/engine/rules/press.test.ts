/**
 * T6-2 — evaluatePresses fixture-driven tests + boundary validation +
 * structural invariants.
 *
 * AC-16: 6 fixtures (a)–(f) + AC-15 determinism + AC-2 fast-fail cases +
 * AC-9 sanity (auto canUndo always false) + AC-13 ordering sanity.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluatePresses,
  type EvaluatePressesInput,
  type EvaluatePressesOutput,
  type Press,
} from './press.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '__fixtures__');

interface FixtureFile {
  name: string;
  input: EvaluatePressesInput;
  expectedNewlyFired: Press[];
  expectedActivePresses: Press[];
}

function loadFixture(filename: string): FixtureFile {
  const raw = readFileSync(join(fixturesDir, filename), 'utf8');
  return JSON.parse(raw) as FixtureFile;
}

const fixtures: Array<{ file: string; label: string }> = [
  { file: 'press-a-no-press.json',                    label: '(a) no press in close match'           },
  { file: 'press-b-single-auto.json',                 label: '(b) single auto-press at 2-down'       },
  { file: 'press-c-compound-auto.json',               label: '(c) compound auto-press, two stacked'  },
  { file: 'press-d-idempotent-replay.json',           label: '(d) idempotent replay, multiplier kept'},
  { file: 'press-e-manual-with-undo.json',            label: '(e) manual press with undo'            },
  { file: 'press-f-manual-and-auto-interleaved.json', label: '(f) manual + auto interleaved'         },
];

function assertOutputStructure(output: EvaluatePressesOutput): void {
  // AC-9: every auto press has canUndo=false.
  for (const p of output.activePresses) {
    if (p.type === 'auto') {
      expect(p.canUndo).toBe(false);
    }
  }
  // AC-13: deterministic ordering.
  for (let i = 1; i < output.activePresses.length; i++) {
    const a = output.activePresses[i - 1]!;
    const b = output.activePresses[i]!;
    if (a.startHole !== b.startHole) {
      expect(a.startHole).toBeLessThan(b.startHole);
    } else if (a.type !== b.type) {
      const TYPE_RANK = { auto: 0, manual: 1 } as const;
      expect(TYPE_RANK[a.type]).toBeLessThan(TYPE_RANK[b.type]);
    } else if (a.team !== b.team) {
      const TEAM_RANK = { teamA: 0, teamB: 1 } as const;
      expect(TEAM_RANK[a.team]).toBeLessThan(TEAM_RANK[b.team]);
    }
  }
  // newlyFired must be a SUBSEQUENCE-stable subset (same order as activePresses).
  let cursor = 0;
  for (const f of output.newlyFired) {
    while (cursor < output.activePresses.length && output.activePresses[cursor] !== f) {
      cursor++;
    }
    expect(cursor).toBeLessThan(output.activePresses.length);
  }
}

describe('evaluatePresses — golden fixtures', () => {
  for (const { file, label } of fixtures) {
    test(label, () => {
      const fx = loadFixture(file);
      const out = evaluatePresses(fx.input);
      expect(out.newlyFired).toEqual(fx.expectedNewlyFired);
      expect(out.activePresses).toEqual(fx.expectedActivePresses);
      assertOutputStructure(out);
    });
  }
});

describe('evaluatePresses — AC-15 deterministic replay', () => {
  test('identical input twice → deep-equal output (no input mutation)', () => {
    const fx = loadFixture('press-c-compound-auto.json');
    const inputClone = structuredClone(fx.input);
    const out1 = evaluatePresses(fx.input);
    const out2 = evaluatePresses(fx.input);
    expect(out2).toEqual(out1);
    // Input not mutated.
    expect(fx.input).toEqual(inputClone);
  });
});

describe('evaluatePresses — AC-2 boundary validation (fast-fail)', () => {
  function baseInput(): EvaluatePressesInput {
    return {
      perHoleResults: [],
      manualPresses: [],
      existingPressLog: [],
      config: { autoPressTriggerAtNDown: 2, pressMultiplier: 2 },
      throughHole: 0,
    };
  }

  test('throws on non-integer throughHole', () => {
    const input = baseInput();
    input.throughHole = 4.5 as unknown as number;
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on throughHole > 18', () => {
    const input = baseInput();
    input.throughHole = 19;
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on non-positive pressMultiplier', () => {
    const input = baseInput();
    input.config.pressMultiplier = 0;
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on autoPressTriggerAtNDown out of range', () => {
    const input = baseInput();
    input.config.autoPressTriggerAtNDown = 19;
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on duplicate perHoleResults entry for same hole', () => {
    const input = baseInput();
    input.throughHole = 1;
    input.perHoleResults = [
      { holeNumber: 1, par: 4, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 1, par: 4, teamABestNet: 5, teamBBestNet: 4, winner: 'teamB', teamDeltaCents: -400, sandiesApplied: false, greenieAwarded: null },
    ];
    expect(() => evaluatePresses(input)).toThrow(/duplicate perHoleResults/);
  });

  test('throws on missing perHoleResults for a hole within throughHole window', () => {
    const input = baseInput();
    input.throughHole = 3;
    input.perHoleResults = [
      { holeNumber: 1, par: 4, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null },
      // hole 2 missing
      { holeNumber: 3, par: 4, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null },
    ];
    expect(() => evaluatePresses(input)).toThrow(/missing perHoleResults/);
  });

  test('throws on duplicate manualPresses entry', () => {
    const input = baseInput();
    input.manualPresses = [
      { team: 'teamA', filedAtHole: 5 },
      { team: 'teamA', filedAtHole: 5 },
    ];
    expect(() => evaluatePresses(input)).toThrow(/duplicate manualPresses/);
  });

  test('throws on non-positive existingPressLog multiplier', () => {
    const input = baseInput();
    input.existingPressLog = [
      { type: 'auto', team: 'teamA', startHole: 5, multiplier: 0 },
    ];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('allows perHoleResults entries beyond throughHole (ignored)', () => {
    const input = baseInput();
    input.throughHole = 1;
    input.perHoleResults = [
      { holeNumber: 1, par: 4, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 5, par: 4, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null },
    ];
    const out = evaluatePresses(input);
    expect(out.activePresses).toEqual([]);
  });

  test('throws on invalid manualPress.team enum', () => {
    const input = baseInput();
    input.manualPresses = [{ team: 'blah' as never, filedAtHole: 5 }];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on manualPress.filedAtHole out of range', () => {
    const input = baseInput();
    input.manualPresses = [{ team: 'teamA', filedAtHole: 19 }];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on perHoleResults.holeNumber out of [1,18]', () => {
    const input = baseInput();
    input.perHoleResults = [
      { holeNumber: 19, par: 4, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null } as never,
    ];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on perHoleResults.winner invalid enum', () => {
    const input = baseInput();
    input.throughHole = 1;
    input.perHoleResults = [
      { holeNumber: 1, par: 4, teamABestNet: 4, teamBBestNet: 5, winner: 'nobody' as never, teamDeltaCents: 0, sandiesApplied: false, greenieAwarded: null },
    ];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on existingPressLog invalid type enum', () => {
    const input = baseInput();
    input.existingPressLog = [
      { type: 'bogus' as never, team: 'teamA', startHole: 5, multiplier: 2 },
    ];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on existingPressLog invalid team enum', () => {
    const input = baseInput();
    input.existingPressLog = [
      { type: 'auto', team: 'teamC' as never, startHole: 5, multiplier: 2 },
    ];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on existingPressLog startHole out of range', () => {
    const input = baseInput();
    input.existingPressLog = [
      { type: 'auto', team: 'teamA', startHole: 0, multiplier: 2 },
    ];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on existingPressLog non-string trigger when present', () => {
    const input = baseInput();
    input.existingPressLog = [
      { type: 'auto', team: 'teamA', startHole: 5, multiplier: 2, trigger: 123 as never },
    ];
    expect(() => evaluatePresses(input)).toThrow(RangeError);
  });

  test('throws on duplicate existingPressLog entries (same type+team+startHole)', () => {
    const input = baseInput();
    input.existingPressLog = [
      { type: 'auto', team: 'teamA', startHole: 5, multiplier: 2 },
      { type: 'auto', team: 'teamA', startHole: 5, multiplier: 3 },
    ];
    expect(() => evaluatePresses(input)).toThrow(/duplicate existingPressLog/);
  });
});

describe('evaluatePresses — AC-14 manual-press carry-forward from existingPressLog', () => {
  test('manual press in existingPressLog carries forward; not in newlyFired; multiplier preserved from log', () => {
    const out = evaluatePresses({
      perHoleResults: Array.from({ length: 5 }, (_, i) => ({
        holeNumber: i + 1,
        par: 4 as const,
        teamABestNet: 4,
        teamBBestNet: 5,
        winner: 'teamA' as const,
        teamDeltaCents: 400,
        sandiesApplied: false,
        greenieAwarded: null,
      })),
      manualPresses: [],
      existingPressLog: [
        { type: 'manual', team: 'teamB', startHole: 3, multiplier: 2 },
      ],
      // Different config.pressMultiplier (e.g., post-T5-11 mid-event edit) should NOT
      // overwrite the carried-forward press's historical multiplier.
      config: { autoPressTriggerAtNDown: null, pressMultiplier: 5 },
      throughHole: 5,
    });
    expect(out.newlyFired).toEqual([]);
    expect(out.activePresses.length).toBe(1);
    const carried = out.activePresses[0]!;
    expect(carried.type).toBe('manual');
    expect(carried.team).toBe('teamB');
    expect(carried.startHole).toBe(3);
    expect(carried.multiplier).toBe(2);  // historical, NOT current config 5
    expect(carried.canUndo).toBe(false); // throughHole 5 > startHole 3
  });
});

describe('evaluatePresses — manual press canUndo transitions (AC-7/AC-8)', () => {
  function baseManual(throughHole: number): EvaluatePressesInput {
    return {
      perHoleResults: Array.from({ length: throughHole }, (_, i) => ({
        holeNumber: i + 1,
        par: 4 as const,
        teamABestNet: 4,
        teamBBestNet: 5,
        winner: 'teamA' as const,
        teamDeltaCents: 400,
        sandiesApplied: false,
        greenieAwarded: null,
      })),
      manualPresses: [{ team: 'teamB', filedAtHole: 7 }],
      existingPressLog: [],
      config: { autoPressTriggerAtNDown: null, pressMultiplier: 2 },
      throughHole,
    };
  }

  test('canUndo=true when throughHole < startHole', () => {
    const out = evaluatePresses(baseManual(6));
    expect(out.activePresses.length).toBe(1);
    expect(out.activePresses[0]!.canUndo).toBe(true);
  });

  test('canUndo=true when throughHole === startHole', () => {
    const out = evaluatePresses(baseManual(7));
    expect(out.activePresses[0]!.canUndo).toBe(true);
  });

  test('canUndo=false when throughHole > startHole', () => {
    const out = evaluatePresses(baseManual(8));
    expect(out.activePresses[0]!.canUndo).toBe(false);
  });
});

describe('evaluatePresses — AC-11 hole-18 trigger does not fire phantom press', () => {
  test('A reaches 2-down at hole 18 → no auto-press (startHole would be 19)', () => {
    // 18 holes: A wins 8, B wins 10, but pattern such that A first reaches -2 only at hole 18.
    // Easiest construction: alternating then late B wins.
    const results = [];
    // First 16 holes: A wins 8, B wins 8, alternating → signed delta walks but never reaches -2.
    for (let h = 1; h <= 16; h++) {
      results.push({
        holeNumber: h,
        par: 4 as const,
        teamABestNet: 4,
        teamBBestNet: 5,
        winner: (h % 2 === 1 ? 'teamA' : 'teamB') as 'teamA' | 'teamB',
        teamDeltaCents: 400,
        sandiesApplied: false,
        greenieAwarded: null,
      });
    }
    // Hole 17: B wins. Signed delta = -1.
    results.push({ holeNumber: 17, par: 4 as const, teamABestNet: 5, teamBBestNet: 4, winner: 'teamB' as const, teamDeltaCents: -400, sandiesApplied: false, greenieAwarded: null });
    // Hole 18: B wins. Signed delta = -2 → would fire at startHole=19 → SUPPRESSED.
    results.push({ holeNumber: 18, par: 4 as const, teamABestNet: 5, teamBBestNet: 4, winner: 'teamB' as const, teamDeltaCents: -400, sandiesApplied: false, greenieAwarded: null });

    const out = evaluatePresses({
      perHoleResults: results,
      manualPresses: [],
      existingPressLog: [],
      config: { autoPressTriggerAtNDown: 2, pressMultiplier: 2 },
      throughHole: 18,
    });
    expect(out.activePresses).toEqual([]);
    expect(out.newlyFired).toEqual([]);
  });
});

describe('evaluatePresses — AC-12 disabled auto-press', () => {
  test('autoPressTriggerAtNDown = null → no auto-press regardless of state', () => {
    const out = evaluatePresses({
      perHoleResults: Array.from({ length: 10 }, (_, i) => ({
        holeNumber: i + 1,
        par: 4 as const,
        teamABestNet: 5,
        teamBBestNet: 4,
        winner: 'teamB' as const,
        teamDeltaCents: -400,
        sandiesApplied: false,
        greenieAwarded: null,
      })),
      manualPresses: [],
      existingPressLog: [],
      config: { autoPressTriggerAtNDown: null, pressMultiplier: 2 },
      throughHole: 10,
    });
    expect(out.activePresses).toEqual([]);
  });

  test('autoPressTriggerAtNDown = 0 → also disabled (treated same as null)', () => {
    const out = evaluatePresses({
      perHoleResults: Array.from({ length: 10 }, (_, i) => ({
        holeNumber: i + 1,
        par: 4 as const,
        teamABestNet: 5,
        teamBBestNet: 4,
        winner: 'teamB' as const,
        teamDeltaCents: -400,
        sandiesApplied: false,
        greenieAwarded: null,
      })),
      manualPresses: [],
      existingPressLog: [],
      config: { autoPressTriggerAtNDown: 0, pressMultiplier: 2 },
      throughHole: 10,
    });
    expect(out.activePresses).toEqual([]);
  });
});

describe('evaluatePresses — both teams can fire in same segment (codex H#2 fix)', () => {
  test('signed delta swings: A reaches -2 then B reaches +2 in same base segment → both fire', () => {
    // Holes 1-4: B wins all → signed delta -1, -2 (A fires at startHole=3), -3, -4
    // Holes 5-9: A wins all → signed delta -3, -2, -1, 0, +1
    // Holes 10-12: A wins → signed delta +2, +3 (B fires at startHole=11) ... wait need to be careful
    //
    // Construction: 1-4 B wins (A reaches -2 at h=2 → press for A at startHole=3)
    // Holes 5-12: A wins 8 in a row → signed delta walks -3,-2,-1,0,+1,+2,+3,+4
    //   B reaches +2 at hole 10 (signed delta after holes 1-10 = -4 + 6 = +2) → press for B at startHole=11
    const results = [
      { holeNumber: 1,  par: 4 as const, teamABestNet: 5, teamBBestNet: 4, winner: 'teamB' as const, teamDeltaCents: -400, sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 2,  par: 4 as const, teamABestNet: 5, teamBBestNet: 4, winner: 'teamB' as const, teamDeltaCents: -400, sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 3,  par: 4 as const, teamABestNet: 5, teamBBestNet: 4, winner: 'teamB' as const, teamDeltaCents: -400, sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 4,  par: 4 as const, teamABestNet: 5, teamBBestNet: 4, winner: 'teamB' as const, teamDeltaCents: -400, sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 5,  par: 4 as const, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA' as const, teamDeltaCents: 400,  sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 6,  par: 4 as const, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA' as const, teamDeltaCents: 400,  sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 7,  par: 4 as const, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA' as const, teamDeltaCents: 400,  sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 8,  par: 4 as const, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA' as const, teamDeltaCents: 400,  sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 9,  par: 4 as const, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA' as const, teamDeltaCents: 400,  sandiesApplied: false, greenieAwarded: null },
      { holeNumber: 10, par: 4 as const, teamABestNet: 4, teamBBestNet: 5, winner: 'teamA' as const, teamDeltaCents: 400,  sandiesApplied: false, greenieAwarded: null },
    ];
    const out = evaluatePresses({
      perHoleResults: results,
      manualPresses: [],
      existingPressLog: [],
      config: { autoPressTriggerAtNDown: 2, pressMultiplier: 2 },
      throughHole: 10,
    });
    // Find the team-A and team-B base-fired auto presses.
    const teamAPress = out.activePresses.find(
      (p) => p.type === 'auto' && p.team === 'teamA' && p.startHole === 3,
    );
    const teamBPress = out.activePresses.find(
      (p) => p.type === 'auto' && p.team === 'teamB' && p.startHole === 11,
    );
    expect(teamAPress).toBeDefined();
    expect(teamBPress).toBeDefined();
  });
});
