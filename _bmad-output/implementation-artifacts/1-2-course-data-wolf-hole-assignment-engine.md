# Story 1.2: Course Data & Wolf Hole Assignment Engine

Status: done

## Story

As a scorer,
I want wolf hole assignments determined automatically from the ball draw batting order,
So that the correct player is identified as wolf on every hole without manual tracking.

## Acceptance Criteria

1. **Given** any of the four batting positions and hole number 1–18, **When** `getWolfAssignment(battingOrder, holeNumber)` is called, **Then** holes 1–2 return `{ type: 'skins' }` regardless of batting order **And** holes 3–18 return the correct wolf player per the fixed assignment table (Batter 1: holes 3,6,9,14 / Batter 2: holes 4,7,10,16 / Batter 3: holes 5,11,12,17 / Batter 4: holes 8,13,15,18) **And** the function is pure — identical inputs always return identical output.

2. **Given** any valid hole number 1–18, **When** `getCourseHole(holeNumber)` is called, **Then** it returns the correct par, handicap stroke index, and tee yardages for that hole at Guyan G&CC **And** an invalid hole number throws a typed `InvalidHoleError`.

## Tasks / Subtasks

- [x] Task 1: Add domain types to `src/types.ts` (AC: 1, 2)
  - [x] 1.1 Add `HoleNumber` branded type (1–18)
  - [x] 1.2 Add `BattingPosition` type (0 | 1 | 2 | 3)
  - [x] 1.3 Add `BattingOrder` type (4-tuple of player identifiers)
  - [x] 1.4 Add `SkinsHoleAssignment` and `WolfHoleAssignment` union type
  - [x] 1.5 Add `CourseHole` type with par, strokeIndex, yardages
  - [x] 1.6 Add `InvalidHoleError` typed error class
  - [x] 1.7 Remove the `Placeholder = never` stub from types.ts

- [x] Task 2: Implement `src/wolf.ts` (AC: 1)
  - [x] 2.1 Write failing tests in `src/wolf.test.ts` covering all 18 holes × 4 batting positions, plus edge cases
  - [x] 2.2 Implement `getWolfAssignment(battingOrder, holeNumber)` with hardcoded assignment table
  - [x] 2.3 Verify all tests pass

- [x] Task 3: Implement `src/course.ts` (AC: 2)
  - [x] 3.1 Write failing tests in `src/course.test.ts` for all 18 holes and `InvalidHoleError`
  - [x] 3.2 Hardcode Guyan G&CC 18-hole data (par, stroke index, blue/white/gold/red yardages)
  - [x] 3.3 Implement `getCourseHole(holeNumber)` throwing `InvalidHoleError` on invalid input
  - [x] 3.4 Verify all tests pass

- [x] Task 4: Export from index and run full suite (AC: 1, 2)
  - [x] 4.1 Verify `src/index.ts` already re-exports `wolf.js` and `course.js` (it does — stubs in place)
  - [x] 4.2 Run `pnpm --filter @wolf-cup/engine test` — all tests pass
  - [x] 4.3 Run `pnpm --filter @wolf-cup/engine typecheck` — zero errors

## Dev Notes

### Previous Story Learnings (from Story 1.1)

- **`.js` extension required on all relative imports** — NodeNext module resolution. `import { foo } from './foo.js'` even though source is `.ts`.
- **`noUncheckedIndexedAccess: true` is active** — array index access returns `T | undefined`. Use `const val = arr[i]; if (val === undefined) throw ...` pattern or use `Map` lookups instead of array index.
- **`exactOptionalPropertyTypes: true` is active** — be precise with optional properties.
- **Vitest 2.x, not Jest** — `describe`, `it`, `expect` imported from `'vitest'`. No globals (globals: false in vitest config).
- **Engine is `"type": "module"`** — all files are ESM.
- **Test files go in `src/`** — e.g., `src/wolf.test.ts`, `src/course.test.ts`. The vitest config covers `src/**/*`.
- **`export {}` stubs** in wolf.ts, course.ts, etc. must be replaced (not just augmented).

### Types Design (`src/types.ts`)

Replace the entire file with proper domain types. All types used in Story 1.2:

