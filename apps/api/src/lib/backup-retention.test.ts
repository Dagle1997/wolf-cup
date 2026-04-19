import { describe, it, expect } from 'vitest';
import { planRetention, buildBackupKey } from './backup-retention.js';

function k(date: string, time = '030000'): string {
  return `backups/wolf-cup-${date}-${time}Z.db.gz`;
}

describe('planRetention', () => {
  const today = new Date(Date.UTC(2026, 3, 19)); // 2026-04-19

  it('keeps backups from the last 365 days', () => {
    const keys = [
      k('2026-04-19'),
      k('2026-04-18'),
      k('2025-12-01'),
      k('2025-04-20'), // exactly 364 days back — inside window
    ];
    const { keep, deleteKeys } = planRetention(keys, today);
    expect(keep.sort()).toEqual(keys.sort());
    expect(deleteKeys).toEqual([]);
  });

  it('deletes backups older than 365 days unless monthly anchor', () => {
    const keys = [
      k('2025-04-19'),       // exactly 365 days old — at the cutoff, kept
      k('2025-04-18'),       // 366 days old, not month-1 → delete
      k('2025-03-15'),       // >365 days, not month-1 → delete
      k('2025-03-01'),       // >365 days, month-1 → KEEP (forever anchor)
      k('2024-01-01'),       // ancient month-1 → KEEP
      k('2022-07-15'),       // ancient non-anchor → delete
    ];
    const { keep, deleteKeys } = planRetention(keys, today);
    expect(keep.sort()).toEqual([
      k('2024-01-01'),
      k('2025-03-01'),
      k('2025-04-19'),
    ].sort());
    expect(deleteKeys.sort()).toEqual([
      k('2022-07-15'),
      k('2025-03-15'),
      k('2025-04-18'),
    ].sort());
  });

  it('keeps every 1st-of-month forever regardless of age', () => {
    const keys = [
      k('2015-01-01'),
      k('2018-06-01'),
      k('2020-11-01'),
    ];
    const { keep, deleteKeys } = planRetention(keys, today);
    expect(keep.sort()).toEqual(keys.sort());
    expect(deleteKeys).toEqual([]);
  });

  it('keeps multiple uploads per day when within daily window', () => {
    const keys = [
      k('2026-04-19', '030000'),
      k('2026-04-19', '153000'),
      k('2026-04-19', '220500'),
    ];
    const { keep, deleteKeys } = planRetention(keys, today);
    expect(keep.sort()).toEqual(keys.sort());
    expect(deleteKeys).toEqual([]);
  });

  it('leaves unknown keys alone — never marks them for deletion', () => {
    const keys = [
      k('2026-04-19'),
      'backups/something-random.txt',
      'photos/2026/group.jpg',
      'backups/wolf-cup-manual-export.zip',
    ];
    const { keep, deleteKeys } = planRetention(keys, today);
    expect(keep).toEqual([k('2026-04-19')]);
    expect(deleteKeys).toEqual([]);
  });

  it('ignores keys with invalid calendar dates', () => {
    const keys = [
      k('2026-02-30'), // Feb 30 doesn't exist
      k('2026-13-01'), // month 13
      k('2026-04-19'),
    ];
    const { keep, deleteKeys } = planRetention(keys, today);
    expect(keep).toEqual([k('2026-04-19')]);
    expect(deleteKeys).toEqual([]);
  });

  it('handles empty input', () => {
    expect(planRetention([], today)).toEqual({ keep: [], deleteKeys: [] });
  });
});

describe('buildBackupKey', () => {
  it('produces a lexicographically-sortable UTC key', () => {
    const earlier = buildBackupKey(new Date(Date.UTC(2026, 3, 19, 3, 0, 0)));
    const later = buildBackupKey(new Date(Date.UTC(2026, 3, 19, 15, 30, 45)));
    expect(earlier).toBe('backups/wolf-cup-2026-04-19-030000Z.db.gz');
    expect(later).toBe('backups/wolf-cup-2026-04-19-153045Z.db.gz');
    expect(earlier < later).toBe(true);
  });

  it('zero-pads all components', () => {
    const key = buildBackupKey(new Date(Date.UTC(2026, 0, 3, 1, 2, 3)));
    expect(key).toBe('backups/wolf-cup-2026-01-03-010203Z.db.gz');
  });
});
