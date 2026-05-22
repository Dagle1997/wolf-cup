# T13-2 Start Round — Party-Mode Review

**Mode:** non-interactive written review (no open questions).
**Story:** T13-2-start-round-instantiate-scoring (Epic T13)
**Change:** new `POST /api/admin/event-rounds/:eventRoundId/start` (creates `rounds` + `round_states`='not_started' + per-foursome `scorer_assignments` atomically; idempotent + race-safe via the partial UNIQUE in migration 0013); a dedicated web start-round route with per-foursome scorer pickers; the lifecycle E2E now drives build → locked pairings → start → score → leaderboard.
**Status entering review:** tournament-api 981 ✓ (e2e 13), tournament-web 334 ✓, engine 472 ✓, wolf-cup-api 517 ✓, typecheck 0, lint clean, impl codex PASS (v2 + the openedAt/middleware fixes verified green).
**Verification anchors (for a context-free reader):** the implementation/coverage claims below were substantiated by the impl codex-review (which read the code) — see `T13-2-start-round-instantiate-scoring-impl-codex.md` + `-v2.md`. **engine + wolf-cup-api were NOT modified** (they appear only as regression baselines); the entire change set is under `apps/tournament-api/**`, `apps/tournament-web/**`, and tournament artifacts — verified via `git status` (zero FORBIDDEN-path edits). Coverage claims map to the named tests in `onboarding-lifecycle.e2e.test.ts` (lifecycle + 8 validation/idempotency cases) and `admin.events.$eventId.start-round.test.tsx` (3 render tests).

---

## 📊 Mary — Business Analyst
The story closes the single highest-impact defect found in the run-through: the app could build an event but never *score* it. Requirements trace to an exhaustive `.insert(` enumeration proving the gap, and to Wolf Cup parity. Scope is correctly bounded — start-round only; lifecycle transitions/scoring already existed. The product decisions (explicit "Start round"; organizer designates a scorer per foursome) are recorded with their rationale (accountless rosters need a login-capable scorer). **No requirements gaps.**

## 🏗️ Winston — Architect
Right shape. The endpoint mirrors Wolf Cup's deliberate round-creation, adapted to tournament's richer model (round_states FSM + scorer_assignments), and instantiates from the already-existing pairings rather than rebuilding foursomes. Two correctness calls landed well: (1) the initial state is sourced from the FSM (`INITIAL_ROUND_STATE='not_started'`, the source-only entry state), not a hardcoded literal — and `openedAt` is left NULL so the FSM owns first-open semantics (set on the first-score transition), avoiding a "created vs first-scored" drift; (2) idempotency is race-safe at the DB layer (partial UNIQUE on `rounds.event_round_id`) with insert-then-recover outside the aborted tx, mirroring the proven `resolveOrInsertGhinPlayer` pattern. Tenant scoping is consistent. The migration is a single partial index, safe because no `event_round`-linked rounds can exist pre-T13-2. **No architectural concerns.**

## 📋 John — Product Manager
This is what makes the app actually usable for an event: an organizer can now go roster → pairings → **start** → score → leaderboard. The designate-a-scorer-per-foursome flow matches how scoring really happens at the course (one phone per group). Defaulting the picker to the organizer is a sensible "it just works" path with per-foursome override. **Ship-ready from a product lens.**

## 🧪 Quinn — QA Engineer
Coverage is strong and, crucially, end-to-end: the lifecycle test proves scoring is REACHABLE (build → locked pairings → start → score → leaderboard reflects the score) — the gap closing, demonstrated, not asserted. Validation is fully exercised: 403 non-organizer, 404 unknown event_round, 422 pairings_not_ready (both unlocked AND no-pairings), 400 invalid_body/duplicate_foursome/unknown_foursome/missing_scorer_for_foursome/invalid_scorer. Idempotency: the double-start test exercises the real UNIQUE-recover branch (returns 200 alreadyStarted, one row) — which also empirically proves the libsql UNIQUE-error detection is correct. Web: 3 render tests (picker renders, Start posts the right scorers, empty state). Honest gaps, acceptable: true wall-clock concurrency isn't unit-testable (the UNIQUE is the structural guarantee); the recovery's defensive check validates round_states but not scorer_assignments (atomic create makes partial state unreachable). **Tests adequate; green first run.**

## 🎨 Sally — UX Designer
The dedicated start-round route is the right placement — read-only against the pairings editor so it can't disturb that critical flow, reached via a clear "Start round" card on the admin landing. Per-foursome scorer dropdowns (members + "You (organizer)") are simple and match the mental model; only all-locked rounds appear, with an empty state that points back to Pairings when nothing's ready. On success it routes straight to score-entry. One acceptable note (consistent with other admin web routes): the route's `beforeLoad` is auth-only; a non-organizer sees the pairings-fetch error state rather than a tailored "not authorized" — server-side `requireOrganizer` is the real guard. **No UX changes required.**

## 💻 Amelia — Developer
Matches the ACs. AC-1 atomic three-table create; AC-2 score POST succeeds after start (proven); AC-3 every validation has a test; AC-4 idempotent + race-safe; AC-5 web picker + Start; AC-6 full-lifecycle E2E. Initial state + openedAt sourced from / deferred to the FSM. All suites green, typecheck 0, lint clean (the test-cleanup activity-truncate carries a scoped, justified eslint-disable). No drift.

---

## 🧙 BMad Master — Consolidated Verdict
All perspectives converge: T13-2 closes the run-through's biggest gap (no way to start scoring) with an FSM-consistent, race-safe, organizer-driven start-round flow, proven end-to-end. Residual items (web route organizer-gating is server-enforced; recovery's scorer_assignments defensive check) are acceptable and recorded.

**Verdict: SHIP-READY. Zero required changes.**
