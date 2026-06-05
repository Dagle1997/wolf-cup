export interface SideGameRotationInput {
  id: number;
}

export interface WeekRotationInput {
  friday: string;
  isActive: number; // 0 or 1
}

export interface SideGameRotationAssignment {
  gameId: number;
  fridays: string[];
}

/**
 * Calculate side-game → Friday assignments for a season.
 *
 * Companion to calculateTeeRotation: the rotation is anchored to the ACTIVE
 * Fridays. Games are taken in id order (creation order = original rotation
 * slot). Each active Friday hosts exactly one game, cycling through the games
 * in order; an inactive (skipped / rained-out) week drops out of the active
 * list, so every later week shifts back one slot — the same "hold" behavior
 * tees get from calculateTeeRotation.
 *
 * game[gameIdx] is assigned the active Fridays where
 *   activeIndex % games.length === gameIdx
 *
 * This is the exact assignment `POST .../side-games/initialize` makes at
 * season start; recomputing it on a week toggle keeps the rotation correct
 * after a rainout without any manual shifting.
 */
export function calculateSideGameRotation(
  games: SideGameRotationInput[],
  weeks: WeekRotationInput[],
): SideGameRotationAssignment[] {
  const orderedGames = [...games].sort((a, b) => a.id - b.id);
  const n = orderedGames.length;
  const activeFridays = weeks
    .filter((w) => w.isActive === 1)
    .map((w) => w.friday)
    .sort(); // ISO dates sort chronologically

  return orderedGames.map((game, gameIdx) => ({
    gameId: game.id,
    fridays:
      n === 0
        ? []
        : activeFridays.filter((_, activeIdx) => activeIdx % n === gameIdx),
  }));
}
