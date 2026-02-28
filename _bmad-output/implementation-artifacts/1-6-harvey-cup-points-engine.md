# Story 1.6: Harvey Cup Points Engine

Status: done

## Story

As a league member,
I want Harvey Cup points calculated from my finish rank across all players in the round,
So that standings accurately reflect relative performance each week.

## Acceptance Criteria

1. **Given** all players' Stableford totals and money totals for a completed round
   **When** `calculateHarveyPoints(players)` is called with an array of N player inputs
   **Then** each player receives Harvey Cup points for their Stableford rank and money rank per the rank-based formula (N points for 1st, N−1 for 2nd, …, 1 point for last)
   **And** rankings are computed across all N players in the input (league-wide, not per-group)

2. **Given** two players tie for 2nd place in Stableford out of 4 players
   **When** Harvey points are calculated
   **Then** both tied players receive (3 + 2) / 2 = 2.5 points each
   **And** the sum of all Stableford Harvey points equals 10 (= 4×5/2)

3. **Given** 16 active players with no ties
   **When** `calculateHarveyPoints` runs
   **Then** the sum of all Stableford Harvey points equals 136 (= 16×17/2)
   **And** the sum of all money Harvey points also equals 136

4. **Given** any combination of ties across any N players
   **When** Harvey points are calculated
   **Then** the total distributed points in each category always equals N×(N+1)/2
   **And** `validateHarveyTotal` confirms this invariant and throws `HarveySumViolationError` if violated

5. **Given** a 3-way tie for 1st place out of 4 players
   **When** Harvey points are calculated
   **Then** all three tied players each receive (4 + 3 + 2) / 3 = 3.0 points
   **And** 4th place receives 1 point
   **And** total is 3×3.0 + 1 = 10 = 4×5/2 ✓

## Tasks / Subtasks

- [x] Task 1: Add Harvey Cup types to `types.ts` (AC: 1–5)
  - [x] 1.1 Add `HarveyRoundInput` type: `{ readonly stableford: number; readonly money: number; }`
  - [x] 1.2 Add `HarveyRoundResult` type: `{ readonly stablefordPoints: number; readonly moneyPoints: number; }`
  - [x] 1.3 Add `HarveySumViolationError` class (extends Error, with `category: 'stableford' | 'money'`, `actualSum: number`, `expectedSum: number`)

- [x] Task 2: Write failing tests in `harvey.test.ts` (AC: 1–5)
  - [x] 2.1 No-tie N=4: stableford scores [10,8,6,4] → points [4,3,2,1]
  - [x] 2.2 No-tie N=4: money scores [-3,-1,1,3] → points [1,2,3,4] (highest money = best rank)
  - [x] 2.3 2-way tie for 2nd/3rd (N=4): tied players each get 2.5; 1st gets 4; 4th gets 1; sum=10
  - [x] 2.4 3-way tie for 1st (N=4): each gets 3.0; 4th gets 1; sum=10
  - [x] 2.5 4-way all-tie (N=4): everyone gets 2.5; sum=10
  - [x] 2.6 2-way tie for last (N=4): tied players each get 1.5; 1st gets 4; 2nd gets 3; sum=10
  - [x] 2.7 N=16 no-tie: 1st gets 16, 16th gets 1, sum=136
  - [x] 2.8 N=16 with 2-way tie for 3rd/4th: sum still = 136
  - [x] 2.9 N=8 no-tie: 1st gets 8, 8th gets 1, sum=36
  - [x] 2.10 Both categories computed independently: player who ranks 1st in Stableford ranks 3rd in money → correct different points per category
  - [x] 2.11 All-zero scores (N=4): each player gets 2.5; sum=10
  - [x] 2.12 N=1 edge case: single player gets 1 point; sum=1
  - [x] 2.13 validateHarveyTotal does not throw for valid results
  - [x] 2.14 validateHarveyTotal throws HarveySumViolationError (stableford) for stableford sum ≠ expected
  - [x] 2.15 validateHarveyTotal throws HarveySumViolationError (money) for money sum ≠ expected
  - [x] 2.16 HarveySumViolationError.actualSum and .expectedSum are correct on the thrown error

- [x] Task 3: Implement `calculateHarveyPoints` in `harvey.ts` (AC: 1–5)
  - [x] 3.1 Internal `rankScores(scores: readonly number[]): readonly number[]` — assigns Harvey points per player index using rank-based formula with half-point tie splits
  - [x] 3.2 Algorithm: sort indices descending by score; group tied scores; assign average of the rank-points they span; map back to original indices
  - [x] 3.3 Call `rankScores` independently for `stableford` and `money` arrays
  - [x] 3.4 Call `validateHarveyTotal` on the assembled results before returning

