# T5-8 Party-Mode Review (non-interactive, written)

- Story: T5-8 Round Lifecycle State Machine [new]
- Spec: `_bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md`
- Generated: 2026-05-01 (impl-codex-rerun returned 0H 1M 2L; all non-blocking, Medium addressed)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)
- Format: written consensus; no open questions; tournament-director will codex-review this output as step 9.

---

## Mary (📊 Analyst) — AC compliance + traceability

13 ACs traced against the implementation. Net: solid AC compliance with **the documented v1 residual race window** (codex-acknowledged limitation, deliberate user-gate decision, tracked in T5-8b followup).

- **AC-1 (service signature):** ✅ All 6 functions exported per the documented signature: transitionState (5 params now incl. tenantId), getRoundState, isEventOrganizer, computeExpectedCells, computeMissingCells, getRoundContext. BusinessRuleError positional constructor `(code, message, status?)` with 422 default.
- **AC-2 (transition matrix):** ✅ LEGAL_TRANSITIONS Map at services/round-state.ts:97-108. Every legal transition tested + every illegal transition tested.
- **AC-3 (audit + opened_at side effects):** ✅ writeAudit on every successful transition; rounds.opened_at SET only on not_started→in_progress IF NULL (idempotent on subsequent transitions, verified by test).
- **AC-4 (POST /complete):** ✅ State gate, auth-FIRST (post-codex fix), missing-cell enumeration via computeMissingCells, transitionState, activity emit. Returns 200 with idempotent flag.
- **AC-5 (POST /complete-rollback):** ✅ Symmetric to AC-4.
- **AC-6 (POST /finalize):** ✅ Per-event organizer auth FIRST (post-codex fix); finalizedAt sourced from round_states.entered_at AFTER transition (single source of truth across first + idempotent paths); 2 audit rows on first call (state_changed + round.finalized); 0 new audit rows on idempotent second call (verified by test h2 with finalizedAt stability assertion).
- **AC-7 (POST /cancel):** ✅ Auth-first; idempotent path doesn't double-audit (test n3 verifies).
- **AC-8 (score POST against finalized → 422):** ✅ T5-6's existing round_not_writable code returns 422 with currentState='finalized'. v1 deviation acknowledged in spec: original AC-8 wording said `round_state_locks_writes`; impl uses the existing T5-6 code `round_not_writable` for consistency.
- **AC-9 (T5-6 refactor):** ✅ Inline state-flip blocks at scores.ts:455-540 replaced with transitionState calls. Race-safety + opened_at side effect now centralized in the service. All 552 pre-existing T5-6 tests pass unchanged.
- **AC-10 (T5-7 refactor):** ✅ State read moved into the transaction; EXISTS predicate added to scorer_assignments UPDATE; "finalize-before-handoff" regression test added (test in route-lifecycle.integration.test.ts at the bottom). T5-7d + T5-7g closed; T5-7f partially closed (within-snapshot residual remains; T5-8b owns).
- **AC-11 (service-level test coverage):** ✅ 24 unit/integration tests covering all 7 specified cases plus extras (illegal transitions across all 5 states, tenant scoping, opened_at idempotency).
- **AC-12 (route-level test coverage):** ✅ 20 integration tests including the auth-bypass-fix tests (d2, h3, n2) and idempotent no-double-audit (n3) added during the impl-codex round, plus the cross-story finalize-before-handoff regression.
- **AC-13 (audit + activity contract):** ✅ Every transition writes state_changed; finalize writes ADDITIONALLY round.finalized; idempotent paths write zero new rows.

**v1 deviations documented in spec:**
- Section 7 + Followup T5-8b: SQLite snapshot-isolation residual race window (within-snapshot case for /finalize during /handoff). User-gate accepted decision A: ship as-is, BEGIN IMMEDIATE work tracked for v1.5.
- AC-8 code drift: `round_not_writable` (existing T5-6) vs spec's stated `round_state_locks_writes` — kept the existing code for consistency with T5-6's untouched behavior.

**Verdict:** AC compliance solid; documented residuals are reasonable.

---

## Winston (🏗 Architect) — services-layer extension + boundary

T5-8 is the second story to add to `services/` (after T5-5). Pattern-extending, not pattern-establishing. I weighed the architectural choices.

