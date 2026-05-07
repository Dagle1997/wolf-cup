/**
 * T6-11 skins engine tests.
 *
 * Covers the AC fixtures: 3 modes × 3 scenarios + gross_beats_net edges +
 * remainder distribution + boundary validation.
 */
import { describe, expect, test } from 'vitest';
import {
  calcSkins,
  type CalcSkinsInput,
  type CourseShape,
  type HoleScoresByPlayer,
} from './skins.js';

const NEUTRAL_TEE = { slope: 113, ratingTimes10: 720, coursePar: 72 };

function course18ParAllFour(): CourseShape {
  return {
    tee: NEUTRAL_TEE,
    holes: Array.from({ length: 18 }, (_, i) => ({
      holeNumber: i + 1,
      par: 4 as const,
      strokeIndex: ((i * 7) % 18) + 1,
    })),
  };
}

function buildScores(
  scores: Record<string, Array<number | null>>,
): HoleScoresByPlayer {
  const map = new Map<string, number | null>();
  for (const [pid, holes] of Object.entries(scores)) {
    holes.forEach((g, i) => {
      map.set(`${pid}|${i + 1}`, g);
    });
  }
  return map;
}

function defaultInput(overrides: Partial<CalcSkinsInput> = {}): CalcSkinsInput {
  return {
    holeScores: buildScores({}),
    mode: 'gross',
    participants: ['A', 'B', 'C', 'D'],
    buyInPerParticipantCents: 1000,  // $10 each → $40 pot
    lastHoleUnclaimedResolution: 'split-among-winners',
    course: course18ParAllFour(),
    handicapsByPlayer: { A: 0, B: 0, C: 0, D: 0 },
    ...overrides,
  };
}

describe('calcSkins — gross mode', () => {
  test('(a) gross single-winner-per-hole, zero carries', () => {
    // A wins every hole at gross 3; B/C/D all 4.
    const out = calcSkins(
      defaultInput({
        holeScores: buildScores({
          A: Array(18).fill(3),
          B: Array(18).fill(4),
          C: Array(18).fill(4),
          D: Array(18).fill(4),
        }),
      }),
    );
    // Pot = 4 × $10 = 4000 cents. basePerHole = floor(4000/18) = 222.
    // Remainder = 4000 - 222*18 = 4000 - 3996 = 4. First-winner gets +4.
    expect(out.totalPotCents).toBe(4000);
    expect(out.holeWinners.every((hw) => hw.winnerId === 'A')).toBe(true);
    expect(out.carries.length).toBe(0);
    // A has the full pot (all skins won + remainder).
    expect(out.potShares.length).toBe(1);
    expect(out.potShares[0]!.playerId).toBe('A');
    expect(out.potShares[0]!.dollarsCents).toBe(4000);
  });

  test('(b) 3-hole carry chain with eventual winner', () => {
    // Hole 1: tied (carry); Hole 2: tied (carry); Hole 3: tied (carry); Hole 4: A wins (collects 4 skins worth).
    // Holes 5-18: A wins (single-winner each).
    const scores = {
      A: [4, 4, 4, 3, ...Array(14).fill(3)],
      B: [4, 4, 4, 4, ...Array(14).fill(4)],
      C: [4, 4, 4, 4, ...Array(14).fill(4)],
      D: [4, 4, 4, 4, ...Array(14).fill(4)],
    };
    const out = calcSkins(
      defaultInput({ holeScores: buildScores(scores) }),
    );
    // Holes 1-3 tied → no winner; carry to next.
    expect(out.holeWinners[0]!.winnerId).toBe(null);
    expect(out.holeWinners[1]!.winnerId).toBe(null);
    expect(out.holeWinners[2]!.winnerId).toBe(null);
    // Hole 4 winner = A; carriedFromHoles should reflect 1, 2, 3.
    expect(out.holeWinners[3]!.winnerId).toBe('A');
    expect(out.holeWinners[3]!.carriedFromHoles).toEqual([1, 2, 3]);
    // Skin value at hole 4 = 4 × basePerHole.
    expect(out.holeWinners[3]!.skinValueCents).toBe(222 * 4);
    // 3 carry records.
    expect(out.carries.length).toBe(3);
  });

  test('(c) last-hole unclaimed split-among-winners with carries left over', () => {
    // A wins hole 1; holes 2-18 all tied → never claimed.
    // Total pot = 4000, A wins 1 skin (basePerHole 222) at hole 1. After hole 18,
    // 17 holes of carry remain unclaimed. With 'split-among-winners', the
    // unclaimed pot splits among all winners (just A) → A gets remaining.
    const out = calcSkins(
      defaultInput({
        holeScores: buildScores({
          A: [3, ...Array(17).fill(4)],
          B: Array(18).fill(4),
          C: Array(18).fill(4),
          D: Array(18).fill(4),
        }),
      }),
    );
    // A is the only winner → A gets entire pot.
    expect(out.potShares.length).toBe(1);
    expect(out.potShares[0]!.playerId).toBe('A');
    expect(out.potShares[0]!.dollarsCents).toBe(4000);
  });
});

