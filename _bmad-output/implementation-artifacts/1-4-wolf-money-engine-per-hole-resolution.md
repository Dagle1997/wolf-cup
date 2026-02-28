# Story 1.4: Wolf Money Engine — Per-Hole Resolution

Status: review

## Story

As a player,
I want money won and lost on each hole calculated correctly — skins holes (1–2), 2v2 wolf holes, and 1v3 lone wolf holes — so that end-of-round settlement is accurate.

## Acceptance Criteria

1. **Given** four players' net scores and a 2v2 wolf alignment
   **When** `calculateHoleMoney(netScores, holeAssignment, wolfDecision, par)` is called
   **Then** three independent TEAM components are resolved:
   - **Low ball:** team's best net vs opposing team's best net → winning team each +$1, losing team each −$1, tie → $0 all
   - **Skin:** team of the absolute low-net-ball player wins $1 each IF that player's net score ≤ par AND the low ball is unique; otherwise $0 all
   - **Team total:** sum of both team members' net scores compared → winning team each +$1, losing team each −$1, tie → $0 all
   **And** all four players net to exactly $0 per component

2. **Given** a lone wolf (1v3) alignment (`wolfDecision.type === 'alone'`)
   **When** `calculateHoleMoney` is called
   **Then** three independent GROUP components are resolved (wolf vs the 3 opponents collectively):
   - **Low ball:** wolf's net vs opponents' best net → wolf wins: wolf +$3, each opp −$1; wolf loses: wolf −$3, each opp +$1; tie → $0 all
   - **Skin:** wolf or opponents have the group's absolute low net (unique, ≤ par) → same $3/$1 payout structure as low ball; if tied or no net par → $0 all
   - **Bonus:** mirrors low ball result exactly
   **And** all four players net to exactly $0 per component
   **And** wolf wins all 3 → wolf +$9, each opponent −$3
   **And** wolf loses all 3 → wolf −$9, each opponent +$3

3. **Given** a blind wolf declaration (`wolfDecision.type === 'blind_wolf'`)
   **When** `calculateHoleMoney` is called
   **Then** the same 3 GROUP components as lone wolf apply
   **And** an extra blind-wolf bonus component is added:
   - Wolf wins low ball → extra bonus: wolf +$3, each opp −$1
   - Wolf loses or ties low ball → extra bonus: $0 all (no additional penalty)
   **And** blind wolf full win: wolf +$12, each opp −$4
   **And** blind wolf full loss: wolf −$9, each opp +$3 (same as regular lone wolf)

4. **Given** a skins hole (holes 1–2, `holeAssignment.type === 'skins'`)
   **When** `calculateHoleMoney` is called
   **Then** only the skin component applies: the player with the absolute lowest net score wins $1 from each other player (+$3 winner, −$1 others), IF the low ball is unique AND ≤ par; otherwise $0 all

5. **Given** all four players tie on any component
   **When** `calculateHoleMoney` is called
   **Then** that component pays $0 for all players (no blood on that component)

6. **Given** any `HoleMoneyResult`
   **When** `validateZeroSum(result)` is called
   **Then** it throws `ZeroSumViolationError` if any component (`lowBall`, `skin`, `teamTotalOrBonus`, `blindWolf`, `total`) does not sum to exactly $0 across all four players
   **And** the error contains the violating component name and actual sum

## Tasks / Subtasks

- [x] Task 1: Add types to `types.ts` (AC: 1–6)
  - [x] 1.1 Add `WolfDecision` union type: `partner` (with `partnerBatterIndex`) | `alone` | `blind_wolf`
  - [x] 1.2 Add `PlayerHoleMoneyResult` type: `lowBall`, `skin`, `teamTotalOrBonus`, `blindWolf`, `total` (all `number`)
  - [x] 1.3 Add `HoleMoneyResult` type: 4-tuple `readonly [P, P, P, P]` indexed by batting position
  - [x] 1.4 Add `ZeroSumViolationError` class with `component` and `sum` fields

