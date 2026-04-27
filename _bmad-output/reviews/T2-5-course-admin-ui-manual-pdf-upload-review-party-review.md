# T2-5 Party-Mode Review (non-interactive written)

**Story:** T2-5 — Course Admin UI (Manual + PDF Upload Review). LAST story in Epic T2.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T2-5 closes Epic T2 — the entire course-onboarding loop now works end-to-end: browse-online-PDF → parse → validate → review-edit → persist. That's the strategic value: from this commit forward, Josh can stand up a new course at the destination with ~3 minutes of work (upload + correct + submit), where before T2 the only path was a hand-crafted seed JSON + redeploy. The 9-day Pinehurst trip becomes "we'll find a course at the resort"-shaped instead of "we have to know all 4 candidates before we leave"-shaped. **This is the unlock.**

**Threat model.** Two non-trivial surfaces:

1. **Stored-XSS via `source_url`.** Closed at the API boundary by the `.refine(http(s))` guard on the Zod schema (`admin-courses.ts:265-271`). `javascript:`, `data:`, `file:` all rejected with 400 invalid_body. Backend test `source_url with javascript: scheme` (line 768-787 region) pins the regression. Future UI render path (course-detail page in a later story) inherits the safety because the *stored value* is already constrained — no per-renderer mitigation required.

2. **Cost-exhaustion via parse-pdf.** T2-5 inherits T2-3a's organizer-only auth gate + 10 MiB body cap + magic-byte filter. The new save endpoint adds nothing to the Anthropic spend surface (it's a pure DB write, no LLM). One new save costs zero cents; one new parse costs ~$0.02 (T2-3 instrumented). At scale: 100 saves/day → $0/day Anthropic + ~6 KB DB write/save. Negligible.

**Pre-existing UNIQUE-bypass-via-whitespace** (round-2 codex Low) was real: `"Test Course"` and `"Test Course   "` would have been treated as distinct courses, defeating the (tenant, club, name) UNIQUE intent. Round-2 fix (`.trim().min(1)` on name + club_name + tee.color) closed it. The "trim-then-409" test (admin-courses.test.ts:809-833 region) pins the contract: trailing whitespace + leading whitespace + same trimmed name → 409 duplicate_course on the second save. Solid.

**Residual unknowns:**
- AC #20 manual smoke is the FIRST end-to-end test against the live save path. Codex + party can't catch a Vite bundler / TanStack Router / production-CSP issue that only manifests at `tournament.dagle.cloud/admin/courses/new`. **Manual smoke is load-bearing for ship.**
- Tee-color collision (round-3 Low, deferred) — if Josh accidentally types two tees as `"blue"`, the form state may silently merge yardages, then T2-4 rule 10 catches it as duplicate-color → 400 validation_failed. Recoverable but annoying. Future polish, not a blocker.

**Recommendation: ship.** Epic T2 is complete after this commit. The strategic unlock outweighs the residual UX edge case.

---

## 🏗️ Winston (Architect) — System Design Perspective

The implementation lands cleanly on the existing T2 substrate — no new abstractions invented, no boundaries crossed.

**Layering is correct.** The save endpoint is a 4-stage pipeline:

1. Middleware: `requireSession` → `requireOrganizer` → `bodyLimit(64 KiB)` → handler (`admin-courses.ts:316-330`). Auth before bodyLimit so anonymous attackers can't even buffer the request. Same posture as T2-3.
2. Schema layer: `SaveCourseRequestSchema.safeParse` (`admin-courses.ts:343-356`) — Zod is the FIRST line of defense. Catches type errors, missing fields, out-of-range values, malformed source_url.
3. Domain layer: `validateCourse(body)` (`admin-courses.ts:362-376`) — T2-4 is the SECOND line, catching cross-field semantic invariants (par totals match holes, SI bijection, yardage-per-tee consistency).
4. Persistence layer: single `db.transaction` (`admin-courses.ts:382-426`) — drizzle-orm/libsql auto-rolls-back on any thrown error.

**No layer cheats on the next.** Zod doesn't try to enforce semantic invariants; T2-4 doesn't re-validate types; the transaction doesn't validate. Each layer's failure mode maps to a distinct HTTP code + error code + log event. Clean.