describe('calcSkins — net mode', () => {
  test('(d) net winner determined by net score after handicap strokes', () => {
    // Player B has 9 HI → gets 1 stroke on SI 1..9 holes.
    // Hole 1 has SI 8 (((1-1)*7)%18 + 1 = 1). Wait let me check: i=0 → ((0*7)%18)+1 = 1. So hole 1 = SI 1.
    // B has HI 9 → stroke on SI 1..9. B gets stroke on hole 1.
    // Gross: A=4, B=4 (+1 stroke handicap, net=3); B's net (3) lower → B wins.
    const out = calcSkins(
      defaultInput({
        mode: 'net',
        holeScores: buildScores({
          A: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
          B: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
          C: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
          D: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
        }),
        handicapsByPlayer: { A: 0, B: 9, C: 0, D: 0 },
      }),
    );
    // B gets a stroke on holes with SI 1..9. Course holes at SI 1..9: ((i*7)%18)+1 sequence.
    // For i=0 → SI=1 ✓, i=1 → SI=8, i=2 → SI=15, i=3 → SI=4, etc.
    // On holes where B gets a stroke, B's net is 3 (vs A's 4 net) → B wins.
    // On holes where B doesn't get a stroke, A and B tie at gross/net 4 → tie carry.
    // So we expect SOME holes won by B and the rest tied.
    const bWins = out.holeWinners.filter((h) => h.winnerId === 'B');
    expect(bWins.length).toBeGreaterThan(0);
  });
});

describe('calcSkins — gross_beats_net mode', () => {
  test('(e) gross_beats_net: unique gross winner takes skin (net irrelevant)', () => {
    // A has gross 3 alone; B has gross 4 with HI 9 → net 3.
    // gross_beats_net: A's unique gross 3 → A wins (net is not consulted).
    const out = calcSkins(
      defaultInput({
        mode: 'gross_beats_net',
        holeScores: buildScores({
          A: [3, ...Array(17).fill(4)],
          B: [4, ...Array(17).fill(4)],
          C: [5, ...Array(17).fill(5)],
          D: [5, ...Array(17).fill(5)],
        }),
        handicapsByPlayer: { A: 0, B: 9, C: 0, D: 0 },
      }),
    );
    expect(out.holeWinners[0]!.winnerId).toBe('A');
  });

  test('(f) gross_beats_net: gross tied → falls through to unique net winner', () => {
    // A gross 4, B gross 4 (tied). B has HI 9 → stroke on hole 1 (SI 1).
    // B's net = 3, A's net = 4 → unique net winner = B.
    const out = calcSkins(
      defaultInput({
        mode: 'gross_beats_net',
        holeScores: buildScores({
          A: [4, ...Array(17).fill(4)],
          B: [4, ...Array(17).fill(4)],
          C: [5, ...Array(17).fill(5)],
          D: [5, ...Array(17).fill(5)],
        }),
        handicapsByPlayer: { A: 0, B: 9, C: 0, D: 0 },
      }),
    );
    expect(out.holeWinners[0]!.winnerId).toBe('B');
  });

  test('(g) gross_beats_net: both gross AND net tied → carry', () => {
    // A and B both gross 4, both HI 0 → both net 4. C and D higher.
    // Result: tied gross AND tied net → no winner; carry.
    const out = calcSkins(
      defaultInput({
        mode: 'gross_beats_net',
        holeScores: buildScores({
          A: [4, ...Array(17).fill(4)],
          B: [4, ...Array(17).fill(5)],  // hole 1 tie with A
          C: [5, ...Array(17).fill(6)],
          D: [5, ...Array(17).fill(6)],
        }),
      }),
    );
    expect(out.holeWinners[0]!.winnerId).toBe(null);
  });
});

describe('calcSkins — last-hole resolutions', () => {
  test('carry-to-next-round emits sentinel pot share', () => {
    // No winners at all (everyone ties every hole).
    const out = calcSkins(
      defaultInput({
        lastHoleUnclaimedResolution: 'carry-to-next-round',
        holeScores: buildScores({
          A: Array(18).fill(4),
          B: Array(18).fill(4),
          C: Array(18).fill(4),
          D: Array(18).fill(4),
        }),
      }),
    );
    // No winners → pot accumulated → carries to next round as sentinel.
    const sentinel = out.potShares.find((ps) => ps.playerId === null);
    expect(sentinel).toBeDefined();
    expect(sentinel!.note).toBe('carried_to_next_round');
    expect(sentinel!.dollarsCents).toBe(4000);
  });

  test('split-among-winners with no winners → splits equally among all participants', () => {
    const out = calcSkins(
      defaultInput({
        lastHoleUnclaimedResolution: 'split-among-winners',
        holeScores: buildScores({
          A: Array(18).fill(4),
          B: Array(18).fill(4),
          C: Array(18).fill(4),
          D: Array(18).fill(4),
        }),
      }),
    );
    // No winners → 4000 cents / 4 = 1000 cents each.
    expect(out.potShares.length).toBe(4);
    for (const ps of out.potShares) {
      expect(ps.dollarsCents).toBe(1000);
    }
  });
});