- [x] Task 2: Write failing tests for `validateZeroSum` in `validation.test.ts` (AC: 6)
  - [x] 2.1 Valid zero-sum result passes without throwing
  - [x] 2.2 `lowBall` sum ≠ 0 → throws `ZeroSumViolationError` with `component === 'lowBall'`
  - [x] 2.3 `skin` sum ≠ 0 → throws with `component === 'skin'`
  - [x] 2.4 `teamTotalOrBonus` sum ≠ 0 → throws with correct component name
  - [x] 2.5 `total` sum ≠ 0 → throws with `component === 'total'`
  - [x] 2.6 Error `sum` field contains the actual (non-zero) sum

- [x] Task 3: Write failing tests for `calculateHoleMoney` in `money.test.ts` (AC: 1–5)
  - [x] 3.1 Skins hole: unique low ball ≤ par → winner +3, others −1
  - [x] 3.2 Skins hole: tied low ball → all $0
  - [x] 3.3 Skins hole: low ball worse than par → all $0
  - [x] 3.4 2v2: full sweep (team A wins low ball + skin + total) → each +3 / −3
  - [x] 3.5 2v2: team A wins low ball + skin, ties total → each +2 / −2
  - [x] 3.6 2v2: low ball winner no net par (no skin) → low ball + total only
  - [x] 3.7 2v2: all 4 players tie → all $0
  - [x] 3.8 2v2: zero-sum validated on every result (no internal ZeroSumViolationError thrown from valid results)
  - [x] 3.9 1v3 alone: wolf wins all 3 → wolf +9, each opp −3
  - [x] 3.10 1v3 alone: wolf loses all 3 → wolf −9, each opp +3
  - [x] 3.11 1v3 alone: wolf ties low ball → all $0
  - [x] 3.12 1v3 alone: wolf wins low ball but no skin (low ball worse than par) → low ball + bonus only (wolf +6)
  - [x] 3.13 1v3 alone: opponent has skin (opp low ball unique ≤ par) → wolf loses skin component −3, opps +1
  - [x] 3.14 1v3 blind_wolf: wolf wins all 3 + blind bonus → wolf +12, each opp −4
  - [x] 3.15 1v3 blind_wolf: wolf loses all 3 → wolf −9, each opp +3 (no blind wolf penalty)
  - [x] 3.16 1v3 blind_wolf: wolf ties low ball → blind wolf extra $0 (no bonus, no penalty)
  - [x] 3.17 All results pass `validateZeroSum` — no valid result should trigger it

- [x] Task 4: Implement `validateZeroSum` in `validation.ts` (AC: 6)
  - [x] 4.1 For each component key, sum values across all 4 players
  - [x] 4.2 Throw `ZeroSumViolationError` with component name + sum if any ≠ 0

- [x] Task 5: Implement `calculateHoleMoney` in `money.ts` (AC: 1–5)
  - [x] 5.1 Dispatch on `holeAssignment.type`: `'skins'` vs `'wolf'`
  - [x] 5.2 Implement skins hole calculation (skin only, individual payout)
  - [x] 5.3 Implement 2v2 team calculation (low ball, skin, team total — all team-based)
  - [x] 5.4 Implement 1v3 lone wolf calculation (low ball, skin, bonus — all group-based)
  - [x] 5.5 Apply blind wolf extra component (bonus if wolf wins low ball; zero if wolf loses or ties)
  - [x] 5.6 Build `HoleMoneyResult` tuple with `total` = sum of all components per player

- [x] Task 6: Run full suite and typecheck
  - [x] 6.1 `pnpm --filter @wolf-cup/engine test` — all tests pass
  - [x] 6.2 `pnpm --filter @wolf-cup/engine typecheck` — zero errors
  - [x] 6.3 `pnpm -r lint` — zero warnings

## Dev Notes

### Previous Story Learnings (from Stories 1.1–1.3)

- **`.js` extension required on all relative imports** — NodeNext module resolution. Always `import { foo } from './foo.js'` even though source is `.ts`.
- **`noUncheckedIndexedAccess: true` is active** — array indexing returns `T | undefined`. Use index guards or destructuring.
- **`exactOptionalPropertyTypes: true` is active** — be precise with optional properties.
- **`globals: false` in Vitest** — always import `describe`, `it`, `expect` from `'vitest'`.
- **Test files go in `src/`** — e.g. `src/money.test.ts`, `src/validation.test.ts`.
- **Replace stubs entirely** — `money.ts` and `validation.ts` currently contain just `export {}`. Remove and replace the whole file.
- **No external dependencies** — pure TypeScript, zero imports from outside `packages/engine`.
- **`InvalidHoleError` pattern** — see `types.ts` for how custom errors extend `Error`. Follow same pattern for `ZeroSumViolationError`.

