# Story 1.7: Best-10-of-N Drop Score & Playoff Multipliers

Status: done

## Story

As a league member,
I want my season Harvey Cup total to reflect my best 10 rounds with correct drops, and playoff rounds scored with the appropriate multipliers,
So that my season ranking is fair regardless of rainouts or playoff appearances.

## Acceptance Criteria

1. **Given** a player's regular-season Harvey Cup results and optional playoff results
   **When** `calculateSeasonTotal(regularRounds, playoffRounds?)` is called
   **Then** the player drops their lowest (regularRounds.length − 10) regular rounds per category, minimum 0 drops
   **And** season total = sum of top min(10, N) regular stableford + all playoff stableford points (independently per category)
   **And** playoff rounds are always counted and never dropped

2. **Given** a player who participated in 15 non-rainout regular rounds
   **When** `calculateSeasonTotal(regularRounds)` runs (no playoff rounds)
   **Then** the player drops their 5 lowest regular rounds (15 − 10 = 5) per category
   **And** the returned totals reflect only the best-10 regular rounds

3. **Given** a player who joined mid-season and played only 8 regular rounds
   **When** `calculateSeasonTotal(regularRounds)` runs
   **Then** the player drops 0 rounds (max(0, 8 − 10) = 0) and their total is the sum of all 8 rounds

4. **Given** a playoff round marked `roundType: 'playoff_r8'`
   **When** `calculateHarveyPoints(players, 'playoff_r8')` is called
   **Then** each player's points = their rank × 3 (rank 1 = last place, rank N = 1st place)
   **And** a player tied for 1st/2nd in R8 receives (8 + 7) / 2 × 3 = 22.5 points each

5. **Given** a playoff round marked `roundType: 'playoff_r4'`
   **When** `calculateHarveyPoints(players, 'playoff_r4')` is called
   **Then** each player's points = their rank × 8
   **And** sum of all points = N×(N+1)/2 × 8

6. **Given** a regular-season round (no roundType or `roundType: 'regular'`)
   **When** `calculateHarveyPoints` is called
   **Then** behaviour is identical to Story 1.6 — no change to existing results

## Tasks / Subtasks

- [x] Task 1: Add `RoundType` and `HarveySeasonTotal` types to `types.ts` (AC: 1–6)
  - [x] 1.1 Add `RoundType = 'regular' | 'playoff_r8' | 'playoff_r4'`
  - [x] 1.2 Add `HarveySeasonTotal` type: `{ readonly stableford: number; readonly money: number; readonly roundsPlayed: number; readonly roundsDropped: number; }`

- [x] Task 2: Write failing tests (AC: 1–6)
  - [x] 2.1 `playoff_r8` N=8 no-tie: 1st gets 24 (8×3), 8th gets 3 (1×3), sum=108
  - [x] 2.2 `playoff_r4` N=4 no-tie: 1st gets 32 (4×8), 4th gets 8 (1×8), sum=80
  - [x] 2.3 `playoff_r8` 2-way tie for 1st/2nd: each gets (8+7)/2 × 3 = 22.5; sum still=108
  - [x] 2.4 `playoff_r4` 3-way tie for 1st: each gets (4+3+2)/3 × 8 = 24; 4th gets 8; sum=80
  - [x] 2.5 `'regular'` explicit roundType: identical output to calling with no roundType
  - [x] 2.6 `calculateSeasonTotal` with 15 regular rounds: drops 5 lowest per category; roundsDropped=5
  - [x] 2.7 `calculateSeasonTotal` with 10 regular rounds: drops 0; total = sum of all 10; roundsDropped=0
  - [x] 2.8 `calculateSeasonTotal` with 8 regular rounds (mid-season joiner): drops 0; total = sum of all 8
  - [x] 2.9 `calculateSeasonTotal` with 1 regular round: returns that round's points; roundsDropped=0
  - [x] 2.10 `calculateSeasonTotal` categories are independent: best-10 stableford ≠ best-10 money when rankings differ across rounds
  - [x] 2.11 `calculateSeasonTotal` roundsPlayed = regularRounds.length; roundsDropped = max(0, length − 10)
  - [x] 2.14 `calculateSeasonTotal` with 10 regular + 1 R8 playoff round: playoff points add on top of season best-10 total
  - [x] 2.15 `calculateSeasonTotal` with 15 regular + 2 playoff rounds: best-10 drops apply to regular only; both playoff rounds fully counted
  - [x] 2.16 `calculateSeasonTotal` with 0 regular rounds + playoff rounds: roundsPlayed=0, roundsDropped=0, total=playoff sum only
  - [x] 2.12 validateHarveyTotal accepts multiplier param: passes for R8 sum=108 with multiplier=3
  - [x] 2.13 validateHarveyTotal throws for R8 results with multiplier=1 (wrong expected sum)