**Strengths:**
- **Single mutating exception correctly carved out.** Barrel comment at `services/index.ts:5-19` explicitly amends T5-5's read-only convention to allow domain-side-effect-isolating functions (transitionState being the canonical one). The line — "orphan side-effects without a domain reason are NOT allowed; encapsulating the legal-transition matrix + race-safe UPDATE + audit-row write into a single function IS the domain reason" — is exactly the right place to draw the line.
- **In-tx auth checks across all 4 lifecycle handlers** (post-codex fix) close a real auth-bypass surface that the initial impl had. Auth runs FIRST; idempotent and error paths both come AFTER auth.
- **TOCTOU-narrowed UPDATE in transitionState** (conditional on `state = :current`) is race-safe for the FSM transition itself (state column is the column being read+written). For OTHER writers (T5-7's UPDATE), the EXISTS predicate pattern adds defense-in-depth at the WRITE level.
- **Tenant scoping is exhaustive.** Every join in services/round-state.ts and routes/round-lifecycle.ts includes tenant_id on every joined table.
- **transitionState's tenantId param** (added during spec-codex revision) keeps the service free of ambient TENANT_ID dependency. Cleaner for testability + future multi-tenant work.

**Acknowledged residuals:**
- **Within-snapshot race window.** Section 7 + Followup T5-8b explicitly document this. The trade-off is reasonable for a 16-player league with deliberate organizer + scorer actions; full closure requires BEGIN IMMEDIATE which drizzle-orm doesn't cleanly expose.
- **Score-commit INSERT not state-gated at the WRITE level.** Same residual as above (Medium #4 from impl-codex first round). Drizzle's INSERT API doesn't accept a WHERE clause; the existing state read at scores.ts:332-348 closes the pre-tx case but not the within-snapshot case. Same v1 acceptance.
- **/finalize Date.now() fallback (Low #3 from impl-codex rerun).** A defensive `?? Date.now()` if the round_states row somehow isn't there post-transition. Should never fire (transitionState guarantees the row exists post-call), but keeps the response from undefined-on-edge-case. Acceptable.

**Boundary check:** zero edits to apps/api/**, apps/web/**, packages/engine/**. No SHARED edits. Footprint stayed exactly within the spec's declared 8 files (+ T5-7 spec mod for closing followups).

**Verdict:** architecturally sound. Pattern-extension done right.

---

## John (📋 PM) — user value + Pinehurst readiness

The story closes the lifecycle gap that's been blocking T5-9 (score correction, which needs `finalized` to be reachable). Concrete user flows:

1. **Round 2 ends, all scores entered.** Foursomes converge on the patio. Scorer-of-foursome-1 (Ben) taps "Mark complete" → POST /complete → state flips to complete_editable → ✅. Other devices' next leaderboard poll reflects the change.
2. **Organizer reviews scores at the bar.** Sees Mark's hole 14 was 5, not 6. Wants to amend. T5-9 (score correction) ships next; T5-9 will use getRoundState + the FSM gate to allow corrections in complete_editable.
3. **Organizer clicks "Finalize round 2".** POST /finalize → state flips to finalized → audit log captures it → next leaderboard poll shows the round as locked.
4. **Mark accidentally double-taps Finalize.** Idempotent — second call returns 200 with idempotent: true and the SAME finalizedAt timestamp. UI can suppress duplicate success toast. ✅
5. **Mid-round emergency: storm rolls in, organizer cancels round 3.** POST /cancel → state=cancelled → leaderboard service excludes cancelled rounds (T5-5 leaderboard.ts already filters appropriately when T6 money lands). ✅
6. **Auto-complete from last-cell commit.** T5-6's auto-complete path now goes through transitionState (refactored) — same race-safety, centralized logic. ✅

**Pinehurst trip readiness:** the FSM endpoints are organizer-driven; the 2026 Pinehurst trip already happened (May 4-8 by the time you read this, May 1 is pre-trip). For trip use, the organizer has /complete and /finalize available. The within-snapshot race residual is essentially impossible in practice (16 players, deliberate human actions).

**Two PM concerns I want to flag for v1.5:**
- **/complete-rollback is in the spec but I'm not sure when an organizer would tap it in the wild.** It exists for "auto-complete fired prematurely" cases. v1 ships it; if real-world use shows it's never tapped, drop it in v1.5. Or document a UI for it (currently no UI affordance).
- **/cancel is a one-way street in v1.** Followup T5-8b mentions "re-open cancelled rounds" — that's a v1.5+ admin operation. For trip-day, organizer cancelling a round and then realizing it shouldn't have been cancelled would need a database write. Acceptable risk for a 4-day trip with sober organizers.

**Verdict:** ships value; trip-ready; supports T5-9's upcoming work.

---

## Quinn (🧪 QA) — coverage + ship readiness

44 net new tests in tournament-api: 24 service-level + 20 route-level. 600/600 passing.

**Service-level coverage (round-state.test.ts):**
- ✅ All 7 legal transitions tested + audit assertion.
- ✅ All illegal transitions throw BusinessRuleError with code='illegal_state_transition'.
- ✅ round_state_missing throw on null state row.
- ✅ Idempotent on already-target (no audit row written — important).
- ✅ opened_at idempotency (set once on not_started→in_progress; preserved on subsequent transitions).
- ✅ getRoundState happy path + null path.
- ✅ isEventOrganizer 3 cases (true, false-non-organizer, false-foreign-player-with-is-organizer-flag).
- ✅ computeExpectedCells 3 cases (4×18, null eventRoundId, 9-hole).
- ✅ computeMissingCells 3 cases (full-scored, partial-scored with 1 missing, null eventRoundId).

**Route-level coverage (round-lifecycle.integration.test.ts):**
- ✅ AC-12 (a)–(o) all 15 cases covered.
- ✅ Plus auth-bypass regression tests (d2, h3, n2) added during impl-codex round.
- ✅ Plus n3: cancel idempotent no-audit assertion.
- ✅ Plus h2: finalizedAt stability across first + idempotent calls.
- ✅ Plus the cross-story finalize-before-handoff regression test (closes T5-7g).

**Holes I'd flag but accept:**
- **No within-snapshot race contention test.** Per the documented v1 residual, this case isn't fully closed by the impl, so a test would either fail (revealing the residual) or be impossible to write reliably under SQLite WAL semantics. T5-8b owns the fix + the test.
- **No T6 finalize-recompute integration test.** T6 hasn't shipped. Test will land with T5-8a when T6 plugs in.

**Reliability:**
- Tests use the same in-memory libsql + drizzle migrate pattern from T5-5/T5-6/T5-7. Stable.
- The cross-story test (finalize-before-handoff) imports both routers and exercises the real refactored paths. Solid integration coverage.

**Verdict:** ship-ready coverage.

---

## Amelia (💻 Dev) — code quality + maintainability

Notes by file:

- `services/round-state.ts` — 322 LOC. One service module with 6 exports. transitionState's flow is clearly numbered (steps 1-8). Comment block at top documents the snapshot-residual transparently. ✅
- `services/round-state.test.ts` — 446 LOC. 24 tests across 6 describes. Self-contained `seed` helper handles state injection. Imports BusinessRuleError as a value but uses `(e as { code: string }).code` for type-safe property access (avoids the dynamic-import-as-type TypeScript footgun).
- `services/index.ts` — barrel re-exports the new module. Comment block amended to acknowledge the single mutating exception. ✅
- `routes/round-lifecycle.ts` — 446 LOC. 4 POST handlers; auth-first ordering (post-codex fix); BusinessRuleError → HTTP status mapping is consistent across handlers. ✅
- `routes/round-lifecycle.integration.test.ts` — 470 LOC. 20 tests across 5 describes (one per route + cross-story regression).
- `app.ts` — 8 lines added (import + mount + comment block).
- `routes/scores.ts` — refactored. Inline state-flip blocks (~85 LOC) replaced with transitionState calls (~25 LOC). Net -60 LOC. The local computeExpectedCells helper is now imported from the service.
- `routes/scorer-assignments.ts` — refactored. Pre-tx state read removed (~30 LOC); state read moved inside the tx. EXISTS predicate added to scorer_assignments UPDATE. The 0-rows-updated branch now disambiguates state-vs-scorer mismatch by re-reading state. ✅
- `_bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md` — followups marked closed/partial.

**`pnpm -r typecheck` ✅. `pnpm -r lint` ✅.** No skipped tests. No dead code. No new dependencies.

**Verdict:** ready for review. Refactor is a net code-removal (T5-6 -60 LOC, T5-7 -30 LOC, +new service +new routes); architectural cleanup that should make T5-9 + future T6 work easier.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Apply impl-codex High #1 (auth bypass on idempotent paths) | High | ✅ APPLIED iteration 2 |
| 2 | Apply impl-codex Medium #2 (finalizedAt timestamp source consistency) | Medium | ✅ APPLIED iteration 2 |
| 3 | Apply impl-codex Medium #3 (test gaps: idempotent auth + no-double-audit) | Medium | ✅ APPLIED iteration 2 (4 new tests) |
| 4 | Document impl-codex Medium #4 (score INSERT residual) under T5-8b | Medium | ✅ Documented in spec followup |
| 5 | Apply impl-codex-rerun Medium (finalizedAt stability test assertion) | Medium | ✅ APPLIED iteration 3 |
| 6 | Document impl-codex-rerun Lows (round_state_missing leak; Date.now fallback) | Low | ✅ Acknowledged; non-blocking |
| 7 | /complete-rollback no UI affordance for v1 | Low | v1.5 followup |
| 8 | /cancel re-open path | Low | v1.5+ admin |

**Overall verdict:** Recommend → done. AC compliance solid; architectural pattern correctly extends T5-5's services-layer convention; trip-ready. The within-snapshot race residual is a deliberate v1 trade-off documented and tracked.

No open questions for the user.
