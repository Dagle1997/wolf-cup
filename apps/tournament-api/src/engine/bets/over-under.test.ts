/**
 * Over/Under settlement tests. One subject + a strokes line:
 *   under (side A) wins if total < line; over (side B) wins if total > line;
 *   on the line exactly → push. Winner-take-stake between STAKEHOLDERS.
 */
import { describe, expect, test } from 'vitest';
import { settleBet } from './index.js';
import type { BetDef, H2hInput } from './types.js';

const SUBJECT = 'subject-player';
const UNDER_BACKER = 'under-backer'; // side A stakeholder
const OVER_BACKER = 'over-backer'; // side B stakeholder

function betDef(line: number | null, stakeCents = 5000): BetDef {
  return {
    id: 'bet-ou-1',
    betType: 'over_under',
    basis: 'gross',
    holeScope: 'full18',
    stakeCents,
    scopedHoles: [1, 2, 3],
    line,
    // Both sides carry the SAME subject; A backs under, B backs over.
    sides: [
      { side: 'A', stakeholderPlayerId: UNDER_BACKER, subjectPlayerId: SUBJECT },
      { side: 'B', stakeholderPlayerId: OVER_BACKER, subjectPlayerId: SUBJECT },
    ],
  };
}

function input(line: number | null, perHole: Array<number | null>): H2hInput {
  return { bet: betDef(line), netPerHoleBySubject: { [SUBJECT]: perHole } };
}

describe('settleOverUnder', () => {
  test('UNDER wins: total below the line → over-backer pays under-backer the stake', () => {
    // total = 3+4+3 = 10, line 12 → under wins (side A).
    const out = settleBet(input(12, [3, 4, 3]));
    expect(out.state).toBe('settled');
    expect(out.result.winnerSide).toBe('A');
    expect(out.result.winnerSubjectId).toBe(SUBJECT);
    expect(out.result.marginNet).toBe(2);
    expect(out.edges).toEqual([
      { fromPlayerId: OVER_BACKER, toPlayerId: UNDER_BACKER, cents: 5000, sourceBetId: 'bet-ou-1', sourceType: 'over_under' },
    ]);
  });

  test('OVER wins: total above the line → under-backer pays over-backer the stake', () => {
    // total = 5+5+5 = 15, line 12 → over wins (side B).
    const out = settleBet(input(12, [5, 5, 5]));
    expect(out.state).toBe('settled');
    expect(out.result.winnerSide).toBe('B');
    expect(out.result.marginNet).toBe(3);
    expect(out.edges).toEqual([
      { fromPlayerId: UNDER_BACKER, toPlayerId: OVER_BACKER, cents: 5000, sourceBetId: 'bet-ou-1', sourceType: 'over_under' },
    ]);
  });

  test('PUSH: total exactly on the line → no money moves', () => {
    // total = 4+4+4 = 12, line 12 → push.
    const out = settleBet(input(12, [4, 4, 4]));
    expect(out.state).toBe('push');
    expect(out.edges).toEqual([]);
  });

  test('PROVISIONAL: an unscored hole → never settles on partial data', () => {
    const out = settleBet(input(12, [4, null, 4]));
    expect(out.state).toBe('provisional');
    expect(out.edges).toEqual([]);
  });

  test('UNSUPPORTED: an over_under with no line fails loud (never banks $0/push)', () => {
    const out = settleBet(input(null, [4, 4, 4]));
    expect(out.state).toBe('unsupported');
    expect(out.edges).toEqual([]);
  });
});
