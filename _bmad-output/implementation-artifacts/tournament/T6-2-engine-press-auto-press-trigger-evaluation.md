# T6-2: Engine — Press + Auto-Press Trigger Evaluation [new]

## Status

Done

## Story

As a developer,
I want `apps/tournament-api/src/engine/rules/press.ts` as a pure function that evaluates manual presses + auto-press triggers (N-down family) against a 2v2 match-state snapshot, returning the set of active presses + the subset newly fired in this call,
So that auto-press fires at exactly the right moment per config (FR-D5 silent fire), manual presses are tracked through their undo window (FR-D1), and downstream money composition (T6-4 / T6-5) has a deterministic press ledger to consume.

T6-2 is the SECOND story in epic T6 and the FIRST story to live under `engine/rules/`. T6-1 established `engine/formats/`; T6-2 adds the parallel `rules/` subtree for cross-format mechanics.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/engine/rules/press.ts                                  [NEW]
apps/tournament-api/src/engine/rules/press.test.ts                             [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/press-a-no-press.json        [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/press-b-single-auto.json     [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/press-c-compound-auto.json   [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/press-d-idempotent-replay.json [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/press-e-manual-with-undo.json [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/press-f-manual-and-auto-interleaved.json [NEW]
```

8 files total — all NEW under `apps/tournament-api/src/engine/rules/**`. Zero MOD edits. The `engine/rules/` directory is created by this story (mirrors T6-1's creation of `engine/formats/`).

### 2. No engine import boundary tension this story

Unlike T6-1, T6-2 does NOT need handicap math, stableford points, or any Wolf-Cup-derived helper. The trigger logic is GREENFIELD team-state arithmetic (count A wins vs B wins through `throughHole`). The "next-trigger" condition Winston flagged in T6-1 (consolidate inline-ports when a third event lands) is NOT reached by this story. Followup T6-1a stays at the same priority.

T6-2's only intra-tournament import is the `HoleResult` type from `engine/formats/best-ball-2v2.ts` (T6-1) — type-only; no runtime dependency on T6-1's compute2v2BestBall execution.

### 3. T6-2 is TRIGGER + LEDGER; T6-2 does NOT compute money

The function returns press DESCRIPTORS (`{ type, team, startHole, multiplier, canUndo, trigger? }`), not money cents. Money composition (multiply each press's contribution by `pressMultiplier`, accumulate into pair attribution) is T6-4's job (score-commit hook) plus T6-5's H2H matrix integration. v1 keeps these layers separate so the trigger logic is golden-file-testable in isolation.

### 4. Auto-press semantic — what does "team A is N-down" mean? (load-bearing decision)

T6-2 reads `perHoleResults` and computes a running win-loss count for each team THROUGH `throughHole`:

- For each hole in `perHoleResults` whose `holeNumber <= throughHole`: a hole `winner === 'teamA'` increments A's count by 1; `'teamB'` increments B's; `'tie'` is a no-op.
- "Team X is N-down" iff `(opposingCount − xCount) === N`. Equivalent: signed delta from team X's perspective `(xCount − opposingCount) === −N`.
- Auto-press fires for team X when X first reaches `-autoPressTriggerAtNDown` (signed). The `startHole` of the press = the trigger hole + 1 (the next hole takes effect). If trigger fires at hole 18, the press has `startHole = 19` which means "no holes left this round" — see Section 6.

### 5. Compound auto-press (nested match semantics)

When an auto-press fires, it creates a NESTED MATCH starting at its `startHole`. Each nested match has its OWN running win-loss count over its segment of holes (from its `startHole` through `throughHole`). When a team reaches N-down WITHIN a nested match, a compound press fires at the nested-match's trigger hole + 1.

**Recursion semantics — load-bearing for replay correctness (codex Critical #1 fix):** every press that EXISTS in the world spawns a child match — this includes presses already in `existingPressLog` from prior evaluations, AND manual presses (which establish independent nested matches with their own auto-press triggers), not just newly-fired auto presses. The algorithm:

  1. Seed `allPresses` from `existingPressLog` carry-forward (AC-14).
  2. Append manual-press echoes (if dedupe key not present).
  3. Append base-match auto-press fires (if dedupe key not present).
  4. **Iterate fixed-point:** for EVERY press in `allPresses` (whether carried-forward, manual-echoed, or newly fired), evaluate its nested-match segment for compound auto-press triggers. Add any compound press to `allPresses` + dedupe set. Repeat until a pass produces no new compound triggers (defensive cap: 50 iterations; throw `RangeError` on overflow).

This step order matches Task 1 exactly. The manual-vs-base ordering is irrelevant to the final dedupe set (manual + auto have different `type` ranks so they cannot collide), but the algorithm's pseudocode pins it for implementation determinism.

Without step 4 walking carried-forward presses, a replay where press_1 is in the log but press_2 (which press_1 spawned) is not yet in the log would silently miss press_2 — a real correctness bug. Trip-day reality: every score commit replays evaluation against the current log; missing a compound fire would silently under-count money.

**Trigger uniqueness within a match:** a single match fires AT MOST ONE press per (`team`, this match's segment). Once a team has triggered in this match's segment, the SAME team cannot re-fire from the same segment with the same `startHole` — the dedupe key `(type, team, startHole)` is the safety net. (Going further down — e.g., team A 2-down at hole 4, then 4-down at hole 7 within the BASE match — does NOT re-fire because the base match's "2-down trigger" already fired once. Subsequent down-counts in the base match are absorbed by the press_1 nested match instead.)

**Dedupe-key collision limitation (codex rerun H#2 — v1 acceptance):** the dedupe key `(type, team, startHole)` is GLOBAL across all parent matches. A theoretical edge case: if two distinct parent matches (say the base match AND a manual press's nested match) both fire `('auto', 'teamA', 5)` from independent N-down counts, v1 collapses them into ONE press. Trip-day reality: this requires multiple manual presses + specific opposing-direction scoring patterns and is vanishingly rare with v1's single-foursome 4-player layout. Followup T6-2g tracks the v1.5 fix (extend dedupe key to include `parentMatchId`; persistence schema would need a parent_match_id column on `team_press_log`). v1 documents this as an acknowledged limitation; the post-press money mis-attribution is bounded (one collapsed press per game) and detectable via observability if it ever happens.

**Depth cap (codex rerun M#3):** v1 ships with a defensive 50-iteration cap on the fixed-point loop (NOT a recursion-depth cap on press-tree depth). If the fixed point doesn't converge within 50 iterations, throw a `RangeError` — pathological scoring patterns shouldn't infinite-loop. Trip-day reality: ≤ 2 levels deep, ≤ 5 iterations to converge. Followup T6-2f tracks if any observed scoring pattern ever exceeds the cap.

### 6. Edge cases — the spec needs explicit answers

- **Trigger at hole 18:** if `autoPressTriggerAtNDown=2` and team A is 2-down for the first time at hole 18, the auto-press would have `startHole = 19`. v1 spec: **the press does NOT fire** — there are no holes left for the nested match to play. The engine emits NO press for `startHole > 18`. This avoids a phantom press that no money can ever flow through.
- **Trigger at hole 0 / pre-tournament:** `throughHole === 0` means no holes complete yet. No autoPress evaluation runs against the empty base segment. Manual presses ARE still echoed back into `activePresses` regardless of `throughHole` — once filed, they exist. (See Section 6b for the "active" rule.)
- **Manual press at `filedAtHole = 19`:** rejected — manual presses are 1..18.
- **Manual press at hole already covered by an auto-press from same team:** allowed — manual + auto are independent press types and dedupe via `type` field. Both appear in `activePresses` if both fired.
- **`autoPressTriggerAtNDown === 0`:** treated the same as `null` — auto-press disabled. (A trigger of "0-down" would fire after every tied hole, which is nonsensical.)
- **Negative or non-integer `autoPressTriggerAtNDown`:** rejected at boundary with `RangeError`.
- **`pressMultiplier` non-positive or non-finite:** rejected at boundary with `RangeError`. v1 expects `pressMultiplier >= 1` (typically 2 for "press doubles the bet"); enforced as positive integer.
- **`existingPressLog` contains a press whose `startHole > throughHole`:** v1 includes it in `activePresses` (treats existing log as authoritative); does NOT fire duplicates against it. This handles re-evaluation after a score correction that reduces the down-count (the previously-fired press stays on the books even if it would not fire today — undo is the only way to remove it).

### 6b. Manual press "active" rule (codex High #2 fix)

A manual press exists from the moment it is filed. T6-2 includes EVERY manualPress in `activePresses` regardless of `throughHole` — gating on throughHole would silently drop a press filed for the next hole (a realistic UX: "I'll press for the hole we're about to play"). The press's MONEY contribution begins at its `startHole` (T6-4 / T6-5 handle that downstream), but the press's EXISTENCE in the active set is independent of throughHole.

`canUndo` IS gated on throughHole per AC-7/AC-8 — undoability is the time-window concept, not activity.

**Concretely:**
- manualPress with `filedAtHole = 8`, `throughHole = 7`: in `activePresses`; `canUndo = true` (throughHole 7 ≤ startHole 8).
- manualPress with `filedAtHole = 8`, `throughHole = 8`: in `activePresses`; `canUndo = true` (throughHole 8 ≤ startHole 8).
- manualPress with `filedAtHole = 8`, `throughHole = 9`: in `activePresses`; `canUndo = false`.
- manualPress with `filedAtHole = 8`, `throughHole = 0`: in `activePresses`; `canUndo = true`.

### 7. Undo window (FR-D1, AC-7)

Per the epic spec: "press filed on hole N → undo window closes when throughHole advances to N+1". v1 applies this rule to MANUAL presses only. Auto-presses have `canUndo === false` always — they're algorithmic and the user shouldn't manually undo a deterministic computation. UI-level press-undo (T6-7) will gate accordingly.

For each press in the output:
- `canUndo === true` IFF `press.type === 'manual' AND throughHole < press.startHole + 1` (equivalently `throughHole <= press.startHole`).
- `canUndo === false` for all auto-presses, AND for manual presses past their undo window.

### 8. Manual-press validation surface

T6-2 does NOT validate that the pressing team is actually DOWN at the time of filing. Wolf Cup convention is "down team presses to recover money", but trip-day reality is that pressers sometimes file out-of-pattern (charity press, late-round comeback). v1: trust the manual press input. The route layer (T6-7) MAY add the down-team gate later if usability demands; engine stays permissive. Followup T6-2c tracks.

### 9. Pure function guarantees (NFR-C1)

- No DB, no I/O, no env, no clock, no crypto, no input mutation.
- Determinism: same input → byte-for-byte identical output.
- Defensive validation: integer/non-negative checks on numeric inputs; unknown enum values throw.

## Acceptance Criteria

(Derived from epics-phase1.md T6.2 lines 1747–1787.)

**AC-1 — File location + signature + complete type surface.**
**Given** `apps/tournament-api/src/engine/rules/press.ts`
**When** inspected
**Then** it exports `evaluatePresses` AND every type referenced below.

```ts
import type { HoleResult } from '../formats/best-ball-2v2.js';

export type PressTeam = 'teamA' | 'teamB';
export type PressType = 'auto' | 'manual';

export type PressConfig = {
  /** N for "fire when N-down". null OR 0 → auto-press disabled. */
  autoPressTriggerAtNDown: number | null;
  /** Multiplier applied to press contributions downstream. Positive integer (typically 2). */
  pressMultiplier: number;
};

export type ManualPress = {
  team: PressTeam;
  /** Hole the press takes effect on (1..18). filedAtHole === startHole for manual presses. */
  filedAtHole: number;
};

export type PressLogEntry = {
  type: PressType;
  team: PressTeam;
  startHole: number;
  /**
   * Multiplier IN EFFECT WHEN THIS PRESS WAS FIRED. Persisted on the press
   * log row at fire-time so a later config edit (T5-11 mid-event rule edit)
   * does not retroactively change the historical money math. Carried-forward
   * presses use THIS multiplier; only newly-fired presses pick up the
   * current config.pressMultiplier.
   */
  multiplier: number;
  /** Optional. For auto presses: e.g. '2-down'. Caller persists at fire-time. */
  trigger?: string;
};

export type Press = {
  type: PressType;
  team: PressTeam;
  startHole: number;
  multiplier: number;       // For newly-fired presses: copied from config.pressMultiplier. For carried-forward presses: copied from existingPressLog[i].multiplier (historical fire-time value, NOT current config). Downstream T6-4/T6-5 use for money composition.
  /** For auto presses: e.g., '2-down'. For manual: undefined. */
  trigger?: string;
  /** True iff this press is in its undo window (manual + throughHole <= startHole). */
  canUndo: boolean;
};

export type EvaluatePressesInput = {
  perHoleResults: HoleResult[];
  manualPresses: ManualPress[];
  existingPressLog: PressLogEntry[];
  config: PressConfig;
  /** 0..18; "the last hole for which all 4 foursome members have committed scores". */
  throughHole: number;
};

export type EvaluatePressesOutput = {
  /** All presses considered live given throughHole, ordered by startHole asc, then by type asc, then by team asc (deterministic). */
  activePresses: Press[];
  /** Subset of activePresses NOT present in existingPressLog. Same ordering. */
  newlyFired: Press[];
};

export function evaluatePresses(input: EvaluatePressesInput): EvaluatePressesOutput;
```

The function is PURE: no DB, no I/O, no env, no clock, no crypto, no mutation of inputs. Imports ONLY type from `../formats/best-ball-2v2.js`.

**AC-2 — Input validation at the boundary (fast-fail; codex Med #4).**
**Given** invalid inputs
**When** `evaluatePresses` is called
**Then** the function throws synchronously:
  - `throughHole` not an integer in [0, 18] → `RangeError`.
  - `config.pressMultiplier` not a positive integer → `RangeError`.
  - `config.autoPressTriggerAtNDown` not (null | non-negative integer ≤ 18) → `RangeError`.
  - Any `manualPress.filedAtHole` not an integer in [1, 18] → `RangeError`.
  - Any `manualPress.team` not in `{'teamA','teamB'}` → `RangeError`.
  - Any `perHoleResults[i].holeNumber` not an integer in [1, 18] → `RangeError`.
  - Any `perHoleResults[i].winner` not in `{'teamA','teamB','tie'}` → `RangeError`.
  - Duplicate `perHoleResults` entries for the same `holeNumber` → `Error` (caller's contract: one entry per played hole).
  - Duplicate `existingPressLog` entries (same `(type, team, startHole)` triple) → `Error`.
  - Any `existingPressLog[i].type` / `.team` not in their enum sets → `RangeError`.
  - Any `existingPressLog[i].startHole` not an integer in [1, 18] → `RangeError`.
  - Any `existingPressLog[i].multiplier` not a positive integer → `RangeError` (multiplier is trusted for downstream money math; corrupt entries must throw at the boundary).
  - Any `existingPressLog[i].trigger` (when present) not a string → `RangeError`.
  - Duplicate `manualPresses` entries (same `(team, filedAtHole)` pair) → `Error` (codex rerun L#5).
  - **perHoleResults completeness gate (codex rerun M#4 + rerun-2 M#2 + rerun-3 L#3):** for every integer h in `[1, throughHole]`, there MUST exist exactly one `perHoleResults` entry with `holeNumber === h`. Missing entries → `Error`. **Duplicate `holeNumber` entries (same h appears more than once) ALWAYS throw** regardless of throughHole. **Entries with `holeNumber > throughHole` are ALLOWED and IGNORED** (callers typically pass the full round's perHoleResults from compute2v2BestBall and let throughHole cap the evaluation window). When `throughHole === 0`, the [1, 0] range is empty — entries are ignored but duplicates still reject; auto-press evaluation is skipped against the empty base segment.

**AC-3 — Auto-press fires at first N-down moment, takes effect on next hole.**
**Given** `autoPressTriggerAtNDown = 2`, team A wins hole 1, team B wins holes 2–4 (A is 2-down through hole 4), `throughHole = 4`, no existingPressLog
**When** evaluated
**Then** `newlyFired` contains exactly one press: `{ type: 'auto', team: 'teamA', startHole: 5, multiplier: pressMultiplier, trigger: '2-down', canUndo: false }`. `activePresses` contains the same press. **The down team (the loser) is the one that gets the press credited to it** — pressing means "you're behind, you challenge with double-or-nothing on the remaining holes".

**AC-4 — No fire when N-down threshold not yet reached.**
**Given** `autoPressTriggerAtNDown = 2`, team A is 1-down through `throughHole = 4`
**When** evaluated
**Then** `newlyFired` is empty. `activePresses` is empty (no manual presses in this fixture either).

**AC-5 — Idempotent replay (log-dedupe; multiplier preservation).**
**Given** the same match state as AC-3, plus `existingPressLog = [{ type: 'auto', team: 'teamA', startHole: 5, multiplier: 2, trigger: '2-down' }]`
**When** evaluated (even with `config.pressMultiplier = 3` reflecting a mid-event T5-11 rule edit)
**Then** `newlyFired` is EMPTY. `activePresses` contains the press carried forward from log with `multiplier: 2` (HISTORICAL value preserved — NOT the current config's 3). Re-evaluation after a score correction does NOT double-fire.

**AC-6 — Compound auto-press (nested match).**
**Given** `autoPressTriggerAtNDown = 2`, base match has team A 2-down at hole 4 (fires press_1 at startHole=5), then within press_1's match (holes 5–8) team A goes 2-down again at hole 8 (fires press_2 at startHole=9), `throughHole = 8`, no existingPressLog
**When** evaluated
**Then** `newlyFired` contains exactly two presses: press_1 (`startHole: 5`) and press_2 (`startHole: 9`), both for team A, both `type: 'auto'`. **Ordering:** `activePresses` is sorted by `startHole` ascending, so press_1 comes before press_2. Each press's match counts only the holes WITHIN its segment (press_2 doesn't count holes 1–4; press_1 doesn't count holes 9+).

**AC-7 — Manual press echoed back; in undo window.**
**Given** `manualPresses = [{ team: 'teamB', filedAtHole: 7 }]`, `throughHole = 7`, no existingPressLog
**When** evaluated
**Then** `newlyFired` contains one press: `{ type: 'manual', team: 'teamB', startHole: 7, multiplier: pressMultiplier, trigger: undefined, canUndo: true }`. `canUndo = true` because `throughHole (7) <= startHole (7)`.

**AC-8 — Manual press past undo window.**
**Given** the same manual press AND `throughHole = 8`
**When** evaluated
**Then** the press is in `activePresses` with `canUndo: false`. (`throughHole (8) > startHole (7)`.)

**AC-9 — Auto-press NEVER has canUndo=true.**
**Given** any auto-press in the output
**When** inspected
**Then** `canUndo === false` regardless of throughHole.

**AC-10 — Manual + auto on same team / hole interleaved.**
**Given** team A is 2-down at hole 4 (auto-press fires startHole=5) AND `manualPresses = [{ team: 'teamA', filedAtHole: 7 }]` AND `throughHole = 7`
**When** evaluated
**Then** `newlyFired` contains TWO presses: the auto at startHole=5 + the manual at startHole=7. They dedupe independently (different `type`), both for team A. Ordering: auto first (startHole=5), manual second (startHole=7).

**AC-11 — Trigger at hole 18 → no fire (startHole > 18).**
**Given** team A first reaches N-down at hole 18, `autoPressTriggerAtNDown = 2`, `throughHole = 18`
**When** evaluated
**Then** `newlyFired` is empty (no remaining holes for the press to play). `activePresses` empty (no manual presses). v1 explicitly does NOT emit a `startHole = 19` phantom press.

**AC-12 — autoPressTriggerAtNDown null OR 0 disables auto-press.**
**Given** team A is 5-down through hole 10 AND `autoPressTriggerAtNDown = null` (or 0)
**When** evaluated
**Then** `newlyFired` is empty. No auto-press evaluation runs.

**AC-13 — Output ordering is deterministic (codex Med #3 — explicit comparator).**
**Given** any input
**When** evaluated
**Then** `activePresses` and `newlyFired` are both sorted using an EXPLICIT THREE-LEVEL COMPARATOR (not relying on JS default string comparison drift if the type/team enums ever expand):
  1. `startHole` ascending (numeric).
  2. Tiebreak: `type` rank — `'auto' = 0, 'manual' = 1` ascending.
  3. Tiebreak: `team` rank — `'teamA' = 0, 'teamB' = 1` ascending.

Any future enum additions (e.g., new press types) require updating the comparator's rank map explicitly. AC-15 deterministic-replay requires this stability for byte-for-byte equality.

**AC-14 — `existingPressLog` carry-forward (multiplier + trigger preserved).**
**Given** `existingPressLog = [{ type: 'manual', team: 'teamB', startHole: 3, multiplier: 2 }]` AND no `manualPresses` entry that matches
**When** evaluated
**Then** `activePresses` includes the press from the log (team-B, manual, startHole=3, **multiplier: 2** from the log entry) with `canUndo` computed against current `throughHole`. `newlyFired` does NOT include it. The fire-time multiplier (and trigger if present) survive intact even if `config.pressMultiplier` differs at evaluation time. (`existingPressLog` is the source of truth for what's been persisted; engine never drops entries or rewrites their historical fields on re-evaluation.)

**AC-15 — Pure / deterministic.**
**Given** identical input passed twice
**When** the function is called twice
**Then** outputs are deep-equal AND inputs are not mutated (verified via `structuredClone` equality).

**AC-16 — Six golden fixtures pass.**
**Given** `apps/tournament-api/src/engine/rules/press.test.ts` + `__fixtures__/press-{a..f}.json`
**When** `pnpm --filter @tournament/api test` runs
**Then** at least six fixtures pass:
  - (a) **No press fires in a close match:** team A and team B alternate wins, never 2-down. `newlyFired` empty.
  - (b) **Single auto-press fires exactly at 2-down:** the AC-3 scenario.
  - (c) **Compound auto-press — two stacked:** the AC-6 scenario.
  - (d) **Idempotency: same state evaluated twice → second call returns empty newlyFired:** the AC-5 scenario.
  - (e) **Manual press with undo inside window:** the AC-7 scenario; verify `canUndo: true` at `throughHole = startHole` and `canUndo: false` at `throughHole = startHole + 1`.
  - (f) **Manual press + auto-press interleaved:** the AC-10 scenario; verify ordering by `startHole asc`.

Each fixture file shape (consistent with T6-1 partial-expected pattern):
```json
{
  "name": "...",
  "input": { "perHoleResults": [...], "manualPresses": [...], "existingPressLog": [...], "config": {...}, "throughHole": ... },
  "expectedNewlyFired": [
    { "type": "auto", "team": "teamA", "startHole": 5, "trigger": "2-down", "canUndo": false }
  ],
  "expectedActivePresses": [...]
}
```

The test harness asserts `output.newlyFired` deep-equals `expectedNewlyFired` (including `multiplier` field — set to `config.pressMultiplier` from the input) and `output.activePresses` deep-equals `expectedActivePresses`. Determinism replay test (AC-15) covers byte-for-byte stability.

## Tasks / Subtasks

- [ ] **Task 1: Create `apps/tournament-api/src/engine/rules/press.ts`.**
  - Pure function `evaluatePresses` per AC-1.
  - Algorithm (codex-revised for fixed-point recursion + manual-press inclusion):
    1. Validate inputs per AC-2 (fast-fail). Build holeByNumber lookup map from perHoleResults.
    2. Initialize `originalLogKeys` set from `existingPressLog`: `${type}|${team}|${startHole}`. This is the snapshot BEFORE any new evaluation.
    3. Initialize `allPresses` array + working `dedupeKeys` set (= copy of `originalLogKeys`).
    4. **Carry-forward** (AC-14): for each entry in `existingPressLog`, push a Press into `allPresses` with `multiplier = entry.multiplier` (the persisted historical value — NOT the current config), `trigger = entry.trigger` (if present), `canUndo` computed (manual + throughHole ≤ startHole). Carried-forward presses preserve fire-time semantics even if the rule-set's pressMultiplier was later edited via T5-11.
    5. **Manual-press echo** (AC-7/AC-8 + Section 6b): for each entry in `manualPresses`, if its dedupe key is NOT in `dedupeKeys`, push a Press into `allPresses` (always — no throughHole gate) AND add key to `dedupeKeys`.
    6. **Base-match auto-press eval** (AC-3, AC-11, AC-12): if `autoPressTriggerAtNDown` is null or 0, skip step 6 + step 7's auto-evaluation. Otherwise, evaluate base segment `[hole 1, throughHole]` via `findAutoFires(segmentStart, throughHole)`:
       - Walk holes in segmentStart..throughHole; accumulate signed delta (A win = +1; B win = -1; tie = 0).
       - Track per-team "fired" flags: `firedA`, `firedB`. Each starts false.
       - At each hole h: if `signedDelta === -autoPressTriggerAtNDown` AND NOT `firedA` → candidate press for team A at `startHole = h + 1`; mark `firedA = true`. Symmetrically for `signedDelta === +autoPressTriggerAtNDown` and team B. Both teams CAN fire in the same segment if signed delta swings (e.g., A fires at hole 4 from -2; later B fires at hole 12 from +2 within the SAME base segment).
       - For each candidate press: if `startHole > 18` → discard (AC-11). If dedupe key already in `dedupeKeys` → skip ADD but the press is conceptually accounted for. Otherwise: push to `allPresses`, add key.
       - New auto-fires use `multiplier = config.pressMultiplier` (current config).
       - Returns array of 0..2 presses.
    7. **Fixed-point compound evaluation** (Section 5 critical fix): repeat the following until a pass yields zero new presses:
       - For each press in `allPresses` (carried-forward, manual-echoed, base-fired, AND any compounds added in prior iterations of this loop):
         - Compute its nested segment: `[press.startHole, throughHole]`.
         - If segment is empty (`press.startHole > throughHole`), skip — no holes to evaluate.
         - Call `findAutoFires(press.startHole, throughHole)` (returns 0..2 presses, one per team that triggered N-down within the segment).
         - For each returned press whose dedupe key is NOT in `dedupeKeys`: push to `allPresses`, add key to `dedupeKeys`, mark "added this iteration".
       - If no new presses added this iteration, exit loop. Defensive 50-iteration cap (RangeError on overflow).
    8. Sort `allPresses` per the AC-13 comparator (startHole asc, type rank asc, team rank asc).
    9. `newlyFired` = `allPresses` filtered to those whose dedupe key is NOT in `originalLogKeys`. Same sort order.
  - Defensive: depth-protect the fixed-point loop with a max-iteration cap of 50. Throw `RangeError` on overflow with message `evaluatePresses: fixed-point did not converge within 50 iterations` — pathological scoring patterns shouldn't infinite-loop.

- [ ] **Task 2: Author six golden fixtures under `__fixtures__/`.**
  - Each fixture is self-contained JSON; HoleResult input rows mirror T6-1's HoleResult shape but only `holeNumber` + `winner` matter for press evaluation (par/teamABestNet/teamBBestNet/teamDeltaCents/sandiesApplied/greenieAwarded fields are STILL required structurally to satisfy the HoleResult type — fixtures populate with placeholder values).
  - Fixture (a)–(f) per AC-16 mapping.

- [ ] **Task 3: Create `apps/tournament-api/src/engine/rules/press.test.ts`.**
  - Six fixture-driven tests + AC-15 determinism + AC-2 boundary-validation cases (≥4 throw scenarios) + AC-9 sanity (auto canUndo always false) + AC-13 ordering sanity (≥1 mixed fixture asserts ordering).

- [ ] **Task 4: Regression test pass.** All existing tournament-api + tournament-web suites stay green; engine + Wolf Cup api unaffected. Typecheck + lint clean.

## Dev Notes

### Project Structure Notes

- **`engine/rules/` directory creation:** new directory; mirrors architecture.md line 1007 + 1842 (plan: `engine/rules/press.ts`).
- **HoleResult type-only import:** the only intra-engine import is `type { HoleResult }` from `../formats/best-ball-2v2.js`. Type-only import = compile-time-only; no runtime dependency.
- **No engine→services imports** (D1-1 layering preserved per T6-1 Section 2b precedent).
- **Pure function discipline:** as for T6-1; no `Date.now()`, no `crypto.*`, no I/O, no env access. Failure modes throw `TypeError`/`RangeError`/`Error` synchronously.

### Money discipline (T6-2 contribution)

T6-2 carries `multiplier` on each Press for downstream T6-4/T6-5 use; the multiplier itself is `config.pressMultiplier` and is validated as a positive integer at the boundary. T6-2 does NOT compute money cents — money composition is downstream.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1747–1787 (T6.2)
- T6-1 HoleResult source: `apps/tournament-api/src/engine/formats/best-ball-2v2.ts`
- Architecture engine boundary: `_bmad-output/planning-artifacts/tournament/architecture.md` line 467 (D1-1), line 1007 (T6 file plan)
- FR-D1, FR-D5 (auto-press silent fire): `_bmad-output/planning-artifacts/tournament/prd.md`

### Risks / Followups

- **Followup T6-2a: T6-4 score-commit-hook integration.** T6-4 is the orchestrator that calls `evaluatePresses` on every score commit, persists `newlyFired` to `team_press_log`, and emits activity events for each newly-fired press. T6-2 ships only the engine; T6-4 wires it.
- **Followup T6-2b: Money composition with press multipliers.** The multiplier is on each Press object; T6-5 (H2H money matrix) consumes activePresses to apply multiplicative pair-attribution. Dependency on T6-1 + T6-2 + T6-5 in that order.
- **Followup T6-2c: Manual-press down-team validation.** v1 trusts manual press input (no "down team only" gate). If trip-day reality demands the gate, add it at the route layer (T6-7) — engine stays permissive.
- **Followup T6-2d: `team_press_log` schema.** v1 spec passes `existingPressLog` rows into the engine but doesn't define the table. T6-4 ships the table (likely with columns `id PK, round_id FK, type CHECK, team CHECK, start_hole INTEGER, trigger TEXT, multiplier INTEGER, fired_at INTEGER, UNIQUE(round_id, type, team, start_hole)`).
- **Followup T6-2e: Press-revoke / press-undo persistence.** v1 engine identifies undoability per press (`canUndo`); the actual undo write is route-layer (T6-7). When a press is undone, the existingPressLog row is deleted and re-evaluation will not see it. v1 explicitly does NOT track "undone" history at the engine layer.
- **Risk: nested-match recursion depth.** No compile-time depth cap. v1 trip-day reality is ≤2 levels deep; pathological 9-level recursion on an 18-hole round is not impossible but is scoring-pattern-extreme. Defensive cap at 9 levels with a thrown error would be belt-and-suspenders; v1 ships without the cap. Followup T6-2f tracks if observed.

## Files this story will edit

- apps/tournament-api/src/engine/rules/press.ts
- apps/tournament-api/src/engine/rules/press.test.ts
- apps/tournament-api/src/engine/rules/__fixtures__/press-a-no-press.json
- apps/tournament-api/src/engine/rules/__fixtures__/press-b-single-auto.json
- apps/tournament-api/src/engine/rules/__fixtures__/press-c-compound-auto.json
- apps/tournament-api/src/engine/rules/__fixtures__/press-d-idempotent-replay.json
- apps/tournament-api/src/engine/rules/__fixtures__/press-e-manual-with-undo.json
- apps/tournament-api/src/engine/rules/__fixtures__/press-f-manual-and-auto-interleaved.json

Additional files MAY be added during implementation only under `apps/tournament-api/src/engine/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director driving dev-story per workflow-tournament.yaml).

### Debug Log References

- Spec codex: 4 rounds (1C+1H+2M → 2H+2M+1L → 2M+1L → 1H+1M+1L → final 1M+1L applied). Critical compound-recursion-on-replay miss + High carried-forward-multiplier corruption + High both-teams-fire-in-segment all addressed.
- Impl codex: 2M applied (fixture (c) drift to AC-6, missing boundary tests).
- Impl codex rerun: PASS, 0 findings.
- Party codex: 2H+2M; 2H+1M applied (test count nit, total breakdown nit, manual-log carry-forward test added). 1M (non-verifiable claims) is review-context drift.

### Completion Notes List

- 8 ALLOWED files (8 NEW under apps/tournament-api/src/engine/rules/**). Zero MOD edits. Zero SHARED, zero FORBIDDEN.
- 33 new tests (6 fixture-driven + 18 boundary-validation + 3 canUndo-transition + AC-15 determinism + AC-14 manual-log carry-forward + AC-11 hole-18 suppression + 2 AC-12 disabled + AC-H#2 both-teams-fire).
- tournament-api regression: 654 → 687 (+33). Engine 472 + wolf-cup api 516 unaffected.
- pnpm -r typecheck + lint clean.
- Architectural decisions ratified at gate: persisted multiplier on PressLogEntry, fixed-point recursion walking ALL presses, per-team firedA/firedB flags.
- T6-4 will need to persist multiplier in team_press_log row when each press fires (downstream contract).

### File List

- apps/tournament-api/src/engine/rules/press.ts (NEW)
- apps/tournament-api/src/engine/rules/press.test.ts (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/press-a-no-press.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/press-b-single-auto.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/press-c-compound-auto.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/press-d-idempotent-replay.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/press-e-manual-with-undo.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/press-f-manual-and-auto-interleaved.json (NEW)
