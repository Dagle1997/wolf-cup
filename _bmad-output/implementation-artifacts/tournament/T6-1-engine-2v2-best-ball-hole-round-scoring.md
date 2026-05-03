# T6-1: Engine — 2v2 Best Ball Hole/Round Scoring (pairwise attribution) [new]

## Status

Done

## Story

As a developer,
I want `apps/tournament-api/src/engine/formats/best-ball-2v2.ts` as a pure function computing per-hole and per-round team money for 2v2 best ball with sandies + greenies, parameterized by rule-set config, returning pairwise money attribution in INTEGER CENTS,
So that the Guyan Game's core math is deterministic, golden-file-testable, float-free, and reusable by the money service (FR-D1, NFR-C1, NFR-C2).

T6-1 is the FIRST story in epic T6 (rules engine, money, bets, settle-up). It establishes the **integer-cents discipline** that locks across the entire epic + the **pairwise attribution** convention (4 pair cells per 2v2 hole, anti-symmetric) that the head-to-head matrix (T6-5) and settle-up (T6-6) consume.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/engine/formats/best-ball-2v2.ts                       [NEW]
apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts                  [NEW]
apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-a-straight-win.json     [NEW]
apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-b-sandies-scattered.json [NEW]
apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-c-greenies-every-par3.json [NEW]
apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-d-no-valid-greenies.json [NEW]
apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-e-handicap-shifts.json   [NEW]
apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-f-tie-hole.json          [NEW]
apps/tournament-api/src/engine/handicap-strokes.ts                            [NEW]
apps/tournament-api/src/engine/handicap-strokes.test.ts                       [NEW]
apps/tournament-api/src/services/handicap.ts                                  [MOD: re-export calcCourseHandicap from engine; preserve existing API]
```

11 files total — 10 NEW + 1 additive MOD, all under `apps/tournament-api/**`. Zero SHARED, zero FORBIDDEN. No package.json change, no pnpm-lock.yaml touch, no eslint config change.

**The 1 MOD on `services/handicap.ts`** is the layering tidy-up per Section 2b — `calcCourseHandicap` moves into the engine layer; the services file becomes a thin re-export so T5-5's existing leaderboard.ts callers continue to compile unchanged. The `allocateNetThroughHole` function stays in services.

**Note on the engine subdirectory `formats/`:** the directory does not yet exist (`ls apps/tournament-api/src/engine` returns `pairings` + `validators`). Creating `formats/` is part of this story; it matches the architecture doc's structural plan (line 1007 of architecture.md: `engine/formats/best-ball-2v2.ts`).

### 2. Architectural decision — engine import boundary (the load-bearing v1 call)

The epic spec line says: *"Imports `stableford.ts` from `@wolf-cup/engine` (sole shared-engine dependency; enforced by ESLint rule per T1)."*

**Reality check** (from observed artifacts):
- `apps/tournament-api/eslint.config.js:14-23` allows ONLY `@wolf-cup/engine/stableford` subpath import; root `@wolf-cup/engine` import is rejected; any other subpath rejected.
- `packages/engine/package.json:6-11` defines exports only for `.` (root) — there is NO `./stableford` subpath export. Importing `@wolf-cup/engine/stableford` would fail at module-resolution time.
- `apps/tournament-api/package.json` does NOT depend on `@wolf-cup/engine` at all (verified via grep + package.json read).

So the eslint rule was written aspirationally for a `/stableford` subpath that the engine package never exposed. Three viable resolutions:

- **(A) Inline-port `getHandicapStrokes` into `apps/tournament-api/src/engine/handicap-strokes.ts`** — mirrors T5-5's already-established precedent of inlining `calcCourseHandicap` into `services/handicap.ts:40-60` rather than importing from `@wolf-cup/engine`. Followup T6-1a tracks consolidation when/if packages/engine exposes a stable subpath surface. **NO SHARED/FORBIDDEN gates fire.** v1 ships ALLOWED-only.
- **(B) Add `./stableford` subpath export to `packages/engine/package.json` + add `@wolf-cup/engine` to `apps/tournament-api/package.json`.** Three problem files: `packages/engine/package.json` (FORBIDDEN — Wolf Cup boundary), `apps/tournament-api/package.json` (ALLOWED — workspace dep is harmless), `pnpm-lock.yaml` (SHARED — workspace deps still touch the lockfile when added). Tournament-director cannot approve the FORBIDDEN edit; this requires per-session user approval AND coordinated Wolf Cup CI.
- **(C) Relax tournament's eslint rule to allow `@wolf-cup/engine` root import + add the workspace dep.** Two problem files: `apps/tournament-api/eslint.config.js` (ALLOWED), `apps/tournament-api/package.json` (ALLOWED), `pnpm-lock.yaml` (SHARED). Architecturally weaker than (B) — root import lets the rest of the engine surface leak in.

**v1 ships (A)** — matches T5-5 precedent, smallest blast radius, zero gates fire. The architectural concern (FD-11/12 "stableford is the sole shared surface") is preserved by tracking Followup T6-1a.

### 2b. Engine→services layering (codex-flagged Med #7)

Architecture D1-1 (architecture.md:467) says: *"engine lives in `apps/tournament-api/src/engine/` and is called by `src/services/money.ts`; services are called by route handlers. Routes never import engine directly; engine never writes to DB directly."* The narrow read is engine MUST NOT import from services.

`getHandicapStrokes` calls `calcCourseHandicap` (a pure function); today `calcCourseHandicap` lives in `services/handicap.ts:40-60` because T5-5 placed it there as a "leaderboard support helper". Two options:

- **(A) Promote the math into the engine layer.** `apps/tournament-api/src/engine/handicap-strokes.ts` houses BOTH `getHandicapStrokes` (per-hole strokes) AND a copy of the slope-aware `calcCourseHandicap` arithmetic (it's 5 lines: `Math.round(handicapIndex × slope / 113 + (rating × 10 − coursePar × 10) / 10)`). The services-layer `calcCourseHandicap` then re-exports from engine. Nets out as: engine is the source of truth for handicap math; services re-exports for read-side callers (T5-5 leaderboard).
- **(B) Allow engine→services for pure-function helpers explicitly.** Document that D1-1's letter is a guard against engine→DB, not engine→pure-helper. Less work but weakens the invariant.

**v1 ships (A)** — engine is the right home for handicap math. The promotion is additive: `services/handicap.ts` becomes a thin wrapper that delegates `calcCourseHandicap` to `engine/handicap-strokes.ts`'s implementation while preserving its existing public API (`CourseHandicapInput` type stays defined in services; `allocateNetThroughHole` stays in services). T5-5's tests + leaderboard.ts callers continue to compile unchanged.

The path footprint (Section 1) reflects this: `apps/tournament-api/src/engine/handicap-strokes.ts` is NEW and hosts `calcCourseHandicap` + `getHandicapStrokes`; `apps/tournament-api/src/services/handicap.ts` is a 1-line MOD to delegate. Both ALLOWED.

### 3. Per-hole handicap strokes — the ONLY math we need from the "stableford engine"

2v2 best ball mathematically needs:

1. Per-player per-hole NET score = `grossStrokes - handicapStrokes(handicapIndex, holeStrokeIndex, tee)`.
2. Per-team best-ball net = `min(player1 net, player2 net)` for each hole.
3. Compare team-A best vs team-B best; lower-net wins the hole.
4. Apply pair-attribution: 4 pair cells per won hole at `basePerHoleCents` each.

**`calculateStablefordPoints` (the points table) is NOT needed by 2v2 best ball.** It's a separate function used by Wolf Cup's Stableford game format, not by best-ball. The epic line "imports stableford.ts" overreached — what's actually needed is `getHandicapStrokes` (per-hole strokes given HI + SI + tee) which lives in the same file but is the SI-allocation function, not the points-table function. T6-1 spec corrects this scope.

`apps/tournament-api/src/engine/handicap-strokes.ts` exports BOTH `calcCourseHandicap` (relocated from `services/handicap.ts` per Section 2b) AND `getHandicapStrokes`. Math mirrors `packages/engine/src/stableford.ts:11-16`. The plus-handicap clamp at the end (`Math.max(0, ...)`) is EXPLICIT per AC-13(vii) — without it, `Math.floor(ch / 18)` returns `-1` for `ch === -3` and the function emits negative strokes.

```ts
export type TeeShape = {
  slope: number;          // e.g., 113
  ratingTimes10: number;  // e.g., 720 (USGA rating × 10)
  coursePar: number;      // 72
};

// USGA slope-adjusted course handicap (relocated from services/handicap.ts).
// Rounding follows JS `Math.round` (half-toward-+∞). T5-5 already shipped
// this behavior and 14 existing handicap.test.ts cases pin it; this story
// preserves the established semantics rather than introducing a divergent
// rounding rule. Followup T6-1f tracks a future audit if Wolf Cup adopts
// half-away-from-zero (USGA's strict rule).
export function calcCourseHandicap(input: { handicapIndex: number; slope: number; ratingTimes10: number; coursePar: number; }): number {
  const { handicapIndex, slope, ratingTimes10, coursePar } = input;
  // Input validation: throws on non-finite numbers and non-positive slope/rating/par.
  const rating = ratingTimes10 / 10;
  const result = Math.round(handicapIndex * (slope / 113) + (rating - coursePar));
  return result === 0 ? 0 : result;  // -0 normalized to 0
}

export function getHandicapStrokes(
  handicapIndex: number,
  strokeIndex: number,
  tee: TeeShape,
): number {
  const ch = calcCourseHandicap({ handicapIndex, ...tee });
  // Plus-handicap clamp — AC-13(vii). v1 doesn't propagate negative strokes.
  if (ch <= 0) return 0;
  const base = Math.floor(ch / 18);
  const extra = ch % 18;
  return base + (strokeIndex <= extra ? 1 : 0);
}
```

`services/handicap.ts` becomes a thin re-export — but its existing `CourseHandicapInput` type (which includes `handicapIndex`, NOT just the tee fields) MUST stay intact to avoid breaking T5-5 callers:

```ts
// services/handicap.ts (post-T6-1)
import { calcCourseHandicap as engineCalcCourseHandicap } from '../engine/handicap-strokes.js';

// CourseHandicapInput is the FULL input shape — handicapIndex + tee fields.
// Stays defined here so T5-5 leaderboard.ts and other callers continue compiling unchanged.
export type CourseHandicapInput = {
  handicapIndex: number;
  slope: number;
  ratingTimes10: number;
  coursePar: number;
};

export function calcCourseHandicap(input: CourseHandicapInput): number {
  return engineCalcCourseHandicap(input);  // wraps engine function; preserves T5-5's argument shape contract
}

// `allocateNetThroughHole` STAYS in services (not engine). Pure-function helper for partial-round leaderboards; T5-5 owns it.
export function allocateNetThroughHole(input: NetAllocationInput): number { /* unchanged from T5-5 impl */ }
export type NetAllocationInput = { courseHandicap: number; throughHole: number };
```

The engine's `TeeShape` (just `slope/ratingTimes10/coursePar`) is the SUBSET of `CourseHandicapInput` without `handicapIndex`. The two types are complementary, not aliases. T5-5's existing `CourseHandicapInput` type lives ONLY in `services/handicap.ts`; engine code uses `TeeShape` directly.

Tee shape is tournament's own; the Wolf Cup `Tee` type from `packages/engine/src/course.ts` is NOT imported (architectural cleanliness — tournament has its own course schema).

### 4. Integer-cents discipline (locks across the entire epic)

All money values stored + transmitted as INTEGER CENTS. Per the epic preamble (line 1697):
- Schema columns will be `INTEGER NOT NULL` (T6-1 has no schema; T6-5 lands the matrix table).
- TypeScript: `number` representing cents. `1000` = "$10.00".
- Division uses integer division + remainder distribution (no `/`-without-floor on money). T6-1's only division op is "team delta = 4 × basePerHole" which is multiplicative, no division needed at this layer.
- UI formats `cents → $X.XX` at render only.

Test fixtures assert all integer values. The pure function MUST return only integers in any money-typed field.

### 5. Pairwise attribution convention (the matrix shape T6-5 consumes)

A 2v2 hole has 4 cross-team player pairs:

```
team A = { A1, A2 }
team B = { B1, B2 }
pairs  = (A1↔B1), (A1↔B2), (A2↔B1), (A2↔B2)
```

When team A wins a hole at `basePerHoleCents = 100`:
- `perPair[A1][B1] = +100`  (A1 wins $1 from B1)
- `perPair[A1][B2] = +100`
- `perPair[A2][B1] = +100`
- `perPair[A2][B2] = +100`
- Symmetric: `perPair[B1][A1] = −100`, etc. (anti-symmetric matrix.)
- Hole's `teamDeltaCents = +4 × 100 = +400` (signed: positive = team A wins).

**Same pair attribution for sandies + greenies bonuses** (per epic line 1699): each bonus adds to all 4 pair cells.

### 6. Sandies + greenies pair attribution (FD-12 tie-in)

- **Sandies:** when a winning-team player makes par (or better) from a bunker, add `sandiesBonusPerHoleCents` to the hole's team delta AND distribute pairwise (4 cells, same direction as the base win). Sandies on a TIED hole: no money flows. Sandies on a LOST hole: no money flows (sandies amplifies a win, doesn't create one).
- **Greenies (par 3):** when a winning-team player is on the green in regulation AND meets `greenieValidation` (e.g., 2-putt), the hole emits `greenieAwarded = { team, valueCents, carriedFromHoles, multiplier }`. T6-1 emits the AWARD or null; the carry-over walk (multiplier > 1) is T6-12's responsibility. T6-1's `greenieAwarded.multiplier` is always `1` and `carriedFromHoles` is always `[]`.
- **No-valid-greenie state (par 3 nobody on in regulation OR validation fails):** `greenieAwarded = null`. T6-1 does NOT track "queued for next par 3" — that's T6-12 state machinery; T6-1's outputs are stateless per hole.

### 7. Sandies + greenies INPUT shape — what does T6-1 receive? (codex-revised)

T6-1 is a PURE function; it can't observe shot tracking. **All bonus eligibility comes from explicit per-cell flags in the input.** Two distinct input shapes:

**Per-player-per-hole `holeScores` record (one per cell):**
```ts
type HoleScoreInput = {
  playerId: string;
  holeNumber: number;
  grossStrokes: number;
  putts: number | null;
  sandyFromBunker?: boolean; // foursome attests at score-entry; T6-1 trusts the flag
};
```

**Per-hole `holeMeta` record (one per played hole, NOT per player):**
```ts
type HoleMetaInput = {
  holeNumber: number;                     // 1..18
  closestToPinPlayerId?: string | null;   // par-3 only; null when nobody on green / no greenie
};
```

The greenie winner is **explicit, not derived**: `closestToPinPlayerId` IS who hit closest to the pin (already determined by the foursome at score-entry). T6-1 awards the greenie if AND only if (i) the hole is par 3, (ii) `closestToPinPlayerId` is set, (iii) that player is on the WINNING team, AND (iv) for `greenieValidation === '2-putt'`, that player's `putts ≤ 2`. Per-pair attribution then follows the standard 4-pair convention (Section 5).

**Why explicit `closestToPinPlayerId` over `greenInRegulation` per-player:** "in regulation" + nearest-to-pin would require shot-tracking data the score-entry UI doesn't capture. The CTP signal IS the trip-day reality (Cassador types it in after each par 3). T5-4's offline cache + T5-2 score-entry already establish this human-attest pattern.

`compute2v2BestBall`'s `Compute2v2BestBallInput` therefore takes `holeMeta: HoleMetaInput[]` alongside `holeScores`. Holes without a corresponding `holeMeta` record are treated as "no greenie awarded".

**Risk #4 (out-of-scope schema delta):** tournament's `hole_scores` schema (T5-1, scoring.ts:103-149) does NOT have columns for `sandyFromBunker` / `closestToPinPlayerId`. Adding them is a SHARED migration outside T6-1 scope. T6-1's pure function ACCEPTS the signals as inputs (test fixtures provide them); the persistence layer is a downstream story. Followup T6-1b tracks the schema add (likely landed alongside T6-4 score-commit hook).

### 8. Tee data shape (slope-aware handicap)

Per T5-5's precedent, `Tee` here is `{ slope, ratingTimes10, coursePar }` — the inputs to `calcCourseHandicap`. The tournament `course_tees` schema (T2-1, courses.ts) carries these fields. T6-1's `compute2v2BestBall` accepts `course: { tee: Tee, holes: Array<{ par, strokeIndex }> }` as the slope-aware shape; the route layer (T6-5 / T6-9) maps DB rows into this shape.

### 9. Pure function guarantees (NFR-C1)

`compute2v2BestBall`:
- No DB access.
- No I/O (no `fetch`, no `fs`, no `Date.now()`).
- No env access.
- Determinism: same input → byte-for-byte identical output across calls.
- No mutation of input arguments. Returns new objects.

Test (g) (deterministic replay) calls the function twice with structurally cloned input and asserts deep-equal output.

## Acceptance Criteria

(Derived from epics-phase1.md T6.1 lines 1701–1745.)

**AC-1 — File location + signature + complete type surface.**
**Given** `apps/tournament-api/src/engine/formats/best-ball-2v2.ts`
**When** inspected
**Then** it exports the function `compute2v2BestBall` AND every type referenced below. Types are nominal; the test file imports them. `TeeShape` is imported from `../handicap-strokes.js` (defined there per Section 3) and re-exported here for convenience — NOT redefined locally.

```ts
import type { TeeShape } from '../handicap-strokes.js';
export type { TeeShape };