```ts
// Branded type for hole numbers — prevents passing arbitrary numbers
export type HoleNumber = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18;

// Position in the ball draw batting order (0 = first drawn, 3 = last drawn)
export type BattingPosition = 0 | 1 | 2 | 3;

// Four player IDs in batting draw order — generic to avoid coupling to DB layer
export type BattingOrder<TPlayerId = string> = [TPlayerId, TPlayerId, TPlayerId, TPlayerId];

// Wolf hole assignment result
export type SkinsHoleAssignment = { readonly type: 'skins' };
export type WolfHoleAssignment = {
  readonly type: 'wolf';
  readonly wolfBatterIndex: BattingPosition; // which position in battingOrder is wolf
};
export type HoleAssignment = SkinsHoleAssignment | WolfHoleAssignment;

// Tee yardages at Guyan G&CC
export type TeeYardages = {
  readonly blue: number;
  readonly white: number;
  readonly gold: number;
  readonly red: number;
};

// One hole's full course data
export type CourseHole = {
  readonly hole: HoleNumber;
  readonly par: 3 | 4 | 5;
  readonly strokeIndex: number; // 1 (hardest) to 18 (easiest)
  readonly yardages: TeeYardages;
};

// Typed error for invalid hole numbers
export class InvalidHoleError extends Error {
  constructor(public readonly holeNumber: number) {
    super(`Invalid hole number: ${holeNumber}. Must be 1–18.`);
    this.name = 'InvalidHoleError';
  }
}
```

### Wolf Assignment Table

The fixed table from the rules (holes 1–2 are always skins; wolf rotates holes 3–18):

| Hole | Wolf Batter Index |
|------|------------------|
| 1    | skins            |
| 2    | skins            |
| 3    | 0 (Batter 1)     |
| 4    | 1 (Batter 2)     |
| 5    | 2 (Batter 3)     |
| 6    | 0 (Batter 1)     |
| 7    | 1 (Batter 2)     |
| 8    | 3 (Batter 4)     |
| 9    | 0 (Batter 1)     |
| 10   | 1 (Batter 2)     |
| 11   | 2 (Batter 3)     |
| 12   | 2 (Batter 3)     |
| 13   | 3 (Batter 4)     |
| 14   | 0 (Batter 1)     |
| 15   | 3 (Batter 4)     |
| 16   | 1 (Batter 2)     |
| 17   | 2 (Batter 3)     |
| 18   | 3 (Batter 4)     |

Batter 1 (index 0): holes 3, 6, 9, 14 → 4 wolf holes
Batter 2 (index 1): holes 4, 7, 10, 16 → 4 wolf holes
Batter 3 (index 2): holes 5, 11, 12, 17 → 4 wolf holes
Batter 4 (index 3): holes 8, 13, 15, 18 → 4 wolf holes

### `src/wolf.ts` Implementation Design

```ts
import type { BattingOrder, BattingPosition, HoleAssignment, HoleNumber } from './types.js';

// Maps hole number → batting position index (for holes 3-18 only)
// Using a Map avoids noUncheckedIndexedAccess issues with array indexing
const WOLF_TABLE = new Map<HoleNumber, BattingPosition>([
  [3,  0], [6,  0], [9,  0], [14, 0],  // Batter 1
  [4,  1], [7,  1], [10, 1], [16, 1],  // Batter 2
  [5,  2], [11, 2], [12, 2], [17, 2],  // Batter 3
  [8,  3], [13, 3], [15, 3], [18, 3],  // Batter 4
]);

/**
 * Returns the wolf assignment for a given hole based on the batting order.
 * Pure function — deterministic, no side effects.
 *
 * @param battingOrder - 4-tuple of player IDs in draw order
 * @param holeNumber - hole 1–18
 */
export function getWolfAssignment<TPlayerId>(
  battingOrder: BattingOrder<TPlayerId>,
  holeNumber: HoleNumber,
): HoleAssignment {
  if (holeNumber === 1 || holeNumber === 2) {
    return { type: 'skins' };
  }
  const wolfBatterIndex = WOLF_TABLE.get(holeNumber);
  if (wolfBatterIndex === undefined) {
    // Should never happen for valid HoleNumber type, but satisfies TS exhaustiveness
    throw new Error(`Wolf table missing entry for hole ${holeNumber}`);
  }
  return { type: 'wolf', wolfBatterIndex };
}
```

**Note:** `battingOrder` is passed but the function only returns which _index_ in the batting order is wolf (not the player ID itself). This keeps the engine decoupled from player ID concerns — the caller resolves `battingOrder[wolfBatterIndex]` to get the actual player. This is intentional.

### `src/course.ts` Implementation Design