- [x] Task 4: Add `validateHarveyTotal` to `validation.ts` (AC: 4)
  - [x] 4.1 Signature: `validateHarveyTotal(results: readonly HarveyRoundResult[], playerCount: number): void`
  - [x] 4.2 Expected sum = `playerCount × (playerCount + 1) / 2`
  - [x] 4.3 Sum `stablefordPoints` across all results; throw `HarveySumViolationError` if not equal to expected
  - [x] 4.4 Sum `moneyPoints` across all results; throw `HarveySumViolationError` if not equal to expected

- [x] Task 5: Run full test suite (AC: all)
  - [x] 5.1 `pnpm --filter @wolf-cup/engine exec vitest run` — all 372 tests pass (349 previous + 23 new harvey tests)
  - [x] 5.2 `pnpm --filter @wolf-cup/engine typecheck` — zero errors
  - [x] 5.3 `pnpm -r lint` — zero warnings

## Dev Notes

### Harvey Cup Formula — Confirmed

**Regular rounds (Story 1.6 scope only — Story 1.7 adds best-10-of-N and playoff multipliers):**

| Rule | Detail |
|---|---|
| Ranking scope | League-wide across all groups — NOT per-foursome |
| Categories | Stableford points and money balance are ranked independently |
| Formula | Rank 1 (best) = N pts; Rank N (worst) = 1 pt; i.e., `points = N + 1 − position` |
| Tie rule | Averaged adjacent rank-points → half-point (0.5) splits |
| Sum invariant | Per category: `sum = N×(N+1)/2` (e.g., N=16 → 136, N=8 → 36, N=4 → 10) |

**Tie averaging walkthrough (N=4, scores [10, 8, 8, 5]):**

| Step | Detail |
|---|---|
| Point table | pos 1→4 pts, pos 2→3 pts, pos 3→2 pts, pos 4→1 pt |
| Sorted desc | [10(idx0), 8(idx1), 8(idx2), 5(idx3)] |
| Group score=10 | spans pos [1] → avg=4.0; assign idx0=4.0 |
| Group score=8 | spans pos [2,3] → avg=(3+2)/2=2.5; assign idx1=2.5, idx2=2.5 |
| Group score=5 | spans pos [4] → avg=1.0; assign idx3=1.0 |
| Result | [4.0, 2.5, 2.5, 1.0]; sum=10 ✓ |

**Common N values in Wolf Cup:**
- Regular season: 8–20 (league has ~16 full members + subs)
- Playoff Round of 8: 8 players
- Playoff Round of 4: 4 players

### New Types (add to `types.ts`)

```typescript
/** One player's round totals fed into Harvey Cup calculation */
export type HarveyRoundInput = {
  /** Player's total Stableford points for the round */
  readonly stableford: number;
  /** Player's net money balance for the round (whole dollars; negative = net loss) */
  readonly money: number;
};

/** Harvey Cup points awarded to one player from a single round */
export type HarveyRoundResult = {
  /** Harvey points for Stableford rank — may be x.5 for tie splits */
  readonly stablefordPoints: number;
  /** Harvey points for money rank — may be x.5 for tie splits */
  readonly moneyPoints: number;
};

/** Thrown when Harvey Cup point totals violate the expected sum invariant */
export class HarveySumViolationError extends Error {
  constructor(
    public readonly category: 'stableford' | 'money',
    public readonly actualSum: number,
    public readonly expectedSum: number,
  ) {
    super(
      `Harvey Cup sum violation in '${category}' category: expected ${expectedSum}, got ${actualSum}`,
    );
    this.name = 'HarveySumViolationError';
  }
}
```

### Function Signatures

**`harvey.ts` (replace stub `export {}`):**
```typescript
import type { HarveyRoundInput, HarveyRoundResult } from './types.js';
import { validateHarveyTotal } from './validation.js';

/**
 * Computes rank-based Harvey Cup points for all players in a round.
 *
 * Points per category: rank 1 (best) = N pts; rank N (worst) = 1 pt.
 * Ties are resolved by averaging the rank-points occupied (half-point splits).
 * Both categories (Stableford and money) are ranked independently.
 *
 * @throws {HarveySumViolationError} if internal sum invariant is violated
 */
export function calculateHarveyPoints(
  players: readonly HarveyRoundInput[],
): readonly HarveyRoundResult[]
```

**`validation.ts` (add):**
```typescript
import type { HarveyRoundResult } from './types.js';
import { HarveySumViolationError } from './types.js';

/**
 * Validates that Harvey Cup point totals equal N×(N+1)/2 for each category.
 *
 * @throws {HarveySumViolationError} if either category sum is wrong
 */
export function validateHarveyTotal(
  results: readonly HarveyRoundResult[],
  playerCount: number,
): void
```

### Ranking Algorithm Detail (Internal to `harvey.ts`)

