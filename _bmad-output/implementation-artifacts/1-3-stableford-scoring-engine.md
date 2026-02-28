# Story 1.3: Stableford Scoring Engine

Status: done

## Story

As a player,
I want my gross score converted to Stableford points correctly on every hole,
So that my daily total is accurate and fairly comparable across all players.

## Acceptance Criteria

1. **Given** a player's gross score, handicap index, hole par, and stroke index
   **When** `calculateStablefordPoints(grossScore, handicapIndex, par, strokeIndex)` is called
   **Then** it returns the correct Stableford points:
   - net double eagle (3+ under par) = 5
   - net eagle (2 under par) = 4
   - net birdie (1 under par) = 3
   - net par = 2
   - net bogey (1 over par) = 1
   - net double bogey or worse (2+ over par) = 0
   **And** handicap strokes are allocated using standard stroke-index allocation

2. **Given** a player with handicap 18 on a par-4 stroke index 1 hole (receives 1 stroke) who shoots gross 5 (net par)
   **When** `calculateStablefordPoints(5, 18, 4, 1)` is called
   **Then** it returns 2

3. **Given** a player with handicap 36 on a par-3 stroke index 1 hole (receives 2 strokes) who shoots gross 4 (net birdie)
   **When** `calculateStablefordPoints(4, 36, 3, 1)` is called
   **Then** it returns 3

## Tasks / Subtasks

- [x] Task 1: Write failing tests for `getHandicapStrokes` helper (AC: 1)
  - [x] 1.1 Test handicap 0 → 0 strokes on all holes
  - [x] 1.2 Test handicap 9 → 1 stroke on SI 1–9, 0 on SI 10–18
  - [x] 1.3 Test handicap 18 → 1 stroke on all 18 holes
  - [x] 1.4 Test handicap 27 → 2 strokes on SI 1–9, 1 stroke on SI 10–18
  - [x] 1.5 Test handicap 36 → 2 strokes on all holes
  - [x] 1.6 Test decimal input (e.g., 18.5 → rounds to 19, behaves like handicap 19)

- [x] Task 2: Write failing tests for `calculateStablefordPoints` (AC: 1, 2, 3)
  - [x] 2.1 Test all 6 point outcomes (0–5) with explicit net-vs-par scenarios
  - [x] 2.2 Test AC example: `calculateStablefordPoints(5, 18, 4, 1)` → 2
  - [x] 2.3 Test AC example: `calculateStablefordPoints(4, 36, 3, 1)` → 3
  - [x] 2.4 Test net 3+ under par (cap at 5 points)
  - [x] 2.5 Test handicap 0 player (no strokes received)
  - [x] 2.6 Test par-3, par-4, par-5 scenarios
  - [x] 2.7 Test stroke-index boundary: player gets stroke on SI equal to handicap, not SI one above
  - [x] 2.8 Test high handicap (36) receiving 2 strokes on a hole

- [x] Task 3: Implement `getHandicapStrokes(handicapIndex, strokeIndex)` in `stableford.ts` (AC: 1)
  - [x] 3.1 Round `handicapIndex` to whole number
  - [x] 3.2 Compute `base = Math.floor(ch / 18)` and `extra = ch % 18`
  - [x] 3.3 Return `base + (strokeIndex <= extra ? 1 : 0)`
  - [x] 3.4 Verify all Task 1 tests pass

- [x] Task 4: Implement `calculateStablefordPoints(grossScore, handicapIndex, par, strokeIndex)` (AC: 1, 2, 3)
  - [x] 4.1 Call `getHandicapStrokes` to get strokes received
  - [x] 4.2 Compute `netScore = grossScore - strokes`
  - [x] 4.3 Compute `netVsPar = netScore - par`
  - [x] 4.4 Map to Stableford points using the 5-4-3-2-1-0 table
  - [x] 4.5 Verify all Task 2 tests pass

- [x] Task 5: Verify `index.ts` already re-exports stableford (it does — `export * from './stableford.js'`)

- [x] Task 6: Run full suite and typecheck
  - [x] 6.1 `pnpm --filter @wolf-cup/engine test` — all tests pass
  - [x] 6.2 `pnpm --filter @wolf-cup/engine typecheck` — zero errors
  - [x] 6.3 `pnpm -r lint` — zero warnings

## Dev Notes

### Previous Story Learnings (from Stories 1.1 & 1.2)

- **`.js` extension required on all relative imports** — NodeNext module resolution. Always `import { foo } from './foo.js'` even though source is `.ts`.
- **`noUncheckedIndexedAccess: true` is active** — array indexing returns `T | undefined`. Use `Map.get()` or explicit index guards.
- **`exactOptionalPropertyTypes: true` is active** — be precise.
- **`globals: false` in Vitest** — always import `describe`, `it`, `expect` from `'vitest'`.
- **Test files go in `src/`** — e.g. `src/stableford.test.ts`.
- **Replace stubs entirely** — `stableford.ts` currently contains just `export {}`. Remove and replace the whole file.
- **No external dependencies** — pure TypeScript, zero imports from outside `packages/engine`.

### Stableford Scoring Formula

**Points table (net score vs par):**

| Net vs Par | Result | Points |
|------------|--------|--------|
| ≤ −3 | Double eagle or better | **5** |
| −2 | Eagle | **4** |
| −1 | Birdie | **3** |
| 0 | Par | **2** |
| +1 | Bogey | **1** |
| ≥ +2 | Double bogey or worse | **0** |

**The 5-point cap is absolute** — any net score 3+ under par returns 5. There is no 6-point outcome.

### Handicap Stroke Allocation Formula

The `handicapIndex` parameter is the **whole-number playing handicap** (already converted from GHIN handicap index by the API layer). The function should safely round non-integer inputs.

