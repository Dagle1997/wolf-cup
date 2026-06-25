/**
 * Regression test for the lock-handicaps GHIN parse bug (Pete Dye, 2026-06-25):
 * GHIN's handicap_history rows come back PascalCase (`RevDate`/`Value`/`Display`),
 * but the parser read snake_case → every revision dropped → empty history →
 * pickAsOfRevision null → every player locked at a null (scratch) handicap.
 */
import { describe, it, expect } from 'vitest';
import { parseHandicapRevisions } from './ghin-client.js';
import { pickAsOfRevision } from './handicap-lock.js';

describe('parseHandicapRevisions', () => {
  // The exact shape GHIN returns today (captured live from api2.ghin.com).
  const REAL_ROWS = [
    { ID: '764383740', GHINNumber: '1236376', RevDate: '2026-06-20T00:00:00', Display: '16.3', Value: '16.3' },
    { ID: '761823718', GHINNumber: '1236376', RevDate: '2026-06-15T00:00:00', Display: '16.3', Value: '16.3' },
    { ID: '760000001', GHINNumber: '1236376', RevDate: '2026-06-01T00:00:00', Display: '15.9', Value: '15.9' },
  ];

  it('maps GHIN PascalCase rows (RevDate/Value/Display)', () => {
    const out = parseHandicapRevisions(REAL_ROWS);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ revisionDate: '2026-06-20T00:00:00', value: 16.3, displayValue: '16.3' });
  });

  it('feeds pickAsOfRevision correctly — lock as-of a date returns the real index, NOT null', () => {
    const out = parseHandicapRevisions(REAL_ROWS);
    // As of 2026-06-24 → the latest revision ≤ cutoff is 2026-06-20 = 16.3.
    expect(pickAsOfRevision(out, '2026-06-24')?.value).toBe(16.3);
    // As of 2026-06-10 → 2026-06-01 = 15.9.
    expect(pickAsOfRevision(out, '2026-06-10')?.value).toBe(15.9);
  });

  it('plus handicap: Display "+1.3" → negative numeric value', () => {
    const out = parseHandicapRevisions([{ RevDate: '2026-06-20T00:00:00', Display: '+1.3', Value: '-1.3' }]);
    expect(out[0]!.value).toBe(-1.3);
  });

  it('plus handicap from Display alone (Value missing) → negative', () => {
    const out = parseHandicapRevisions([{ RevDate: '2026-06-20T00:00:00', Display: '+2.0' }]);
    expect(out[0]!.value).toBe(-2.0);
  });

  it('accepts the legacy snake_case shape as a fallback', () => {
    const out = parseHandicapRevisions([{ revision_date: '2026-06-20', value: '8.4', display_value: '8.4' }]);
    expect(out[0]).toEqual({ revisionDate: '2026-06-20', value: 8.4, displayValue: '8.4' });
  });

  it('drops rows with no usable date; never throws on junk', () => {
    const out = parseHandicapRevisions([{ Value: '10' }, { RevDate: '', Value: '11' }, { RevDate: '2026-06-20T00:00:00', Value: '12' }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe(12);
  });
});