export type HoleShape = {
  holeNumber: number;     // 1..18
  par: 3 | 4 | 5;
  strokeIndex: number;    // 1..18
};

export type HoleScoreInput = {
  playerId: string;
  holeNumber: number;     // 1..18
  grossStrokes: number;   // ≥ 1 integer
  putts: number | null;
  sandyFromBunker?: boolean;  // optional; default false
};

export type HoleMetaInput = {
  holeNumber: number;     // 1..18
  closestToPinPlayerId?: string | null;  // par-3 only; null = no greenie this par-3
};

export type BestBall2v2Config = {
  basePerHoleCents: number;             // INTEGER ≥ 0
  sandies: boolean;
  sandiesBonusPerHoleCents: number;     // INTEGER ≥ 0; ignored when sandies=false
  greenieCarryover: boolean;            // T6-1 emits; carry walk owned by T6-12
  greenieValidation: '2-putt' | 'none';
  greenieBaseCents: number;             // INTEGER ≥ 0
};

export type Compute2v2BestBallInput = {
  holeScores: HoleScoreInput[];
  holeMeta: HoleMetaInput[];
  pairings: { teamA: [string, string]; teamB: [string, string] };
  config: BestBall2v2Config;
  course: { tee: TeeShape; holes: HoleShape[] };
  handicapIndexByPlayer: Record<string, number>;
};

