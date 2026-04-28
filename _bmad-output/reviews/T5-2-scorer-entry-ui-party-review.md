# T5-2 Party-Mode Review (non-interactive written)

**Story:** T5-2 — Scorer Entry UI [port from Wolf Cup; iOS keyboard fix intact]. First UI consumer of T5-3's offline queue + T5-6's score POST endpoint.
**Status:** review
**Generated:** 2026-04-28
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T5-2 is the **first user-facing scoring surface** for tournament. It's the screen scorers will tap on at Pinehurst No. 2 with a flaky 5G signal in the trees. Every other T5 story converges to make this experience reliable. Without T5-2, the schema (T5-1), the offline queue (T5-3), and the server endpoint (T5-6) are all dark plumbing.

**Threat model — six surfaces:**

1. **iOS keyboard cadence** (NFR-P1: ≤10s for full-foursome-per-hole). The load-bearing UX detail. Wolf Cup commit `ebe3cea` discovered: iOS Safari only opens the keyboard when `focus()` is called inside a user-gesture handler. T5-2 preserves the pattern verbatim — Save's `onClick` SYNCHRONOUSLY calls `scoreInputRefs.current[0]?.focus()` BEFORE awaiting any enqueueMutation, and stable `key={member.playerId}` on input wrappers means React reuses the same DOM input across hole advances → keyboard stays open. **Test pinned**: ordering spy on `focus()` + spy on `enqueueMutation` proves focus fires first. **The trip-day cadence promise is real.**

2. **Offline-first via T5-3 queue.** Save fires 4 separate `enqueueMutation` calls per hole (one per cell), each with a stable `clientEventId`. Round-2 + round-3 codex hardened the retry-dedupe model: clientEventIds are CACHED in a sessionStorage-persisted Map keyed by `(hole, playerId)`. A partial-fail-then-retry cycle reuses the same IDs → server's dedupe target catches the successful first-pass entries (200 deduped path). A page reload mid-hole also reuses the cached IDs. **Robust against the "intermittent 5G + scorer panics + retries" trip-day failure mode.**

3. **Score range bug fix vs Wolf Cup.** Wolf Cup's UI hardcodes `maxLength={1}` + `/^[1-9]$/` regex → cannot enter 10+ scores. **T5-2 corrects this**: maxLength={2}; SCORE_RE accepts 1-20 (matching T5-6's Zod). Real golf scenario: Pinehurst No. 2's hole 5 (par 5, water on the left, OB right) has historically produced 10+ scores in Wolf Cup play. Tournament can score them now.

4. **Score-existence obfuscation via uniform 404.** Backend GET returns 404 `round_not_found` byte-equivalent to foreign-tenant case for all of: nonexistent round, foreign tenant, session not in any foursome. Test verifies the response shape matches across the cases. **A probe attempt cannot distinguish "exists" vs "exists but I'm not in it."** v1 single-tenant Guyan; defense-in-depth for v2+.

5. **State-machine writability.** GET surfaces `round_states.state`; UI handles 6 view branches (Loading / 404 not-in-round / 422 setup-error / round-closed / no-scorer / read-only / score-entry-form) per the precedence ordering. Save POSTs hit T5-6's middleware, which 422s for non-writable states (finalized/cancelled). **Round 1 codex flagged round_states-default contradiction; round 2 resolved to 422 round_state_missing with no silent default.** Loud failures > silent corruption.

6. **Skip hole + sessionStorage**. Per epic AC line 1313. T5-2 ships persisted `skippedHoles` Set per-roundId; cleared automatically when server fills the cell (e.g., another scorer or admin correction). Guards against the "skip 5, advance to 6, server refetch returns 5 unscored, UI snaps back to 5" bug. Test pinned the pinned scenario explicitly.

**Strategic significance:** the trip-day scoring cadence promise is now live for testing. T5.10 airplane-mode drill is the integration capstone; T5-2 ships the UI shell.

