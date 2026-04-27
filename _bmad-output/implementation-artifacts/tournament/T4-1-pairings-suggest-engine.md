# T4-1: Pairings Suggest Engine [target-miss tolerable]

## Status

Ready for Dev

## Story

As a developer,
I want `suggestPairings(input: SuggestPairingsInput)` as a pure function that produces a pairings grid minimizing repeats,
So that organizers have a "Suggest Pairings" button that produces a reasonable starting point (target-miss: T4.2 manual pin/lock covers Pinehurst entirely if this slips).

(Single-object input shape codified in AC #1; the epic source uses positional args as a colloquial hint, but the project's existing engine convention — and AC #1's exact contract — is single-object input for forward-compat extensibility.)

T4-1 ships a pure function that lives in `apps/tournament-api/src/engine/pairings/suggest.ts` and its golden-file tests. **No DB**, **no I/O**, **no env access**, **no route handler**, **no frontend**. T4-2 will call this function from a `POST /api/events/:eventId/pairings/suggest` route handler; T4-1 is just the engine + tests.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** Pure new `engine/pairings/` directory in tournament-api. No new deps, no env vars, no DB migrations.

### 2. Target-miss tolerable per epic + PRD

The epic explicitly tags T4-1 as target-miss tolerable. Josh can hand-construct 8 foursomes for Pinehurst if the engine slips; T4-2's manual pin-and-save is the trip-critical path that must work WITHOUT this story landing. T4-1 is a quality-of-life accelerator, not a blocker.

### 3. Algorithm choice — derived `foursomesPerRound` + canonical fixture for 8×4×4 + greedy fallback

**Derived sizing.** The input does NOT take `foursomesPerRound` directly. It is derived as `Math.floor(roster.length / foursomeSize)` per round (every round has the same number of foursomes). When `roster.length` divides evenly by `foursomeSize` (e.g., 8 / 4 = 2), every roster player plays every round. When it doesn't divide evenly (e.g., 9 / 4 = 2 with 1 leftover), a rotating subset sits out per round (see sit-out logic below). For Pinehurst (8 players, foursomeSize=4) → 2 foursomes per round, no sit-outs. For non-multiple cases (e.g., 9 × 4 = 2 foursomes + 1 sit-out per round) → rotating sit-outs.

If `roster.length < foursomeSize` (can't fill even one foursome) → return empty grid (`grid.rounds: []`) + warning `"insufficient roster: need at least {foursomeSize}, got {roster.length}"`. **The grid is empty in this case, NOT partial-length** — keeping the type invariant `playerIds.length === foursomeSize` always-true (per round-1 codex catch).

If `roster.length` is not an integer multiple of `foursomeSize` (e.g., 9 players × foursomeSize 4 → 2 full foursomes + 1 leftover slot per round), the algorithm sits out `roster.length - playableSlots` distinct players per round, where `playableSlots = foursomesPerRound * foursomeSize`. Let `sitOutCount = roster.length - playableSlots`.

**Sit-out + pin reconciliation algorithm (precise, deterministic):**

For each round `r` in `0..numRounds-1`:
1. Compute the round's pinned players: `pinnedInRound = { p.playerId for p in pins where p.round === r+1 }`.
2. Generate the candidate sit-out sequence in round-robin order: `candidate(j) = roster[(r * sitOutCount + j) % roster.length]` for `j = 0, 1, 2, ...`.
3. Iterate `j` upward; for each candidate, SKIP if it's in `pinnedInRound` (pins always play; sit-outs select from the un-pinned remainder). Add the first non-pinned candidate to this round's sit-out set. Continue until `sitOutCount` distinct sit-outs are collected OR `j` has cycled the full roster (in which case fewer than `sitOutCount` sit-outs were possible, which means too many pins; the overflow case from Risk §5 has already produced its warning).
4. The round's playable players = `roster - sitOutSet`. Pins are placed first per Risk §5. Remaining slots filled greedily.

**Pin-overflow within a round** (when pins force more players to participate than `playableSlots`): handled at the pin-placement stage per Risk §5. The first `foursomeSize` pinned players per `(round, foursome)` are honored in input order; remaining are dropped + the `"foursome (round {r}, foursome {f}) overflowed — {n} pinned, max is {foursomeSize}"` warning fires per Risk §6. After the overflow drop, the round is feasible (≤ `playableSlots` distinct pinned players), and the sit-out reconciliation algorithm above proceeds normally.

**No-permanent-benching guarantee:** when `pins` is empty/undefined AND `numRounds * sitOutCount >= roster.length`, the round-robin formula produces a complete coverage cycle: every roster index is selected as a sit-out at least once. Tested explicitly. When pins are present, the skip-step in (3) preserves rotation for un-pinned players; pinned players have their own (different) frequency that depends on the pin pattern. The "permanent sit-out" warning fires only on the strict no-pins case where `numRounds * sitOutCount < roster.length` — i.e., the roster is too large to rotate everyone through the sit-out positions.

**Constraint:** `'everyone-once'` means every pair of players meets in at least one foursome across all rounds. NOT "every pair meets EXACTLY once" (that's a stricter resolvable design problem). For 8 players × 4 rounds × foursomes-of-4, the math: 4 rounds × C(4,2)=6 pairs per foursome × 2 foursomes per round = 48 pair-meetings spread across C(8,2)=28 pairs. Average 1.71 meetings per pair.

**Algorithm — two-tier:**

1. **Canonical fixture path (load-bearing for 8×4×4 Pinehurst case).** Trigger condition (exact, deterministic):

   ```
   roster.length === 8
   && numRounds === 4
   && foursomeSize === 4
   && constraint === 'everyone-once'
   && (pins === undefined || pins.length === 0)
   ```

   "No pins" treats `pins: undefined` AND `pins: []` IDENTICALLY (per round-2 codex catch — `pins: []` is truthy in JS, so a naive `!pins` check would incorrectly skip the fixture path for empty-array callers; common case from T4-2's UI which always passes an array). Return a HARDCODED known-good schedule that satisfies everyone-once (verified at impl time via the AC #2 pair-coverage test). The hardcoded schedule below is one valid solution (others exist; impl-codex verifies the chosen one):

   ```
   round 1: [r0, r1, r2, r3] [r4, r5, r6, r7]
   round 2: [r0, r1, r4, r5] [r2, r3, r6, r7]
   round 3: [r0, r2, r4, r6] [r1, r3, r5, r7]
   round 4: [r0, r3, r4, r7] [r1, r2, r5, r6]
   ```
   Where `r0..r7` are the roster's first 8 entries in order. **This is the v1 trip-critical case.** Other sizes fall through to the greedy path. (Verifying the hardcoded schedule's pair coverage at impl time is one of the explicit test ACs.)

2. **Greedy fallback (everything else).** For all other input shapes (different roster size, different numRounds, pins present, OR `constraint: 'custom'`):
   - Place pinned slots verbatim.
   - For each remaining slot (round-by-round, foursome-by-foursome, slot-by-slot in deterministic order), pick the unplaced player that minimizes the maximum pair-meeting count so far. Ties broken by player order in `roster` (deterministic).
   - **Pair-coverage scan is CONSTRAINT-CONDITIONAL.** When `constraint === 'everyone-once'`: scan all C(roster.length, 2) pairs; for each pair with 0 meetings, add `"pair-not-met: {playerA} and {playerB}"` warning. When `constraint === 'custom'`: SKIP the scan (no `pair-not-met` warnings emitted, regardless of coverage). This honors AC #7's contract that `'custom'` is the weaker constraint (no everyone-once enforcement).
   - **Greedy is NOT guaranteed to satisfy everyone-once** for arbitrary input shapes; the warnings inform the T4-2 UI when constraints can't be fully satisfied. Grid is returned regardless (target-miss-tolerable).

This **two-tier** design honors target-miss-tolerance: the load-bearing 8×4×4 Pinehurst case is guaranteed by hardcoded fixture; everything else is best-effort with explicit warnings.

### 4. Determinism guarantee

No `Math.random()` anywhere. No `Date.now()`, no environment variables, no global mutable state. Same input → byte-for-byte identical output, verifiable via `expect(result).toEqual(expectedFixture)` in vitest. If a future caller wants variety, the input shape supports an optional `seed?: number` parameter that would feed a seeded PRNG (NOT in T4-1 scope; reserved for v1.5+).

### 5. Pin handling semantics

Pins are an array of `{ round, foursome, playerId }` triples (1-indexed `round` + `foursome`). Placement is verbatim:
- The pinned `playerId` occupies the first available slot in `(round, foursome)` (slot ordering is internal to the algorithm; T4-2's UI assigns slot_number at save time).
- **Allowed:** same `playerId` pinned to MULTIPLE rounds (e.g., `[{round:1,foursome:1,playerId:'p0'}, {round:2,foursome:1,playerId:'p0'}]`) — that's the normal case where Josh wants player p0 in foursome 1 every round.
- **Allowed:** multiple `playerId` values pinned to the same `(round, foursome)` (e.g., `[{round:1,foursome:1,playerId:'p0'}, {round:1,foursome:1,playerId:'p1'}]`) up to `foursomeSize` total. That's pin-multiple-players-to-one-foursome.
- **Input violation — same playerId pinned to TWO foursomes in ONE round:** e.g., `[{round:1,foursome:1,playerId:'p0'}, {round:1,foursome:2,playerId:'p0'}]`. The grid is returned with the FIRST pin honored (foursome 1); the second is DROPPED + warning `"player p0 pinned to multiple foursomes in round 1"`. Subsequent processing fills the dropped slot greedily.
- **Input violation — duplicate same `(round, foursome, playerId)` triple:** e.g., the same triple appears twice in `pins`. Idempotent: first occurrence honored, second silently no-ops (no warning — it's harmless).
- **Input violation — pin OVERFLOWS `foursomeSize`:** more than `foursomeSize` distinct players pinned to ONE `(round, foursome)`. The first `foursomeSize` are honored in input order; remaining are DROPPED + warning `"foursome (round {r}, foursome {f}) overflowed — {n} pinned, max is {foursomeSize}"`.
- **Input violation — out-of-range round/foursome:** `round < 1 || round > numRounds`, or `foursome < 1 || foursome > foursomesPerRound` (per Risk §3 derivation). Pin DROPPED + warning `"pin out of range: round {r}, foursome {f}"`.
- **Input violation — unknown playerId:** Pin DROPPED + warning `"pin references unknown playerId {id}"`.

### 6. Warning strings — stable contract

Warning strings are part of the public contract (callers / future T4-2 UI may surface them). T4-1 fixes a small enumeration. **Ordering is deterministic** — warnings are appended in algorithm execution order: (1) input-validation warnings (insufficient roster, unknown playerId, pin out of range, etc.) are emitted during pin processing in input-array order; (2) per-round warnings (overflow, multiple-foursomes-same-round, sit-out permanent benching) are emitted in round order then within-round in input order; (3) post-fill `pair-not-met` warnings (when applicable) are emitted in playerId-pair lexicographic order to keep deterministic output. Same input → same warning array byte-for-byte.

**Enumeration:**
- `"pair-not-met: {playerA} and {playerB}"` — for everyone-once violations on the greedy fallback path
- `"player {id} pinned to multiple foursomes in round {round}"` — same playerId in two different foursomes of one round
- `"foursome (round {r}, foursome {f}) overflowed — {n} pinned, max is {foursomeSize}"` — too many distinct players pinned to one foursome
- `"pin out of range: round {r}, foursome {f}"` — round/foursome index outside [1..numRounds] or [1..foursomesPerRound]
- `"pin references unknown playerId {id}"` — pin's playerId not in roster
- `"insufficient roster: need at least {foursomeSize}, got {roster.length}"` — can't fill even one foursome
- `"player {id} never plays: roster size + foursome size produces a permanent sit-out"` — only when `roster.length % foursomeSize !== 0` AND a player is never assigned across all rounds (rare)

Future T4.x stories may extend this enumeration; existing strings are stable.

### 7. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/engine/pairings/suggest.ts` — NEW
- `apps/tournament-api/src/engine/pairings/suggest.test.ts` — NEW
- `apps/tournament-api/src/engine/pairings/__snapshots__/` — NEW directory if vitest snapshots are used (tested ALLOWED)
- Story file + codex review files in `_bmad-output/`

NO SHARED edits expected. NO FORBIDDEN edits. **No `app.ts` change** (the engine isn't wired into a route — T4-2 does that).

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/engine/pairings/suggest.ts`
   **When** inspected
   **Then** it exports `suggestPairings(input: SuggestPairingsInput): SuggestPairingsResult` as a pure function with NO DB / I/O / env access. Both types are exported alongside.

   ```ts
   export interface SuggestPairingsInput {
     roster: string[];                                              // playerIds
     numRounds: number;                                             // ≥ 1
     foursomeSize: number;                                          // typically 4 (Pinehurst); supports any positive integer
     constraint: 'everyone-once' | 'custom';                        // 'custom' = no constraint, just minimize repeats
     pins?: Array<{ round: number; foursome: number; playerId: string }>;  // optional; rounds + foursomes are 1-indexed for human readability
   }

   export interface PairingsGrid {
     rounds: Array<{
       round: number;                                               // 1-indexed
       foursomes: Array<{
         foursome: number;                                          // 1-indexed within the round
         playerIds: string[];                                       // length === foursomeSize, in deterministic order
       }>;
     }>;
   }

   export interface SuggestPairingsResult {
     grid: PairingsGrid;
     warnings: string[];                                            // empty on full success; non-empty per Risk §6 enumeration
   }
   ```

   The function MUST NOT import from `../../db/`, `../../routes/`, `../../middleware/`, `node:fs`, or any other I/O surface. ESLint rule (existing project posture) catches the boundary if violated.

2. **Given** `roster.length === 8`, `numRounds === 4`, `foursomeSize === 4`, `constraint === 'everyone-once'`, `pins` undefined
   **When** invoked
   **Then** the returned `grid` has every player pair sharing at least one foursome across the 4 rounds (verifiable via test assertion over all C(8,2)=28 pairs); `warnings` is an empty array.

3. **Given** the same input twice
   **When** invoked
   **Then** the output is byte-for-byte identical (verified via `expect(JSON.stringify(a)).toEqual(JSON.stringify(b))` AND `expect(a).toEqual(b)` deep equality).

4. **Given** a `pins` array containing valid pin tuples
   **When** invoked
   **Then** every pinned `(round, foursome, playerId)` combination appears verbatim in the returned grid (the player is in the foursome's `playerIds` array). Remaining unpinned slots are filled greedily.

5. **Given** an INVALID pin (out of range, unknown playerId, same player pinned to two foursomes in one round)
   **When** invoked
   **Then** the function returns the grid with that pin DROPPED + a warning string per Risk §6 enumeration. **Does NOT throw.**

6. **Given** a roster too small to fill any foursome (e.g., `roster.length: 2`, `foursomeSize: 4`, `numRounds: 1`)
   **When** invoked
   **Then** the function returns `{ grid: { rounds: [] }, warnings: ["insufficient roster: need at least 4, got 2"] }`. **Does NOT throw.** The grid is EMPTY (not partial-length) — preserves the type invariant that every `foursomes[i].playerIds.length === foursomeSize` whenever a foursome row exists.

7. **Given** `constraint: 'custom'` with no pins
   **When** invoked
   **Then** the algorithm permutes greedily without enforcing everyone-once. Output is a fully-filled grid (no warnings about pair coverage); behaves identically to `'everyone-once'` for inputs where every-pair-met is naturally achieved.

8. **Given** `apps/tournament-api/src/engine/pairings/suggest.test.ts` (NEW)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 9 tests pass:
   - **Test A — 8-player no-pins everyone-once**: golden-file fixture; `warnings` empty; all C(8,2)=28 pairs covered (via assertion loop over the grid).
   - **Test B — partial-pinned regenerate**: `pins: [{round:1, foursome:1, playerId:'p0'}, {round:1, foursome:1, playerId:'p1'}]`; verify both pins honored verbatim; remaining slots filled greedily.
   - **Test C — fully-pinned no-regen**: every slot has a pin; suggest returns the pinned grid unchanged; `warnings` empty.
   - **Test D — invalid pin** (unknown playerId): grid returned without the pin; `warnings` contains `"pin references unknown playerId p99"`.
   - **Test E — determinism**: invoke twice with the SAME input; assert deep equality + JSON-string equality on outputs.
   - **Test F — insufficient roster**: 2-player roster + foursomeSize 4; returns `{ grid: { rounds: [] }, warnings: ["insufficient roster: need at least 4, got 2"] }` (empty grid, NOT partial — matches AC #6 exactly).
   - **Test G — duplicate pin same round**: pin same playerId to (round 1, foursome 1) AND (round 1, foursome 2); first pin honored, second dropped + warning.
   - **Test H — pin overrides sit-out (round-2 codex catch)**: 9-player roster + foursomeSize 4 + numRounds 2 (sit-out rotation would normally bench player at index 8 in round 1). Pin player at index 8 to (round 1, foursome 1). Verify the pinned player IS in the foursome (not sat out); the sit-out for round 1 is now a different player from the un-pinned remainder.
   - **Test I — no-permanent-benching guarantee (round-4 codex catch)**: 9-player roster + foursomeSize 4 + numRounds 9 (so `numRounds * sitOutCount = 9 ≥ roster.length = 9`). No pins. Run suggest, scan all 9 rounds' grids, verify EVERY player from the 9-player roster appears in at least ONE foursome across the 9 rounds (i.e., no permanent sit-outs). Verify NO `"never plays"` warning fires.

9. **Given** `pnpm -F @tournament/api test`
   **When** run post-T4-1
   **Then** total tests ≥ baseline + 9. Baseline at story start: 410 (post-T3-10).

10. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T4-1
    **Then** both continue to pass with zero net-negative test count change.

11. **Given** typecheck + lint + build for tournament-api
    **When** run post-T4-1
    **Then** all exit 0. No new `any`. No new `// eslint-disable`. No `Math.random()`. No `Date.now()` in `suggest.ts`.

12. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED.

## Tasks / Subtasks

- [ ] Task 1: Capture baseline (410).

- [ ] Task 2: Backend — create `engine/pairings/suggest.ts`. (AC #1, #4-#7)
  - [ ] Subtask 2.1: Define types (SuggestPairingsInput, PairingsGrid, SuggestPairingsResult).
  - [ ] Subtask 2.2: Implement input validation + warning generation.
  - [ ] Subtask 2.3: Implement pin placement.
  - [ ] Subtask 2.4: Implement greedy fill with deterministic ordering.
  - [ ] Subtask 2.5: Implement post-fill pair-coverage check + `pair-not-met` warnings.

- [ ] Task 3: Backend — create `engine/pairings/suggest.test.ts` with at least 9 tests (matches AC #8 enumeration A–I). (AC #8)

- [ ] Task 4: Run regressions (typecheck, lint, all 4 test suites).

## Dev Notes

- **Why a separate `engine/pairings/` directory rather than `lib/`?** Engine code = pure functions, no I/O. The directory boundary makes the no-I/O invariant visible at the path layer. Future T6.x stories will add `engine/scoring/`, `engine/money/`, etc. — same pattern.

- **Why 1-indexed `round` + `foursome` in the public contract?** Human-friendly for T4-2's UI labels ("Round 1", "Foursome 2"). Internal algorithm code may use 0-indexed arrays, but the public surface is 1-indexed. Consistent with golf-domain convention.

- **Why greedy + warnings rather than full backtracking + throw on impossibility?** Throwing is hostile to T4-2's UI ("the regenerate button just errored"). Warnings let the UI surface a banner: "Pinned positions made everyone-once impossible — you may want to unpin Josh from round 2." Strictly better UX.

- **Why no `seed` parameter in v1?** The greedy algorithm is fully determined by `roster` order + pin order. If a future story needs "regenerate with variety" UX, the `seed` parameter can be added without breaking the v1 callers (additive). Reserved for v1.5+.

- **Why `'custom'` constraint?** A weaker contract for cases where the organizer doesn't care about everyone-once (e.g., a 6-round event where pair-meets-twice is fine). Stub for v1.5+ stories that may extend it.

- **No DB schema in T4-1.** T4-2 adds `pairings` + `pairing_members` tables. T4-1 is pure compute on in-memory data passed by the future T4-2 caller.

- **Wolf Cup isolation (FD-1 / FD-2):** T4-1 writes only to `apps/tournament-api/src/engine/pairings/`. Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-H-zero-M.
- **Retro AI-2 applied:** zero SHARED files pre-announced.

### Project Structure Notes

Shape after T4-1:

```
apps/tournament-api/
  src/
    engine/
      pairings/
        suggest.ts                                # NEW: pure function
        suggest.test.ts                           # NEW: 9+ tests
```

**Explicitly NOT in T4-1 (reserved for future):**
- `pairings` + `pairing_members` schema (T4-2).
- Route handler `POST /api/events/:eventId/pairings/suggest` (T4-2).
- Frontend UI (T4-2).
- PDF export (T4-3).
- `seed` parameter for variety (v1.5+).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T4.1 (line 1116-1144).
- Predecessor stories: T3-1 (players + groups schema, source for the `roster` input shape; pure function only references playerId strings).
- Consumer story (downstream): T4-2 (pairings UI + persistence) calls `suggestPairings` from a route handler at impl time.
- Pattern reference: Wolf Cup engine pure-function posture in `packages/engine/` (for posture, not for code reuse — T4-1 is greenfield in tournament-api).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