export type HoleResult = {
  holeNumber: number;
  par: 3 | 4 | 5;
  // best-ball nets carried through for downstream debugging / matrix derivation
  teamABestNet: number;
  teamBBestNet: number;
  winner: 'teamA' | 'teamB' | 'tie';
  // Signed: positive = team A wins this hole (in cents). 0 on tie.
  teamDeltaCents: number;
  sandiesApplied: boolean;       // true iff a sandy bonus was added on a winning hole
  greenieAwarded: GreenieAward | null;
};

export type GreenieAward = {
  team: 'teamA' | 'teamB';
  playerId: string;            // closestToPinPlayerId
  valueCents: number;          // greenieBaseCents × multiplier (multiplier=1 in T6-1)
  carriedFromHoles: number[];  // [] in T6-1; T6-12 fills
  multiplier: 1 | 2 | 3 | 4;   // 1 in T6-1; T6-12 emits 2..4
};

export type PairLedger = Record<string, Record<string, number>>;
// PairLedger[a][b] = signed cents that flow from b → a across the round.
// Anti-symmetric: PairLedger[a][b] === −PairLedger[b][a]. Cross-team only.

export type RoundResult = {
  // Signed: positive = team A wins the round (in cents).
  teamTotalCents: number;
  holesPlayed: number;        // count of HoleResult entries
  sandiesAwardedCount: number;
  greeniesAwardedCount: number;
};

