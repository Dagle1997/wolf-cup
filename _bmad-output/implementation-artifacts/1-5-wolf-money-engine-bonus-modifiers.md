# Story 1.5: Wolf Money Engine — Bonus Modifiers

Status: done

## Story

As a player,
I want birdie, eagle, greenie, and polie bonuses applied correctly to hole money,
So that exceptional shots are rewarded accurately in both 2v2 and 1v3 scenarios.

## Acceptance Criteria

1. **Given** a net score and hole par
   **When** `detectBonusLevel(netScore, par)` is called
   **Then** it returns:
   - `'double_eagle'` if netScore ≤ par − 3
   - `'eagle'` if netScore ≤ par − 2 (but > par − 3)
   - `'birdie'` if netScore === par − 1
   - `null` if no bonus applies (net par or worse)

2. **Given** a player on a 2v2 wolf hole who has a net birdie
   **When** `applyBonusModifiers` is called
   **Then** that player's team wins 1 bonus skin (+1/+1/−1/−1)
   **And** the `bonusSkins` component sums to $0 across all four players

3. **Given** a player on a 2v2 wolf hole who has a net eagle
   **When** `applyBonusModifiers` is called
   **Then** that player's team wins 2 bonus skins: 1 for the birdie level + 1 for the eagle level (each +1/+1/−1/−1)

4. **Given** a player on a 2v2 wolf hole who has a net double eagle
   **When** `applyBonusModifiers` is called
   **Then** that player's team wins 3 bonus skins: birdie level + eagle level + double eagle level

5. **Given** both 2v2 team members have at least a net birdie AND at least one has a natural birdie (gross score ≤ par − 1)
   **When** `applyBonusModifiers` is called
   **Then** the team receives 2 bonus skins from the birdie level (double birdie bonus — both birdies count)
   **And** if both birdie but neither is natural → 1 bonus skin only (no double birdie bonus; only 1 counted)

6. **Given** a greenie is scorer-recorded for a player on a par-3 hole
   **When** `applyBonusModifiers` is called
   **Then** that player's team wins 1 bonus skin
   **And** if both 2v2 team members are in the greenies input → team wins 2 bonus skins total (double greenie bonus)
   **And** double greenie does NOT apply in 1v3 (wolf is alone; no partner)

7. **Given** a polie is scorer-recorded for a player (any hole)
   **When** `applyBonusModifiers` is called
   **Then** that player's team/side wins 1 bonus skin
   **And** multiple polies on the same hole (multiple players) each generate a separate bonus skin

8. **Given** a 1v3 lone wolf or blind wolf alignment
   **When** `applyBonusModifiers` is called with any bonus events
   **Then** each bonus skin uses the group structure: wolf-side wins → wolf +3, each opp −1; opponents-side wins → wolf −3, each opp +1
   **And** each individual player's bonus event (birdie, eagle, greenie, polie) generates a separate group skin
   **And** no double birdie bonus or double greenie applies in 1v3

9. **Given** multiple bonus events on the same hole (e.g., birdie + eagle + polie for one player, plus a separate polie for an opponent)
   **When** `applyBonusModifiers` is called
   **Then** all bonus skins are summed into the `bonusSkins` field of each player's result
   **And** `total` = `lowBall + skin + teamTotalOrBonus + blindWolf + bonusSkins`
   **And** `validateZeroSum` validates `bonusSkins` sums to $0 across all four players

10. **Given** a skins hole (holes 1–2, `holeAssignment.type === 'skins'`)
    **When** `applyBonusModifiers` is called with bonus events
    **Then** bonus skins use the individual structure: bonus winner +3, each other player −1
    **And** there are no teams on skins holes — each player's bonus is individual

11. **Given** any result returned from `applyBonusModifiers`
    **When** `validateZeroSum` is called on it
    **Then** it passes without error (all valid bonus results are zero-sum per component)

## Tasks / Subtasks

- [ ] Task 1: Extend `PlayerHoleMoneyResult` in `types.ts` and add `BonusInput` type (AC: 1–11)
  - [ ] 1.1 Add `bonusSkins: number` field to `PlayerHoleMoneyResult` (between `blindWolf` and `total`)
  - [ ] 1.2 Update `total` comment to reflect it now includes `bonusSkins`
  - [ ] 1.3 Add `BonusInput` type: `{ readonly greenies: readonly BattingPosition[]; readonly polies: readonly BattingPosition[]; }`
  - [ ] 1.4 Update `player()` helper in `money.ts` to accept and default `bonusSkins = 0`; update `total` to include `bonusSkins`
  - [ ] 1.5 Update `validateZeroSum` in `validation.ts` to include `bonusSkins` in the components list
  - [ ] 1.6 Update `makeResult` helper in `validation.test.ts` to include `bonusSkins: p.bonusSkins ?? 0`

