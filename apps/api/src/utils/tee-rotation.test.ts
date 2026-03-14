import { describe, it, expect } from 'vitest';
import { calculateTeeRotation } from './tee-rotation.js';
import type { WeekInput } from './tee-rotation.js';

function makeWeeks(count: number, inactiveIndexes: number[] = []): WeekInput[] {
  // Generate valid Friday dates starting from 2026-04-10 (a Friday)
  const start = new Date('2026-04-10T12:00:00');
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return {
      id: i + 1,
      friday: `${y}-${m}-${day}`,
      isActive: inactiveIndexes.includes(i) ? 0 : 1,
    };
  });
}

describe('calculateTeeRotation', () => {
  it('assigns blue, black, white cycle for 3 active weeks', () => {
    const result = calculateTeeRotation(makeWeeks(3));
    expect(result).toEqual([
      { weekId: 1, tee: 'blue' },
      { weekId: 2, tee: 'black' },
      { weekId: 3, tee: 'white' },
    ]);
  });

  it('cycles correctly for 6 active weeks', () => {
    const result = calculateTeeRotation(makeWeeks(6));
    expect(result.map((r) => r.tee)).toEqual([
      'blue', 'black', 'white', 'blue', 'black', 'white',
    ]);
  });

  it('skips inactive week — tee holds', () => {
    // 4 weeks, week 2 inactive
    const result = calculateTeeRotation(makeWeeks(4, [1]));
    expect(result).toEqual([
      { weekId: 1, tee: 'blue' },
      { weekId: 2, tee: null },
      { weekId: 3, tee: 'black' },
      { weekId: 4, tee: 'white' },
    ]);
  });

  it('handles multiple consecutive skips — tee holds through all', () => {
    // 5 weeks, weeks 2+3 inactive
    const result = calculateTeeRotation(makeWeeks(5, [1, 2]));
    expect(result).toEqual([
      { weekId: 1, tee: 'blue' },
      { weekId: 2, tee: null },
      { weekId: 3, tee: null },
      { weekId: 4, tee: 'black' },
      { weekId: 5, tee: 'white' },
    ]);
  });

  it('returns all null when all weeks are inactive', () => {
    const result = calculateTeeRotation(makeWeeks(3, [0, 1, 2]));
    expect(result).toEqual([
      { weekId: 1, tee: null },
      { weekId: 2, tee: null },
      { weekId: 3, tee: null },
    ]);
  });

  it('assigns blue for a single active week', () => {
    const result = calculateTeeRotation(makeWeeks(1));
    expect(result).toEqual([{ weekId: 1, tee: 'blue' }]);
  });

  it('handles 1 active, 1 skip, 1 active → blue, null, black', () => {
    const result = calculateTeeRotation(makeWeeks(3, [1]));
    expect(result).toEqual([
      { weekId: 1, tee: 'blue' },
      { weekId: 2, tee: null },
      { weekId: 3, tee: 'black' },
    ]);
  });

  it('handles skip at start', () => {
    const result = calculateTeeRotation(makeWeeks(4, [0]));
    expect(result).toEqual([
      { weekId: 1, tee: null },
      { weekId: 2, tee: 'blue' },
      { weekId: 3, tee: 'black' },
      { weekId: 4, tee: 'white' },
    ]);
  });

  it('handles skip at end', () => {
    const result = calculateTeeRotation(makeWeeks(4, [3]));
    expect(result).toEqual([
      { weekId: 1, tee: 'blue' },
      { weekId: 2, tee: 'black' },
      { weekId: 3, tee: 'white' },
      { weekId: 4, tee: null },
    ]);
  });

  it('returns empty array for empty input', () => {
    const result = calculateTeeRotation([]);
    expect(result).toEqual([]);
  });
});