```ts
import type { CourseHole, HoleNumber, TeeYardages } from './types.js';
import { InvalidHoleError } from './types.js';

// Guyan Golf & Country Club — Huntington, WV
// Course rating: Blue 71.2/126, White 69.3/122, Gold 66.5/113, Red 71.8/123
// Total par: 71 (36 out, 35 in)
const COURSE_DATA: CourseHole[] = [
  { hole: 1,  par: 5, strokeIndex: 3,  yardages: { blue: 567, white: 548, gold: 508, red: 466 } },
  { hole: 2,  par: 4, strokeIndex: 1,  yardages: { blue: 444, white: 382, gold: 357, red: 311 } },
  { hole: 3,  par: 4, strokeIndex: 13, yardages: { blue: 328, white: 317, gold: 303, red: 271 } },
  { hole: 4,  par: 4, strokeIndex: 5,  yardages: { blue: 358, white: 351, gold: 325, red: 289 } },
  { hole: 5,  par: 4, strokeIndex: 9,  yardages: { blue: 414, white: 401, gold: 381, red: 347 } },
  { hole: 6,  par: 3, strokeIndex: 17, yardages: { blue: 148, white: 135, gold: 118, red:  95 } },
  { hole: 7,  par: 3, strokeIndex: 15, yardages: { blue: 222, white: 197, gold: 171, red: 128 } },
  { hole: 8,  par: 5, strokeIndex: 7,  yardages: { blue: 510, white: 488, gold: 461, red: 412 } },
  { hole: 9,  par: 4, strokeIndex: 11, yardages: { blue: 346, white: 311, gold: 289, red: 251 } },
  { hole: 10, par: 4, strokeIndex: 8,  yardages: { blue: 356, white: 344, gold: 315, red: 280 } },
  { hole: 11, par: 5, strokeIndex: 2,  yardages: { blue: 566, white: 543, gold: 508, red: 459 } },
  { hole: 12, par: 3, strokeIndex: 18, yardages: { blue: 159, white: 147, gold: 133, red: 111 } },
  { hole: 13, par: 4, strokeIndex: 6,  yardages: { blue: 383, white: 357, gold: 329, red: 285 } },
  { hole: 14, par: 4, strokeIndex: 10, yardages: { blue: 357, white: 304, gold: 279, red: 246 } },
  { hole: 15, par: 3, strokeIndex: 16, yardages: { blue: 176, white: 151, gold: 126, red: 102 } },
  { hole: 16, par: 4, strokeIndex: 4,  yardages: { blue: 396, white: 386, gold: 352, red: 312 } },
  { hole: 17, par: 4, strokeIndex: 14, yardages: { blue: 345, white: 334, gold: 309, red: 275 } },
  { hole: 18, par: 4, strokeIndex: 12, yardages: { blue: 380, white: 366, gold: 338, red: 302 } },
];

// Pre-build a Map for O(1) lookup and to avoid noUncheckedIndexedAccess issues
const COURSE_MAP = new Map<HoleNumber, CourseHole>(
  COURSE_DATA.map(h => [h.hole, h])
);

/**
 * Returns course data for a specific hole at Guyan G&CC.
 * @throws {InvalidHoleError} if holeNumber is not 1–18
 */
export function getCourseHole(holeNumber: number): CourseHole {
  const hole = COURSE_MAP.get(holeNumber as HoleNumber);
  if (hole === undefined) {
    throw new InvalidHoleError(holeNumber);
  }
  return hole;
}

/** Returns all 18 holes in order. */
export function getAllCourseHoles(): readonly CourseHole[] {
  return COURSE_DATA;
}
```

### Guyan G&CC Complete Scorecard (authoritative hardcode reference)