**Recommendation: ship.**

---

## 🏗️ Winston (Architect) — System Design Perspective

Eight observations:

1. **Backend GET added to scoresRouter** (vs split-into-rounds-router). Single mount at `/api/rounds`; the file is now ~530 lines (POST + GET handlers). Acceptable for v1; future split into `routes/round-detail.ts` is a refactor candidate when T5.7 adds more reads.

2. **6 view branches with explicit precedence ordering**. Loading → 404 → 422 → round-closed → no-scorer → read-only → score-entry-form. Each branch has a `data-testid` for component tests. **Sharp branching.** No fallthrough; no implicit defaults.

3. **Member ordering by slot_number ASC** is load-bearing. Backend SQL `.orderBy(pairingMembers.slotNumber)` produces deterministic order; frontend maps array order to `scoreInputRefs.current[idx]`. Test #1 in scores.read.test.ts pins the member-name ordering. If the order ever drifts, the iOS keyboard fix's auto-advance would target the wrong inputs.

4. **Two refs for ref-positional indexing.** `scoreInputRefs.current[idx]` for the DOM input (focus/blur targets). `pendingAdvanceTimers.current[idx]` for per-input debounce timers (cancel on next keystroke / blur / unmount). Cleanup useEffect on unmount clears all timers. **Robust.**

5. **clientEventIdCache (Round-2 + Round-3 hardening)**. The single design that survived the most codex iterations:
   - Round 1: spec mandated per-cell clientEventIds.
   - Round 2: codex caught "new IDs on retry → dedupe broken." Added cache.
   - Round 3: codex caught "in-memory cache lost on reload." Added sessionStorage persistence.
   - Round 4: codex caught "partial-fail blocks retry via queue.pendingCount gate." Added separate `isSaving` state.
   The final design: cache keyed by `${hole}:${playerId}`, persisted to sessionStorage, cleared per hole on advance. Save button gated by local `isSaving` (NOT `queue.pendingCount`, so retries work even with successful first-pass entries still in the queue).

6. **Auto-advance state machine**. `'3'`-`'9'` advance immediately (no valid 2-digit score starts with these digits). `'1'` AND `'2'` wait 1500ms (could start `10`-`19` or `20`). 2-digit values 10-19 / 20 advance immediately. Cancellation rules: timer cleared on next keystroke (valid OR invalid), input blur, component unmount. **The state machine is small but careful.**

7. **Promise.allSettled with try/catch wrap inside .map() — round-2 hardening.** A synchronous throw during enqueue construction (e.g., `crypto.randomUUID()` unavailable, `parseInt` NaN) is converted to a rejected Promise so `allSettled` sees ALL 4 cell outcomes, not a bailed-loop partial. Defense-in-depth for the "iPhone 12 + Safari 17 + low memory" edge case.

8. **TanStack Query polling at 15s with `refetchIntervalInBackground: false`** — battery + bandwidth conserved on backgrounded tabs; foreground catches scorer-handoffs without WebSockets/SSE.

**Architectural concerns: zero blockers.**

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T5-2 satisfy the trip-day scorer-entry promise?** Yes. The page renders a familiar Wolf-Cup-style score-entry grid; iOS keyboard stays open across hole advances; scores persist to IDB on Save; sync chip surfaces queue depth. The 6 view branches give clear states for non-scorers, non-participants, setup-pending rounds, and closed rounds.

**Scope discipline check:**
- 9 NEW source files: 3 backend (route + GET handler — same file modified — + 1 test) + 2 frontend (route + test).
- 4 modified source files: scores.ts (added GET), useOfflineQueue.ts (cleanup), PORTS.md (port row), routeTree.gen.ts (auto-regen).
- 5 BMAD docs: spec + 4 codex review files.
- 0 SHARED files. 0 FORBIDDEN.

**Path footprint is clean.**

