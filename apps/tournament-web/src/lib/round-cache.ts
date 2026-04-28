/* T5-4 round-cache lib. GREENFIELD — no Wolf Cup analogue exists.
 *
 * Wolf Cup uses vite-plugin-pwa workbox for static assets only; the
 * runtime /api/* cache was REMOVED in commit 67238a2 (the score-entry
 * SW kill memory). T5-4 ships fresh: an IDB-backed cache for the
 * round-detail (T5-2 GET response) + round-course (T5-4 GET response)
 * payloads, keyed by roundId.
 *
 * Two object stores in a NEW database `tournament-round-cache`
 * (separate from T5-3's `tournament-offline` mutation queue — different
 * lifecycles, different gc semantics).
 *
 * Cache-aside pattern: every successful network fetch overwrites the
 * cache. Stale data on disk is never served when the network succeeds.
 * Offline-only path: cache is the source of truth. The route's
 * `fetchOrCacheRoundDetail` / `fetchOrCacheRoundCourse` queryFns own
 * the read-then-write ordering (load-bearing for the course-superseded
 * banner — must read cached BEFORE writing fresh).
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'tournament-round-cache';
const DETAIL_STORE = 'round-detail';
const COURSE_STORE = 'round-course';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DETAIL_STORE)) {
          db.createObjectStore(DETAIL_STORE);
        }
        if (!db.objectStoreNames.contains(COURSE_STORE)) {
          db.createObjectStore(COURSE_STORE);
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// round-detail (T5-2 GET response)
// ---------------------------------------------------------------------------

/**
 * Read returns null on cache-miss OR malformed deserialization (caught
 * + console.warn). Consumers treat null as "no cached value" — same
 * branch as a truly absent key.
 */
export async function readCachedRoundDetail<T = unknown>(
  roundId: string,
): Promise<T | null> {
  try {
    const db = await getDB();
    const value = await db.get(DETAIL_STORE, roundId);
    if (value === undefined) return null;
    return value as T;
  } catch (err) {
    console.warn('readCachedRoundDetail: malformed cache entry', err);
    return null;
  }
}

export async function writeCachedRoundDetail<T>(
  roundId: string,
  data: T,
): Promise<void> {
  const db = await getDB();
  await db.put(DETAIL_STORE, data, roundId);
}

export async function clearCachedRoundDetail(roundId: string): Promise<void> {
  const db = await getDB();
  await db.delete(DETAIL_STORE, roundId);
}

// ---------------------------------------------------------------------------
// round-course (T5-4 GET response)
// ---------------------------------------------------------------------------

export async function readCachedRoundCourse<T = unknown>(
  roundId: string,
): Promise<T | null> {
  try {
    const db = await getDB();
    const value = await db.get(COURSE_STORE, roundId);
    if (value === undefined) return null;
    return value as T;
  } catch (err) {
    console.warn('readCachedRoundCourse: malformed cache entry', err);
    return null;
  }
}

export async function writeCachedRoundCourse<T>(
  roundId: string,
  data: T,
): Promise<void> {
  const db = await getDB();
  await db.put(COURSE_STORE, data, roundId);
}

export async function clearCachedRoundCourse(roundId: string): Promise<void> {
  const db = await getDB();
  await db.delete(COURSE_STORE, roundId);
}

// ---------------------------------------------------------------------------
// Test-only helpers (NODE_ENV/VITEST guarded)
// ---------------------------------------------------------------------------

/**
 * Test-only: close the cached DB connection so a subsequent
 * indexedDB.deleteDatabase call can complete (open connections block
 * deletes). Mirrors the T5-3 offline-queue pattern.
 */
export async function _resetCacheForTests(): Promise<void> {
  if (typeof process === 'undefined') {
    throw new Error('_resetCacheForTests is test-only (no process in browser)');
  }
  if (
    process.env['NODE_ENV'] !== 'test' &&
    process.env['VITEST'] !== 'true'
  ) {
    throw new Error('_resetCacheForTests is test-only');
  }
  if (dbPromise !== null) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Already closed; nothing to clean up.
    }
    dbPromise = null;
  }
}
