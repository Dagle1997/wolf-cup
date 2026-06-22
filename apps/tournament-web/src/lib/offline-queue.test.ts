import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  _resetDbForTests,
  _resetTerminalErrorsForTests,
  enqueueMutation,
  getQueue,
  getQueueCount,
  getTerminalErrors,
  purgeOrphanedEntries,
  quarantineEntry,
  registerTerminalErrors,
  removeFromQueue,
  resolveConflict,
  updateEntry,
  type EnqueueInput,
} from './offline-queue.js';

beforeEach(async () => {
  // Close any cached DB BEFORE deleting (fake-indexeddb blocks deletes
  // against open connections). _resetDbForTests is async + closes.
  await _resetDbForTests();
  _resetTerminalErrorsForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('tournament-offline');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

function baseEntry(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    kind: 'hole_score',
    url: '/api/test/score',
    body: { foo: 'bar' },
    clientEventId: 'evt-default',
    roundId: 'r-1',
    ...overrides,
  };
}

describe('offline-queue — enqueue + getQueue + FIFO order', () => {
  test('3 enqueues → getQueue returns in id ASC order', async () => {
    await enqueueMutation(baseEntry({ clientEventId: 'evt-1' }));
    await enqueueMutation(baseEntry({ clientEventId: 'evt-2' }));
    await enqueueMutation(baseEntry({ clientEventId: 'evt-3' }));
    const rows = await getQueue('r-1');
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.clientEventId)).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(rows[0]!.id).toBeLessThan(rows[1]!.id!);
    expect(rows[1]!.id).toBeLessThan(rows[2]!.id!);
  });
});

describe('offline-queue — enqueue validation', () => {
  test('rejects with explicit Error when clientEventId is empty', async () => {
    await expect(
      enqueueMutation(baseEntry({ clientEventId: '' })),
    ).rejects.toThrow(/clientEventId is required/);
  });

  test("rejects when kind is outside the 4-value union", async () => {
    await expect(
      enqueueMutation(baseEntry({ kind: 'wolf_decision' as unknown as 'hole_score' })),
    ).rejects.toThrow(/invalid kind/);
  });

  test('rejects when url is empty', async () => {
    await expect(enqueueMutation(baseEntry({ url: '' }))).rejects.toThrow(
      /url is required/,
    );
  });

  test('rejects when body is undefined', async () => {
    await expect(
      enqueueMutation(baseEntry({ body: undefined })),
    ).rejects.toThrow(/body is required/);
  });
});

describe('offline-queue — claim kind (Story 2.1)', () => {
  test("accepts kind='claim' (the two-place union+set change)", async () => {
    await enqueueMutation(
      baseEntry({
        kind: 'claim',
        url: '/api/rounds/r-1/claims',
        body: { playerId: 'p1', holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'c-set' },
        clientEventId: 'c-set',
      }),
    );
    const rows = await getQueue('r-1');
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe('claim');
  });

  test('a set and a remove are DISTINCT queued mutations (removal is queued, not client-only)', async () => {
    await enqueueMutation(
      baseEntry({
        kind: 'claim',
        url: '/api/rounds/r-1/claims',
        body: { playerId: 'p1', holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'c-set' },
        clientEventId: 'c-set',
      }),
    );
    await enqueueMutation(
      baseEntry({
        kind: 'claim',
        url: '/api/rounds/r-1/claims',
        body: { playerId: 'p1', holeNumber: 7, claimType: 'greenie', op: 'remove', clientEventId: 'c-rm' },
        clientEventId: 'c-rm',
      }),
    );
    const rows = await getQueue('r-1');
    expect(rows.length).toBe(2);
    expect(rows.map((r) => (r.body as { op: string }).op)).toEqual(['set', 'remove']);
  });
});

describe('offline-queue — resolveConflict overwrite validation', () => {
  test("'overwrite' rejects when overwriteBody is undefined", async () => {
    await enqueueMutation(baseEntry({ clientEventId: 'evt-r' }));
    const [row] = await getQueue('r-1');
    // @ts-expect-error — testing the runtime guard with intentional misuse
    await expect(resolveConflict(row!.id!, 'overwrite')).rejects.toThrow(
      /requires a non-undefined overwriteBody/,
    );
  });
});

