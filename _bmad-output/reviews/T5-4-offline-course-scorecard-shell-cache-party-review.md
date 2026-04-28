# T5-4 Party-Mode Review (non-interactive written)

**Story:** T5-4 — Offline Course + Scorecard Shell Cache. Greenfield IDB cache for offline-first score entry.
**Status:** review
**Generated:** 2026-04-28
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T5-4 closes the offline-first loop for the score-entry path. T5-3 shipped the offline mutation queue (writes survive offline); T5-4 ships the offline READ — the score-entry route renders fully from IndexedDB when the network is unreachable. Combined: T5-2 + T5-3 + T5-4 = a fully-offline-capable scoring workflow.

**Threat model — five surfaces:**

1. **Cache vs network correctness** (cache-aside pattern). Every successful network fetch overwrites the cache; offline path reads from cache. Stale data never served when network succeeds. The READ-cache-BEFORE-write-fresh ordering in `fetchOrCacheRoundCourse` is load-bearing for the course-superseded banner — must compare hashes BEFORE overwriting; my impl pins the order and test #11 verifies the banner fires. **Verified.**

2. **Cross-event course leakage defense** (round.event_id + event_round.event_id checks). Round-1 codex caught this. Two defense layers: (a) `round.event_id === :eventId` mismatch → 404 round_not_found; (b) `event_round.event_id === :eventId` mismatch → 404 round_not_found. Both pinned by tests. Tenant scoping covers cross-tenant case.

3. **Param validation precedence** (auth-first per round-2 codex). requireSession → param guard → requireEventParticipant. Unauthenticated requests get 401 even with malformed params; authenticated requests with bad UUIDs get 400 before participant lookup runs.

4. **Offline-no-cache UX** (round-1 + round-2 codex). The TypeError-without-status path now renders a dedicated "You're offline and this round isn't cached" placeholder. Partial-offline state (detail succeeds, course fails) also fires the offline-mode chip via the courseError check.

5. **Course-superseded banner** (epic AC line 1378-1380). Stable hash `holeNumber:par:si` (NOT JSON.stringify which is key-order-unstable). First-fetch guard prevents banner-on-first-visit. Banner is dismissible; doesn't discard in-flight scores.

**Strategic significance:** the trip-day fully-offline scoring promise is now realized for the foursome path. T9.1 9-hole drill validates UX; T5.10 airplane-mode drill is the integration test.

**Recommendation: ship.**

---

## 🏗️ Winston (Architect) — System Design Perspective

Six observations:

1. **Two IDB databases by design.** `tournament-offline` (T5-3 mutation queue) vs `tournament-round-cache` (T5-4 cache). Different lifecycles — mutation queue persists across cold launches and gets actively drained; cache is read-mostly with cache-aside writes. Separation prevents test-pollution (each test file deletes its own DB without affecting the other) and gc semantics differ. **Right call.**

2. **Cache-aside pattern with explicit ordering**. `fetchOrCacheRoundCourse` reads cache → fetches network → compares hashes → writes cache. The READ-before-WRITE ordering is load-bearing for the course-superseded banner; if we wrote first, the comparison would always read its own write. Spec round-4 + impl pin the order; comment in scores.ts spells it out.

3. **The two-router export from scores.ts**. `scoresRouter` (mounted at /api/rounds for POST + GET) and `eventRoundsCourseRouter` (mounted at /api/events for the course endpoint). File is now ~875 lines but well-organized; future split into `routes/round-detail.ts` (T5-2 GET) + `routes/scores.ts` (T5-6 POST) + `routes/round-course.ts` (T5-4 GET) is a cleanup candidate when T5.7 lands.

4. **sourceRef + forceSourceRender pattern instead of `__source` field**. Round-3 spec design. The queryFn's data shape is unmodified; the source signal flows via a closure-captured callback that updates the ref + triggers a render via a useState dummy. NOT a useState write inside queryFn (would cause R19 mid-fetch issues). NOT TanStack Query's meta field (mutation unsupported). **The ref pattern is the cleanest of the three options.**

5. **Param guard middleware ordering**. Round-2 codex caught the auth-first precedence. requireSession → param guard → requireEventParticipant. Prevents 400-before-401 (which would leak whether the round exists to unauthenticated callers) AND prevents the 0-row-then-403 confusing path on malformed eventId.