- [ ] Task 2: Write failing tests for `detectBonusLevel` in `bonuses.test.ts` (AC: 1)
  - [ ] 2.1 net score = par − 1 → 'birdie'
  - [ ] 2.2 net score = par − 2 → 'eagle'
  - [ ] 2.3 net score = par − 3 → 'double_eagle'
  - [ ] 2.4 net score = par (par) → null
  - [ ] 2.5 net score = par + 1 (bogey) → null
  - [ ] 2.6 net score ≤ par − 3 (multiple levels below par) → 'double_eagle'
  - [ ] 2.7 par-3 birdie (net 2), par-4 birdie (net 3), par-5 birdie (net 4) — each returns 'birdie'

- [ ] Task 3: Write failing tests for `applyBonusModifiers` in `bonuses.test.ts` (AC: 2–11)
  - [ ] 3.1 2v2: birdie on wolf's team → +1/+1/−1/−1 bonus skin
  - [ ] 3.2 2v2: birdie on opponent team → −1/−1/+1/+1 bonus skin
  - [ ] 3.3 2v2: eagle → 2 bonus skins (+2/+2/−2/−2 for eagle player's team)
  - [ ] 3.4 2v2: double eagle → 3 bonus skins
  - [ ] 3.5 2v2: double birdie bonus (both birdie, ≥1 natural) → 2 bonus skins
  - [ ] 3.6 2v2: both birdie, NO natural → 1 bonus skin only (no double bonus)
  - [ ] 3.7 2v2: greenie (1 player) → 1 bonus skin (+1/+1/−1/−1)
  - [ ] 3.8 2v2: double greenie (both team members in greenies list) → 2 bonus skins
  - [ ] 3.9 2v2: polie → 1 bonus skin; two polies (different players) → 2 separate bonus skins
  - [ ] 3.10 2v2: no bonus events → all bonusSkins = 0, totals unchanged from base
  - [ ] 3.11 1v3 alone: wolf birdies → wolf +3, each opp −1 bonus skin
  - [ ] 3.12 1v3 alone: wolf eagles → wolf +6, each opp −2 (2 bonus skins)
  - [ ] 3.13 1v3 alone: opponent has birdie → wolf −3, each opp +1 bonus skin
  - [ ] 3.14 1v3 alone: two opponents each have a polie → 2 separate group skins (wolf −6, each opp +2 total)
  - [ ] 3.15 1v3 alone: opponent chip-in eagle (polie + eagle = 3 bonus skins: polie +1 skin, birdie +1 skin, eagle +1 skin) → wolf −9 from bonuses alone
  - [ ] 3.16 1v3 alone: no double birdie bonus in 1v3 even if multiple opponents birdie (each is a separate group skin)
  - [ ] 3.17 1v3 blind wolf: same bonus structure as alone (blind wolf modifier already in baseResult)
  - [ ] 3.18 skins hole: birdie → winner +3, others −1 (individual structure)
  - [ ] 3.19 skins hole: polie → winner +3, others −1 (individual structure)
  - [ ] 3.20 zero-sum holds on bonusSkins and total for all scenarios
  - [ ] 3.21 $21 wolf loss scenario: 3 base skins (LB+skin+wolf point) + polie + polie + birdie + eagle = 7 skins × $3 = $21; verify total

- [x] Task 4: Implement `detectBonusLevel` in `bonuses.ts` (AC: 1)
  - [ ] 4.1 Pure function: `(netScore: number, par: number) → BonusLevel | null`
  - [ ] 4.2 Levels: `double_eagle` if ≤ par−3, `eagle` if ≤ par−2, `birdie` if === par−1, null otherwise

- [x] Task 5: Implement `applyBonusModifiers` in `bonuses.ts` (AC: 2–11)
  - [ ] 5.1 Accept: `baseResult`, `netScores`, `grossScores`, `bonusInput`, `holeAssignment`, `wolfDecision`, `par`
  - [ ] 5.2 Compute birdie/eagle/double_eagle bonus skins per player using `detectBonusLevel`
  - [ ] 5.3 Resolve each bonus event as a team skin (2v2) or group skin (1v3) or individual skin (skins hole)
  - [ ] 5.4 Apply double birdie bonus logic (2v2 only): if both team members have ≥ birdie AND ≥1 natural → 2 birdie-level skins
  - [ ] 5.5 Apply double greenie logic (2v2 only): if both team members in `bonusInput.greenies` → 2 greenie skins
  - [ ] 5.6 Apply polies: 1 skin per player; each is a separate bonus skin event
  - [ ] 5.7 Sum all bonus skins into `bonusSkins` per player; recompute `total` = base components + bonusSkins
  - [ ] 5.8 Call `validateZeroSum` on the final result before returning

- [x] Task 6: Export new symbols from `index.ts` and run full suite (AC: all)
  - [ ] 6.1 Add `export * from './bonuses.js'` to `packages/engine/src/index.ts`
  - [ ] 6.2 Export `BonusInput` and `BonusLevel` types from `types.ts` (already re-exported via `index.ts`)
  - [ ] 6.3 `pnpm --filter @wolf-cup/engine exec vitest run` — all tests pass (302+ previous + new bonus tests)
  - [ ] 6.4 `pnpm --filter @wolf-cup/engine typecheck` — zero errors
  - [ ] 6.5 `pnpm -r lint` — zero warnings

## Dev Notes

### Bonus Rules — Complete Reference (Confirmed with Josh, 2026-02-28)

All bonuses are denominated in **skins** (extra points on top of the base 3 components). Each bonus skin follows the same dollar structure as the base components: team-based in 2v2, group-based in 1v3, individual on skins holes.

#### Bonus Point Values

| Bonus | Trigger | Skins Awarded | Notes |
|-------|---------|---------------|-------|
| **Birdie** | Net score = par − 1 | 1 extra skin | Auto-detected from net score |
| **Eagle** | Net score ≤ par − 2 | 2 extra skins (birdie level + eagle level) | Auto-detected |
| **Double Eagle** | Net score ≤ par − 3 | 3 extra skins (birdie + eagle + double eagle) | Auto-detected |
| **Greenie** | Par-3 only; scorer-recorded to closest validated player | 1 extra skin | Must: hit green from tee, be closest on green, 2-putt or better (par or better). Scorer records winner. |
| **Double Greenie** | Both 2v2 team members validate on par-3 | 2 extra skins | Both must: on green, par or better, 2-putt or better. 2v2 only — no double greenie in 1v3. |
| **Polie** | Scorer-recorded | 1 extra skin per player | Any putt made from >flagstick length on first putt; chip-in from off green counts. Multiple players can each earn a polie on the same hole — each is a separate skin. |
| **Double Birdie Bonus** | Both 2v2 team members have at least a net birdie AND ≥1 is a natural birdie (gross ≤ par − 1) | 2 extra skins (both count) | Normally only 1 birdie skin per team; double bonus allows the second to also count. Natural birdie = gross score ≤ par − 1 regardless of handicap. 2v2 only — no double birdie in 1v3. |

#### Team/Group Resolution per Bonus Skin

Same rules as base components:

| Format | Bonus winner's side wins | Bonus loser's side loses |
|--------|--------------------------|--------------------------|
| **2v2** | +$1 each team member | −$1 each opposing team member |
| **1v3** | wolf wins: +$3 wolf, −$1 each opp | wolf loses: −$3 wolf, +$1 each opp |
| **Skins hole** | +$3 individual | −$1 each other player |

#### 1v3 Bonus Rules

- Each individual bonus event (per player) generates a separate group skin.
- Multiple opponents with bonuses on the same hole each generate separate group skins (wolf pays for each).
- NO double birdie bonus in 1v3 (wolf is alone — no partner to double with).
- NO double greenie in 1v3.
- Opponent birdie → wolf −3, all 3 opps +1 (all 3 benefit, same as base group structure).

#### $21 Wolf Loss — Verified Example

Wolf going alone (1v3). One opponent chip-in eagles; a second opponent also makes a polie.

| # | Event | Wolf ΔΔ |
|---|-------|---------|
| 1 | Low ball (base) — wolf loses | −3 |
| 2 | Skin (base) — opp has unique low net ≤ par | −3 |
| 3 | Wolf bonus (base, mirrors LB) — wolf loses | −3 |
| 4 | Polie — Opponent 1 (chip-in eagle) | −3 |
| 5 | Polie — Opponent 2 | −3 |
| 6 | Birdie — auto-detected from eagle net score | −3 |
| 7 | Eagle — additional skin for eagle level | −3 |
| **Total** | 7 skins × $3 = **$21** wolf loses | −21 |

Each opponent gains $7 (+1 per skin × 7 skins). Zero-sum: −21 + 7 + 7 + 7 = 0 ✓

### Type Changes Required

**`types.ts` — Extend `PlayerHoleMoneyResult`:**

```typescript
export type PlayerHoleMoneyResult = {
  readonly lowBall: number;
  readonly skin: number;
  readonly teamTotalOrBonus: number;
  readonly blindWolf: number;
  readonly bonusSkins: number;   // NEW — sum of all bonus skin dollar amounts for this player
  readonly total: number;        // lowBall + skin + teamTotalOrBonus + blindWolf + bonusSkins
};
```

**`types.ts` — Add `BonusInput` and `BonusLevel`:**

```typescript
export type BonusLevel = 'birdie' | 'eagle' | 'double_eagle';

export type BonusInput = {
  /** Batting positions of players who won a valid greenie (par-3 only; scorer-determined) */
  readonly greenies: readonly BattingPosition[];
  /** Batting positions of players who recorded a valid polie */
  readonly polies: readonly BattingPosition[];
};
```

**⚠️ REGRESSION WARNING — Existing code/tests must be updated:**

Adding `bonusSkins` to `PlayerHoleMoneyResult` requires:
1. **`money.ts`**: Update the internal `player()` helper to accept `bonusSkins = 0` and include it in `total`:
   ```typescript
   function player(lowBall, skin, teamTotalOrBonus, blindWolf, bonusSkins = 0): PlayerHoleMoneyResult {
     return { lowBall, skin, teamTotalOrBonus, blindWolf, bonusSkins,
               total: lowBall + skin + teamTotalOrBonus + blindWolf + bonusSkins };
   }
   ```
2. **`validation.ts`**: Add `'bonusSkins'` to the `components` array in `validateZeroSum`.
3. **`validation.test.ts`**: Update `makeResult` helper to include `bonusSkins: p.bonusSkins ?? 0`. Update all inline `HoleMoneyResult` literals to add `bonusSkins: 0`.
4. **`money.test.ts`**: All inline `PlayerHoleMoneyResult` objects (if any constructed by hand — check) need `bonusSkins: 0`.

All 302 existing tests should still pass after these changes since `bonusSkins` defaults to 0.

### Function Signatures

**`detectBonusLevel`** in `bonuses.ts`:
```typescript
export function detectBonusLevel(netScore: number, par: number): BonusLevel | null
```

**`applyBonusModifiers`** in `bonuses.ts`:
```typescript
export function applyBonusModifiers(
  baseResult: HoleMoneyResult,
  netScores: readonly [number, number, number, number],
  grossScores: readonly [number, number, number, number],  // for natural birdie detection
  bonusInput: BonusInput,
  holeAssignment: HoleAssignment,
  wolfDecision: WolfDecision | null,
  par: 3 | 4 | 5,
): HoleMoneyResult
```

### Internal Design Notes

**Why `netScores` separately instead of inferring from `baseResult`?**
Net scores drive birdie/eagle detection. They're already available at bonus-application time. Passing them explicitly keeps `applyBonusModifiers` pure and testable.

**Why `grossScores`?**
Needed exclusively for natural birdie detection (`grossScore <= par - 1`). No other bonus requires gross scores.

**Bonus resolution helpers (internal to `bonuses.ts`):**
```typescript
// Resolve a single bonus skin as a team event in 2v2
function bonusSkinTeam(
  teamA: readonly [BattingPosition, BattingPosition],
  teamB: readonly [BattingPosition, BattingPosition],
  winningTeam: 'A' | 'B',
): readonly [number, number, number, number]

// Resolve a single bonus skin as a group event in 1v3
function bonusSkinGroup(
  wolfIdx: BattingPosition,
  opps: readonly [BattingPosition, BattingPosition, BattingPosition],
  wolfWins: boolean,
): readonly [number, number, number, number]

// Resolve a single bonus skin as an individual event (skins holes)
function bonusSkinIndividual(
  winnerIdx: BattingPosition,
): readonly [number, number, number, number]
```

**Accumulating bonus skins:**
Maintain a running `[number, number, number, number]` accumulator. For each bonus event, add the resolved skin values to the accumulator. At the end, add the accumulator to each player's `bonusSkins` field in the base result, recompute `total`.

**Birdie bonus counting in 2v2:**
- Count of birdies per team: `teamABirdieCount = teamA members where detectBonusLevel(netScores[i], par) !== null`
- Natural check: `grossScores[i] <= par - 1`
- `teamABirdieSkins`: if `teamABirdieCount >= 2 AND any teamA member has natural birdie` → 2; else if `teamABirdieCount >= 1` → 1; else 0
- Then apply eagle and double eagle skins independently per player (each eagle-level player generates +1 more skin for their team beyond the birdie skin; each double-eagle-level player generates +1 more beyond eagle)

**Eagle stacking logic in 2v2:**
- Eagle = birdie skin already counted above + 1 additional eagle-level skin for the eagle player's team
- Double eagle = birdie + eagle + 1 additional double-eagle-level skin
- These additional skins are PER PLAYER (not subject to the "1 per team" rule that birdie skins are). If both team members eagle, each generates their own eagle-level skin. (The birdie-level skins are what the double-birdie-bonus governs.)

**Eagle stacking logic in 1v3:**
Each level of each player's bonus is a separate group skin. Wolf eagles → wolf wins 2 group skins (+6/−2 each opp). Two opponents birdie → 2 separate group skins (wolf −6/each opp +2 total).

### Previous Story Learnings (from Stories 1.1–1.4)

- **`.js` extension required on all relative imports** — NodeNext module resolution. New `bonuses.ts` imports must use `import { foo } from './types.js'` etc.
- **`noUncheckedIndexedAccess: true` is active** — use `BattingPosition` typed indices; filter with type predicates; destructure with undefined guards.
- **`exactOptionalPropertyTypes: true` is active** — precise with optional properties.
- **`globals: false` in Vitest** — always import `describe`, `it`, `expect` from `'vitest'`.
- **Test files go in `src/`** — `src/bonuses.test.ts`
- **`ALL_POSITIONS` pattern** — `const ALL_POSITIONS: readonly BattingPosition[] = [0, 1, 2, 3]` (already in money.ts; consider extracting to a shared location or repeating).
- **`validateZeroSum` called at boundary** — `applyBonusModifiers` should call it before returning.
- **Zero-sum math check**: for any bonus skin in 2v2: +1+1−1−1=0 ✓; in 1v3: +3−1−1−1=0 ✓; individual: +3−1−1−1=0 ✓.

### Files to Create/Modify

- **Create:** `packages/engine/src/bonuses.ts` — `detectBonusLevel`, `applyBonusModifiers`
- **Create:** `packages/engine/src/bonuses.test.ts`
- **Modify:** `packages/engine/src/types.ts` — add `bonusSkins` to `PlayerHoleMoneyResult`; add `BonusLevel`, `BonusInput`
- **Modify:** `packages/engine/src/money.ts` — update `player()` helper; add `bonusSkins = 0` param; update total formula
- **Modify:** `packages/engine/src/validation.ts` — add `'bonusSkins'` to components list
- **Modify:** `packages/engine/src/validation.test.ts` — add `bonusSkins: 0` to `makeResult` helper and all inline fixtures
- **Modify:** `packages/engine/src/index.ts` — add `export * from './bonuses.js'`
- **Do NOT touch:** `stableford.ts`, `wolf.ts`, `course.ts`, `harvey.ts`, `money.test.ts` (money.test.ts tests only use `r[i].total`, `r[i].lowBall` etc., which still work — verify no literal HoleMoneyResult construction there)

### References

- FR14: Polie and greenie bonuses are team bonuses in 2v2; in 1v3, wolf earns against all 3 opponents individually [Source: epics.md]
- FR15: Auto-detect net birdies and eagles from gross scores and player handicap [Source: epics.md]
- FR16: Auto-calculate money applies greenie, polie, birdie, eagle, and double-bonus modifiers [Source: epics.md]
- Bonus rules confirmed with Josh in Story 1.5 design session (2026-02-28):
  - Birdie = 1 extra skin; Eagle = 2 extra skins (birdie level + eagle level); Double Eagle = 3 extra skins
  - Greenie = 1 skin (par-3 only, closest validated player); Double Greenie = 2 skins (both team members validate)
  - Polie = 1 skin per player (any putt > flagstick length on first putt; chip-in counts)
  - Double Birdie Bonus = 2 skins (both team members birdie, ≥1 natural); 2v2 only
  - All bonus skins in 1v3 use wolf $3/$1 group structure; no double bonus in 1v3
  - $21 wolf loss confirmed: 7 skins × $3 = $21 (3 base + polie + polie + birdie + eagle)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/engine/src/bonuses.ts` — new; detectBonusLevel, applyBonusModifiers
- `packages/engine/src/bonuses.test.ts` — new
- `packages/engine/src/types.ts` — add bonusSkins to PlayerHoleMoneyResult; add BonusLevel, BonusInput
- `packages/engine/src/money.ts` — update player() helper
- `packages/engine/src/validation.ts` — add bonusSkins to validateZeroSum
- `packages/engine/src/validation.test.ts` — update makeResult helper and fixtures
- `packages/engine/src/index.ts` — add export for bonuses.ts
