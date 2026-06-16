import { describe, expect, it } from 'vitest';
import { pickAsOfRevision, isIsoDate, type Revision } from './handicap-lock.js';

describe('pickAsOfRevision', () => {
  it('picks the latest revision on/before the cutoff', () => {
    const revs: Revision[] = [
      { revisionDate: '2026-05-01', value: 9.1 },
      { revisionDate: '2026-06-01', value: 8.4 },
      { revisionDate: '2026-06-15', value: 7.9 },
    ];
    expect(pickAsOfRevision(revs, '2026-06-10')!.value).toBe(8.4);
  });

  it('includes a revision dated exactly on the cutoff', () => {
    const revs: Revision[] = [
      { revisionDate: '2026-06-01', value: 8.4 },
      { revisionDate: '2026-06-10', value: 8.0 },
    ];
    expect(pickAsOfRevision(revs, '2026-06-10')!.value).toBe(8.0);
  });

  it('returns null when every revision is after the cutoff', () => {
    const revs: Revision[] = [
      { revisionDate: '2026-07-01', value: 8.4 },
      { revisionDate: '2026-08-01', value: 8.0 },
    ];
    expect(pickAsOfRevision(revs, '2026-06-10')).toBeNull();
  });

  it('skips revisions with a null value', () => {
    const revs: Revision[] = [
      { revisionDate: '2026-06-01', value: 8.4 },
      { revisionDate: '2026-06-09', value: null }, // latest but unusable
    ];
    const got = pickAsOfRevision(revs, '2026-06-10');
    expect(got!.value).toBe(8.4);
    expect(got!.revisionDate).toBe('2026-06-01');
  });

  it('returns null for an empty history', () => {
    expect(pickAsOfRevision([], '2026-06-10')).toBeNull();
  });

  it('tolerates ISO datetime strings (slices to the day)', () => {
    const revs: Revision[] = [
      { revisionDate: '2026-06-01T12:00:00Z', value: 8.4 },
      { revisionDate: '2026-06-10T08:30:00Z', value: 8.0 },
    ];
    expect(pickAsOfRevision(revs, '2026-06-10')!.value).toBe(8.0);
  });

  it('keeps the chronologically-latest even if it appears earlier in the array', () => {
    const revs: Revision[] = [
      { revisionDate: '2026-06-09', value: 8.0 }, // latest, listed first (GHIN newest-first)
      { revisionDate: '2026-06-01', value: 8.4 },
    ];
    expect(pickAsOfRevision(revs, '2026-06-10')!.value).toBe(8.0);
  });
});

describe('isIsoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isIsoDate('2026-06-15')).toBe(true);
  });

  it('rejects non-strings', () => {
    expect(isIsoDate(20260615)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it('rejects malformed dates', () => {
    expect(isIsoDate('2026-6-15')).toBe(false);
    expect(isIsoDate('06/15/2026')).toBe(false);
    expect(isIsoDate('2026-06-15T00:00:00Z')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});