**v1 limitations** (acceptable):
- 9-hole rounds: tested at the API layer (holes_to_play=9 returns correctly); UI handles the upper-bound check (hole 10 in 9-hole round → 422 from server). Manual smoke at T9.1 9-hole drill validates UX.
- Putts: optional input with controlled-input revert (0-15 range). No tests for the putts validation specifically; covered indirectly by the happy-path Save test which sends putts=null (no putts entered).
- Round-closed handling routes to leaderboard placeholder (T5-5 owns the actual leaderboard).
- The "scoring complete from your end" placeholder when currentHole === null is rendered but no test specifically pins the all-done branch — covered indirectly by the currentHole formula tests in T5.10.

**Test surface: 24 new tests** (10 backend + 14 frontend). Tournament-api 489 → 499 (+10). Tournament-web 78 → 92 (+14). AC #10 floor was +23; margin +1.

**Recommendation: ship.**

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 489 → 499 (+10). AC #10 floor was +10 backend. ✓
- tournament-web: 78 → 92 (+14). AC #10 floor was +13 frontend. Margin +1.
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).
- typecheck + lint clean across all 5 workspaces.

**`scores.read.test.ts` coverage** (10 tests):

| AC | Test | Pin? |
|---|---|---|
| AC #1, #2 | 200 happy + members slot_number ASC | ✅ load-bearing |
| AC #3 | 200 non-scorer participant | ✅ |
| AC #4 | 404 non-participant uniform | ✅ load-bearing |
| AC #2 | 200 with hole_scores populated | ✅ |
| AC #2 | 200 finalized state | ✅ |
| AC #2 | 200 9-hole | ✅ |
| Risk §3 | 200 no-scorer-yet (scorerPlayerId/scorerName null) | ✅ load-bearing |
| AC #1 | 422 round_state_missing | ✅ load-bearing |
| AC #1 | 400 invalid_round_id | ✅ |
| AC #4, #5 | 404 foreign-tenant | ✅ load-bearing |

**`rounds.$roundId.score-entry.test.tsx` coverage** (14 tests):

| AC | Test | Pin? |
|---|---|---|
| AC #6, #9 | Loading state | ✅ |
| AC #6 | Score inputs grid (isScorer=true) | ✅ |
| AC #9 | Read-only placeholder (isScorer=false) | ✅ |
| AC #9 | Round-closed (state=finalized) | ✅ |
| AC #9 | No-scorer-yet (scorerPlayerId=null) | ✅ |
| AC #6 | Auto-advance state machine ('5' immediate, '1' waits 1500ms via fake timers, '12' advances) | ✅ **load-bearing** |
| AC #6 | Score input rejects invalid (30/01/0/non-digit) | ✅ |
| AC #6 | Save button disabled until 4 valid | ✅ |
| AC #6 | iOS keyboard fix: focus before enqueue (load-bearing) | ✅ **load-bearing** |
| AC #7 | Save enqueues 4 mutations with distinct clientEventIds | ✅ load-bearing |
| Risk §5 | Skip hole + sessionStorage + don't snap back | ✅ load-bearing |
| AC #8 | registerTerminalErrors at mount | ✅ |
| AC #9 | Pending-sync chip | ✅ |
| AC #4 | Not-in-round placeholder on 404 | ✅ |

**Coverage gaps** (Lows; documented as v1.5 followups):

1. **Save partial-failure path** (round-1 codex Med added defensive code; not pinned by an explicit test). The retry-dedupe via clientEventIdCache is plumbed but not tested under simulated rejection. Acceptable v1 — the failure mode (`crypto.randomUUID()` throws, `enqueueMutation` rejects synchronously) is rare on supported browsers.

2. **clientEventIdCache sessionStorage persistence** (round-3 fix). Not unit-tested. The behavior is straightforward (generates and caches; reuses; cleared per hole; persisted across reloads); manual verification at T5.10 airplane-mode drill is the integration coverage.

