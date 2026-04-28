# T5-6 Party-Mode Review (non-interactive written)

**Story:** T5-6 — Score POST + require-scorer-for-round Middleware (single-writer enforcement, FR-B10/NFR-S3/FR-H3).
**Status:** review
**Generated:** 2026-04-28
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T5-6 is the **single-writer enforcement boundary** for the entire scoring epic. Without it, FR-B10 (one scorer per foursome) is unenforceable: any participant could construct a hand-crafted POST and overwrite scores. With it, even a malicious actor with a valid session cookie cannot write to a foursome they're not assigned to score. This is the trip-day security floor.

**Threat model — six surfaces:**

1. **Identity binding** (`session.userId === scorer_assignments.scorer_player_id`). The middleware joins `pairing_members → pairings` to find the foursome containing `body.playerId`, then matches `scorer_assignments.scorer_player_id` against the session. **Verified by test #10 in middleware tests** (happy path) + tests #8/#9 (the two distinct 403 codes). The `currentScorerName` payload on 403 lets the client UI suggest the correct scorer rather than just "you're forbidden" — UX win + diagnostic clarity.

2. **Idempotent replay** (T5-1's dual-UNIQUE). Same `clientEventId` retried → 200 deduped, no audit row. Different `clientEventId` at same cell → 409 with `conflictingEntry` payload. **Verified by integration tests #2 (dedupe-no-audit) + #3 (collision)**. The scorer's offline queue (T5-3) supplies stable clientEventIds across retries; the server enforces the dedupe contract.

3. **State-machine concurrency** (transitional integrity). Round-1 codex flagged race-unsafe state transitions. Round-1 fix: conditional UPDATE with state predicate + `.returning()` rows-affected check. Two concurrent first-commits → only one transitions, only one audit row. **The middleware enforces single-writer, so this race is theoretical** (only one scorer per foursome can issue concurrent commits, and even then their clientEventIds differ → second hits 409 before reaching state-transition code), but the defense-in-depth is correct + cheap.

4. **Tenant scoping coverage**. Every SELECT/INSERT/UPDATE in the middleware AND the handler filters on `tenant_id = TENANT_ID`. Round-2 codex caught one tenant-filter omission (the post-concurrency-loss state re-read) — fixed. Round-2 final pass: zero remaining tenant gaps.

5. **Polymorphic audit trail** (T5-1's `audit_log` + the new shared constants `AUDIT_EVENT_TYPES` / `AUDIT_ENTITY_TYPES`). T5-6 / T5-7 / T5-8 / T5-9 / T7-6 all import these constants — typo-fragmentation guard works. Three audit rows in T5-6's contract: `score.committed` on new cell + `round.state_changed` on first-commit transition + `round.state_changed` on auto-complete. **Pinned by integration tests #1 (score.committed payload), #6 (first-commit audit), #7 (auto-complete audit).**

6. **Forward-compat with T8** (the `emitActivity` no-op stub). T5-6 calls `emitActivity(tx, {...})` on every score commit. T8's spec will replace ONLY the function body. The stub's test asserts (a) zero rows written anywhere, (b) the type signature accepts the v1 score-committed shape. T8 can swap implementations without breaking T5-6+ call sites unless T8 adds REQUIRED fields (signature break would be coordinated).

**Strategic significance:** the trip-day single-writer guarantee is now real. A scorer at Pinehurst No. 2 with a valid invite token who tries to construct a hand-crafted POST for a player in a different foursome gets a 403 with `currentScorerName` — the UI tells them who actually owns that input.

**Recommendation: ship.** No commit-blocking concerns.

---

## 🏗️ Winston (Architect) — System Design Perspective

Eight observations:

1. **14-path error taxonomy with deterministic precedence.** Misuse 500s → path-param 400s → body 400 → round_not_found 404 → lookup 404/422 → auth 403 (two distinct codes) → state 422s → cell collision 409 → happy 200/201. Documented in spec §9 + middleware code reads top-to-bottom in this order. **Pattern is solid;** future story `T5-7` (scorer handoff) can mirror it.

2. **Body-parse via context-storage.** Middleware reads + Zod-validates the body, stores via `c.set('scorePostBody', ...)`. Handler reads via `c.get('scorePostBody')`. ContextVariableMap typing in `hono.d.ts` extended (`putts?: number | null | undefined` to satisfy exactOptionalPropertyTypes + Zod's `.optional()` semantics — round-1 typecheck fix). **No double-parse, no body-cache reliance.** Cleaner than mounting `zValidator` middleware (which would require a new dep).

3. **Two-phase scorer lookup.** Middleware computes BOTH `roundScorers` (all assignments for the round) AND `targetFoursome` (the foursome containing `body.playerId`), THEN picks the more specific 403 code. **Extra query** (compared to a one-shot lookup), but the diagnostic clarity is worth it. Handler vs middleware split is sharp: middleware = auth + lookup; handler = transactional write + state.

4. **State-transition logic INLINE.** T5-8 will refactor. Audit-row payloads use `{ from, to }` shape — stable contract; T5-8's refactor is call-site-only. **The conditional UPDATE pattern (`WHERE state='not_started'`) is the canonical race-safe approach** for SQLite without explicit row locks; preserves correctness even under (theoretical) concurrent writes.

5. **`computeExpectedCells` helper.** Lives inline in `scores.ts` with a comment that T5-8 will likely promote to `services/round-state.ts`. **Right pattern** — don't over-extract before T5-8 has actual call-site needs.

6. **`isUniqueConstraintError` heuristic.** Round-2 hardening: removed the `message.includes('UNIQUE')` substring fallback (would have matched unrelated UNIQUE-related error messages); kept `code` / `extendedCode` / `rawCode (2067)` checks across both wrapping error and cause. **Robust to libsql version drift** for any drift that preserves at least one of three fields.

7. **`audit-log.ts` constants module.** `AUDIT_EVENT_TYPES` + `AUDIT_ENTITY_TYPES` exported as `as const` objects. T5-6 uses 3 values (`SCORE_COMMITTED`, `ROUND_STATE_CHANGED`, `HOLE_SCORE`, `ROUND`). T5-7/T5-8/T5-9/T7-6 will extend. **Single source of truth for the polymorphic audit's discriminator strings** — codex round-1 spec review caught the typo-fragmentation risk and this is the resolution.

8. **`activity.ts` stub.** Smallest possible v1 surface; T8 swaps the body. **Right tradeoff** — better to have a callable no-op than gate every consumer behind feature flags.

**Architectural concerns: zero blockers.**

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T5-6 satisfy the FR-B10 single-writer promise?** Yes. The 14-path taxonomy gives the client UI rich error states to drive UX:
- 401 / 403 codes drive "ask the assigned scorer to enter this score"
- 409 with `conflictingEntry` drives the D3-3 overwrite prompt (T5.10's UI)
- 200 deduped is the silent-success path (offline queue replay won't generate spurious activity)
- 201 created is the new-cell happy path

**Scope discipline check:**
- 9 NEW source files: 4 lib (audit-log + activity + their tests), 1 middleware + test, 1 route + integration test, 1 typing extension on hono.d.ts.
- 2 modified files: `apps/tournament-api/src/app.ts` (mount), `apps/tournament-api/src/types/hono.d.ts` (ContextVariableMap).
- Plus the spec + 4 spec-codex review files + 2 impl-codex review files + 1 party review.
- 0 SHARED files. 0 FORBIDDEN edits.

**Path footprint is clean.**

**v1 limitations** (acceptable):
- State-transition logic is INLINE in scores.ts. T5-8 refactors into `transitionState` service. Audit-row payload contract `{from, to}` is stable; refactor is call-site-only.
- `emitActivity` is a no-op v1 stub. T8 replaces the function body. Zero behavioral effect in v1; verified by row-count snapshot test.
- `score_corrections` (edits to existing cells) is OUT OF SCOPE for T5-6. T5-9 owns; T5-6's score POST is INSERT-only (cell-create or dedupe).
- Tenant scoping is column-level only (v1 single-tenant Guyan). v2 retrofit is a system-wide future fork.
- The middleware does an extra query (`roundScorers` lookup) to compute the two-phase decision tree. Tradeoff: ~5ms extra latency per score POST for the more specific 403 code on the rare 403 path. Trip-day acceptable.

**Test surface: 21 new tests** (10 middleware + 8 integration + 1 audit-log + 1 activity + 1 added in impl-round-1 = 21). Tournament-api 468 → 489 (+21; AC #7 floor +20, margin +1).

**Recommendation: ship.**

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 468 → 489 (+21). AC #7 floor was +20. Margin: +1.
- tournament-web: 78 (unchanged — backend-only story).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).
- typecheck + lint clean across all 5 workspaces.

**`require-scorer-for-round.test.ts` coverage** (11 tests — one per error path + happy):

| Path | Test | Pin? |
|---|---|---|
| 500 middleware_misuse | requireSession not ahead | ✅ |
| 500 middleware_misuse_no_round_id | route lacks `:roundId` | ✅ |
| 400 invalid_round_id | non-UUID `:roundId` | ✅ |
| 400 invalid_hole_number | `:holeNumber` not in [1,18] | ✅ |
| 400 invalid_body — malformed_json | non-JSON body | ✅ (added impl-round-1) |
| 400 invalid_body — Zod fail | missing required field | ✅ |
| 404 player_not_in_any_foursome | body.playerId not in pairings | ✅ |
| 422 foursome_has_no_scorer | scorer_assignments row deleted | ✅ |
| 403 not_scorer_for_this_foursome | session not in any foursome's scorer | ✅ load-bearing |
| 403 player_not_in_your_foursome | session is scorer of foursome 1, body is foursome 2 | ✅ load-bearing |
| Happy: next() + scorePostBody set | session matches | ✅ load-bearing |

**`scores.integration.test.ts` coverage** (8 tests):

| AC | Test | Pin? |
|---|---|---|
| 201 happy path | new cell + audit row + correct fields | ✅ load-bearing |
| 200 deduped | same clientEventId; no new row; **audit count == 1** | ✅ load-bearing |
| 409 hole_already_scored | different clientEventId; conflictingEntry payload | ✅ load-bearing |
| 422 round_not_writable | state = 'finalized' | ✅ |
| 422 hole_number_exceeds_holes_to_play | hole 10 in 9-hole round | ✅ |
| State transition not_started → in_progress | first commit | ✅ load-bearing |
| State transition in_progress → complete_editable | last cell of 9-hole 2-player round (17 pre-seeded → 18th completes) | ✅ load-bearing |
| Foreign-tenant defense-in-depth | round in different tenant → 404 | ✅ |

**`audit-log.test.ts` coverage** (1 test):
- writeAudit insert + read round-trip; payload_json round-trips via JSON.parse; AUDIT_EVENT_TYPES + AUDIT_ENTITY_TYPES exported. ✅

**`activity.test.ts` coverage** (1 test):
- emitActivity is a no-op (zero rows in any user-domain table; row-count snapshot before+after); type signature accepts v1 score-committed shape. ✅

**Coverage gaps** (Lows; documented as v1.5 followups):

1. **Concurrent first-commit race**. Round-1 codex flagged this; round-1 fix added the conditional UPDATE pattern. **Not unit-tested as an explicit race scenario** because deterministic concurrency tests in libsql/SQLite are notoriously flaky. Code-review-verified; integration test #6 exercises the happy path which would expose any non-race-safe bug under sequential test runs.

2. **`isUniqueConstraintError` libsql version drift**. The current implementation handles 3 field shapes (`code`, `extendedCode`, `rawCode`). If libsql ever emits a 4th shape, the handler falls through to the catch-all 500. Mitigation: integration test #3 (409 hole_already_scored) is the canary — it fails loud if the heuristic ever stops matching the real error.

3. **`computeExpectedCells` with NULL eventRoundId** (v1.5 standalone-round forward-compat). Returns 0 → never auto-completes. Not unit-tested; T5-1 spec already documented this as v1.5 territory.

**Net assessment:** the tests pin **all the correctness paths that matter for trip-day** including the two distinct 403 codes (load-bearing for FR-B10), idempotent dedupe + 409 collision, state transitions with audit rows, and tenant-scoping defense-in-depth. Coverage gaps are bounded; downstream stories (T5-7, T5-8, T5-9) will exercise these paths further.

**Recommendation: ship.**

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + impl-codex iteration evidence.

**`scores.ts`** (~400 lines): provenance header at L1-22 (T5-6 design notes + forward references). Imports + module-local TENANT_ID at L24-44. `scorePostBodySchema` + type at L46-54. `scoresRouter` + handler at L56-onwards.
- L72-89: defensive misuse guards (no body / no holeNumber). The latter is round-2 added.
- L91-100: Step 1 — fetch round (defense-in-depth post-middleware).
- L102-114: Step 2 — holeNumber ≤ holesToPlay.
- L116-141: Step 3 — round_states + writability gate.
- L143-218: Step 4 — INSERT with `onConflictDoNothing(target=[4 cols])` + UNIQUE-catch → 409.
- L220-237: Steps 5 — audit + activity-stub for new cell.
- L240-285: Step 6 — first-commit transition with conditional UPDATE + `.returning()` rows-affected check + audit (round-1 fix); concurrent-loss re-read with tenant predicate (round-2 fix).
- L287-330: Step 7 — auto-complete detection with same conditional UPDATE pattern.
- L333-340: Step 8 — 201 created.
- L350-380: `computeExpectedCells` helper (v1.5 NULL-eventRoundId returns 0).
- L385-415: tightened `isUniqueConstraintError` (round-1 fix).

**`require-scorer-for-round.ts`** (~155 lines): provenance header at L1-15. Module-local TENANT_ID + UUID regex at L17-19. The handler at L21-onwards mirrors the spec's middleware §3 step list.
- L27-39: Step 1 — `c.get('player')` validation.
- L41-65: Step 2-3 — path-param 400s.
- L67-92: Step 4 — body parse with try/catch around `c.req.json()` + Zod safeParse + `c.set('scorePostBody', ...)`.
- L94-110: Step 5 — round existence check.
- L113-149: Step 6 — two-phase scorer lookup + 404/422/403 decision tree.
- L151-174: 403 path with `currentScorerName` lookup.

**`audit-log.ts`** (~70 lines): tight, single-purpose. `WriteAuditArgs` interface; `writeAudit` writes the row; `AUDIT_EVENT_TYPES` + `AUDIT_ENTITY_TYPES` `as const` objects.

**`activity.ts`** (~30 lines): smallest possible v1 surface; T8 will fill in the body.

**Tests:** 21 new across 4 files. The `vi.mock` pattern for `requireSession` in integration tests is clean — it stubs the middleware to use a module-local `__testPlayer` var that each test sets via `buildApp(scorerId)`. The actual require-session module is exercised by its own dedicated tests; the mock here keeps T5-6's tests focused on its own contract.

**Lint + typecheck:** clean. No `any`. One justified `// eslint-disable-next-line no-console` in the offline-queue (different story); zero in T5-6.

**DRY / idiomatic concerns:**
1. The `seedRound` helper in `scores.integration.test.ts` is similar to but distinct from the `seedFullScoringSetup` helper in `require-scorer-for-round.test.ts`. They have different shapes (single-foursome vs two-foursome). Could be unified in a `_test-helpers.ts` someday; not a T5-6 concern.
2. The `vi.mock('../middleware/require-session.js', ...)` pattern in the integration test is clear but could be promoted to a shared test fixture if T5-7+ also needs to stub session. Not a T5-6 concern.
3. The handler's transaction body is ~280 lines. Long but well-structured (numbered steps with comments). T5-8's `transitionState` extraction will reduce this by ~80 lines.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge. Spec-codex 4 rounds (AI-1 cap, all FIXED, PASS verdict). Impl-codex 2 rounds (0 High after round 2). Test deltas exceed AC floors (+21 vs +20 floor; margin +1). Path footprint: 11 ALLOWED files (9 NEW + 2 modified), ZERO SHARED, ZERO FORBIDDEN. Wolf Cup regressions clean (engine 472, api 507).

**Load-bearing correctness:**
1. **14-path error taxonomy with deterministic precedence** — middleware decision tree picks the most-specific code; client UI gets actionable error states.
2. **Two distinct 403 codes** — `not_scorer_for_this_foursome` vs `player_not_in_your_foursome` — pinned by middleware tests #8 + #9.
3. **Idempotent dedupe via T5-1's dual-UNIQUE** — `onConflictDoNothing(target=[4 cols])` + UNIQUE-catch on cell-level violation; integration tests #2 + #3 cover both paths.
4. **Race-safe state transitions** — conditional UPDATE with state predicate + `.returning()` rows-affected check; one audit row per concurrent transition.
5. **Tenant scoping coverage** — every SELECT/INSERT/UPDATE in middleware + handler tenant-scoped; round-2 codex caught the one gap (concurrent-loss re-read) and it's fixed.
6. **Polymorphic audit trail** — `audit-log.ts` constants prevent typo-fragmentation across T5-6/T5-7/T5-8/T5-9/T7-6.
7. **Forward-compat with T8** — `emitActivity` no-op stub with stable signature; T8 replaces only the function body.
8. **Body-parse via context-storage** — middleware Zod-validates and stores via `c.set('scorePostBody', ...)`; handler reads via `c.get('scorePostBody')`; no double-parse, no body-cache reliance.

**Documented limitations (followups):**
- State-transition logic INLINE in scores.ts (T5-8 refactors).
- `emitActivity` is no-op v1 (T8 replaces).
- `score_corrections` edits are out of scope (T5-9 owns).
- `computeExpectedCells` with NULL eventRoundId returns 0 (v1.5 standalone-round forward-compat; never auto-completes).
- Concurrent-write race-safety verified by code review only (deterministic concurrency tests in libsql/SQLite are flaky; load-bearing path covered by sequential integration tests).

**Followups (other stories):**
- T5-2 (scorer entry UI) calls this endpoint via T5-3's offline queue with `enqueueMutation({ kind: 'hole_score', url: '/api/rounds/${roundId}/holes/${holeNumber}/scores', body: {...includes clientEventId at top level...}, clientEventId, roundId })`. Will register terminal errors for `'hole_score'` (e.g. `['round_not_writable', 'player_not_in_your_foursome', 'foursome_has_no_scorer', 'hole_number_exceeds_holes_to_play']`).
- T5-7 (scorer handoff) UPDATEs `scorer_assignments`. Stale offline mutations from old scorer hit T5-6's middleware → 403 with `currentScorerName` for UX routing.
- T5-8 (round lifecycle) refactors T5-6's inline state-transition code into `transitionState(tx, roundId, to, actor)`.
- T5-9 (score correction endpoint) writes `score_corrections` rows for cell edits. T5-6 stays INSERT-only.
- T8 (activity spine) replaces `emitActivity` no-op with real activity-event writes.

**Manual verification post-commit (optional, NOT a release gate):**
1. Local dev: start tournament-api, seed an event/round/pairing/scorer, POST a score with a valid session cookie + clientEventId. Verify 201 + audit row in `audit_log`.
2. POST same body again → 200 deduped, no new audit row.
3. POST same cell with new clientEventId → 409 with `conflictingEntry`.

**Epic T5 progress: 3/11 done (T5-1 + T5-3 + T5-6).** Per Josh's option-A sequencing, T5-2 (scorer entry UI port) is next — it now has all its dependencies (T5-1 schema + T5-3 offline queue + T5-6 server enforcement).

**The director workflow can proceed to commit.**