describe('offline-queue — getQueueCount', () => {
  test('scoped by roundId returns count', async () => {
    await enqueueMutation(baseEntry({ roundId: 'r-1', clientEventId: 'a' }));
    await enqueueMutation(baseEntry({ roundId: 'r-1', clientEventId: 'b' }));
    await enqueueMutation(baseEntry({ roundId: 'r-2', clientEventId: 'c' }));
    expect(await getQueueCount('r-1')).toBe(2);
    expect(await getQueueCount('r-2')).toBe(1);
    expect(await getQueueCount('r-9')).toBe(0);
  });
});

describe('offline-queue — purgeOrphanedEntries', () => {
  test('removes entries for other rounds and returns count removed', async () => {
    await enqueueMutation(baseEntry({ roundId: 'r-1', clientEventId: 'a' }));
    await enqueueMutation(baseEntry({ roundId: 'r-2', clientEventId: 'b' }));
    await enqueueMutation(baseEntry({ roundId: 'r-3', clientEventId: 'c' }));
    const removed = await purgeOrphanedEntries('r-1');
    expect(removed).toBe(2);
    const survivors = await getQueue();
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.roundId).toBe('r-1');
  });
});

describe('offline-queue — quarantineEntry', () => {
  test('moves the row from mutation-queue to mutation-queue-errored atomically', async () => {
    await enqueueMutation(baseEntry({ clientEventId: 'evt-q' }));
    const [row] = await getQueue('r-1');
    expect(row).toBeDefined();
    await quarantineEntry(row!.id!);
    expect(await getQueueCount('r-1')).toBe(0);
    // Verify the errored store has 1 row directly via raw IDB.
    const erroredCount = await new Promise<number>((resolve, reject) => {
      const req = indexedDB.open('tournament-offline');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('mutation-queue-errored', 'readonly');
        const countReq = tx.objectStore('mutation-queue-errored').count();
        countReq.onsuccess = () => {
          db.close();
          resolve(countReq.result);
        };
        countReq.onerror = () => {
          db.close();
          reject(countReq.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
    expect(erroredCount).toBe(1);
  });
});

describe('offline-queue — resolveConflict', () => {
  test("'discard' purges the entry", async () => {
    await enqueueMutation(baseEntry({ clientEventId: 'evt-d' }));
    const [row] = await getQueue('r-1');
    await resolveConflict(row!.id!, 'discard');
    expect(await getQueueCount('r-1')).toBe(0);
  });

  test("'overwrite' replaces body, clears conflictPending, resets retryCount", async () => {
    await enqueueMutation(baseEntry({ clientEventId: 'evt-o' }));
    const [row] = await getQueue('r-1');
    // Simulate a 409 retention state.
    await updateEntry(row!.id!, {
      conflictPending: true,
      retryCount: 3,
      lastError: { status: 409, body: { code: 'CELL_TAKEN' } },
    });
    const newBody = { fresh: true, ts: 999 };
    await resolveConflict(row!.id!, 'overwrite', newBody);
    const [updated] = await getQueue('r-1');
    expect(updated!.body).toEqual(newBody);
    expect(updated!.conflictPending).toBe(false);
    expect(updated!.retryCount).toBe(0);
    expect(updated!.lastError).toBeNull();
  });
});

describe('offline-queue — terminal-error registry round-trip', () => {
  test('register then read returns the registered codes per kind', () => {
    expect(getTerminalErrors('hole_score')).toEqual([]);
    registerTerminalErrors('hole_score', ['ROUND_FINALIZED', 'INVALID_SCORES']);
    expect(getTerminalErrors('hole_score')).toEqual([
      'ROUND_FINALIZED',
      'INVALID_SCORES',
    ]);
    // Re-registering replaces.
    registerTerminalErrors('hole_score', ['NEW_CODE']);
    expect(getTerminalErrors('hole_score')).toEqual(['NEW_CODE']);
    // Other kinds unaffected.
    expect(getTerminalErrors('round_finalize')).toEqual([]);
  });

  test('mutating the original codes array does NOT affect the registry (snapshot semantics)', () => {
    const codes: string[] = ['CODE_A', 'CODE_B'];
    registerTerminalErrors('hole_score', codes);
    // Mutate the original — registry should not change.
    codes.push('CODE_C');
    codes[0] = 'MUTATED';
    expect(getTerminalErrors('hole_score')).toEqual(['CODE_A', 'CODE_B']);
  });
});

describe('offline-queue — removeFromQueue', () => {
  test('removes the row by id', async () => {
    await enqueueMutation(baseEntry({ clientEventId: 'evt-rm' }));
    const [row] = await getQueue('r-1');
    await removeFromQueue(row!.id!);
    expect(await getQueueCount('r-1')).toBe(0);
  });
});