- [x] Task 3: Update `validateHarveyTotal` in `validation.ts` to accept optional `multiplier` (AC: 4–5)
  - [x] 3.1 Add optional `multiplier = 1` parameter
  - [x] 3.2 `expectedSum = playerCount × (playerCount + 1) / 2 × multiplier`
  - [x] 3.3 Existing callers (Story 1.6) unaffected — multiplier defaults to 1

- [x] Task 4: Add playoff multiplier support to `calculateHarveyPoints` in `harvey.ts` (AC: 4–6)
  - [x] 4.1 Add `roundType: RoundType = 'regular'` parameter (with default)
  - [x] 4.2 Internal `getMultiplier(roundType): number` — `playoff_r8`→3, `playoff_r4`→8, `regular`→1
  - [x] 4.3 Multiply `rankScores` output by multiplier before assembling results
  - [x] 4.4 Pass multiplier to `validateHarveyTotal` call

- [x] Task 5: Implement `calculateSeasonTotal` in `harvey.ts` (AC: 1–3)
  - [x] 5.1 Signature: `calculateSeasonTotal(regularRounds: readonly HarveyRoundResult[], playoffRounds?: readonly HarveyRoundResult[]): HarveySeasonTotal`
  - [x] 5.2 `roundsPlayed = regularRounds.length`
  - [x] 5.3 `roundsDropped = Math.max(0, roundsPlayed - 10)`
  - [x] 5.4 Sort regularRounds stablefordPoints desc, sum top `roundsPlayed − roundsDropped` values
  - [x] 5.5 Sort regularRounds moneyPoints desc, sum top `roundsPlayed − roundsDropped` values independently
  - [x] 5.6 Sum all playoffRounds stablefordPoints and moneyPoints (no drops)
  - [x] 5.7 Return `{ stableford: regularStableford + playoffStableford, money: regularMoney + playoffMoney, roundsPlayed, roundsDropped }`

- [x] Task 6: Run full test suite (AC: all)
  - [x] 6.1 `pnpm --filter @wolf-cup/engine exec vitest run` — all tests pass (375 previous + new 1.7 tests)
  - [x] 6.2 `pnpm --filter @wolf-cup/engine typecheck` — zero errors
  - [x] 6.3 `pnpm -r lint` — zero warnings

## Dev Notes

### Playoff Multiplier Formula — Confirmed

The ACs say `roundType: 'playoff_r8'` → points = rank × 3. The `rank` here is the same rank value `rankScores` already produces (1 = worst, N = best). So the playoff formula is just the regular formula with a multiplier applied to each player's output:

```
Regular: points_i = rank_i × 1
R8:      points_i = rank_i × 3
R4:      points_i = rank_i × 8
```

Sum invariant with multiplier: `N×(N+1)/2 × multiplier`
- R8, N=8: 36 × 3 = 108
- R4, N=4: 10 × 8 = 80

Tie-splitting: same averaged-adjacent-ranks formula, then multiplied. Distributes correctly:
- R8 N=8, 2-way tie for 1st/2nd: avg = (8+7)/2 = 7.5 → 7.5 × 3 = 22.5 each

### Best-10-of-N Formula

```
roundsPlayed  = roundResults.length
roundsDropped = max(0, roundsPlayed - 10)
keptRounds    = roundsPlayed - roundsDropped = min(10, roundsPlayed)
```

Categories are **independent** — best-10 stableford rounds may differ from best-10 money rounds:

```
stableford_total = sum of top keptRounds stablefordPoints (sorted desc)
money_total      = sum of top keptRounds moneyPoints (sorted desc, independently)
```

