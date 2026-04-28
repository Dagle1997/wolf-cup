import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  _resetCacheForTests,
  clearCachedRoundCourse,
  clearCachedRoundDetail,
  readCachedRoundCourse,
  readCachedRoundDetail,
  writeCachedRoundCourse,
  writeCachedRoundDetail,
} from './round-cache.js';

beforeEach(async () => {
  await _resetCacheForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('tournament-round-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe('round-cache', () => {
  test('readCachedRoundDetail returns null on miss', async () => {
    const result = await readCachedRoundDetail('round-X');
    expect(result).toBeNull();
  });

  test('write then read round-trip for round-detail', async () => {
    const detail = {
      roundId: 'r-1',
      state: 'in_progress',
      myFoursome: { foursomeNumber: 1 },
    };
    await writeCachedRoundDetail('r-1', detail);
    const result = await readCachedRoundDetail<typeof detail>('r-1');
    expect(result).toEqual(detail);
  });

  test('write then read round-trip for round-course', async () => {
    const course = {
      roundId: 'r-1',
      holes: [
        { holeNumber: 1, par: 4, si: 1 },
        { holeNumber: 2, par: 5, si: 2 },
      ],
    };
    await writeCachedRoundCourse('r-1', course);
    const result = await readCachedRoundCourse<typeof course>('r-1');
    expect(result).toEqual(course);
  });

  test('clearCachedRoundDetail removes the row', async () => {
    await writeCachedRoundDetail('r-1', { foo: 1 });
    expect(await readCachedRoundDetail('r-1')).not.toBeNull();
    await clearCachedRoundDetail('r-1');
    expect(await readCachedRoundDetail('r-1')).toBeNull();
  });

  test('overwrite-on-write: second write replaces', async () => {
    await writeCachedRoundDetail('r-1', { v: 1 });
    await writeCachedRoundDetail('r-1', { v: 2 });
    const result = await readCachedRoundDetail<{ v: number }>('r-1');
    expect(result).toEqual({ v: 2 });
  });

  test('per-roundId scoping: write to roundA does not affect roundB', async () => {
    await writeCachedRoundDetail('r-A', { name: 'A' });
    await writeCachedRoundDetail('r-B', { name: 'B' });
    expect(await readCachedRoundDetail<{ name: string }>('r-A')).toEqual({
      name: 'A',
    });
    expect(await readCachedRoundDetail<{ name: string }>('r-B')).toEqual({
      name: 'B',
    });
  });

  test('_resetCacheForTests closes the cached DB connection so deleteDatabase can proceed', async () => {
    await writeCachedRoundDetail('r-1', { foo: 1 });
    // Without _resetCacheForTests, the open connection would block delete.
    await _resetCacheForTests();
    // Now indexedDB.deleteDatabase should succeed (no open handle).
    const deleted = await new Promise<boolean>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('tournament-round-cache');
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve(false); // would mean reset failed
    });
    expect(deleted).toBe(true);
    // After delete, fresh read returns null (data is gone).
    expect(await readCachedRoundDetail('r-1')).toBeNull();
  });

  test('clearCachedRoundCourse removes the round-course row', async () => {
    await writeCachedRoundCourse('r-1', { holes: [{ holeNumber: 1 }] });
    expect(await readCachedRoundCourse('r-1')).not.toBeNull();
    await clearCachedRoundCourse('r-1');
    expect(await readCachedRoundCourse('r-1')).toBeNull();
  });
});
