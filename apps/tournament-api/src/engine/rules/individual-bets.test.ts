/**
 * T6-3 — computeIndividualBet fixture-driven tests + boundary validation.
 *
 * AC-11: 4 fixtures (a)-(d) + AC-10 determinism + AC-5 boundary cases +
 * AC-8b hole-18-no-fire.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeIndividualBet,
  type ComputeIndividualBetInput,
  type HoleScoreShape,
  type PressFireRow,
} from './individual-bets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, '__fixtures__');

interface FixtureFile {
  name: string;
  input: Omit<ComputeIndividualBetInput, 'holeScoresByCell'> & {
    _holeScoresByCellEntries: Array<[string, HoleScoreShape]>;
  };
  expectedNetToPlayerACents: number;
  expectedTriggeredPressesCount?: number;
  expectedTriggeredPresses?: PressFireRow[];
}

function loadFixture(filename: string): FixtureFile {
  const raw = readFileSync(join(fixturesDir, filename), 'utf8');
  return JSON.parse(raw) as FixtureFile;
}

function materializeInput(fx: FixtureFile): ComputeIndividualBetInput {
  const holeScoresByCell = new Map<string, HoleScoreShape>();
  for (const [k, v] of fx.input._holeScoresByCellEntries) {
    holeScoresByCell.set(k, v);
  }
  const { _holeScoresByCellEntries: _drop, ...rest } = fx.input;
  return { ...rest, holeScoresByCell } as ComputeIndividualBetInput;
}

const fixtures: Array<{ file: string; label: string }> = [
  { file: 'individual-bet-a-per-hole-1-round.json',  label: '(a) per-hole match, 1 round'      },
  { file: 'individual-bet-b-4-round-aggregate.json', label: '(b) 4-round aggregate'           },
  { file: 'individual-bet-c-auto-press-chain.json',  label: '(c) auto-press chain in 1 round' },
  { file: 'individual-bet-d-tie-round.json',         label: '(d) tied round'                  },
];

describe('computeIndividualBet — golden fixtures', () => {
  for (const { file, label } of fixtures) {
    test(label, () => {
      const fx = loadFixture(file);
      const input = materializeInput(fx);
      const out = computeIndividualBet(input);

      expect(out.netToPlayerACents).toBe(fx.expectedNetToPlayerACents);

      if (fx.expectedTriggeredPresses) {
        expect(out.triggeredPresses).toEqual(fx.expectedTriggeredPresses);
      } else if (fx.expectedTriggeredPressesCount !== undefined) {
        expect(out.triggeredPresses.length).toBe(fx.expectedTriggeredPressesCount);
      }

      // perRound sums to the aggregate.
      const sumPerRound = out.perRound.reduce((acc, r) => acc + r.netToPlayerACents, 0);
      expect(sumPerRound).toBe(out.netToPlayerACents);

      // Every cents value is integer.
      expect(Number.isInteger(out.netToPlayerACents)).toBe(true);
      for (const r of out.perRound) {
        expect(Number.isInteger(r.netToPlayerACents)).toBe(true);
        for (const h of r.perHole) {
          expect(Number.isInteger(h.baseDeltaCents)).toBe(true);
          expect(Number.isInteger(h.pressDeltaCents)).toBe(true);
        }
      }
    });
  }
});

describe('computeIndividualBet — AC-10 deterministic replay', () => {
  test('identical input twice → deep-equal output (no input mutation)', () => {
    const fx = loadFixture('individual-bet-c-auto-press-chain.json');
    const input1 = materializeInput(fx);
    const input2 = materializeInput(fx);
    const out1 = computeIndividualBet(input1);
    const out2 = computeIndividualBet(input2);
    expect(out2).toEqual(out1);
  });
});

describe('computeIndividualBet — AC-5 boundary validation', () => {
  function baseInput(): ComputeIndividualBetInput {
    return {
      bet: {
        id: 'bet-x',
        playerAId: 'A',
        playerBId: 'B',
        betType: 'match_play_per_hole',
        stakePerHoleCents: 500,
        config: {},
      },
      applicableRounds: [],
      holeScoresByCell: new Map(),
      pressesByRound: {},
      handicapIndexByPlayer: { A: 0, B: 0 },
    };
  }

  test('throws on betType not in enum', () => {
    const input = baseInput();
    input.bet.betType = 'bogus' as never;
    expect(() => computeIndividualBet(input)).toThrow(RangeError);
  });

  test('throws on non-positive stakePerHoleCents', () => {
    const input = baseInput();
    input.bet.stakePerHoleCents = 0;
    expect(() => computeIndividualBet(input)).toThrow(RangeError);
  });

  test('throws on non-integer stakePerHoleCents', () => {
    const input = baseInput();
    input.bet.stakePerHoleCents = 500.5;
    expect(() => computeIndividualBet(input)).toThrow(RangeError);
  });

  test('throws when match_play_with_auto_press has no config fields', () => {
    const input = baseInput();
    input.bet.betType = 'match_play_with_auto_press';
    input.bet.config = {};
    expect(() => computeIndividualBet(input)).toThrow(RangeError);
  });

  test('throws on autoPressTriggerAtNDown out of range', () => {
    const input = baseInput();
    input.bet.betType = 'match_play_with_auto_press';
    input.bet.config = { autoPressTriggerAtNDown: 19, pressMultiplier: 2 };
    expect(() => computeIndividualBet(input)).toThrow(RangeError);
  });

  test('throws on duplicate applicableRounds eventRoundId', () => {
    const input = baseInput();
    input.applicableRounds = [
      { roundId: 'r1', eventRoundId: 'er1', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes: [] } },
      { roundId: 'r2', eventRoundId: 'er1', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes: [] } },
    ];
    expect(() => computeIndividualBet(input)).toThrow(/duplicate applicableRounds/);
  });

  test('throws on duplicate applicableRounds roundId', () => {
    const input = baseInput();
    input.applicableRounds = [
      { roundId: 'r1', eventRoundId: 'er1', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes: [] } },
      { roundId: 'r1', eventRoundId: 'er2', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes: [] } },
    ];
    expect(() => computeIndividualBet(input)).toThrow(/duplicate applicableRounds/);
  });

  test('throws on press_fire_row_round_mismatch (key vs firedAtRoundId)', () => {
    const input = baseInput();
    input.pressesByRound = {
      'er1': [{ firedAtRoundId: 'er2', firedAtHole: 5, multiplier: 2, triggerType: 'auto' }],
    };
    expect(() => computeIndividualBet(input)).toThrow(/press_fire_row_round_mismatch/);
  });

  test('throws on non-positive press multiplier', () => {
    const input = baseInput();
    input.pressesByRound = {
      'er1': [{ firedAtRoundId: 'er1', firedAtHole: 5, multiplier: 0, triggerType: 'auto' }],
    };
    expect(() => computeIndividualBet(input)).toThrow(RangeError);
  });

  test('throws on missing handicapIndex', () => {
    const input = baseInput();
    input.applicableRounds = [
      { roundId: 'r1', eventRoundId: 'er1', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes: [{ holeNumber: 1, par: 4, strokeIndex: 1 }] } },
    ];
    input.holeScoresByCell.set('r1|A|1', { grossStrokes: 4, putts: 2 });
    input.holeScoresByCell.set('r1|B|1', { grossStrokes: 5, putts: 2 });
    delete input.handicapIndexByPlayer['A'];
    expect(() => computeIndividualBet(input)).toThrow(/missing handicapIndex/);
  });
});

describe('computeIndividualBet — AC-8b trigger-at-hole-18 no-fire', () => {
  test('A reaches 2-down at hole 18 → no press fires (firedAtHole would be 19)', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      par: 4 as const,
      strokeIndex: ((i * 7) % 18) + 1,
    }));
    const holeScoresByCell = new Map<string, HoleScoreShape>();
    // Holes 1-16: alternate wins → signed delta walks but never reaches -2.
    for (let h = 1; h <= 16; h++) {
      const aGross = h % 2 === 1 ? 4 : 5;
      const bGross = h % 2 === 1 ? 5 : 4;
      holeScoresByCell.set(`r1|A|${h}`, { grossStrokes: aGross, putts: 2 });
      holeScoresByCell.set(`r1|B|${h}`, { grossStrokes: bGross, putts: 2 });
    }
    // Hole 17: B wins → delta = -1.
    holeScoresByCell.set(`r1|A|17`, { grossStrokes: 5, putts: 2 });
    holeScoresByCell.set(`r1|B|17`, { grossStrokes: 4, putts: 2 });
    // Hole 18: B wins → delta = -2, but firedAtHole=19 is suppressed.
    holeScoresByCell.set(`r1|A|18`, { grossStrokes: 5, putts: 2 });
    holeScoresByCell.set(`r1|B|18`, { grossStrokes: 4, putts: 2 });

    const out = computeIndividualBet({
      bet: {
        id: 'bet-h18',
        playerAId: 'A',
        playerBId: 'B',
        betType: 'match_play_with_auto_press',
        stakePerHoleCents: 500,
        config: { autoPressTriggerAtNDown: 2, pressMultiplier: 2 },
      },
      applicableRounds: [
        { roundId: 'r1', eventRoundId: 'er1', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes } },
      ],
      holeScoresByCell,
      pressesByRound: {},
      handicapIndexByPlayer: { A: 0, B: 0 },
    });
    expect(out.triggeredPresses).toEqual([]);
  });
});

describe('computeIndividualBet — AC-9 presses do not carry across rounds', () => {
  test('round 1 fires press at hole 5; round 2 evaluates fresh from hole 1', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      par: 4 as const,
      strokeIndex: ((i * 7) % 18) + 1,
    }));
    const holeScoresByCell = new Map<string, HoleScoreShape>();

    // Round 1 — A goes 2-down at hole 4 (B wins 1-4, A wins rest), press fires at hole 5.
    for (let h = 1; h <= 4; h++) {
      holeScoresByCell.set(`r1|A|${h}`, { grossStrokes: 5, putts: 2 });
      holeScoresByCell.set(`r1|B|${h}`, { grossStrokes: 4, putts: 2 });
    }
    for (let h = 5; h <= 18; h++) {
      holeScoresByCell.set(`r1|A|${h}`, { grossStrokes: 4, putts: 2 });
      holeScoresByCell.set(`r1|B|${h}`, { grossStrokes: 5, putts: 2 });
    }

    // Round 2 — close match, never reaches 2-down. Alternating wins.
    for (let h = 1; h <= 18; h++) {
      const aGross = h % 2 === 1 ? 4 : 5;
      const bGross = h % 2 === 1 ? 5 : 4;
      holeScoresByCell.set(`r2|A|${h}`, { grossStrokes: aGross, putts: 2 });
      holeScoresByCell.set(`r2|B|${h}`, { grossStrokes: bGross, putts: 2 });
    }

    const out = computeIndividualBet({
      bet: {
        id: 'bet-2r',
        playerAId: 'A',
        playerBId: 'B',
        betType: 'match_play_with_auto_press',
        stakePerHoleCents: 500,
        config: { autoPressTriggerAtNDown: 2, pressMultiplier: 2 },
      },
      applicableRounds: [
        { roundId: 'r1', eventRoundId: 'er1', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes } },
        { roundId: 'r2', eventRoundId: 'er2', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes } },
      ],
      holeScoresByCell,
      pressesByRound: {},
      handicapIndexByPlayer: { A: 0, B: 0 },
    });

    // Round 1 fires at least one press (A 2-down at hole 4); compound presses
    // may also fire as A swings ahead within press_1's segment. Round 2 fires
    // ZERO — close-alternating match never reaches ±2 → no triggers carry across.
    const round1Presses = out.triggeredPresses.filter((p) => p.firedAtRoundId === 'er1');
    const round2Presses = out.triggeredPresses.filter((p) => p.firedAtRoundId === 'er2');
    expect(round1Presses.length).toBeGreaterThanOrEqual(1);
    expect(round2Presses.length).toBe(0);
  });
});

describe('computeIndividualBet — idempotent replay (existing press in pressesByRound)', () => {
  test('re-evaluating with the press already in log does not duplicate the trigger', () => {
    const holes = Array.from({ length: 7 }, (_, i) => ({
      holeNumber: i + 1,
      par: 4 as const,
      strokeIndex: i + 1,
    }));
    const holeScoresByCell = new Map<string, HoleScoreShape>();
    // Holes 1-4: A goes 0,-1,-2 (B wins 2-4 / A wins 1) so press fires at hole 5.
    holeScoresByCell.set('r1|A|1', { grossStrokes: 4, putts: 2 });
    holeScoresByCell.set('r1|B|1', { grossStrokes: 5, putts: 2 });
    for (let h = 2; h <= 4; h++) {
      holeScoresByCell.set(`r1|A|${h}`, { grossStrokes: 5, putts: 2 });
      holeScoresByCell.set(`r1|B|${h}`, { grossStrokes: 4, putts: 2 });
    }
    // Holes 5-7: A wins, B halved, A wins → segment delta walks +1, +1, +2 only at hole 7.
    // firedAtHole would be 8 BUT 8 > 7 (segment end). So compound press doesn't fire
    // because the trigger hole (7) is the LAST hole and firedAtHole=8 is out of segment range.
    // Actually firedAtHole=8 is in [1,18] (allowed) — it would fire IF the engine evaluated
    // through hole 8. But our perHoleData only has holes 1-7. The engine's
    // findAutoFiresInSegment walks scoredHoleNumbers. Hole 7 reaches +2 → press fires at hole 8.
    // Hmm, so this WILL compound. Let me make holes 5-7 less swingy.
    // A wins hole 5, hole 6 halved, hole 7 halved → segment delta +1, +1, +1. No compound.
    holeScoresByCell.set('r1|A|5', { grossStrokes: 4, putts: 2 });
    holeScoresByCell.set('r1|B|5', { grossStrokes: 5, putts: 2 });
    holeScoresByCell.set('r1|A|6', { grossStrokes: 4, putts: 2 });
    holeScoresByCell.set('r1|B|6', { grossStrokes: 4, putts: 2 });
    holeScoresByCell.set('r1|A|7', { grossStrokes: 4, putts: 2 });
    holeScoresByCell.set('r1|B|7', { grossStrokes: 4, putts: 2 });

    const out = computeIndividualBet({
      bet: {
        id: 'bet-idemp',
        playerAId: 'A',
        playerBId: 'B',
        betType: 'match_play_with_auto_press',
        stakePerHoleCents: 500,
        config: { autoPressTriggerAtNDown: 2, pressMultiplier: 2 },
      },
      applicableRounds: [
        { roundId: 'r1', eventRoundId: 'er1', course: { tee: { slope: 113, ratingTimes10: 720, coursePar: 72 }, holes } },
      ],
      holeScoresByCell,
      pressesByRound: {
        er1: [
          { id: 'p-existing', firedAtRoundId: 'er1', firedAtHole: 5, multiplier: 2, triggerType: 'auto' },
        ],
      },
      handicapIndexByPlayer: { A: 0, B: 0 },
    });

    // No NEW presses triggered — the one in pressesByRound is preserved (in allPresses)
    // but does not appear in triggeredPresses (filtered by originalKeys).
    expect(out.triggeredPresses).toEqual([]);
  });
});