### The 3-Component Money Model

The Wolf Cup game is built on **3 independent components per hole**, each worth $1 per player.
Zero-sum is enforced per component (sum of all 4 players = $0).

#### Skins Holes (1–2) — `holeAssignment.type === 'skins'`

One component only: **skin (individual payout)**

| Condition | Payout |
|-----------|--------|
| Unique absolute low net ball AND net score ≤ par | Winner +$3, each other player −$1 |
| Tied low ball OR low ball > par | All $0 (no blood) |

No wolf decision is made on skins holes. `wolfDecision` will be `null`.

---

#### 2v2 Wolf Holes — `wolfDecision.type === 'partner'`

Team assignment:
- `wolfPlayerIdx = holeAssignment.wolfBatterIndex`
- `partnerIdx = wolfDecision.partnerBatterIndex`
- Team A = `[wolfPlayerIdx, partnerIdx]`
- Team B = the other two batting positions

Three **TEAM components** (all resolve the same way: winning team each +$1, losing team each −$1, tie $0):

| Component | Comparison | Note |
|-----------|------------|------|
| **Low ball** | `min(teamA scores)` vs `min(teamB scores)` | Tie if equal |
| **Skin** | Same as low ball result | Only awarded if the absolute low ball is unique AND ≤ par; otherwise $0 all |
| **Team total** | `sum(teamA scores)` vs `sum(teamB scores)` | Independent of low ball |