**The dual-AbortController pattern is sound** (`admin.courses.new.tsx:144-156`). The round-1 single-ref design had a real bug: an in-flight upload + a subsequent save would orphan the upload. Round-2 fix splits into `uploadAbortRef` + `saveAbortRef`, aborts both on unmount, and aborts the prior controller before replacing. Belt-and-suspenders: Submit is also disabled while uploading (`admin.courses.new.tsx:464-466`). Two layers of defense for the same race; intentional given how cheap the disabled-button check is.

**The Zod-trim-then-T2-4-then-tx layering** is the right order:
- Trim BEFORE T2-4 so T2-4 sees normalized input (T2-4's rule 1 checks `name.length > 0`; if we passed `"   "` and T2-4 stripped internally, the API's persisted value would still be `"   "` — a divergence bug). Letting Zod trim at the boundary makes the persisted value identical to what T2-4 saw. Correct.
- T2-4 BEFORE the transaction so a validation miss never opens a tx. Cheap, fast, correct.

**The dup of `isUniqueConstraintError`** (admin-courses.ts:282-313 mirrors auth.ts:484-512) is the codebase's "no refactor beyond the task" posture. Auth.ts comment said "third copy promotes to shared util" — T2-5 is the second. **Hold.** A future story that needs a third UNIQUE-detector promotes both copies + this one to `apps/tournament-api/src/lib/libsql-error.ts` in one cohesive sweep. Premature extraction now would mean a SHARED-style change with no other consumers — pure busywork.

**One forward-looking note.** The `revisionNumber=1` hardcoded at `admin-courses.ts:393` reflects T2-5's create-only scope. The future course-edit story will read the latest revisionNumber for this course_id and increment. The current code shape (revision per row) is FD-8-ready; the next story plugs in directly.

**Architectural concerns: zero blockers.** Ship.

---

## 📋 John (PM) — User Value / Scope Perspective

**Does this satisfy organizer-facing value?** Yes — but only after AC #20 manual smoke passes. Code-level ACs can't observe whether the organizer can actually USE the form on a phone screen at the resort. That's the load-bearing test for ship-readiness.

**Scope discipline: tight.**
- Zero new deps. `useState` over `react-hook-form`, no client-side Zod, no drag-and-drop, no per-row error mapping in v1.
- Path footprint: 4 ALLOWED files + 1 auto-regen. **Zero SHARED gates.** Risk Acceptance §1's "no SHARED expected" prediction held — that's the third story in a row to ship without a SHARED stop, which is what AI-2 was trying to engineer.
- Deviated from epic AC line 783 (no client-side Zod). Rationale documented in Risk Acceptance §6: single source of truth, server roundtrip is acceptable for an 80-field admin form. Spec gate approved this. **Deliberate, justified, documented.**