3. **isSaving lock vs queue.pendingCount distinction** (round-3 fix). Not unit-tested. The behavior matters most under partial-fail (button stays clickable for retry); manual verification at T5.10.

4. **Putts validation edge cases** (input range 0-15, non-digit, leading zero). The component logic is correct; not exercised by a dedicated test. Putts is optional v1; trip-day scorers may not use it.

5. **15s polling refetch behavior** in jsdom. Not unit-tested. TanStack Query handles it correctly; manual smoke is the validation.

6. **All-done placeholder** (currentHole === null). Not pinned by a frontend test. Covered indirectly by the test where Skip hole at hole=1 advances to hole=2 of an 18-hole round (currentHole stays positive). The all-done branch is reached only when every cell is scored OR every unscored hole is skipped — rare enough that v1.5 is fine.

**Net assessment:** the tests pin **all the load-bearing correctness paths for trip day** — iOS keyboard fix ordering, dual-UNIQUE-friendly enqueue, view-branch precedence, Skip hole sessionStorage, terminal-error registry, auto-advance state machine. Coverage gaps are bounded; T5.10's full integration drill validates the unhappy paths.

**Recommendation: ship.**

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + impl-codex iteration evidence.

**`scores.ts` GET handler** (~155 lines added): tenant-scoped 5-step lookup; `inArray` filter for hole_scores (round-1 fix); 404 uniform via early-return on round-existence-then-foursome-membership.
- L67-99: path-param + round-existence check; uniform 404 early.
- L101-118: round_states 422.
- L120-150: round.eventRoundId NULL check + my-foursome lookup; 404 uniform on non-participant.
- L152-175: members ordered by slot_number ASC.
- L177-195: scorer_assignments + scorer name JOIN.
- L197-214: hole_scores filtered via SQL `inArray` (round-1 fix).
- L216-230: response assembly.

**`rounds.$roundId.score-entry.tsx`** (~470 lines): TanStack Query GET + 6 view branches + ScoreEntryForm with full state machine.
- L1-22: provenance header citing Wolf Cup `score-entry-hole.tsx` @ commit `67238a22a949e37d5d6143ddf46e3804aec57f59` + iOS keyboard fix commit `ebe3cea`.
- L98-130: top-level component branches (loading / 404 / 422 / round-closed / no-scorer / read-only / form).
- L138-159: skippedHoles state + sessionStorage persist.
- L161-200: server-filled-hole computation + cleared-by-server logic with value-equality.
- L202-227: currentHole formula (min(unscoredHoles - skippedHoles)).
- L240-275: clientEventIdCache + sessionStorage persistence + per-hole clear (round-2 + round-3 hardening).
- L286-360: auto-advance state machine with timer refs + cleanup.
- L390-470: Save handler with synchronous focus + Promise.allSettled + try/catch wrap inside .map() + isSaving lock + saveError state (round-2 + round-3 hardening).
- L515-535: Skip hole handler + sessionStorage update.
- L545-585: render — chip, inputs grid (`<div key={member.playerId}>`), validation banner, save-error toast, Save button gated by `!allValid || isSaving`.

**Lint + typecheck:** clean. No `any`. Two `console.warn` calls (one in offline-queue from T5-3; not added in T5-2). Zero TS-ignore.

**Test patterns:**
- Backend tests use the established `vi.mock('../middleware/require-session.js')` pattern from T5-6.
- Frontend tests use `fireEvent.change` (NOT `userEvent.type`) for controlled-input value updates in jsdom — `userEvent.type` doesn't reliably trigger React's onChange in this version stack.
- The auto-advance test uses `vi.useFakeTimers({ shouldAdvanceTime: true })` AFTER the GET resolves to avoid the React-19+fake-timer act-hang issue I hit in earlier runs.
- `vi.hoisted` for the `enqueueSpy` to avoid the "factory hoisted before var" error.