| Hole | Par | HCP | Blue | White | Gold | Red |
|------|-----|-----|------|-------|------|-----|
| 1    | 5   | 3   | 567  | 548   | 508  | 466 |
| 2    | 4   | 1   | 444  | 382   | 357  | 311 |
| 3    | 4   | 13  | 328  | 317   | 303  | 271 |
| 4    | 4   | 5   | 358  | 351   | 325  | 289 |
| 5    | 4   | 9   | 414  | 401   | 381  | 347 |
| 6    | 3   | 17  | 148  | 135   | 118  |  95 |
| 7    | 3   | 15  | 222  | 197   | 171  | 128 |
| 8    | 5   | 7   | 510  | 488   | 461  | 412 |
| 9    | 4   | 11  | 346  | 311   | 289  | 251 |
| 10   | 4   | 8   | 356  | 344   | 315  | 280 |
| 11   | 5   | 2   | 566  | 543   | 508  | 459 |
| 12   | 3   | 18  | 159  | 147   | 133  | 111 |
| 13   | 4   | 6   | 383  | 357   | 329  | 285 |
| 14   | 4   | 10  | 357  | 304   | 279  | 246 |
| 15   | 3   | 16  | 176  | 151   | 126  | 102 |
| 16   | 4   | 4   | 396  | 386   | 352  | 312 |
| 17   | 4   | 14  | 345  | 334   | 309  | 275 |
| 18   | 4   | 12  | 380  | 366   | 338  | 302 |
| **OUT** | **36** | — | **3337** | **3130** | **2913** | **2570** |
| **IN**  | **35** | — | **3118** | **2932** | **2689** | **2372** |
| **TOT** | **71** | — | **6455** | **6062** | **5602** | **4942** |

**Course ratings:** Blue 71.2/126 · White 69.3/122 · Gold 66.5/113 · Red 71.8/123

### Test Coverage Requirements

**`src/wolf.test.ts`** must cover:
- All 18 holes with at least one batting order — verify skins vs wolf type
- Holes 1–2: all 4 batting orders return `{ type: 'skins' }`
- Each wolf hole: verify the correct `wolfBatterIndex` (spot-check all 16)
- Purity: same inputs → same output (call twice, compare)
- The actual player ID in `battingOrder[wolfBatterIndex]` resolves correctly (integration check)

Minimal complete test set (verify ALL 16 wolf assignments):
```ts
// Skins holes
expect(getWolfAssignment(order, 1)).toEqual({ type: 'skins' });
expect(getWolfAssignment(order, 2)).toEqual({ type: 'skins' });

// Batter 0 wolf holes
expect(getWolfAssignment(order, 3)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
expect(getWolfAssignment(order, 6)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
expect(getWolfAssignment(order, 9)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
expect(getWolfAssignment(order, 14)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });

// Batter 1 wolf holes
expect(getWolfAssignment(order, 4)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });
expect(getWolfAssignment(order, 7)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });
expect(getWolfAssignment(order, 10)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });
expect(getWolfAssignment(order, 16)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });

// Batter 2 wolf holes
expect(getWolfAssignment(order, 5)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });
expect(getWolfAssignment(order, 11)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });
expect(getWolfAssignment(order, 12)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });
expect(getWolfAssignment(order, 17)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });

// Batter 3 wolf holes
expect(getWolfAssignment(order, 8)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
expect(getWolfAssignment(order, 13)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
expect(getWolfAssignment(order, 15)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
expect(getWolfAssignment(order, 18)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
```

**`src/course.test.ts`** must cover:
- `getCourseHole(n)` returns correct par for every hole (18 assertions)
- `getCourseHole(n)` returns correct strokeIndex for every hole
- `getCourseHole(n)` returns correct blue yardage for a sample of holes
- `getCourseHole(0)` throws `InvalidHoleError`
- `getCourseHole(19)` throws `InvalidHoleError`
- `getCourseHole(-1)` throws `InvalidHoleError`
- `getCourseHole(1.5)` throws `InvalidHoleError`
- `getAllCourseHoles()` returns array of length 18
- `getAllCourseHoles()` holes are in order 1–18
- Stroke indexes are unique (1–18, no duplicates) — validate the data itself

### Critical Implementation Constraints

1. **Do NOT import anything from outside `packages/engine`** — the engine has zero framework/external dependencies. Only use TypeScript built-ins.

2. **`noUncheckedIndexedAccess: true` means `array[i]` is `T | undefined`** — use `Map.get()` instead of array index access wherever you need to look up by key. The COURSE_DATA array is defined statically; use a `Map` for runtime lookups.

3. **`HoleNumber` is a union literal type, not a branded type** — `getCourseHole` accepts `number` (runtime input), not `HoleNumber` (compile-time type). The function validates at runtime and throws `InvalidHoleError`. The return type is `CourseHole` (which has `hole: HoleNumber`).

4. **`getWolfAssignment` takes `HoleNumber`, not `number`** — callers must narrow to `HoleNumber` before calling. This is correct: the scorer UI will always pass a known hole number 1–18. Inside the wolf table Map, using `Map<HoleNumber, BattingPosition>` with a `.get(holeNumber)` handles the `noUncheckedIndexedAccess` concern automatically.

