import { describe, expect, test } from 'vitest';
import { isEligibleScorer, isScorerPolicy } from './scorer-eligibility.js';

const ORG = 'org';
const M1 = 'm1';
const M2 = 'm2';
const CADDIE = 'caddie';
const OUTSIDER = 'outsider';
const foursome = [M1, M2];

describe('isScorerPolicy', () => {
  test('accepts the three policies, rejects others', () => {
    expect(isScorerPolicy('foursome')).toBe(true);
    expect(isScorerPolicy('designated')).toBe(true);
    expect(isScorerPolicy('open')).toBe(true);
    expect(isScorerPolicy('nope')).toBe(false);
    expect(isScorerPolicy(undefined)).toBe(false);
  });
});

describe('isEligibleScorer', () => {
  test('organizer is always eligible under every policy', () => {
    for (const policy of ['foursome', 'designated', 'open'] as const) {
      expect(
        isEligibleScorer({
          policy,
          designatedIds: [],
          foursomeMemberIds: foursome,
          organizerPlayerId: ORG,
          candidateId: ORG,
        }),
      ).toBe(true);
    }
  });

  test("'foursome' = members only (reproduces pre-T13-4 isMember||isOrganizer)", () => {
    const base = { policy: 'foursome' as const, designatedIds: [CADDIE], foursomeMemberIds: foursome, organizerPlayerId: ORG };
    expect(isEligibleScorer({ ...base, candidateId: M1 })).toBe(true);
    expect(isEligibleScorer({ ...base, candidateId: CADDIE })).toBe(false); // designee pool ignored
    expect(isEligibleScorer({ ...base, candidateId: OUTSIDER })).toBe(false);
  });

  test("'designated' = the pool (+organizer); a caddie in the pool qualifies, a member not in it does not", () => {
    const base = { policy: 'designated' as const, designatedIds: new Set([CADDIE]), foursomeMemberIds: foursome, organizerPlayerId: ORG };
    expect(isEligibleScorer({ ...base, candidateId: CADDIE })).toBe(true);
    expect(isEligibleScorer({ ...base, candidateId: M1 })).toBe(false); // foursome membership doesn't help under designated
    expect(isEligibleScorer({ ...base, candidateId: OUTSIDER })).toBe(false);
  });

  test("'open' = any participant; a non-participant id is rejected", () => {
    const base = { policy: 'open' as const, designatedIds: [], foursomeMemberIds: foursome, organizerPlayerId: ORG };
    expect(isEligibleScorer({ ...base, candidateId: OUTSIDER, candidateIsParticipant: true })).toBe(true);
    expect(isEligibleScorer({ ...base, candidateId: OUTSIDER, candidateIsParticipant: false })).toBe(false);
  });
});