export type Compute2v2BestBallOutput = {
  perHole: HoleResult[];
  perRound: RoundResult;
  perPair: PairLedger;
};

export function compute2v2BestBall(input: Compute2v2BestBallInput): Compute2v2BestBallOutput;
```

- The function is PURE: no DB, no I/O, no env access, no `Date.now()`, no `crypto.*`, no mutation of inputs.
- The file imports from `../handicap-strokes.js` ONLY (`getHandicapStrokes`, `calcCourseHandicap`, `TeeShape`). It does NOT import from `../../services/handicap.js` (engine→services would violate D1-1 layering — see Section 2b). It does NOT import from `@wolf-cup/engine` (Section 2 option A).

**AC-2 — Iteration + input contract: drive iteration off `course.holes`; complete-cell gate (codex rerun H#2).**
**Given** `compute2v2BestBall`
**When** invoked
**Then**:
  - Iteration is driven off `course.holes` — every hole listed in `course.holes` is a candidate. `holeMeta` is OPTIONAL on a per-hole basis: a missing entry is equivalent to `{ closestToPinPlayerId: null }` (no greenie info; no greenie awarded).
  - **Complete-cell gate:** for each candidate hole (call its number `n`), the function checks whether ALL FOUR foursome members (`pairings.teamA[0]`, `teamA[1]`, `teamB[0]`, `teamB[1]`) have a `holeScores` row whose `holeNumber === n`. If all four rows exist → include in `perHole` (the hole is "played"). If any of the four are missing → SKIP this hole (not in `perHole`; not counted in `perRound.holesPlayed`; no pair cells mutate).
  - The function does NOT throw on missing cells. The caller (money service / route handler) decides whether the partial-round case is informational or an error at its own layer.
  - The Zod schema for `Compute2v2BestBallInput` is OUT OF SCOPE — engine boundary is type-only. Route-layer Zod parsing lands when T6-5 ships the matrix endpoint.

**AC-3 — Per-hole outcome (winner + delta + pair cells).**
**Given** a played hole with team-A best-ball net = 3, team-B best-ball net = 4, `basePerHoleCents = 100`
**When** computed
**Then** `perHole[i] = { holeNumber, par, winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null }`
AND `perPair` accumulates 4 pair cells of `+100` for team A (signed), and 4 cells of `−100` for team B (anti-symmetric).

**AC-4 — Tied hole emits zero delta, `sandiesApplied = false`, `greenieAwarded = null`.**
**Given** team-A best net == team-B best net
**When** computed
**Then** `perHole[i].winner = 'tie'`; `teamDeltaCents = 0`; no pair cells mutate; `sandiesApplied = false` (sandies amplifies a win; on a tie, the bonus does not apply); `greenieAwarded = null` (greenies follow the same "amplify a win" rule — CTP only collects on a winning hole; a CTP on a tie or loss queues for T6-12 carryover, which T6-1 represents as null). This rule is identical to AC-6 — a tied hole takes the AC-6 fallback path.

**AC-5 — Sandies bonus adds to a winning team's delta and pair cells (codex Med #8 clarification: GROSS par).**
**Given** `config.sandies = true` AND a winning-team player has `sandyFromBunker === true` AND that player's GROSS strokes on this hole ≤ par (i.e., gross par or better; net is irrelevant for sandies validation)
**When** computed
**Then** `perHole[i].sandiesApplied = true`; team delta adds 4 × `sandiesBonusPerHoleCents`; each of the 4 pair cells adds `sandiesBonusPerHoleCents` (signed by winning team).
**AND** when the SAME hole is TIED OR LOST by the sandy player's team, NO bonus is applied — `sandiesApplied = false`.
**AND** when MULTIPLE winning-team players each have a qualifying sandy on the same hole: the bonus is added EXACTLY ONCE (a hole has at most one sandies emit). Tournament-trip realism: sandies stacking-per-player would inflate prize pots beyond house rules.
**AND** the `sandyFromBunker` flag is TRUSTED — T6-1 does no validation against shot-tracking data (no such data exists). The score-entry UI captures the foursome's attestation; followup T6-1b lands the persistence column.

**AC-6 — Greenie award (par 3) is determined by `closestToPinPlayerId` (codex High #3 rewrite).**
**Given** a par-3 hole with a corresponding `holeMeta` entry where `closestToPinPlayerId` is set AND that player meets `greenieValidation` AND that player is on the WINNING team
**When** computed
**Then** `perHole[i].greenieAwarded = { team, playerId, valueCents: greenieBaseCents, carriedFromHoles: [], multiplier: 1 }` AND pair attribution distributes `greenieBaseCents` across the 4 pair cells (signed by the CTP player's team).

Validation rules:
- `greenieValidation === '2-putt'`: CTP player's `putts` MUST be ≤ 2 (and not null). `putts === null` fails validation → `greenieAwarded = null`.
- `greenieValidation === 'none'`: any CTP player passes (no putt constraint).

The CTP player MAY be on the LOSING or TYING team — in those cases T6-1 emits `greenieAwarded = null` (the closest-to-pin only collects on a winning hole; otherwise the value queues for T6-12 carryover, which T6-1 represents as `null` here). T6-1 emits null; T6-12 owns the queue state.

**AC-7 — No-valid-greenie state.**
**Given** par 3 where no eligible player meets the validation rule
**When** computed
**Then** `perHole[i].greenieAwarded = null`. (T6-12 owns the carry-over carry walk; T6-1 emits per-hole only.)

**AC-8 — Handicap strokes shift net.**
**Given** a 15-handicap player at SI 1–15, `tee = { slope: 113, ratingTimes10: 720, coursePar: 72 }`
**When** computed
**Then** `getHandicapStrokes(15, si, tee)` returns 1 for `si ∈ [1..15]` and 0 for `si ∈ [16..18]`. Net = gross − strokes is what the best-ball comparison uses.

**AC-9 — `perPair` anti-symmetry + matrix completeness.**
**Given** any output
**When** inspected
**Then** for every (a, b) pair: `perPair[a][b] === −perPair[b][a]`. Pair cells exist for ALL 4 cross-team pairs (`teamA × teamB`); intra-team pair cells (A1↔A2, B1↔B2) are NOT populated (a player never owes their own teammate via this game).

**AC-10 — `perRound.teamTotalCents` invariants (codex High #1 rewrite).**
**Given** any output
**When** inspected
**Then**:
```
perRound.teamTotalCents
  === sum(perHole[i].teamDeltaCents for every i)
  === perPair[A1][B1] + perPair[A1][B2] + perPair[A2][B1] + perPair[A2][B2]
