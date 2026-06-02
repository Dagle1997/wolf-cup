import { describe, it, expect } from 'vitest';
import { computePairingDiff, type PairingGroup } from './pairing-capture.js';

// Pure, no-IO tests for the diff. serializeGroups + capture (DB IO) are
// covered by the integration test in routes/admin/pairing.test.ts.

/**
 * Self-consistency invariant: every player in `final` is exactly one of
 * unchanged / moved / added, and every player in `generated` is exactly one of
 * unchanged / moved / removed. No player double-counted, none dropped.
 */
function assertSelfConsistent(generated: PairingGroup[], final: PairingGroup[]) {
  const diff = computePairingDiff(generated, final);
  const genIds = generated.flatMap((g) => g.playerIds);
  const finalIds = final.flatMap((g) => g.playerIds);

  const movedIds = new Set(diff.moved.map((m) => m.playerId));
  const addedIds = new Set(diff.added.map((a) => a.playerId));
  const removedIds = new Set(diff.removed.map((r) => r.playerId));

  // No id appears in more than one bucket.
  for (const id of movedIds) {
    expect(addedIds.has(id)).toBe(false);
    expect(removedIds.has(id)).toBe(false);
  }
  for (const id of addedIds) expect(removedIds.has(id)).toBe(false);

  // Partition coverage for final: each final id is unchanged | moved | added.
  for (const id of finalIds) {
    const inGen = genIds.includes(id);
    if (addedIds.has(id)) expect(inGen).toBe(false);
    else expect(movedIds.has(id) || inGen).toBe(true);
  }
  // Partition coverage for generated: each gen id is unchanged | moved | removed.
  for (const id of genIds) {
    const inFinal = finalIds.includes(id);
    if (removedIds.has(id)) expect(inFinal).toBe(false);
    else expect(movedIds.has(id) || inFinal).toBe(true);
  }
}

describe('computePairingDiff', () => {
  it('reports no changes when final matches generated', () => {
    const groups: PairingGroup[] = [
      { groupNumber: 1, playerIds: [1, 2, 3, 4] },
      { groupNumber: 2, playerIds: [5, 6, 7, 8] },
    ];
    const diff = computePairingDiff(groups, groups);
    expect(diff).toEqual({ moved: [], added: [], removed: [] });
    assertSelfConsistent(groups, groups);
  });

  it('detects a moved player with correct from/to groups', () => {
    const generated: PairingGroup[] = [
      { groupNumber: 1, playerIds: [1, 2, 3, 4] },
      { groupNumber: 2, playerIds: [5, 6, 7, 8] },
    ];
    const final: PairingGroup[] = [
      { groupNumber: 1, playerIds: [2, 3, 4] },
      { groupNumber: 2, playerIds: [5, 6, 7, 8, 1] },
    ];
    const diff = computePairingDiff(generated, final);
    expect(diff.moved).toEqual([{ playerId: 1, fromGroup: 1, toGroup: 2 }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    assertSelfConsistent(generated, final);
  });

  it('detects a sub swap as removed + added (AC4)', () => {
    const generated: PairingGroup[] = [{ groupNumber: 1, playerIds: [1, 2, 3, 4] }];
    // player 4 replaced by sub 99 in the same group
    const final: PairingGroup[] = [{ groupNumber: 1, playerIds: [1, 2, 3, 99] }];
    const diff = computePairingDiff(generated, final);
    expect(diff.removed).toEqual([{ playerId: 4, fromGroup: 1 }]);
    expect(diff.added).toEqual([{ playerId: 99, toGroup: 1 }]);
    expect(diff.moved).toEqual([]);
    assertSelfConsistent(generated, final);
  });

  it('handles remove + add to the SAME group (AC12)', () => {
    const generated: PairingGroup[] = [
      { groupNumber: 1, playerIds: [1, 2, 3, 4] },
      { groupNumber: 2, playerIds: [5, 6, 7, 8] },
    ];
    const final: PairingGroup[] = [
      { groupNumber: 1, playerIds: [1, 2, 3, 50] }, // 4 removed, 50 added
      { groupNumber: 2, playerIds: [5, 6, 7, 8] },
    ];
    const diff = computePairingDiff(generated, final);
    expect(diff.removed).toContainEqual({ playerId: 4, fromGroup: 1 });
    expect(diff.added).toContainEqual({ playerId: 50, toGroup: 1 });
    expect(diff.moved).toEqual([]);
    assertSelfConsistent(generated, final);
  });

  it('resolves a group-count change without error (AC10)', () => {
    // Generated had 3 groups; final has 2 (group 3 dissolved, players moved up).
    const generated: PairingGroup[] = [
      { groupNumber: 1, playerIds: [1, 2, 3, 4] },
      { groupNumber: 2, playerIds: [5, 6, 7, 8] },
      { groupNumber: 3, playerIds: [9, 10, 11, 12] },
    ];
    const final: PairingGroup[] = [
      { groupNumber: 1, playerIds: [1, 2, 3, 4, 9, 10] },
      { groupNumber: 2, playerIds: [5, 6, 7, 8, 11, 12] },
    ];
    const diff = computePairingDiff(generated, final);
    expect(diff.moved).toContainEqual({ playerId: 9, fromGroup: 3, toGroup: 1 });
    expect(diff.moved).toContainEqual({ playerId: 10, fromGroup: 3, toGroup: 1 });
    expect(diff.moved).toContainEqual({ playerId: 11, fromGroup: 3, toGroup: 2 });
    expect(diff.moved).toContainEqual({ playerId: 12, fromGroup: 3, toGroup: 2 });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    assertSelfConsistent(generated, final);
  });

  it('handles a non-multiple-of-4 final (player removed, no sub added)', () => {
    const generated: PairingGroup[] = [{ groupNumber: 1, playerIds: [1, 2, 3, 4] }];
    const final: PairingGroup[] = [{ groupNumber: 1, playerIds: [1, 2, 3] }];
    const diff = computePairingDiff(generated, final);
    expect(diff.removed).toEqual([{ playerId: 4, fromGroup: 1 }]);
    expect(diff.added).toEqual([]);
    expect(diff.moved).toEqual([]);
    assertSelfConsistent(generated, final);
  });
});