```
function rankScores(scores: readonly number[]): readonly number[]

Steps:
1. N = scores.length
2. Create array of [score, originalIndex] pairs
3. Sort descending by score
4. Walk through sorted array, group consecutive equal scores
5. For each group of size k spanning positions [p, p+1, ..., p+k-1]:
   - groupPoints = sum of (N+1−pos) for pos in [p..p+k-1] / k
   - Assign groupPoints to all original indices in this group
6. Return points indexed by original position
```

Note: positions are 1-indexed in the formula; implementation uses 0-indexed with `(N − i)` where `i` is 0-indexed sorted position.

**Floating-point note:** The only half-point value that can appear is `x.5` (average of two consecutive integers, or average of odd-count spans). No precision issues with IEEE-754 for values in realistic range (1–20 players, half-points).

### Project Structure Notes

**Files to create/modify:**
- **Modify:** `packages/engine/src/types.ts` — append `HarveyRoundInput`, `HarveyRoundResult`, `HarveySumViolationError` after the existing `ZeroSumViolationError`
- **Modify:** `packages/engine/src/harvey.ts` — replace the stub `export {}` with full implementation
- **Modify:** `packages/engine/src/validation.ts` — add `validateHarveyTotal` function
- **Create:** `packages/engine/src/harvey.test.ts` — all Harvey tests

**No changes needed:**
- `index.ts` — already exports `'./harvey.js'` ✓
- `stableford.ts`, `wolf.ts`, `course.ts`, `money.ts`, `bonuses.ts` — do not touch
- `validation.test.ts` — do not touch (harvey tests go in `harvey.test.ts`)

### TypeScript Strictness Reminders

- `noUncheckedIndexedAccess: true` — never directly index arrays without guards; use `for...of`, `map`, or explicit undefined checks
- `exactOptionalPropertyTypes: true` — no optional fields in these types (all required)
- `globals: false` in Vitest — always `import { describe, it, expect } from 'vitest'`
- `.js` extension on all local imports — `import { ... } from './types.js'` etc.

### Previous Story Learnings (1.1–1.5)

- `ALL_POSITIONS` pattern used in money.ts/bonuses.ts — `rankScores` will need its own `for...of` iteration approach
- `validateZeroSum` is called at the boundary of `applyBonusModifiers` before returning — follow same pattern: call `validateHarveyTotal` at the boundary of `calculateHarveyPoints`
- Test file goes in `packages/engine/src/` alongside the source
- harvey.ts is currently a stub (`// Harvey Cup points engine — implemented in Story 1.6+\nexport {}`) — replace entirely

### References

- FR4: System ranks all players by Stableford and money position [Source: epics.md]
- FR5: Harvey Cup points per player per category using rank-based formula scaled to active player count [Source: epics.md]
- FR6: Half-point tie splits — averaged adjacent rank values; total still matches expected [Source: epics.md]
- NFR5: League-wide ranks across all groups, not per-group [Source: epics.md]
- NFR6: Total Harvey Cup points per category per round must equal mathematically expected total for active player count [Source: epics.md]
- NFR7: Ties produce correct averaged half-point splits such that total still matches expected [Source: epics.md]
- Architecture: `harvey.ts` — FR4–FR8 (Story 1.6 covers FR4–FR6) [Source: architecture.md]
- Architecture: Harvey Cup points stored as floats (e.g., 2.5 for tie splits) [Source: architecture.md]
- Architecture: `validation.ts` — zero-sum checks AND Harvey Cup total integrity checks [Source: architecture.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented `rankScores` internal helper using sort + group-span averaging; handles all tie configurations correctly with exact half-point splits
- `calculateHarveyPoints` ranks Stableford and money independently; calls `validateHarveyTotal` before returning
- `validateHarveyTotal` added to `validation.ts`; checks both categories against N×(N+1)/2 expected sum
- `HarveySumViolationError` stores `category`, `actualSum`, and `expectedSum` for precise error reporting
- 23 new tests in `harvey.test.ts`: no-tie baselines (N=1,2,4,8,16), 2-way/3-way/4-way ties, both-category independence, negative money ranks, validateHarveyTotal throw/no-throw
- 375/375 tests passing after code review fixes; typecheck clean; lint clean; zero regressions
- Code review fixes: added `results.length !== playerCount` guard to `validateHarveyTotal`; added N=0, N=20, and length-mismatch tests; fixed misleading "tied 3rd=3rd" comment → "tied 3rd/4th"

### File List

- `packages/engine/src/types.ts` — added `HarveyRoundInput`, `HarveyRoundResult`, `HarveySumViolationError`
- `packages/engine/src/harvey.ts` — replaced stub with full `calculateHarveyPoints` + internal `rankScores`
- `packages/engine/src/validation.ts` — added `validateHarveyTotal`
- `packages/engine/src/harvey.test.ts` — created (23 tests)