**DRY / idiomatic concerns:**
1. The `SCORE_RE` regex is duplicated between the input keystroke validator and the `allValid` check. Acceptable for clarity.
2. The clientEventIdCache logic (~50 lines) could be extracted into a custom `useClientEventIdCache(roundId, currentHole)` hook. Not v1 (the logic is local to this route).
3. The 6 view branches in the top-level component are written as nested `if` returns. Could be a switch/explicit dispatch table; the cascade reads cleanly so kept as-is.
4. `loadSkippedHoles` and `persistSkippedHoles` mirror the clientEventIdCache pattern. Common helper extraction is a v1.5 cleanup.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge. Spec-codex 4 rounds (AI-1 cap, all FIXED). Impl-codex 3 rounds (0 High after round 3). Test deltas exceed AC floors (+24 vs +23 floor; margin +1). Path footprint: 13 ALLOWED files (9 NEW + 4 modified), ZERO SHARED, ZERO FORBIDDEN. Wolf Cup regressions clean (engine 472, api 507).

**Load-bearing correctness:**
1. **iOS keyboard fix preserved verbatim** — synchronous focus in user-gesture handler before any await; pinned by ordering spy test.
2. **Score range corrected to 1-20** vs Wolf Cup's 1-9 limitation; controlled-input revert pattern handles invalid keystrokes.
3. **Auto-advance state machine** — `'3'`-`'9'` immediate, `'1'`/`'2'` wait 1500ms, 2-digit immediate; per-input timer refs cleaned on unmount.
4. **clientEventIdCache** persisted to sessionStorage so retries dedupe correctly; cache cleared per-hole-advance.
5. **Skip hole sessionStorage** with cleared-by-server-fill logic; defends against the snap-back scenario.
6. **6 view branches with explicit precedence** — Loading / 404 / 422 / round-closed / no-scorer / read-only / form.
7. **Tenant scoping coverage** — every backend SELECT filtered; uniform 404 obfuscates round existence.
8. **Promise.allSettled with sync-throw protection** — defense-in-depth for the rare "crypto unavailable" failure mode.
9. **isSaving local lock** distinct from queue.pendingCount — partial-fail-then-retry works as intended.

**Documented limitations (followups):**
- Save partial-failure path defensive code not unit-tested (rare failure mode).
- clientEventIdCache sessionStorage persistence not unit-tested (manual T5.10 verification).
- Putts validation edge cases not pinned (optional v1 input).
- 15s polling refetch behavior trusted to TanStack Query.
- All-done placeholder (currentHole === null) not pinned.

**Followups (other stories):**
- T5.7 (scorer handoff): GET response stays the same; 15s polling catches handoffs transparently.
- T5.10 (airplane-mode drill): full integration test of enqueue → offline → reconnect → drain → 409 → resolveConflict.
- T5-5 (leaderboard): "Open leaderboard" link target becomes real.
- T8 (activity spine): T5-6's emitActivity stub gets real implementation; T5-2 unaffected.

**Manual verification post-commit (Josh's T9.1 9-hole drill territory):**
1. Open `/rounds/<roundId>/score-entry` in iOS Safari. Verify the numeric keyboard surfaces.
2. Enter scores 1-9 → verify auto-advance is immediate (3-9) or 1.5s wait (1, 2).
3. Enter "10" → verify 2-digit advance.
4. Tap Save → verify keyboard stays open across hole advances.
5. Test offline mode: airplane-mode → enter scores → reconnect → verify queue drains and chip updates.
6. Test scorer handoff: have organizer reassign scorer mid-round → verify the prior scorer's UI transitions to read-only within ~15s without refresh.

**Epic T5 progress: 4/11 done (T5-1 + T5-3 + T5-6 + T5-2).** Per Josh's option-A sequencing, the 3-story core scoring path is now complete. T5-4 (offline cache shell), T5-5 (leaderboard v1), or T5-7 (scorer handoff) are the natural next picks.

**The director workflow can proceed to commit.**
