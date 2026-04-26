# T2-3b Party-Mode Review (non-interactive written)

**Story:** T2-3b — minimal organizer upload UI (covers T2-3 + T2-3a usability)
**Status:** review
**Generated:** 2026-04-26
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T2-3b closes the user-visible-value loop opened by T2-3 + T2-3a. With T2-3 (PDF parser) and T2-3a (image input) already deployed, the only thing standing between Josh and "be at the course on tournament day, take a picture, parse it" was a UI to upload through. T2-3b ships that UI — minimal but functional. The 4-state component (idle / uploading / success / error) handles every realistic flow without scope creep into save/edit (correctly deferred to T2-5).

**Threat model: tightly bounded.** The route is auth-gated server-side at the API (T2-3 + T2-3a's `requireSession` → `requireOrganizer` → CSRF chain). The SPA's auth-guard is a UX optimization (avoid showing the upload form to non-organizers); the actual security boundary is at the API layer where it always was. A malicious client bypassing the SPA guard and POSTing directly to `/api/admin/courses/parse-pdf` gets the same 401/403 response — nothing new exposed.

**The 5-step loader contract** (Risk Acceptance §3) deserves explicit praise: it correctly handles every failure mode of a third-party-style API call (network down, server 5xx, JSON parse failure, malformed body, unexpected shape) by collapsing all to `{player: null}` → OAuth redirect. This is the right posture for an auth-status endpoint: when in doubt, send the user through OAuth rather than risk rendering admin UI to a non-admin.

**One nuance worth naming:** the round-2 Low about caching `{player: null}` for 30s during a transient API failure means a user who lands during a 5xx will see OAuth redirect → Google sign-in → callback → home → click "Upload" → 30s of cached "anonymous" → another OAuth round-trip. Not ideal UX. Mitigations available: (a) shorter staleTime for null results (e.g., 5s for null, 30s for valid player) — but that's complexity for an edge case; (b) accept the rare-case friction — Josh is the only user today and a hard-refresh busts the cache. **Accepting (b)** is the right call for T2-3b's scope.

**Recommendation:** ship. Followup-story candidate: differentiated staleTime per result type when the user base grows beyond Josh.

---

## 🏗️ Winston (Architect) — System Design Perspective

The dual-export architecture (`Route` + `UploadCoursePage`) is elegant. It threads the needle between TanStack Router's file-based routing convention and the testability requirement (`render(<UploadCoursePage />)` directly without router setup). Future routes that want similar testability can copy the pattern.

**Solid design choices:**
1. **5-step loader contract** as a documented invariant in the comments — every error-path collapses to `{player: null}`, no exceptions can escape. This is the kind of thing that's easy to regress in 6 months when someone adds a new validation step; the inline comment + the existing 5-step structure make regression visible.
2. **`useEffect` cleanup + 4 abort guards** in the upload flow — fully covers the cancel/unmount race classes: cancel-during-fetch, cancel-during-success-json-parse, cancel-during-error-json-parse, exception-after-cancel. The race-guard pattern is reusable for any future async UI.
3. **Lookup table for error messages** lives inline in the route — premature extraction would create a `lib/upload-errors.ts` for one consumer. Three-callers rule: extract when T2-5's admin UI also needs it.
4. **Dual-export pattern** (named `UploadCoursePage` alongside `Route`) sets the testing template for tournament-web. T2-5 will copy this exact pattern.

**One forward-looking concern (not for T2-3b):** the SPA has no centralized fetch wrapper. Every fetch is hand-rolled with its own error-handling. Once T2-5 adds 5-10 more API calls, this gets painful. A `lib/api.ts` with a typed fetch helper (parses JSON, maps codes to typed errors, integrates with TanStack Query) becomes valuable. **Don't extract for T2-3b** — premature for a single fetch call. Watch for the third caller in T2-5's admin UI; that's the natural extraction trigger.

**Architectural concerns: minor or forward-looking.**
- Inline `extractCookieValue` in `auth.ts` duplicates `extractCookie` in `require-session.ts`. Codex flagged as Low. Three-callers rule applies: extract when a third consumer arrives.
- `queryClient` is imported as a singleton from `lib/query-client.ts`. Same instance used app-wide via `<QueryClientProvider client={queryClient}>` in main.tsx. Cache state is shared across navigations. Correct.

**Recommendation:** ship. Architectural debt: zero. Future extraction triggers documented inline.

---

## 📋 John (PM) — User Value / Scope Perspective

**Does this satisfy the user-visible value?**
Yes. Combined with T2-3 + T2-3a (already deployed), tournament organizers can now navigate to `/admin/courses/upload` on tournament day, snap a photo of a printed scorecard, and see structured course data on screen within ~15 seconds. The "be at the course, take a picture, parse it" loop is closed.

**One UX caveat in completion notes worth re-emphasizing:** the success state shows a READ-ONLY summary, not an edit form. Organizer sees parsed data, can verify it looks right, but cannot save it or correct OCR errors. That's T2-5's scope. For T2-3b's scope, this is correct — it validates the pipeline works without committing to persistence semantics that T2-5 will design (with edit UI + validation per T2-4).

**Scope discipline: excellent.**
- 1 SHARED gate (lockfile) — pre-announced at spec time, approved at impl time.
- No HEIC server-side decoding (correctly deferred).
- No edit/save UI (correctly deferred to T2-5).
- No E2E tests (correctly deferred per epic note).
- No real-API smoke test (this is a frontend-only story; mocked fetch tests + AC #15 manual smoke cover the actual call surface).

**Concerns:**
1. **The 4 component tests bypass TanStack Router** (per AC #9 explicit decision). Pro: tighter test cycles, no router-harness setup. Con: the `beforeLoad` auth-guard logic is unverified at unit-test level. Mitigation: AC #5's `/api/auth/status` API tests cover the contract end; AC #15's manual post-deploy smoke covers the integration end. Acceptable.
2. **No test for the "loader returns {player: null} → window.location.assign called" path.** The 5-step loader contract is documented but not pinned by a test. If a future refactor accidentally drops a step (e.g., removes the shape validation), no test catches it until manual smoke. Mitigation: the contract is small (~15 lines), the inline comment is explicit, and the smoke test is mandatory pre-deploy. Acceptable Low; T2-5 may add a mocked-router test if patterns warrant.

**The 5-step loader contract** is the kind of architectural choice that PMs love — it makes failure modes explicit and bounds them. Codex's round-1 push to make this fully spec'd (vs the original ambiguous "treat fetch failure as anonymous") prevented a class of "stuck on blank page" bugs that would have cost real organizer-trust if T2-3b had shipped without it. **Worth calling out the methodology**: spec → 4 codex rounds → impl with mechanical fixes → impl-codex → 2 rounds → party. The compounding rigor caught issues that any single layer would have missed.

**Recommendation:** ship. T2-3b is the story that makes T2-3 + T2-3a real.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis:**

**Tournament-api (3 net new tests):**
- ✅ Anonymous (no cookie) → `{ player: null }`
- ✅ Invalid session_id (cookie present but no DB row) → `{ player: null }`
- ✅ Authenticated organizer → `{ player: { id, isOrganizer: true } }`
- ✅ Authenticated non-organizer → `{ player: { id, isOrganizer: false } }`
- ⚠️ NOT covered: expired session (cookie + DB row exists but `expires_at <= now`). This is a real failure path that `validateSession` handles by returning null. Behavior is correct (status returns `{ player: null }` because validateSession returned null), but no explicit test pins it. Low — same code path as "missing row" so essentially covered by the invalid-session-id test.

**Tournament-web (4 net new component tests):**
- ✅ Idle state: file input + disabled Submit button
- ✅ Uploading state: progress message + Cancel button
- ✅ Success state: parsed course summary + Try another button
- ✅ Error state: code-keyed user message + Try another file button

**Coverage GAPS (none warrant a re-iteration):**
1. **No test for the loader's 5-step contract.** Per AC #9 explicit decision (component tests bypass router); covered by 5-step contract being mechanically simple + manual smoke. Codex round-2's PASS-with-Lows accepts this.
2. **No test for cancel during in-flight upload.** The race-guard pattern (`if (ac.signal.aborted) return`) at 4 setState points is correctness-critical, but only tested implicitly via the uploading-state test that holds a controllable promise. A test that triggers cancel mid-fetch and asserts no state-leak would be valuable but adds significant complexity (controlling fetch resolution + abort in the right order). Acceptable Low.
3. **No test for the error-message lookup-table fallback.** All 7 documented codes route to messages; an unknown code falls through to the generic message. The error-state test exercises one specific code (wrong_mime); doesn't pin "unknown code → generic message". Acceptable Low.
4. **No test for `userMessageFromCode(undefined)` or `userMessageFromCode('')`.** Edge cases of malformed API error responses. Generic message fallback handles them; not pinned by test. Acceptable Low.

**Real-API smoke deferred:** AC #15 explicitly delegates verification to a manual post-deploy smoke. This is appropriate for a UI-only story — the API surface is already covered by T2-3 + T2-3a's smokes. The frontend-side concern is "does the form submit + render the response correctly", which is covered by mocked-fetch component tests.

**Recommendation:** ship. The 4 explicit Low coverage gaps are all Low-priority polish — none warrant another impl iteration. Three of them (#1, #2, #4) are natural fits for T2-5's testing pass when the admin UI gets a more sophisticated test harness.

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Five observations:

1. **`UploadState` discriminated union** with four variants is used exhaustively in the render branches. Adding a fifth state (e.g., 'validating') would require updating the render switch — TypeScript will fail to compile until updated. Type discipline solid.

2. **The `useEffect` cleanup** runs on unmount (empty deps array). Correctly aborts the in-flight request. The 4 setState guards (`if (ac.signal.aborted) return`) handle the in-component cancel case (Submit + Cancel within the same mount lifecycle). Together they cover both unmount AND in-mount cancel paths — different races, both handled.

3. **`queryClient.ensureQueryData`** with `staleTime: 30_000, retry: false` is the right primitive for this use case. `ensureQueryData` returns cached data if fresh, otherwise calls queryFn — exactly the "navigate within 30s, no refetch" semantics the spec wanted. Cleaner than rolling our own cache.

4. **`validateAuthStatus` shape validator** is 13 lines and could be replaced by Zod (already a dep at workspace level — but NOT in tournament-web's deps). Pulling Zod into tournament-web for one validator would be a SHARED gate (lockfile) for marginal value. Hand-rolled validator is correct here.

5. **No `React.useState` import — uses bare `useState`/`useEffect`/`useRef`.** Modern React 19 + new JSX transform pattern. Correct.

**Small refactors NOT worth doing now:**
- `extractCookieValue` duplication with `require-session.ts` — three-callers rule.
- `ERROR_MESSAGES` lookup table extraction to `lib/upload-errors.ts` — three-callers rule.
- `validateAuthStatus` inline → `lib/auth-status-schema.ts` — two-callers max for the foreseeable future.

**No `// eslint-disable`, no `as any`, no implicit-any locals.** Type discipline intact throughout. Race guards are explicit + commented. The only `as` casts are narrow and intentional (`as ParsedCourse` after JSON parse is fine — the API contract is verified by T2-3's tests, and a malformed response would render garbage in the UI but not crash).

**Recommendation:** ship. Code quality is solid. The 3 documented "extract when 3rd caller arrives" candidates are correctly deferred — premature extraction would be code-smell.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T2-3b as-is.**

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Analyst | Differentiated staleTime per result type (auth-status null vs valid) | Future story when user base > Josh |
| Architect | Centralized fetch wrapper in `lib/api.ts` | T2-5 spec note — third-caller trigger |
| Architect | Extract `extractCookieValue` to `lib/cookies.ts` | Future story when 3rd consumer arrives |
| PM | Loader 5-step contract not pinned by unit test | Manual smoke covers; T2-5 testing pass may add |
| QA | Expired-session test missing (covered by invalid-session-id path) | Low |
| QA | Cancel-mid-fetch race-guard not pinned by test | Low — covered implicitly |
| QA | Error-code lookup unknown-code fallback not tested | Low |
| Dev | `validateAuthStatus` could become Zod-based when tournament-web adds Zod | Acceptable — single validator |

**No agent has open questions for the user. No proposed code changes warrant another impl iteration. Director may proceed to step 9 (codex-on-party-review).**
