import { describe, it, expect } from 'vitest';
import { getFridaysInRange } from './fridays.js';

describe('getFridaysInRange', () => {
  it('returns all Fridays from April 10, 2026 to August 28, 2026 (hard-coded validation)', () => {
    const result = getFridaysInRange('2026-04-10', '2026-08-28');
    const expected = [
      '2026-04-10',
      '2026-04-17',
      '2026-04-24',
      '2026-05-01',
      '2026-05-08',
      '2026-05-15',
      '2026-05-22',
      '2026-05-29',
      '2026-06-05',
      '2026-06-12',
      '2026-06-19',
      '2026-06-26',
      '2026-07-03',
      '2026-07-10',
      '2026-07-17',
      '2026-07-24',
      '2026-07-31',
      '2026-08-07',
      '2026-08-14',
      '2026-08-21',
      '2026-08-28',
    ];
    expect(result).toEqual(expected);
    expect(result.length).toBe(21);
  });

  it('returns 1 Friday when start === end (same Friday)', () => {
    const result = getFridaysInRange('2026-04-10', '2026-04-10');
    expect(result).toEqual(['2026-04-10']);
  });

  it('throws when start date is not a Friday', () => {
    expect(() => getFridaysInRange('2026-04-11', '2026-08-28')).toThrow(
      'Start date must be a Friday',
    );
  });

  it('throws when end date is not a Friday', () => {
    expect(() => getFridaysInRange('2026-04-10', '2026-08-27')).toThrow(
      'End date must be a Friday',
    );
  });

  it('throws when start date is after end date', () => {
    expect(() => getFridaysInRange('2026-08-28', '2026-04-10')).toThrow(
      'Start date must be before or equal to end date',
    );
  });

  it('both boundaries are inclusive', () => {
    const result = getFridaysInRange('2026-04-10', '2026-04-17');
    expect(result).toEqual(['2026-04-10', '2026-04-17']);
  });
});