**Connection to product:**
- Form is intentionally minimal but functional. Header + tees + 18 holes + totals + "Compute totals" button + "Upload Scorecard" pre-populate. No styling, no Tailwind polish in this story (matches T2-3b's posture). v1.5 / v2 stories handle UI cleanup once organizer feedback is in.
- "Compute totals from holes" button (admin.courses.new.tsx:230-251) is a quiet ergonomic win for manual entry. After typing 18 pars, click the button → totals auto-fill from computed sums. Eliminates a class of typing-error frustration.
- Source URL field (added per round-3 spec Low #1) lets organizers paste the URL they pulled the PDF from, persisted to `course_revisions.source_url` — provenance for "where did this course data come from" in case of dispute later. Quiet but useful.

**Concerns / observations:**
1. **Auth-guard tests deferred to manual smoke.** AC #14 explicitly scopes them out; AC #20 covers them via human-in-the-loop. Codex flagged this as a Med (#3) in impl round 1. Spec consciously made this trade — TanStack Router's loader is hard to test in a unit context without a heavy mock. **Acceptable for v1**; a future test-infra story can add minimal route-level harness. Not a blocker.
2. **"Try another file" / clear-form affordance is missing.** If organizer pre-populates from a wrong PDF, the only path is manual field-by-field edit OR pick a new file (which auto-prepopulates over the existing data). No "Reset" button. Minor; can add in polish.
3. **No course-list / course-detail UI.** v1 success message is "Course saved! (id: ...)" — Josh can verify via `GET /api/courses` (T2-2). Future T-story adds the list UI. v1 success message is enough for an admin tool used by one person.

**Recommendation: ship after AC #20 manual smoke passes.** Epic T2 closes here.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis.** Test deltas:
- `@tournament/api`: 208 → 222 (+14 new tests; +75% over the AC #16 minimum of +8).
- `@tournament/web`: 5 → 11 (+6 new tests; +50% over the AC #17 minimum of +4).

**Backend test inventory** (admin-courses.test.ts, save endpoint section):

| # | Test | Failure Mode |
|---|---|---|
| 1 | Happy path 201 + 4-table atomicity | Per-row insert + tenantId/contextId verification |
| 2 | Zod par=6 → 400 invalid_body | Schema layer rejection |
| 3 | T2-4 out_total mismatch → 400 validation_failed | Domain layer rejection (rule 14) |
| 4 | T2-4 duplicate SI → 400 validation_failed | Domain layer rejection (rule 9 bijection) |
| 5 | UNIQUE conflict (same payload twice) → 409 | Persistence layer + predicate match |
| 6 | Anonymous → 401 session_missing | requireSession middleware |
| 7 | Non-organizer → 403 not_organizer | requireOrganizer middleware |
| 8 | 70 KiB body → 400 body_too_large | bodyLimit middleware (with explicit Content-Length) |
| 9 | source_url javascript: → 400 invalid_body | Zod refine guards XSS sink |
| 10 | source_url https → persisted to revisions row | Happy path with optional field |
| 11 | rating=Infinity (JSON-encoded as null) → 400 | Schema-layer non-finite rejection |
| 12 | Whitespace-only name → 400 invalid_body | Schema trim().min(1) |
| 13 | Trim normalize + 409 on second insert | Schema trim before UNIQUE check |
| 14 | Non-UNIQUE DB failure → 500 save_failed (NOT 409) | Predicate correctly distinguishes UNIQUE from generic |

**Frontend test inventory** (admin.courses.new.test.tsx):
| # | Test | Coverage |
|---|---|---|
| 1 | Idle state renders all sections, Submit disabled | Initial render + completeness gating |
| 2 | Upload pre-populate → form fields populated | Parse-pdf integration + state transfer |
| 3 | Manual+upload+Submit happy path → 201 → reset | Full save flow + form clear |
| 4 | Validation 400 → top-level error list | AC #11 v1 contract (top-level, not per-row) |
| 5 | Upload 400 wrong_mime → friendly message | Code-mapping table from T2-3b |
| 6 | Save 409 → friendly duplicate message + form preserved | Conflict UX |

**Failure modes well-covered:**
- ✅ Each layer (Zod / T2-4 / DB / middleware) has at least one rejection test
- ✅ Atomicity asserted on every rejection test (no partial rows)
- ✅ Real T2-4 validator used (not mocked) — pins the integration contract
- ✅ Round-1 → Round-3 codex gaps each got a dedicated regression test
- ✅ The non-UNIQUE-500 test (#14) specifically pins the round-1 fix — a future regression that re-broadens the predicate would fail this test

**Failure modes NOT covered (acceptable Lows):**
- Auth-guard route loader (anonymous redirect, non-organizer ForbiddenMessage). Per AC #14 + #20 — spec-deferred to manual smoke. Risk: if a future TanStack Router upgrade changes loader semantics, only manual smoke catches it.
- Tee-color collision UI behavior (round-3 codex Low). Could submit duplicate tees → would land at T2-4 rule 10 → 400 validation_failed. Annoying but recoverable; T2-4 backstop is the safety net.
- "Compute totals from holes" with partial-fill (returns prev unchanged). Behavior is correct but untested.
- Input-mask edge cases (e.g., paste "72.3" into rating, paste "ABC" into rating). Browser type=number filters most; Zod catches the rest at submit. Untested.
- The 64 KiB body-limit test relies on explicit `content-length` header — production browsers always send this, but if they ever don't (e.g., chunked transfer-encoding), bodyLimit may not fire. Edge case.

**Residual risk: low.** The test pyramid covers every load-bearing failure mode. The 5 untested edges are either (a) caught by upstream layers, (b) deferred to manual smoke per spec, or (c) negligible-probability production scenarios.

**Recommendation: ship.** AC #20 manual smoke is the final gate.

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. File-path-and-AC-ID notes:

1. **`isUniqueConstraintError` duplication** (`admin-courses.ts:282-313` ↔ `auth.ts:484-512`). Auth.ts comment said "next story that needs a third copy promotes to shared util." T2-5 is the SECOND copy, not the third. Hold per the codebase's "no refactor beyond the task" posture. The right next move: when story #3 needs UNIQUE-detection, promote all three to `apps/tournament-api/src/lib/libsql-error.ts` in one sweep with deletion of both private copies. **Don't do it now** — would inflate T2-5's footprint with no concrete consumer.

2. **`SaveCourseRequestSchema` mirrors `ParsedCourseSchema`** (`admin-courses.ts:232-274` ↔ `course-parser.ts:191-199`). Two Zod schemas now define the ParsedCourse shape. Drift risk acknowledged in Risk Acceptance §6 of the spec; mitigation is the AC #2 documentation. A future `packages/tournament-shared/courses.ts` (3rd consumer story) is the right time to consolidate. **Hold.**

3. **`prepopulateFromUpload`** (`admin.courses.new.tsx:268-298`) converts the parsed `Record<string, number>` yardages to `Record<string, string>` form-state shape. The number→string→number round-trip is intentional — the form state is all-strings to match controlled-input semantics. `Number(value)` at submit pulls the round-trip back to numbers. Verbose but correct; alternative (mixed string|number state) would be worse.

4. **`isComplete()`** (`admin.courses.new.tsx:351-376`) does a deep readback of the form state for client-side completeness. Could be split into `isCourseHeaderComplete + isTeesComplete + isHolesComplete + isTotalsComplete` helpers, but the linear inline form is more obvious to a reader. 25 lines, runs once per render, no hot-path concerns. Leave it.

5. **No `// eslint-disable`, no `as any`, no implicit any.** Casts are limited to:
   - `payload as Record<string, unknown>` in the test (line 731 region) — necessary for the Infinity-via-JSON test that round-trips through JSON to drop the non-finite value.
   - `body as { code?: string; errors?: string[] }` etc — narrowing fetch responses to expected shape after `await res.json()`. Standard pattern.

6. **The `while !ac.signal.aborted` race guards** in `onUploadScorecard` and `onSubmit` — these run BEFORE every setState after an `await`. Without them, a navigation-mid-fetch could trigger `setState on unmounted component` warnings. Mirrors T2-3b exactly. Good defensive hygiene.

7. **Missing docstring on `prepopulateFromUpload`** explaining why it iterates `teeColors` rather than `Object.entries(h.yardages)` — the parsed shape may include yardage keys for tees the parser detected but didn't include in the tees array (rare but possible per T2-3a). The current iteration restricts to the declared tees. Five-line clarifying comment would help. **Acceptable Low.**

8. **The admin.courses.new.tsx file is 670 lines.** Could be split into `NewCourseForm`, `TeesTable`, `HolesTable`, `TotalsSection`, `UploadSection` sub-components. But a single-purpose admin route used by one person doesn't need premature decomposition. **Leave as-is.** A v2 styling pass (Tailwind + shadcn/ui) is the natural time to extract sub-components.

**No blockers.** Ship.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T2-5 as-is** (after AC #20 manual smoke).

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Mary | Tee-color collision UX gap | T2-4 rule 10 backstop catches it; future polish |
| Mary | Manual smoke (AC #20) is load-bearing | Required before commit, not before code-review |
| Winston | `isUniqueConstraintError` 2nd copy in admin-courses.ts ↔ auth.ts | Promote on 3rd consumer per codebase posture |
| John | "Reset / try another file" affordance missing | Future polish |
| John | No course-list UI | Future T-story (separate from Epic T2) |
| Quinn | Auth-guard route loader untested in code | Manual smoke per AC #14 + #20 |
| Quinn | Body-limit test depends on explicit Content-Length | Production browsers always send this header |
| Amelia | `prepopulateFromUpload` could use a 5-line docstring | Future polish |
| Amelia | admin.courses.new.tsx is 670 lines, not yet decomposed | v2 styling pass is the right time |

**No agent has open questions for the user.** No proposed code changes warrant another impl iteration. **Director may proceed to step 9 (codex-on-party-review).**

Epic T2 is complete after this commit lands.