```
(Sum of the four "team A side" pair cells, signed.)

When team A is net AHEAD across the round, `teamTotalCents > 0` AND the four "A side" pair cells sum to `teamTotalCents`. When team A is net BEHIND, `teamTotalCents < 0` AND the four "A side" pair cells sum to a negative number; the four "B side" pair cells (`perPair[B1][A1]` etc.) sum to `-teamTotalCents` (positive). Anti-symmetry guarantees the redundancy.

**AC-11 — Integer-only money values.**
**Given** any output
**When** inspected
**Then** every money-typed field (`teamDeltaCents`, `valueCents`, all `perPair` cells, `perRound.teamTotalCents`) is `Number.isInteger(x) === true`. No floats.

**AC-12 — Pure / deterministic.**
**Given** identical input passed twice
**When** the function is called twice
**Then** outputs are deep-equal (and the function does not mutate either input).

**AC-13 — `getHandicapStrokes` unit tests with explicit plus-handicap behavior (codex Med #4 fix).**
**Given** `apps/tournament-api/src/engine/handicap-strokes.test.ts`
**When** run
**Then** at least 7 cases pass:
  (i) HI 0 → 0 strokes on every SI.
  (ii) HI 9 → 1 stroke on SI 1..9; 0 on SI 10..18.
  (iii) HI 15 → 1 on SI 1..15; 0 on SI 16..18.
  (iv) HI 18 → 1 on every SI.
  (v) HI 27 (slope-adjusted CH ≥ 18) → 2 on SI 1..(CH−18); 1 on the rest.
  (vi) HI exactly at boundary (CH=18 after slope adjustment) → 1 on every SI; 0 nowhere.
  (vii) **Plus-handicap clamp:** when `calcCourseHandicap` returns a negative integer (a "plus" handicap), `getHandicapStrokes` returns 0 for every SI. v1 does NOT propagate negative strokes back to the caller — the trip's player roster is all positive HIs; plus-handicap arithmetic is a Followup T6-1e (would let scratch-or-better players actually GIVE strokes, not just not RECEIVE them).

**AC-14 — Six golden fixtures pass.**
**Given** `apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts` + `__fixtures__/best-ball-2v2-{a..f}.json`
**When** `pnpm --filter @tournament/api test` runs
**Then** at least six fixtures pass:
  - (a) **Straight win round, no sandies, no greenies:** 18 holes, team A wins 10, team B wins 8, sandies off, no GIR signal. Asserts perPair anti-symmetry + integer values + teamTotal = 10×400 − 8×400 = +800 cents.
  - (b) **Sandies scattered (3 holes):** team A wins 12, team B wins 6, sandies on, 3 holes have a winning-team player marked `sandyFromBunker`. Total includes 3 × 4 × `sandiesBonusPerHoleCents` extra pair cells.
  - (c) **Greenies awarded on every par 3 (4 holes):** 4 par-3 holes, each has a winning-team player on GIR + 2-putt. `perHole` for each par 3 has `greenieAwarded` populated; total team delta includes 4 × 4 × `greenieBaseCents`.
  - (d) **No valid greenies, carryover off:** 4 par-3 holes, none meet validation. All 4 `greenieAwarded = null`. (Carryover behavior is T6-12.)
  - (e) **Handicap strokes shift net (15-handicap on SI 1–15):** team-A player has HI 15; gross 5 on a par-4 SI 3 → net 4 → ties team-B's 4. Shows the SI allocation flipping a hole's outcome.
  - (f) **Tie hole:** team-A best net == team-B best net. `winner = 'tie'`, `teamDeltaCents = 0`, no pair cells mutate.

Each fixture file shape:
```json
{
  "name": "...",
  "input": {
    "holeScores": [...],
    "holeMeta": [...],
    "pairings": {"teamA": ["A1","A2"], "teamB": ["B1","B2"]},
    "config": {...},
    "course": {"tee": {...}, "holes": [...]},
    "handicapIndexByPlayer": {"A1": 12.3, "A2": 9.0, "B1": 4.5, "B2": 18.2}
  },
  "expected": { "perHole": [...], "perRound": {...}, "perPair": {...} }
}
```

Tests assert `compute2v2BestBall(input)` deep-equals `expected`. Fixtures committed; not regenerated.

**AC-15 — Determinism replay test.**
**Given** any one fixture
**When** `compute2v2BestBall` is called with the same input twice
**Then** outputs are deep-equal AND the input object is unchanged (no mutation).

## Tasks / Subtasks

- [ ] **Task 1: Create `apps/tournament-api/src/engine/handicap-strokes.ts`.**
  - File: `apps/tournament-api/src/engine/handicap-strokes.ts`.
  - Exports `TeeShape` type, `calcCourseHandicap(input)` function, and `getHandicapStrokes(handicapIndex, strokeIndex, tee)` function.
  - Engine has NO services-layer imports (D1-1 layering per Section 2b).
  - Plus-handicap clamp: `getHandicapStrokes` early-returns 0 when `ch <= 0` (AC-13(vii)).

- [ ] **Task 1b: Refactor `apps/tournament-api/src/services/handicap.ts` to thin wrapper.**
  - `calcCourseHandicap` body becomes a delegation to `../engine/handicap-strokes.js`'s `engineCalcCourseHandicap`.
  - `CourseHandicapInput` type STAYS defined in services (NOT aliased to `TeeShape`) — preserves T5-5's existing argument shape (`{ handicapIndex, slope, ratingTimes10, coursePar }`) so leaderboard.ts callers compile unchanged.
  - `allocateNetThroughHole` + `NetAllocationInput` STAY in services; not relocated.
  - T5-5's existing handicap.test.ts continues to pass without modification (verify in Task 6).

- [ ] **Task 2: Create `apps/tournament-api/src/engine/handicap-strokes.test.ts`.**
  - 7 unit cases per AC-13 (including the explicit plus-handicap clamp case).
  - Pure function, no DB.

- [ ] **Task 3: Create `apps/tournament-api/src/engine/formats/best-ball-2v2.ts`.**
  - Pure function `compute2v2BestBall` per AC-1, AC-2.
  - Per-hole pipeline: compute every player's net → team best (min of two teammates' nets) → compare → assign winner / tie → build pair cells → apply sandies if eligible → apply greenies if par-3 + valid → emit `HoleResult`.
  - Round aggregator: sum perHole deltas → `perRound.teamTotalCents`; count sandies/greenies for telemetry.
  - All money values produced via integer arithmetic. Defensive `Number.isInteger` check on `basePerHoleCents`, `sandiesBonusPerHoleCents`, `greenieBaseCents` at the start (throw `RangeError` if non-integer — fast-fail rather than silent float drift).

- [ ] **Task 4: Author six golden fixtures under `__fixtures__/`.**
  - Each fixture is a self-contained JSON with `input` + `expected`. Fixture player IDs: `A1`, `A2`, `B1`, `B2` (synthetic, fixed across files).
  - Each fixture asserts perPair anti-symmetry and integer-only values via the test harness, not by being in the JSON itself.

- [ ] **Task 5: Create `apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts`.**
  - Six fixture-driven tests + AC-15 determinism + AC-9 anti-symmetry sanity check + AC-11 integer-only sanity check.

- [ ] **Task 6: Regression test pass.**
  - `pnpm --filter @tournament/api test` adds ≥18 new test cases (6 fixtures + ≥6 unit + ≥6 helper).
  - Engine `@wolf-cup/engine` UNTOUCHED (FD-2 boundary).
  - Wolf Cup api UNTOUCHED.
  - `pnpm -r typecheck` + `pnpm -r lint` clean.

## Dev Notes

### Project Structure Notes

- **`engine/formats/` directory creation:** new directory; mirrors architecture.md line 1007 + 1842 (plan: `engine/formats/best-ball-2v2.ts`).
- **No `@wolf-cup/engine` import:** decision section 2 option A. eslint rule at apps/tournament-api/eslint.config.js:14-23 disallows `@wolf-cup/engine` root import; the would-be allowed `/stableford` subpath doesn't exist in `packages/engine/package.json` exports. Inline-port instead.
- **`getHandicapStrokes` mathematical equivalence:** the inline port produces byte-for-byte same output as `packages/engine/src/stableford.ts:11-16` for identical inputs. AC-13 cross-checks against the Wolf Cup math (no shared test fixture, but the formula is well-known).
- **Pair-attribution shape (`perPair`):** anti-symmetric matrix represented as `Record<string, Record<string, number>>` (cents). Sparse — only populated for cross-team pairs. T6-5 will consume this shape directly into the `head_to_head_money_matrix` materialized table.
- **Pure function discipline:** no `Date.now()`, no `crypto.randomUUID()`, no I/O. Failure modes throw `TypeError` / `RangeError` synchronously; route-layer (T6-5/T6-9) translates errors to HTTP responses.

### Money discipline (epic-wide invariant locked HERE)

- INTEGER CENTS: `Number.isInteger(x) === true` for every money field at every layer.
- Multiplication is safe (int × int = int). Division goes through `Math.floor(a / b)` with explicit remainder distribution; T6-1 has no division op.
- Test assertions explicitly check `Number.isInteger` on every money cell.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1697–1745 (T6.1) + 1697 (integer-cents discipline) + 1699 (pairwise convention)
- T5-5 inline-port precedent: `apps/tournament-api/src/services/handicap.ts:40-60` (`calcCourseHandicap`)
- Wolf Cup stableford reference (NOT imported): `packages/engine/src/stableford.ts:11-16`
- Architecture engine boundary: `_bmad-output/planning-artifacts/tournament/architecture.md` line 467 (D1-1 engine purity), line 770 (engine-import constraint), line 1007 (T6 file plan)
- ESLint engine-import rule: `apps/tournament-api/eslint.config.js:14-23`

### Risks / Followups

- **Followup T6-1a (NEXT-TRIGGER priority — not generic v1.5 cleanup):** Consolidate handicap-strokes via `packages/engine` subpath export. Today the engine package has no `./stableford` subpath export despite tournament's eslint rule referencing one. T6-1 inlines `getHandicapStrokes` locally per Section 2 option A; this is the SECOND inline-port event after T5-5's `calcCourseHandicap`. **Trigger condition:** if a third tournament story needs to inline-port additional engine math OR a Wolf Cup bug fix forces a tournament mirror update, immediately escalate to coordinate a `packages/engine/package.json` subpath export with Wolf Cup (a tournament-driven proposal; the actual edit is FORBIDDEN per director path-allowlist and requires per-session user approval + a passing Wolf Cup test suite). Memory `feedback_external_api_smoke_test.md` companion: per architecture.md line 149's package-extraction trigger ("when the same Wolf Cup bug fix lands in a copied module twice — extract immediately"), handicap math has not crossed the trigger YET (no Wolf Cup bug fixes mirrored). Drift mitigation v1: AC-13 tests pin tournament's expected output; any Wolf Cup change ALSO requires updating tournament. Pattern matches T5-5's `calcCourseHandicap` clone.
- **Followup T6-1b: Persist `sandyFromBunker` + `greenInRegulation` flags in `hole_scores`.** T6-1's pure function ACCEPTS these as inputs; v1 production wiring depends on the score-entry UI capturing them and the schema storing them. Schema add is a SHARED migration outside T6-1 scope. Tracked as T6-1b; likely lands as part of T6-4 (score-commit hook) or as a precursor.
- **Followup T6-1c: Tournament `Tee` type unification.** Today T5-5 uses `{ slope, ratingTimes10, coursePar }` shape; T6-1 uses the same shape. If a future story extends Tee with new fields, both consumers need coordinated update. Low risk, named for traceability.
- **Followup T6-1d: GIR + sandies polymorphism.** T6-1 spec accepts `greenInRegulation?: boolean` per player per hole, but Wolf Cup's actual data model encodes this as a derived signal (gross strokes − putts) in some places. Tournament v1 takes the explicit-flag input; the persistence layer can choose either approach. Followup to consolidate when score-entry UI (T6-4 or earlier) captures the signal.
- **Risk: unicode / playerId stability across pair matrix keys.** `perPair` is keyed by playerId (UUID strings). Test fixtures use synthetic IDs; production passes through DB UUIDs unchanged. No stability concern at the engine layer.
- **Risk: half-finished hole (some players unscored) feeding into compute2v2BestBall.** v1 spec is "compute the rounds we have data for"; T6-1's per-hole loop SKIPS holes where any of the 4 foursome players has no `hole_scores` row. This matches Wolf Cup's `bonuses.ts` partial-round pattern. AC-3 fixtures all assume 18-hole completed rounds; partial rounds are tested as part of T6-4 (score-commit hook integration), not T6-1.

## Files this story will edit

- apps/tournament-api/src/engine/formats/best-ball-2v2.ts
- apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-a-straight-win.json
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-b-sandies-scattered.json
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-c-greenies-every-par3.json
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-d-no-valid-greenies.json
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-e-handicap-shifts.json
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-f-tie-hole.json
- apps/tournament-api/src/engine/handicap-strokes.ts
- apps/tournament-api/src/engine/handicap-strokes.test.ts
- apps/tournament-api/src/services/handicap.ts

Additional files MAY be added during implementation only under `apps/tournament-api/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director driving dev-story per workflow-tournament.yaml).