```typescript
// ch = whole-number course/playing handicap
const ch = Math.round(handicapIndex);
const base = Math.floor(ch / 18);  // strokes every hole gets (0, 1, 2, ...)
const extra = ch % 18;             // additional strokes on the hardest 'extra' holes
const strokes = base + (strokeIndex <= extra ? 1 : 0);
```

**Verification against AC examples:**
- hcp 18: `base=1, extra=0` → SI 1: `1 + (1<=0?1:0) = 1` ✓ (gross 5 - 1 = net 4 = par on par-4 → 2 pts)
- hcp 36: `base=2, extra=0` → SI 1: `2 + (1<=0?1:0) = 2` ✓ (gross 4 - 2 = net 2 = birdie on par-3 → 3 pts)

**More examples:**
- hcp 9: SI 1–9 → 1 stroke; SI 10–18 → 0 strokes
- hcp 27: SI 1–9 → 2 strokes; SI 10–18 → 1 stroke
- hcp 0: 0 strokes on every hole

### Course Handicap vs Playing Handicap (API Layer Concern)

The Wolf Cup engine function takes an already-computed whole-number handicap. The API layer is responsible for the GHIN → Course Handicap conversion:

```
Course Handicap = round(GHIN_HI × Slope / 113 + (CourseRating - Par))
```

For Guyan G&CC (Wolf Cup tees):
- Black tees: Slope ≈ 126, Rating ≈ 71.3, Par 71
- Blue tees: Slope 126, Rating 71.2, Par 71
- White tees: Slope 122, Rating 69.3, Par 71

**This conversion is NOT Story 1.3's concern.** The Stableford engine trusts the `handicapIndex` parameter as a ready-to-use whole-number playing handicap.

### Functions to Export

**`getHandicapStrokes(handicapIndex: number, strokeIndex: number): number`**
- Exported helper — will be reused in Story 1.5 (`detectBirdieEagle`) and by the API for net score display
- Pure function, no side effects

**`calculateStablefordPoints(grossScore: number, handicapIndex: number, par: 3 | 4 | 5, strokeIndex: number): number`**
- Primary AC function
- Pure function, deterministic

Note: `par: 3 | 4 | 5` uses the union type already in `types.ts` (from `CourseHole.par`). No new types needed.

### Test Coverage Requirements

**`stableford.test.ts`** must cover:

```
getHandicapStrokes:
  handicap 0:  all SIs → 0
  handicap 9:  SI 1–9 → 1, SI 10–18 → 0
  handicap 18: SI 1–18 → all 1
  handicap 27: SI 1–9 → 2, SI 10–18 → 1
  handicap 36: SI 1–18 → all 2
  decimal:     18.6 rounds to 19; SI 1–1 → 2 strokes, SI 2–18 → 1 stroke

calculateStablefordPoints:
  net ≤-3 → 5:  e.g. hcp 36, par-4, SI 1, gross 1 (net -1... wait)
                Actually: hcp 36 → 2 strokes; gross 1, net -1 vs par 4 → -3 → 5
  net -2 → 4:   hcp 18, par-4, SI 1, gross 1 → net 0 vs 4 → -4 → 5
                Better: hcp 0, par-5, SI 1, gross 3 → net 3-5=-2 → eagle → 4
  net -1 → 3:   AC example 2: hcp 36, par-3, SI 1, gross 4 → 3
  net  0 → 2:   AC example 1: hcp 18, par-4, SI 1, gross 5 → 2
  net +1 → 1:   hcp 0, par-4, SI 1, gross 5 → net 5-4=1 bogey → 1
  net +2 → 0:   hcp 0, par-4, SI 1, gross 6 → double bogey → 0
  net +3 → 0:   hcp 0, par-3, SI 1, gross 6 → triple bogey → 0
  purity:       same inputs → same output
```

### Project Structure Notes

- Only file to create: `packages/engine/src/stableford.test.ts`
- Only file to modify: `packages/engine/src/stableford.ts` (replace stub `export {}`)
- `packages/engine/src/index.ts` already has `export * from './stableford.js'` — do NOT touch
- Do NOT touch `types.ts` — all needed types (`3 | 4 | 5` for par) already exist
- Do NOT touch any other package

### References

- Stableford points table: [Source: _bmad-output/planning-artifacts/epics.md — Story 1.3 AC]
- FR1: "system calculates Stableford points for each player per hole based on net score relative to par" [Source: epics.md FR1]
- Stroke index allocation: USGA World Handicap System standard
- Course handicap formula: Course Handicap = round(HI × Slope/113 + (CR-Par)) [USGA WHS]
- Guyan G&CC ratings: Black ≈71.3/126, Blue 71.2/126, White 69.3/122 [Wolf Cup scorecard + golflink.com]
- NodeNext `.js` import requirement: [Source: Story 1.1 dev notes]
- `noUncheckedIndexedAccess` constraint: [Source: Story 1.1 tsconfig.base.json]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation was straightforward.

### Completion Notes List

- All tasks completed in a single pass; no blockers encountered.
- `stableford.ts`: replaced stub `export {}` with full implementation of `getHandicapStrokes` and `calculateStablefordPoints`.
- `stableford.test.ts`: created with 114 tests covering all AC examples, all 6 point outcomes, decimal rounding, SI boundary, par-3/4/5 scenarios, and high-handicap (36) receiving 2 strokes.
- `index.ts` untouched — `export * from './stableford.js'` was already present.
- 251 total tests pass (114 stableford + 110 course + 26 wolf + 1 index).
- Typecheck: 0 errors. Lint: 0 warnings.

### File List

- `packages/engine/src/stableford.ts` — replaced stub; exports `getHandicapStrokes`, `calculateStablefordPoints`
- `packages/engine/src/stableford.test.ts` — new; 114 tests
