import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  _resetDbForTests,
  _resetTerminalErrorsForTests,
  enqueueMutation,
  getQueue,
  getQueueCount,
  registerTerminalErrors,
  type EnqueueInput,
} from '../lib/offline-queue.js';
import { useOfflineQueue } from './useOfflineQueue.js';

const ROUND = 'r-test';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  await _resetDbForTests();
  _resetTerminalErrorsForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('tournament-offline');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function entry(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    kind: 'hole_score',
    url: '/api/test/score',
    body: { hole: 1, gross: 4 },
    clientEventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    roundId: ROUND,
    ...overrides,
  };
}

describe('useOfflineQueue — drain semantics', () => {
  test('200 response → entry purged, pendingCount decrements to 0', async () => {
    await enqueueMutation(entry());
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => {
      await result.current.drain();
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(await getQueueCount(ROUND)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('409 response → entry retained with conflictPending, CustomEvent fires, drain CONTINUES to next entry', async () => {
    await enqueueMutation(entry({ clientEventId: 'evt-conflict' }));
    await enqueueMutation(entry({ clientEventId: 'evt-ok' }));

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, { code: 'CELL_TAKEN' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const eventListener = vi.fn();
    window.addEventListener('tournament-offline-queue-conflict', eventListener);

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(2));

    await act(async () => {
      await result.current.drain();
    });

    expect(eventListener).toHaveBeenCalledTimes(1);
    const evt = eventListener.mock.calls[0]![0] as CustomEvent;
    expect(evt.detail).toMatchObject({
      clientEventId: 'evt-conflict',
      kind: 'hole_score',
      response: { status: 409, body: { code: 'CELL_TAKEN' } },
    });

    // Conflict entry retained with conflictPending; ok entry purged.
    const survivors = await getQueue(ROUND);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.clientEventId).toBe('evt-conflict');
    expect(survivors[0]!.conflictPending).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    window.removeEventListener('tournament-offline-queue-conflict', eventListener);
  });

  test('transient 4xx on entry 1 of 3 → drain CONTINUES; entries 2-3 POSTed; entry 1 retryCount = 1', async () => {
    await enqueueMutation(entry({ clientEventId: 'evt-1' }));
    await enqueueMutation(entry({ clientEventId: 'evt-2' }));
    await enqueueMutation(entry({ clientEventId: 'evt-3' }));

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { code: 'UNKNOWN' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(3));

    await act(async () => {
      await result.current.drain();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const survivors = await getQueue(ROUND);
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.clientEventId).toBe('evt-1');
    expect(survivors[0]!.retryCount).toBe(1);
  });

  test('5xx on entry 1 of 3 → drain BREAKs; entries 2-3 NOT POSTed', async () => {
    // The heartbeat setTimeout that re-triggers drain is verified by code
    // review + the airplane-mode drill (T5.10); fake timers + renderHook
    // interact poorly with React's act/microtask flush, so we test BREAK
    // semantics here and leave heartbeat firing for integration coverage.
    await enqueueMutation(entry({ clientEventId: 'evt-1' }));
    await enqueueMutation(entry({ clientEventId: 'evt-2' }));
    await enqueueMutation(entry({ clientEventId: 'evt-3' }));

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 'BUSY' }));

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(3));

    await act(async () => {
      await result.current.drain();
    });

    // BREAK: only entry 1 was attempted; entries 2-3 not POSTed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getQueueCount(ROUND)).toBe(3);
    // Entry 1's retryCount is NOT incremented (5xx is not a transient-4xx).
    const survivors = await getQueue(ROUND);
    expect(survivors[0]!.retryCount).toBe(0);
  });

  test('universal failsafe: same entry hits 4xx 5 times → 5th attempt purges + failsafe-purged event fires', async () => {
    // Entry stays at retryCount=4 after 4 failed attempts; the 5th attempt
    // increments to 5 → purge + event.
    await enqueueMutation(entry({ clientEventId: 'evt-failsafe' }));

    const fetchMock = vi.mocked(fetch);
    // 5 transient 4xx responses (no terminal-allowlist match).
    for (let i = 0; i < 5; i++) {
      fetchMock.mockResolvedValueOnce(jsonResponse(400, { code: 'UNKNOWN' }));
    }

    const failsafeListener = vi.fn();
    window.addEventListener(
      'tournament-offline-queue-failsafe-purged',
      failsafeListener,
    );

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    // 5 sequential drain calls. Each drains the queue (1 entry) and applies
    // one transient-4xx attempt. After call 5, the entry is purged.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await result.current.drain();
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(await getQueueCount(ROUND)).toBe(0);
    expect(failsafeListener).toHaveBeenCalledTimes(1);
    const evt = failsafeListener.mock.calls[0]![0] as CustomEvent;
    expect(evt.detail).toMatchObject({
      clientEventId: 'evt-failsafe',
      kind: 'hole_score',
      retryCount: 5,
    });

    window.removeEventListener(
      'tournament-offline-queue-failsafe-purged',
      failsafeListener,
    );
  });
});

describe('useOfflineQueue — auto-drain on window online event', () => {
  test("dispatched 'online' event triggers drain", async () => {
    await enqueueMutation(entry({ clientEventId: 'evt-online' }));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      // Allow the async drain triggered by the event to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(0));
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('useOfflineQueue — corrupted-entry quarantine', () => {
  test('entry with undefined kind in IDB is quarantined on drain', async () => {
    // Insert a malformed row directly into IDB (bypass enqueue's validation).
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tournament-offline', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('mutation-queue')) {
          db.createObjectStore('mutation-queue', {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
        if (!db.objectStoreNames.contains('mutation-queue-errored')) {
          db.createObjectStore('mutation-queue-errored', {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('mutation-queue', 'readwrite');
        tx.objectStore('mutation-queue').add({
          // missing `kind` — corrupted shape
          url: '/api/test',
          body: { x: 1 },
          clientEventId: 'evt-corrupt',
          roundId: ROUND,
          timestamp: Date.now(),
          retryCount: 0,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
    });

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => {
      await result.current.drain();
    });

    expect(await getQueueCount(ROUND)).toBe(0);
    // Verify the row landed in mutation-queue-errored.
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

describe('useOfflineQueue — terminal-error registry interaction', () => {
  test('registered terminal code → entry purged on first 4xx (no retryCount increment)', async () => {
    registerTerminalErrors('hole_score', ['ROUND_FINALIZED']);
    await enqueueMutation(entry({ clientEventId: 'evt-terminal' }));

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { code: 'ROUND_FINALIZED' }),
    );

    const { result } = renderHook(() => useOfflineQueue(ROUND));
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => {
      await result.current.drain();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getQueueCount(ROUND)).toBe(0);
  });
});