### Debug Log References

- Spec codex: 4 iterations (3H+5M+1L → 1H+4M → 0H+2M+2L → 2M+2L). All Highs + applicable Mediums applied; remaining Lows non-actionable (review-context drift).
- Impl codex: 2H+2M+1L applied (Infinity validation, calcCourseHandicap rounding spec aligned to T5-5 impl, strokeIndex range, missing-handicap throw, non-negative money). Spec section 3 snippet rewritten to match T5-5's preserved Math.round behavior; speculative Math.sign × Math.abs formulation removed.
- Impl codex rerun: 2M+1L; Mediums applied (duplicate-cell throw, runtime enum/boolean validation); Low (grossStrokes/putts range) deferred — schema-level CHECK constraints cover.
- Party codex: 2M+2L; 1M + 2L applied (greenie validation conditional wording, AC-10 invariant claim, slope-adjusted test count); 1M (non-verifiable claims) is review-context drift, factually true from session.

### Completion Notes List

- 11 ALLOWED files (10 NEW + 1 additive MOD on services/handicap.ts). Zero SHARED, zero FORBIDDEN.
- 20 new tests (11 handicap-strokes + 9 best-ball-2v2 fixture+invariant tests).
- tournament-api regression: 634 → 654. Engine 472 + wolf-cup api 516 unaffected.
- pnpm -r typecheck + lint clean.
- T5-5's 14 handicap.test.ts cases unchanged + still pass — services/handicap.ts wrapper preserves T5-5's CourseHandicapInput shape.
- Architectural decision A approved at gate (inline-port handicap math; followup T6-1a tracks future consolidation).

### File List

- apps/tournament-api/src/engine/handicap-strokes.ts (NEW)
- apps/tournament-api/src/engine/handicap-strokes.test.ts (NEW)
- apps/tournament-api/src/engine/formats/best-ball-2v2.ts (NEW)
- apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts (NEW)
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-a-straight-win.json (NEW)
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-b-sandies-scattered.json (NEW)
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-c-greenies-every-par3.json (NEW)
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-d-no-valid-greenies.json (NEW)
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-e-handicap-shifts.json (NEW)
- apps/tournament-api/src/engine/formats/__fixtures__/best-ball-2v2-f-tie-hole.json (NEW)
- apps/tournament-api/src/services/handicap.ts (MOD: thin wrapper delegating to engine; CourseHandicapInput type + allocateNetThroughHole stay)