**Key insight:** In 2v2, the skin always goes to the low-ball winning team (since the absolute low ball is the winning team's best player by definition). The skin is simply the low-ball result gated by `netPar` — it does NOT pay out to the individual skin holder (+$3); both team members win the same +$1.

**Max sweep:** +$3/+$3/−$3/−$3 across all 3 components. Zero-sum: +3+3−3−3=0 ✓

Example verification:
```
netScores: [3, 4, 5, 6]  par: 5  wolf: pos 0  partner: pos 1
Low ball:   Team A = min(3,4)=3  vs  Team B = min(5,6)=5  → A wins (+1/+1/−1/−1)
Skin:       Absolute low = 3 (pos 0), unique, 3 ≤ 5 ✓  → A wins (+1/+1/−1/−1)
Team total: Team A = 3+4=7  vs  Team B = 5+6=11  → A wins (+1/+1/−1/−1)
Result:     pos0=+3, pos1=+3, pos2=−3, pos3=−3  ✓
```

---

#### 1v3 Lone Wolf — `wolfDecision.type === 'alone'`

The wolf plays against the 3 opponents as a **group**. Each component: wolf +$3/−$3, each opponent −$1/+$1.

```
wolfIdx = holeAssignment.wolfBatterIndex
oppIndices = [0, 1, 2, 3].filter(i => i !== wolfIdx)
```

Three **GROUP components**:

| Component | Resolution | Wolf wins | Wolf loses | Tie |
|-----------|------------|-----------|------------|-----|
| **Low ball** | wolf net vs `min(opp nets)` | wolf +3, opps −1 | wolf −3, opps +1 | $0 all |
| **Skin** | who has absolute low net (unique, ≤ par) | wolf +3, opps −1 | wolf −3, opps +1 | $0 all |
| **Bonus** | mirrors low ball result exactly | wolf +3, opps −1 | wolf −3, opps +1 | $0 all |

**Skin in 1v3 detail:**
- Find the absolute minimum of all 4 net scores
- If that minimum is unique AND ≤ par:
  - Wolf has it → wolf wins skin (+3/−1 each opp)
  - An opponent has it → opponents win skin (wolf −3, each opp +1)
- Tied for minimum OR minimum > par → no skin ($0 all)

Note: if an opponent wins skin, **all 3 opponents benefit equally** (+$1 each) even though only one of them had the low ball. This is the group-vs-wolf structure — not individual payout.

**Full win:** wolf +9 (3 × +3), each opp −3 (3 × −1). Sum: 9−3−3−3=0 ✓
**Full loss:** wolf −9 (3 × −3), each opp +3 (3 × +1). Sum: −9+3+3+3=0 ✓

---

#### Blind Wolf — `wolfDecision.type === 'blind_wolf'`

Blind wolf is called **before anyone (including the wolf) sees their drive**. It is a modifier on the lone wolf (1v3) scenario.

Same 3 GROUP components as `alone`, plus:

| Extra component | Condition | Payout |
|-----------------|-----------|--------|
| **Blind wolf bonus** | Wolf WON the low ball component | wolf +3, each opp −1 |
| | Wolf TIED or LOST low ball | $0 all (no extra penalty) |

**The asymmetry is intentional:** blind wolf is a risk-free upside — the wolf can only gain from calling it, never be penalized extra for it.

**Full win (all 3 base + blind bonus):** wolf +12 (4 × +3), each opp −4 (4 × −1). Sum: 12−4−4−4=0 ✓
**Full loss:** wolf −9, each opp +3 (same as regular lone wolf — blind wolf adds no penalty)

---

### Function Signatures

**`calculateHoleMoney`** in `money.ts`:
```typescript
export function calculateHoleMoney(
  netScores: readonly [number, number, number, number],  // batting positions 0–3
  holeAssignment: HoleAssignment,
  wolfDecision: WolfDecision | null,  // null on skins holes (type: 'skins')
  par: 3 | 4 | 5,
): HoleMoneyResult
```

**`validateZeroSum`** in `validation.ts`:
```typescript
export function validateZeroSum(result: HoleMoneyResult): void  // throws ZeroSumViolationError
```

---

### New Types to Add to `types.ts`

```typescript
export type WolfDecision =
  | { readonly type: 'partner'; readonly partnerBatterIndex: BattingPosition }
  | { readonly type: 'alone' }
  | { readonly type: 'blind_wolf' };

export type PlayerHoleMoneyResult = {
  readonly lowBall: number;           // 0 on skins holes
  readonly skin: number;
  readonly teamTotalOrBonus: number;  // team total (2v2) | bonus (1v3) | 0 (skins hole)
  readonly blindWolf: number;         // 0 unless blind_wolf and wolf wins low ball
  readonly total: number;             // sum of above
};

export type HoleMoneyResult = readonly [
  PlayerHoleMoneyResult,  // batting position 0
  PlayerHoleMoneyResult,  // batting position 1
  PlayerHoleMoneyResult,  // batting position 2
  PlayerHoleMoneyResult,  // batting position 3
];

export class ZeroSumViolationError extends Error {
  constructor(
    public readonly component: 'lowBall' | 'skin' | 'teamTotalOrBonus' | 'blindWolf' | 'total',
    public readonly sum: number,
  ) {
    super(`Zero-sum violation on '${component}' component: sum=${sum}`);
    this.name = 'ZeroSumViolationError';
  }
}
```

---

### Helper Patterns

**Finding the two opponents in 2v2:**
```typescript
const teamA = new Set([wolfIdx, partnerIdx]);
const teamB = ([0, 1, 2, 3] as const).filter(i => !teamA.has(i)) as [number, number];
// noUncheckedIndexedAccess: use explicit index checks or destructure safely
```

**Resolving a team component:**
```typescript
function teamComponent(aWins: boolean, bWins: boolean): [number, number, number, number] {
  // aWins and bWins are mutually exclusive (compare scores)
  // returns [pos0, pos1, pos2, pos3] with +1/-1/0 per player based on team membership
}
```

**Skin uniqueness check:**
```typescript
const minNet = Math.min(...netScores);
const minCount = netScores.filter(s => s === minNet).length;
const hasSkin = minCount === 1 && minNet <= par;
```

---

### Key Edge Cases to Test

| Scenario | Expected |
|----------|----------|
| 2v2: team A wins low ball (no net par) | low ball +1, skin $0, total may vary |
| 2v2: all 4 scores equal | all $0 (3 ties) |
| 1v3: wolf score = opponent's best ball | tie on low ball + bonus = $0; skin resolves separately |
| 1v3: two opponents tie for low ball (both ≤ par) | skin tied → $0 on skin |
| 1v3: wolf has low ball but > par | wolf wins low ball + bonus, but skin = $0 |
| blind wolf: wolf ties on low ball | blind wolf extra = $0 (tie counts as "not winning") |
| blind wolf: wolf loses all 3 | same as regular lone wolf |

---

### Files to Create/Modify

- **Modify:** `packages/engine/src/types.ts` — add `WolfDecision`, `PlayerHoleMoneyResult`, `HoleMoneyResult`, `ZeroSumViolationError`
- **Replace stub:** `packages/engine/src/money.ts` — implement `calculateHoleMoney`
- **Replace stub:** `packages/engine/src/validation.ts` — implement `validateZeroSum`
- **Create:** `packages/engine/src/money.test.ts`
- **Create:** `packages/engine/src/validation.test.ts`
- **Do NOT touch:** `index.ts` (already exports `* from './money.js'` and `* from './validation.js'`)
- **Do NOT touch:** `stableford.ts`, `wolf.ts`, `course.ts`, `harvey.ts`

### References

- FR2, FR3, FR11–FR19: wolf money engine, skins, zero-sum [Source: epics.md Requirements Inventory]
- NFR1–NFR3: zero-sum is a critical invariant; violations must surface immediately [Source: epics.md NonFunctional Requirements]
- Architecture data flow: `validation.assertZeroSum(moneyResults)` called after `money.calculate()` [Source: architecture.md Score Submission Data Flow]
- `BattingPosition`, `HoleAssignment`, `CourseHole.par` type: already in `types.ts`
- NodeNext `.js` import requirement [Source: Story 1.1 dev notes]
- `noUncheckedIndexedAccess` constraint [Source: Story 1.1 tsconfig.base.json]
- Wolf money rules clarified by Josh in Story 1.4 design session (2026-02-28):
  - 3 components in 2v2: low ball (team), skin (team), team total (team)
  - 3 components in 1v3: low ball (group), skin (group), bonus = mirrors low ball (group)
  - Blind wolf: +1 extra group component if wolf wins low ball; no extra penalty if wolf loses
  - Skin in 2v2 is team-based (both team members win/lose equally); skin winner does NOT collect individually
  - Skin in 1v3 is group-based (all opponents benefit equally when any opponent has the skin)
  - Skins holes (1-2): individual skin only (+$3/−$1)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

Fixed `noUncheckedIndexedAccess` TypeScript errors: changed all array-filtered indices (`teamB`, `oppIndices`) from `number` to `BattingPosition` via destructuring with undefined guards. Fixed unused variable in test (line 51 of money.test.ts).

### Completion Notes List

- Added `WolfDecision`, `PlayerHoleMoneyResult`, `HoleMoneyResult`, `ZeroSumViolationError` to `types.ts`.
- Implemented `validateZeroSum` in `validation.ts`: checks all 5 components sum to $0, throws typed error on violation.
- Implemented `calculateHoleMoney` in `money.ts`: dispatches on skins vs wolf hole, 2v2 vs 1v3 vs blind_wolf. All results pass `validateZeroSum` internally.
- Created `money.test.ts` (39 tests) and `validation.test.ts` (12 tests).
- 302/302 tests pass. 0 typecheck errors. 0 lint warnings.
- Key design decisions confirmed with user during story creation: 3 components in 2v2 (low ball team, skin team, team total); 3 group components in 1v3 (low ball, skin, bonus mirrors low ball); blind wolf = asymmetric upside only (+bonus if wolf wins, no penalty if wolf loses).

### File List

- `packages/engine/src/types.ts` — added WolfDecision, PlayerHoleMoneyResult, HoleMoneyResult, ZeroSumViolationError
- `packages/engine/src/money.ts` — replaced stub; exports calculateHoleMoney
- `packages/engine/src/validation.ts` — replaced stub; exports validateZeroSum
- `packages/engine/src/money.test.ts` — new; 39 tests
- `packages/engine/src/validation.test.ts` — new; 12 tests