describe('calcSkins — boundary validation', () => {
  test('throws on invalid mode', () => {
    expect(() =>
      calcSkins(defaultInput({ mode: 'bogus' as never })),
    ).toThrow(RangeError);
  });

  test('throws on negative buyInPerParticipantCents', () => {
    expect(() =>
      calcSkins(defaultInput({ buyInPerParticipantCents: -1 })),
    ).toThrow(RangeError);
  });

  test('throws on missing handicap', () => {
    expect(() =>
      calcSkins(
        defaultInput({
          handicapsByPlayer: { A: 0, B: 0, C: 0 /* D missing */ },
        }),
      ),
    ).toThrow(/missing handicap/);
  });

  test('empty participants → empty output (no throw)', () => {
    const out = calcSkins(defaultInput({ participants: [] }));
    expect(out.totalPotCents).toBe(0);
    expect(out.holeWinners).toEqual([]);
  });
});

describe('calcSkins — integer-cents discipline', () => {
  test('every potShare value is integer; total awarded equals totalPotCents', () => {
    const out = calcSkins(
      defaultInput({
        // Awkward pot: 5 participants × $1.03 buy-in = 515 cents pot.
        // 515 / 18 = 28.6... → basePerHole = 28; remainder = 515 - 28*18 = 515 - 504 = 11.
        participants: ['A', 'B', 'C', 'D', 'E'],
        buyInPerParticipantCents: 103,
        handicapsByPlayer: { A: 0, B: 0, C: 0, D: 0, E: 0 },
        holeScores: buildScores({
          A: Array(18).fill(3),
          B: Array(18).fill(4),
          C: Array(18).fill(4),
          D: Array(18).fill(4),
          E: Array(18).fill(4),
        }),
      }),
    );
    expect(out.totalPotCents).toBe(515);
    let sum = 0;
    for (const ps of out.potShares) {
      expect(Number.isInteger(ps.dollarsCents)).toBe(true);
      sum += ps.dollarsCents;
    }
    expect(sum).toBe(515);
  });
});

describe('calcSkins — per-player tee override (teeByPlayer)', () => {
  test('net mode: high-slope override flips ties → outright wins on stroke-index holes', () => {
    // Setup: A (HI 18) shoots 4 every hole; B (HI 0) shoots 3 every hole.
    // Course par 72, neutral tee slope 113 → A's CH = 18 → exactly 1 stroke
    // per hole. Net: A=3, B=3 → all 18 holes tie (carry chain → split pot).
    const baseHoleScores = buildScores({
      A: Array(18).fill(4),
      B: Array(18).fill(3),
    });
    const baseline = calcSkins(
      defaultInput({
        mode: 'net',
        participants: ['A', 'B'],
        buyInPerParticipantCents: 100,
        handicapsByPlayer: { A: 18, B: 0 },
        holeScores: baseHoleScores,
      }),
    );
    // All baseline winners are null (ties).
    expect(baseline.holeWinners.every((hw) => hw.winnerId === null)).toBe(true);

    // Override: A plays a much higher-slope tee → CH = round(18 × 155/113) = 25.
    // 25 strokes across 18 holes = 2 strokes on stroke-index 1–7, 1 stroke
    // on 8–18. On the 7 double-stroke holes A's net=2 < B's net=3 → A wins.
    // On the other 11 single-stroke holes nets stay 3 vs 3 → still tied.
    const override = calcSkins(
      defaultInput({
        mode: 'net',
        participants: ['A', 'B'],
        buyInPerParticipantCents: 100,
        handicapsByPlayer: { A: 18, B: 0 },
        holeScores: baseHoleScores,
        teeByPlayer: { A: { slope: 155, ratingTimes10: 720, coursePar: 72 } },
      }),
    );
    const aWins = override.holeWinners.filter((hw) => hw.winnerId === 'A');
    expect(aWins.length).toBe(7);
    // Sanity: same scores in baseline but no outright winners.
    expect(baseline.holeWinners.filter((hw) => hw.winnerId === 'A').length).toBe(0);
  });

  test('gross mode: teeByPlayer is ignored (no calcCourseHandicap call), result identical', () => {
    const grossInput = defaultInput({
      mode: 'gross',
      handicapsByPlayer: { A: 18, B: 0, C: 0, D: 0 },
      holeScores: buildScores({
        A: Array(18).fill(3),
        B: Array(18).fill(4),
        C: Array(18).fill(4),
        D: Array(18).fill(4),
      }),
    });
    const baseline = calcSkins(grossInput);
    const withOverride = calcSkins({
      ...grossInput,
      teeByPlayer: { A: { slope: 155, ratingTimes10: 720, coursePar: 72 } },
    });
    expect(withOverride).toEqual(baseline);
  });
});