Rainout rounds: not included in `roundResults` — the caller (API layer in Epic 2+) filters them before calling the engine. The engine just processes what it receives.

**Examples:**

| Scenario | roundsPlayed | roundsDropped | Rule |
|---|---|---|---|
| Full 17-round season, 2 rainouts, player in all 15 | 15 | 5 | 15−10=5 |
| Joined mid-season, played 8 of 15 eligible | 8 | 0 | max(0,8−10)=0 |
| 10-round season, no rainouts | 10 | 0 | max(0,10−10)=0 |
| 12-round season, no rainouts | 12 | 2 | 12−10=2 |

### New Types (add to `types.ts`)

```typescript
/** Round classification for Harvey Cup point calculation */
export type RoundType = 'regular' | 'playoff_r8' | 'playoff_r4';

/** A player's season Harvey Cup totals after applying best-10-of-N drops */
export type HarveySeasonTotal = {
  /** Total Harvey points for Stableford category (best N rounds, drops excluded) */
  readonly stableford: number;
  /** Total Harvey points for money category (best N rounds, drops excluded) */
  readonly money: number;
  /** Number of rounds counted (before drops) */
  readonly roundsPlayed: number;
  /** Number of rounds excluded (lowest scores dropped) */
  readonly roundsDropped: number;
};
```

### Updated Function Signatures

**`harvey.ts` — modify `calculateHarveyPoints`:**
```typescript
export function calculateHarveyPoints(
  players: readonly HarveyRoundInput[],
  roundType: RoundType = 'regular',     // NEW optional param
): readonly HarveyRoundResult[]
```

**`harvey.ts` — add `calculateSeasonTotal`:**
```typescript
export function calculateSeasonTotal(
  regularRounds: readonly HarveyRoundResult[],
  playoffRounds?: readonly HarveyRoundResult[],
): HarveySeasonTotal
```

**`validation.ts` — update `validateHarveyTotal`:**
```typescript
export function validateHarveyTotal(
  results: readonly HarveyRoundResult[],
  playerCount: number,
  multiplier = 1,    // NEW optional param — defaults to 1, pass 3 for R8, 8 for R4
): void
```

### Internal Design: `calculateHarveyPoints` with multiplier

```typescript
function getMultiplier(roundType: RoundType): number {
  if (roundType === 'playoff_r8') return 3;
  if (roundType === 'playoff_r4') return 8;
  return 1;
}

// Inside calculateHarveyPoints:
const multiplier = getMultiplier(roundType);
const stablefordPoints = rankScores(stablefordScores).map(p => p * multiplier);
const moneyPoints = rankScores(moneyScores).map(p => p * multiplier);
// ...
validateHarveyTotal(results, players.length, multiplier);
```

### Internal Design: `calculateSeasonTotal`

Playoff rounds are NEVER subject to drops — they always add to the total. Regular season
best-10-of-N drops apply only to regular rounds. This lets a player carry their season lead
into the playoffs while giving playoff multipliers enough weight to allow comebacks.

```typescript
export function calculateSeasonTotal(
  regularRounds: readonly HarveyRoundResult[],
  playoffRounds: readonly HarveyRoundResult[] = [],
): HarveySeasonTotal {
  const roundsPlayed = regularRounds.length;
  const roundsDropped = Math.max(0, roundsPlayed - 10);
  const kept = roundsPlayed - roundsDropped;

  // Sort each regular category independently, sum top `kept` values
  const regularStableford = [...regularRounds]
    .map(r => r.stablefordPoints)
    .sort((a, b) => b - a)
    .slice(0, kept)
    .reduce((sum, p) => sum + p, 0);

  const regularMoney = [...regularRounds]
    .map(r => r.moneyPoints)
    .sort((a, b) => b - a)
    .slice(0, kept)
    .reduce((sum, p) => sum + p, 0);

  // Playoff rounds always counted in full — no drops
  const playoffStableford = playoffRounds.reduce((sum, r) => sum + r.stablefordPoints, 0);
  const playoffMoney = playoffRounds.reduce((sum, r) => sum + r.moneyPoints, 0);

  return {
    stableford: regularStableford + playoffStableford,
    money: regularMoney + playoffMoney,
    roundsPlayed,
    roundsDropped,
  };
}
```

### Project Structure Notes

