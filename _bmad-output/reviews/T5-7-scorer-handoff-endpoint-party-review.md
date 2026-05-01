# T5-7 Party-Mode Review (non-interactive, written)

- Story: T5-7 Scorer Handoff Endpoint [new]
- Spec: `_bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md`
- Generated: 2026-05-01 (impl-codex-rerun returned 0H 1M 1L; both non-blocking and documented in followups)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)
- Format: written consensus; no open questions; tournament-director will codex-review this output as step 9.

---

## Mary (📊 Analyst) — AC compliance + requirements traceability

I traced all 10 ACs (with 4 added test cases per the iteration-2 spec rev) against the implementation. Net: AC compliance is solid with **two intentional v1 deviations** that are documented in the spec.

- **AC-1 (endpoint shape + Zod):** ✅ `POST /api/rounds/:roundId/scorer-assignments/transfer`; `scorerTransferBodySchema` Zod schema enforces `{ foursomeNumber: z.number().int().positive(), toPlayerId: z.string().uuid() }`. Path UUID validated via `UUID_RE`. Error codes 400 invalid_round_id / invalid_body all wired.
- **AC-2 (round + state gate):** ✅ Round existence check (404 round_not_found); round_states gate (422 round_state_missing / round_finalized / round_cancelled). Allowed states (not_started / in_progress / complete_editable) proceed.
- **AC-3 (per-event organizer OR current scorer; in-tx auth):** ✅ Lines 159–222 of `scorer-assignments.ts` do exactly this — in-tx SELECT scorer (capture `fromPlayerId`), in-tx SELECT events.organizer_player_id, in-tx auth re-check. 403 not_authorized_for_handoff on mismatch.
- **AC-4 (foursome membership):** ✅ Lines 224–250 join pairing_members → pairings on `pairings.event_round_id = rounds.event_round_id`. 422 assignee_not_in_foursome on miss.
- **AC-5 (atomic transfer + audit + activity):** ✅ TOCTOU-narrowed scorer-path UPDATE (when caller is purely the current scorer); permissive organizer-path UPDATE (when caller is event organizer; precedence rule applied per impl-codex-rerun fix). `writeAudit` + `emitActivity` both inside the same transaction. `assignedAt: Date.now()` is the single source of truth (used in UPDATE column, audit JSON, and response payload — addresses spec Risks Low #2).
- **AC-6 (cross-device propagation ≤15s):** ✅ Existing T5-2 `GET /api/rounds/:roundId` endpoint reads scorer_assignments and returns `myFoursome.scorerPlayerId` + `myFoursome.scorerName`. The 15s polling interval on the score-entry page (`refetchInterval: 15_000`) brings the new state to other devices comfortably under NFR-P2's 30s envelope.
- **AC-7 (stale-queue 403 metadata):** ✅ T5-6 middleware already populates `currentScorerName` on the 403 path; the integration test (i) explicitly verifies the post-handoff stale-queue scenario.
- **AC-8 (web handoff UI):** ✅ `<HandoffControl>` component visible only when `isScorer === true`; member picker excludes the current scorer; POST → 200 → `queryClient.invalidateQueries(['round-detail', roundId])` → next refetch shows read-only state. The new test "T5-7: 200 transfer response → query invalidated → page transitions to read-only" locks this in.
- **AC-9 (stale-queue banner):** ✅ `<StaleQueueBanner>` reads `peekErroredEntries(roundId)`, filters on `lastError.body.code` ∈ {'player_not_in_your_foursome', 'not_scorer_for_this_foursome'} AND non-null `currentScorerName`. Per impl-codex-rerun fix, banner now renders ONLY in the read-only branch (when `isScorer === false`) — the active-scorer branch shows the handoff control instead. This narrows the false-positive surface.
- **AC-10 (test coverage):** ✅ All 14 cases (a)–(n) present + new (o) for organizer-also-scorer override. 552/552 tournament-api tests, 110/110 tournament-web tests.

**Documented v1 deviations:**
- **Files this story will edit** was extended during impl to include `apps/tournament-web/src/lib/offline-queue.ts` (added `peekErroredEntries` helper). This was per the spec's amendment rule and is appended in "Files this story will edit".
- AC-9 banner gating tightened to read-only branch only (per Med #3 fix).

**Verdict:** all 10 ACs satisfied; documented deviations are reasonable.

---

## Winston (🏗 Architect) — boundary, atomicity, layering

T5-7 is the third route the tournament app has shipped on top of the T5-1 schema, so its role is not pattern-establishing — it's pattern-consuming. I weighed against existing precedent.

**Strengths:**
- **In-transaction auth re-check is correctly atomic.** Lines 156–222 of `scorer-assignments.ts`: SELECT scorer-row + SELECT events.organizer + auth check + foursome-membership SELECT + UPDATE all run inside one `db.transaction(async (tx) => {...})`. The TOCTOU window the spec was worried about (between pre-tx SELECT and UPDATE) is gone.
- **Path-selection precedence (organizer-path wins when both apply)** is the right call. A common-enough scenario — small-league organizer who's also assigned to score their own foursome — would have failed under the old code if a concurrent transfer slipped between the SELECT and UPDATE. The fix is a one-line conditional swap; the comment block at lines 263–271 documents it cleanly.
- **Per-event organizer (not global is_organizer) is correctly enforced** — line 192 reads `events.organizerPlayerId` from the events table joined via rounds.event_id. Test (m) locks in the rejection of global-isOrganizer-but-not-event-organizer. This prevents a future regression to a global-admin model.
- **Tenant scoping is exhaustive.** Every JOIN includes `tenant_id` filters on both sides (5 tables joined: scorer_assignments, events, rounds, pairing_members, pairings). Audit + activity helpers use `audit:round` context_id consistent with T5-1 schema design.
- **Handler-internal authorization, not middleware** is the architecturally correct choice. `requireScorerForRound` would 403 the organizer-recovery path; `requireOrganizer` (global) would 403 the scorer-handoff path. Neither fits the dual-identity rule. Inline in the transaction is correct.
- **No new constants needed.** `AUDIT_EVENT_TYPES.SCORER_TRANSFERRED = 'scorer.transferred'` was already at `lib/audit-log.ts:27` from T5-1's audit infrastructure. Activity emit signature is forward-compatible with T8.

**Concerns / future-proofing:**
- **State gate is OUTSIDE the transaction (AC-2).** Real concern: if round transitions to `finalized` between AC-2 and AC-5's UPDATE, the handoff still commits. v1 acceptance is reasonable (sub-millisecond window; finalize is organizer-only and an organizer racing themselves is not a real scenario). Followup T5-7f tracks moving the state read inside the transaction when T5-8 ships its `transitionState` service. **Not blocking.**
- **Test (o) is identity-verifying, not contention-verifying.** Per impl-codex-rerun Medium: the organizer-also-scorer override test passes with both the OLD bug and the NEW fix because there's no actual concurrent transfer in flight. A true contention test requires either a path-selection unit-test refactor or a `tx.update` mock. Followup T5-7g tracks. The fix is sound; the test is weak. **Not blocking.**
- **Soft TOCTOU window in scorer-path UPDATE.** The narrowed scorer-path `AND scorer_player_id = :fromPlayerId` correctly returns 0 rows when scorer changed mid-tx. SQLite's transaction isolation should make this work in practice (write-locks are exclusive in deferred-mode tx). I'd want a small note in the file header documenting that the implementation relies on SQLite's exclusive-write-lock behavior, but that's polish, not a correctness gap.

**Boundary check:** zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`. New ALLOWED file `apps/tournament-web/src/lib/offline-queue.ts` modification (1 added function) was correctly appended to "Files this story will edit". No SHARED edits.

**Verdict:** architecturally sound. Pattern-consuming, follows T5-5 / T5-6 conventions correctly.

---

## John (📋 PM) — user value + Pinehurst readiness

Asking "WHY" and tracing back to the actual moment: Jeff's phone dies on hole 14 of round 2; he hands the scoring duty to Ben. Or Jeff just wants Ben to score the back-9 because Jeff is in the lead and wants to focus.

**Trip-day flow check:**
1. **Mid-round handoff:** Jeff taps "Hand off scorer" on the active score-entry page → picks Ben from the 3-member list → confirm. ✅ Implemented.
2. **Dead-phone recovery:** Jeff's phone dies. Organizer (= Jeff in this case... but in general, the league's designated event organizer per the events row) on their own device opens the score-entry page for Jeff's foursome (currently shows read-only "Jeff is scoring"). Wait — does the organizer have a way to initiate transfer from the read-only state? Looking at the code... no. The handoff button is only visible when `isScorer === true`. The organizer-recovery path is **API-only** in v1 — there's no UI affordance for it. This means an organizer recovering a dead phone would need to use a CLI / admin tool / direct API call.

   **This is a v1 gap I want flagged.** The spec lists "organizer-recovery path" as the SECOND auth path for the API but the AC-8 web UI text only describes the scorer-initiated flow. The organizer recovery via UI is missing.
   
   **Recommendation:** add to the spec's followups: T5-7h (organizer-recovery UI) — when an organizer views a foursome's read-only state for a foursome they're NOT in, the UI should offer a "Reassign scorer (recovery)" button that POSTs the same endpoint. v1.5 enhancement. The API supports it today; only the UI affordance is missing.

3. **At-the-turn voluntary handoff:** Jeff hands to Ben between holes 9 and 10 because Ben volunteers. ✅ Same flow as mid-round.
4. **Stale-queue UX:** Jeff's phone had 3 unsynced scores when the handoff happened; he reconnects after the trip ends. ✅ Stale-queue banner on the read-only screen tells him to ask Ben to re-enter or use admin correction (T5-9).
5. **Cross-device update:** Ben's device polls the round-detail every 15s. After Jeff's transfer commits, Ben's UI flips to the active-scorer state on next poll. ✅ Within NFR-P2's 30s envelope.

**Trip readiness:** the dominant case (voluntary handoff at the turn) is fully supported by the UI. The dead-phone-recovery case requires API access, which is a real gap but workable: the organizer can SSH the VPS or use curl from another device with the right cookie. For the 2026 Pinehurst trip, that's fine because the league is small and Jeff has admin access. T5-7h closes this for v1.5.

**Verdict:** ships value; trip-ready with the known UI gap on organizer-recovery.

---

## Quinn (🧪 QA) — coverage + soak readiness

Test count: 14 API integration cases + 1 organizer-also-scorer override test + 6 new web tests. 552/552 + 110/110.

**API coverage:**
- ✅ Happy path (scorer + organizer paths both covered: tests a, b, o).
- ✅ All 4 documented error codes (403 not_authorized, 422 round_finalized / round_cancelled / round_state_missing / foursome_has_no_scorer / assignee_not_in_foursome, 400 invalid_round_id / invalid_body).
- ✅ Auth invariants: per-event vs global organizer (m); scorer-of-different-foursome (n).
- ✅ Stale-queue scenario (i): post-handoff prior scorer's POST hits 403 with `currentScorerName` populated.
- ✅ Audit row content (j).

**Web coverage:**
- ✅ Handoff button visibility (isScorer=true vs false).
- ✅ Picker excludes current scorer.
- ✅ POST body shape verified.
- ✅ Post-200 transition to read-only (locked in by the new test).
- ✅ Stale-queue banner renders + does-not-render.

**Holes I'd flag but accept:**
- **Concurrency / TOCTOU regression test missing.** Test (o) wouldn't catch a regression where someone re-introduces the path-selection bug under contention. Followup T5-7g documents. Not trip-blocking.
- **No web test for the "Cancel" picker action.** The picker has a Cancel button that returns to the closed state; not tested. Trivial; v1.5 polish.
- **No web test for the API error path** (e.g., 403 surfaces inline). Coverage gap; not blocking.
- **No load test.** Trip-day field is 16 players × 4 days × maybe 2 handoffs/day max. Trivial scale. No load test needed.

**Reliability:**
- The integration tests fully use the in-memory libsql + drizzle migrate pattern from T5-5/T5-6. No flakiness vectors I can see.
- The web tests properly mock `fetch` per-URL and `peekErroredEntries` via vi.hoisted spy. Following the T5-2 pattern.

**Verdict:** coverage is fit for trip readiness. Ship it.

---

## Amelia (💻 Dev) — code quality + maintainability

`apps/tournament-api/src/routes/scorer-assignments.ts:62` `scorerAssignmentsRouter`. Reads cleanly. Single POST handler.

Notes by file:
- `routes/scorer-assignments.ts` — 322 lines. One async handler. Inline `TENANT_ID = 'guyan'` consistent with T5-5 / T5-6 precedent. Single transaction wraps all writes + auth re-check. ✅
- `routes/scorer-assignments.integration.test.ts` — 614 lines. 15 tests (14 ACs + 1 dual-role override). Self-contained `seed` helper extends T5-6's pattern; supports `state: 'NONE'`, `noScorerAssignment: true`, `twoFoursomes: true` toggles. Clean.
- `app.ts` — 7 lines added (import + mount + comment block). Mount path is `/api/rounds` consistent with the scores router.
- `apps/tournament-web/src/lib/offline-queue.ts` — added `peekErroredEntries(roundId?)` (1 new exported function, 14 LOC). Read-only; doesn't mutate the errored bucket. Existing API contract preserved.
- `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx` — added `<HandoffControl>` (102 LOC) + `<StaleQueueBanner>` (54 LOC). Both are local components inside the same file. Banner is gated to read-only branch only after impl-codex-rerun fix.
- `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx` — added `peekErroredSpy` to the existing offline-queue mock; 6 new T5-7 tests + 1 new post-200 transition test. Existing test infrastructure reused.

**`pnpm -r typecheck` ✅. `pnpm -r lint` ✅** (after fixing one prefer-const lint error iteration-2). Tests 100%.

**No skipped tests. No dead code.** No dependencies added.

**Verdict:** ready for review. Follows T5-5 / T5-6 conventions cleanly.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Apply impl-codex High #1 (organizer-also-scorer path-selection precedence) | High | ✅ APPLIED iteration 2 |
| 2 | Apply impl-codex Medium #2 (post-200 transition test missing) | Medium | ✅ APPLIED iteration 2 |
| 3 | Apply impl-codex Medium #3 (banner false-positive when isScorer=true) | Medium | ✅ APPLIED iteration 2 |
| 4 | Add followup for TOCTOU contention regression test | Medium | ✅ Followup T5-7g documented |
| 5 | Organizer-recovery UI is a v1 gap (API supports it; no UI affordance) | Medium | **Recommend new Followup T5-7h** |
| 6 | Picker "Cancel" button untested | Low | v1.5 polish |
| 7 | API error path (403 inline) untested in web | Low | v1.5 polish |
| 8 | File-header note on SQLite write-lock TOCTOU dependency | Low | v1.5 polish |

**John's #5 is the one that wasn't already documented.** Recommendation: add T5-7h to the spec's followups.

**Overall verdict:** Recommend → done. AC compliance solid; impl-codex Highs all addressed; trip-ready. The organizer-recovery-UI gap (T5-7h) is a v1.5 enhancement, not a blocker.

No open questions for the user.