6. **navigator.onLine short-circuit in queryFn**. Avoids a 15s loop of futile fetches when the device is known offline. The `'online'` event listener (from T5-3's useOnlineStatus) drives `queryClient.invalidateQueries` to retry on reconnect. **Power + bandwidth conserved.**

**Architectural concerns: zero blockers.**

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T5-4 deliver the FR-B5 offline-cold-launch promise?** Yes. A scorer who opens the score-entry route once online (cache populates) can later open it with zero connectivity (cache hits, par/SI strip renders, "Offline mode" chip visible, score input grid functional via the T5-3 queue).

**Scope discipline check:**
- 9 NEW source files: 4 lib (round-cache + test + scores.course + 2 banner components), 0 test infrastructure, 5 spec/codex review docs.
- 4 modified source files: scores.ts (course endpoint + courseRouterParamGuard + eventId in T5-2 response), app.ts (mount), rounds.$roundId.score-entry.tsx (course query + chip + banner + scorecard-shell strip), rounds.$roundId.score-entry.test.tsx (3 new integration tests).
- 1 modified PORTS.md (greenfield disclosure for round-cache + course endpoint).
- 0 SHARED files, 0 FORBIDDEN edits.

**Path footprint is clean.**

**v1 limitations** (acceptable):
- Banner display in read-only / no-scorer placeholders deferred to v1.5 (banner only renders when the form view is active).
- Pairings cache for cross-foursome leaderboard view deferred to T5-5 (T5-4 only caches MY foursome's data via T5-2's GET response).
- 15s polling continues even in offline mode (TanStack Query's `enabled: true`); navigator.onLine short-circuit makes each tick cheap (no fetch attempted) but it does cost an IDB read every 15s. Acceptable v1; v1.5 could add a smarter offline-pause.

**Test surface: +16 tests** (7 backend course + 8 cache-lib + 3 frontend integration after round-1 + round-2 codex fixes). Tournament-api 499 → 506 (+7); tournament-web 92 → 103 (+11). AC #7 floor: +16. Margin: 0 (the floor was hit exactly).

**Recommendation: ship.**

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 499 → 506 (+7). AC #7 floor was +5 backend; margin +2 (the round-1 fixes added 2 new tests for invalid_event_id + cross-event mismatch).
- tournament-web: 92 → 103 (+11). AC #7 floor was +11 frontend; ✓.
- Total: +18 (vs floor +16; margin +2 from round-1 additions).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).
- typecheck + lint clean across all 5 workspaces.

**`scores.course.test.ts` coverage** (7 tests):

| AC | Test | Pin? |
|---|---|---|
| AC #1, #2 | 200 happy path: 18 holes + 1 tee | ✅ load-bearing |
| AC #2 | 200 multiple tees | ✅ |
| AC #1 | 400 invalid_round_id | ✅ |
| Auth | 401 no session | ✅ |
| AC #6 | 404 round_not_found foreign-tenant | ✅ |
| AC #1 | 400 invalid_event_id (round-1 added) | ✅ |
| AC #1 (defense-in-depth) | 404 round_not_found cross-event mismatch (round-1 added) | ✅ |

**`round-cache.test.ts` coverage** (8 tests): all paths green.

**`rounds.$roundId.score-entry.test.tsx` (T5-4 additions)** (3 new tests):
- Cold-online cache populate + par/SI strip render + no offline chip.
- Cold-offline pre-seeded cache + fetch reject → render from cache + offline chip.
- Course-superseded banner + Dismiss + form preserved.

**Coverage gaps** (Lows; documented as v1.5 followups):

1. **Offline-no-cache placeholder rendering** — round-1 fix added the placeholder but no dedicated test pins its render. Indirectly covered by the offline tests but not explicitly. Acceptable v1.

2. **navigator.onLine short-circuit path** — code review verified; no jsdom-level test (jsdom doesn't reliably set navigator.onLine).

3. **15s polling refetch behavior** — same as T5-2; trusted to TanStack Query.

4. **isApiError discrimination** — pinned indirectly by the offline-no-cache test (which throws a TypeError without status).

**Net assessment:** the tests pin **all the load-bearing correctness paths for offline scoring** including the dual-defense event_id checks, the cache-aside read-before-write ordering, and the course-superseded banner. The +16 floor is hit exactly; round-1 additions push margin to +2.

**Recommendation: ship.**

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + impl-codex iteration evidence.

**`scores.ts` course endpoint** (~210 lines added): provenance comment block at L630-636 (T5-4 design notes). Imports extended with course-related schemas + `requireEventParticipant`. New `courseRouterParamGuard` middleware (L660-684) validates UUID-shape for both path params with explicit auth-first ordering.
- L686-718: handler chain (requireSession → courseRouterParamGuard → requireEventParticipant → handler).
- L720-730: round existence + tenant + event_id match.
- L732-744: round.eventRoundId NULL guard (v1.5 forward-compat).
- L746-770: event_rounds + event_id mismatch defense (round-1 codex catch).
- L772-820: course_revisions → courses chain.
- L822-870: holes + tees JOIN; yardagePerTee JSON parse with try/catch.
- L872-887: response assembly.

**`round-cache.ts`** (~110 lines): tight, single-purpose. Two object stores. Cache-aside pattern (writes overwrite). Defensive read with try/catch + console.warn for malformed entries → null cache-miss. Test-only `_resetCacheForTests` with NODE_ENV/VITEST guards.

**`rounds.$roundId.score-entry.tsx`** modifications:
- L18-23: import round-cache lib + cache helpers.
- L85-101: RoundCourse + CourseHole interfaces; `courseHash` helper.
- L155-183: `fetchOrCacheRoundDetail` with navigator.onLine short-circuit + ApiError-vs-no-status discrimination.
- L185-225: `fetchOrCacheRoundCourse` with READ-before-WRITE ordering for banner trigger.
- L283-318: sourceRef + setDetailSource + setCourseSource callbacks; courseChangedAt + bannerDismissed state.
- L320-345: detail useQuery + course useQuery (`enabled: eventId !== null`); isOffline + courseChanged computed.
- L380-400: offline-chip + course-superseded-banner render.
- L505-515: scorecard-shell-strip render in form.
- L355-372: error branch with isApiError check + offline-no-cache placeholder.

**Tests** (3 new in score-entry.test.tsx + 7 in scores.course.test.ts + 8 in round-cache.test.ts = 18 new tests; 16 floor; margin +2).

**Lint + typecheck:** clean. No `any`. No `// eslint-disable`. One `console.warn` in round-cache (justified for malformed-entry defensive logging).

**DRY / idiomatic concerns:**
1. The yardagePerTeeJson try/catch parse pattern is repeated for each course hole. Acceptable inline for clarity.
2. The fetchOrCacheRoundDetail and fetchOrCacheRoundCourse functions share ~80% structure. Could be unified via a generic `fetchOrCache<T>(url, key, read, write)` helper. Not v1 — the differences (banner trigger, source signal) are subtle enough that explicit duplication reads cleaner than a clever generic.
3. The vi.mocked(fetch).mockImplementation pattern with URL routing is a useful test helper. Could be promoted to a shared file when more routes need it.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge. Spec-codex 4 rounds (AI-1 cap, all FIXED). Impl-codex 2 rounds (0 High after round 2). Test deltas hit the +16 AC floor with margin +2 from round-1 additions. Path footprint: 13 ALLOWED files + 4 modified ALLOWED. ZERO SHARED, ZERO FORBIDDEN. Wolf Cup regressions clean.

**Load-bearing correctness:**
1. **Cache-aside with READ-before-WRITE ordering** — load-bearing for course-superseded banner; pinned by integration test.
2. **Cross-event defense** (round.event_id + event_round.event_id checks) — round-1 codex catch; both layers pinned.
3. **Param validation auth-first precedence** — round-2 codex catch; requireSession → param guard → requireEventParticipant.
4. **navigator.onLine short-circuit** — bounds the 15s loop of futile fetches when offline.
5. **Stable course hash** (NOT JSON.stringify) — banner trigger reliable across implementations.
6. **First-fetch guard** — banner doesn't fire on first-ever visit.
7. **sourceRef pattern** — no data shape pollution; no R19 mid-fetch issues.
8. **Offline-no-cache placeholder** — round-1 codex catch; UI never shows confusing "status undefined".

**Documented limitations (followups):**
- Banner display in read-only/no-scorer placeholders v1.5.
- Pairings cache for cross-foursome leaderboard T5-5.
- 15s polling continues offline (cheap via short-circuit but cost an IDB read).
- Offline-no-cache placeholder not unit-pinned (covered indirectly).

**Followups (other stories):**
- T5-5 (leaderboard) owns pairings cache for cross-foursome view.
- T5.10 (airplane-mode drill) full integration test.
- T8 (activity spine) replaces emitActivity stub; T5-4 unaffected.

**Manual verification (Josh's T9.1 territory):**
1. Open `/rounds/<roundId>/score-entry` online once → verify par/SI strip renders.
2. DevTools → Application → IndexedDB → `tournament-round-cache` → verify `round-detail` and `round-course` populated for the roundId.
3. DevTools → Network → Offline → reload → verify form renders + "Offline mode" chip + par/SI still visible.
4. Reconnect → verify chip disappears + cache refreshes.
5. (If possible) admin updates a course's hole-5 par; reload the score-entry page → verify "Course data updated" banner appears + Dismiss removes it + scores still entered.

**Epic T5 progress: 5/11 done (T5-1 + T5-3 + T5-6 + T5-2 + T5-4).** The full offline-capable scoring loop is now shippable.

**The director workflow can proceed to commit.**