5. **Do NOT remove `export * from './wolf.js'` etc. from `index.ts`** — the re-exports are already there from Story 1.1. Just replace the stub content in `wolf.ts`, `course.ts`, and `types.ts`.

6. **`InvalidHoleError` is in `types.ts`** (not `course.ts`) so it can be imported and used by other engine modules in future stories without circular deps.

7. **The `battingOrder` parameter in `getWolfAssignment` is generic `<TPlayerId>`** — this keeps the engine decoupled from the player ID type used by the API/DB layer. The function doesn't inspect player IDs, so it should remain generic.

8. **Course data should be verified**: The sum of stroke indexes must be `1+2+...+18 = 171`. Confirm this in tests. Par totals: front 9 = 36, back 9 = 35, total = 71.

### Project Structure Notes

Only modify files in `packages/engine/src/`:
- `types.ts` — replace entirely with domain types
- `wolf.ts` — replace stub with full implementation
- `course.ts` — replace stub with full implementation
- `src/wolf.test.ts` — create new
- `src/course.test.ts` — create new
- No other packages are touched

### References

- Wolf hole assignment table: [Source: _bmad-output/planning-artifacts/epics.md — Story 1.2 Acceptance Criteria]
- Engine purity and zero-dep constraint: [Source: _bmad-output/planning-artifacts/epics.md — "From Architecture — Engine"]
- Guyan G&CC course data: golflink.com, bluegolf.com (verified Feb 2026)
- Course ratings Blue 71.2/126, White 69.3/122, Gold 66.5/113, Red 71.8/123
- NodeNext `.js` import requirement: [Source: Story 1.1 Dev Notes]
- `noUncheckedIndexedAccess` constraint: [Source: Story 1.1 tsconfig.base.json]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Course data sourced from golflink.com and bluegolf.com (Feb 2026). Verified via test assertions: total par 71, blue yardage 6455, white 6062, stroke indexes unique set 1–18 summing to 171.
- `getWolfAssignment` uses `_battingOrder` (prefixed underscore) because the parameter is received for API symmetry but only `holeNumber` is used to derive `wolfBatterIndex`. Caller resolves `battingOrder[wolfBatterIndex]` for the actual player.
- `InvalidHoleError` placed in `types.ts` (not `course.ts`) to keep it importable by future engine modules without circular deps.

### Completion Notes List

- 87/87 tests pass across 3 test files (26 wolf + 60 course + 1 smoke).
- `pnpm --filter @wolf-cup/engine typecheck` — zero errors (both tsconfig.json and tsconfig.node.json).
- `pnpm -r lint` — zero warnings/errors across all packages.
- All 18 wolf assignment holes verified with explicit assertions.
- Course data validated by: par totals (36+35=71), blue yardage (6455), white yardage (6062), stroke index uniqueness (set of 18 distinct values 1–18, sum 171).
- `Map`-based lookups used throughout to avoid `noUncheckedIndexedAccess` TypeScript errors.

### Senior Developer Review (AI)

**Reviewer:** AI Code Review — 2026-02-28
**Outcome:** Approved with fixes applied

**Issues dismissed:**
- M1: Missing gold/red yardage total tests — dismissed. Gold and red tees are never used; weekly rotation is blue → black → white.

**Issues fixed:**
- M2: Added explicit `Number.isInteger() + range check` in `getCourseHole` before `Map.get()`, making the `as HoleNumber` cast safe and the validation intent explicit.
- M3: Fixed JSDoc `@param battingOrder` → `@param _battingOrder` in `wolf.ts` to match the actual parameter name.
- L1: Replaced 5-hole blue yardage spot-checks with complete all-18-hole blue yardage assertions (using same data-driven pattern as par/strokeIndex tests).
- L2: `getAllCourseHoles()` now returns `[...COURSE_DATA]` (shallow copy) to prevent runtime mutation of internal data via the returned reference.

**Final test count:** 100/100 (26 wolf + 73 course + 1 smoke)

### File List

- `packages/engine/src/types.ts` (replaced — full domain types)
- `packages/engine/src/wolf.ts` (replaced — full implementation; JSDoc fixed in review)
- `packages/engine/src/course.ts` (replaced — full implementation; explicit validation + defensive copy added in review)
- `packages/engine/src/wolf.test.ts` (new — 26 tests)
- `packages/engine/src/course.test.ts` (new — 73 tests after review fixes)