**Files to modify:**
- `packages/engine/src/types.ts` — add `RoundType`, `HarveySeasonTotal`
- `packages/engine/src/harvey.ts` — add `roundType` param to `calculateHarveyPoints`; add `calculateSeasonTotal`
- `packages/engine/src/validation.ts` — add optional `multiplier` param to `validateHarveyTotal`
- `packages/engine/src/harvey.test.ts` — add playoff and season total tests

**No changes needed:**
- `index.ts` — already exports `'./harvey.js'` and `'./validation.js'` ✓
- All other engine files — do not touch

**Regression check critical:** All 375 existing tests (including 26 Story 1.6 harvey tests) must still pass. The `calculateHarveyPoints` signature change adds a default parameter — callers passing no `roundType` are unaffected. The `validateHarveyTotal` signature change adds a default multiplier=1 — existing callers unaffected.

### TypeScript Strictness Reminders

- `noUncheckedIndexedAccess: true` — array `slice` + `reduce` pattern is safe; `map` too
- `.js` extension on all local imports
- Default parameter `roundType: RoundType = 'regular'` is valid TypeScript
- `[...roundResults]` spread creates a mutable copy for sorting (input is `readonly`)

### Previous Story Learnings (1.1–1.6)

- `validateHarveyTotal` already has `results.length !== playerCount` guard (added in 1.6 review) — preserves correctly with multiplier added
- `rankScores` is pure internal function — multiplying its output is safe
- `calculateHarveyPoints` already calls `validateHarveyTotal(results, players.length)` — just add multiplier arg
- Test helpers `sp()`, `mp()`, `sumOf()`, `inputs()` already defined in `harvey.test.ts` — reuse them

### References

- FR7: Best-10-of-N — player drops lowest (N−10) rounds; cancelled/rainout excluded from count [Source: epics.md]
- FR8: Two-tier playoff multipliers — R8: rank×3; R4: rank×8 [Source: epics.md]
- NFR8: Best-10-of-N must correctly handle rainouts and sub-join scenarios [Source: epics.md]
- Architecture: `harvey.ts` covers FR4–FR8; best-10-of-N, playoff multipliers [Source: architecture.md]
- Architecture: Harvey Cup points stored as floats [Source: architecture.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Updated story to reflect user clarification: playoff rounds are never dropped — `calculateSeasonTotal` takes separate `regularRounds` and `playoffRounds?` arrays
- Added `RoundType` and `HarveySeasonTotal` to `types.ts`
- Added optional `multiplier = 1` to `validateHarveyTotal` in `validation.ts`; `expectedSum = N×(N+1)/2 × multiplier`; existing callers unaffected
- Added `getMultiplier` internal helper + `roundType: RoundType = 'regular'` param to `calculateHarveyPoints`; multiplies `rankScores` output before assembling results
- Added `calculateSeasonTotal(regularRounds, playoffRounds? = [])` — regular rounds subject to best-10 drops per category; playoff rounds always summed on top, never dropped
- 17 new tests: playoff_r8 (no-tie, 2-way tie), playoff_r4 (no-tie, 3-way tie), regular explicit=default, validateHarveyTotal with multiplier (pass/throw), calculateSeasonTotal (15/10/8/1/0 regular rounds, categories independent, playoff accumulation, 0 regular + playoff only, omitted param = empty array)
- 392/392 tests passing; typecheck clean; lint clean; zero regressions
- Code review fixes: moved `rounds` test helper to module scope (was duplicated in two describe blocks); replaced misleading "categories independent" test with one that actually proves independence (stableford=65 ≠ money=100, buggy shared-rounds impl would give money=91); added 11-round boundary test (first case with 1 drop); updated `calculateHarveyPoints` JSDoc to document `roundType` param and playoff multipliers
- Final: 393/393 tests passing after code review fixes

### File List

- `packages/engine/src/types.ts` — added `RoundType`, `HarveySeasonTotal`
- `packages/engine/src/validation.ts` — added optional `multiplier` param to `validateHarveyTotal`
- `packages/engine/src/harvey.ts` — added `getMultiplier` helper, `roundType` param to `calculateHarveyPoints`, `calculateSeasonTotal`
- `packages/engine/src/harvey.test.ts` — added 17 Story 1.7 tests
