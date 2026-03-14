import type { Tee } from '@wolf-cup/engine';

const TEE_CYCLE: Tee[] = ['blue', 'black', 'white'];

export interface WeekInput {
  id: number;
  friday: string;
  isActive: number; // 0 or 1
}

export interface TeeAssignment {
  weekId: number;
  tee: Tee | null;
}

/**
 * Calculate tee rotation assignments for season weeks.
 *
 * Rules:
 * - Active weeks cycle through blue → black → white → blue...
 * - Inactive (skipped) weeks get null tee and do NOT advance the rotation
 * - Cancelled rounds still have their week active, so rotation advances naturally
 */
export function calculateTeeRotation(weeks: WeekInput[]): TeeAssignment[] {
  let rotationIndex = 0;
  return weeks.map((week) => {
    if (week.isActive === 0) {
      return { weekId: week.id, tee: null };
    }
    const tee = TEE_CYCLE[rotationIndex % 3]!;
    rotationIndex++;
    return { weekId: week.id, tee };
  });
}
