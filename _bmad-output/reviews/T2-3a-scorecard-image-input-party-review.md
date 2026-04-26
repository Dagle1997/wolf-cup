# T2-3a Party-Mode Review (non-interactive written)

**Story:** T2-3a — phone-photographed scorecard input (extends T2-3)
**Status:** review
**Generated:** 2026-04-26
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T2-3a closes a real product gap that the T2-3 retrospective surfaced empirically: 3 of the 5 Pinehurst-area courses we'll play in May either publish JPG-only (Talamore Resort), have no public scorecard at all (Tobacco Road in some catalogs), or don't expect their guests to print PDFs day-of (most clubs). The use case Josh articulated — *"be at the course on tournament day, take a picture of it and be good to go"* — is now backend-deliverable. The 12.9s real-API smoke against the actual Talamore JPG, returning a structurally clean `ParsedCourse` with cleaner data quality than the PDF Talamore CC sister-course smoke from T2-3, is genuine product validation, not just code-level verification.

**Threat model: narrow, well-contained.** The image-input path inherits all of T2-3's existing defenses (`requireSession` → `requireOrganizer` → `bodyLimit(10 MiB)` → MIME pre-filter → buffer → magic-byte → Zod reparse) and adds magic-byte detection that's authoritative against MIME spoofing. A malicious organizer could try to upload an image-MIME-typed PDF or vice versa; the magic-wins policy parses based on bytes, eliminating MIME-spoofing as a useful attack. Image content has its own prompt-injection surface (the model could be tricked by adversarial image content), but the existing SECURITY clause + `tool_choice: { type: 'tool' }` forced-tool-use + Zod reparse means the worst the model can do is emit hallucinated course data — which T2-4 (validator) and T2-5 (human review) catch.

**Recommendation:** ship as-is. The deferred PNG live-API smoke is genuinely low-risk per the impl-codex gate decision. Followup-story candidate: a "real-API smoke harness" story that bundles 3-4 representative real images of each MIME type as committed fixtures (under an ALLOWED path) + a CI-conditional smoke runner gated on a `SMOKE_TEST_API_KEY` env var. That'd close the live-API coverage gap without adding noisy CI runs.

---

## 🏗️ Winston (Architect) — System Design Perspective

The implementation pattern is clean: pure helper (`detectContentKind`) + discriminated-union (`MagicByteResult`) + exhaustive switch in the route. The narrowing from `MagicByteResult` (4 variants) to `ParseContentKind` (2 variants — `pdf` and `image`) at the route boundary, before calling `parseCoursePdf`, is exactly the right place for that decision: the parser shouldn't have to know about `unsupported_image` or `mismatch` — those are HTTP-layer concerns. Type-safe at the boundary, easy to extend (a future T2-3a-extension that adds, say, server-side HEIC decoding could change the route's `case 'unsupported_image':` branch from "reject" to "convert + recurse" without touching the parser).

**Architectural concerns: minor and forward-looking.**

1. **`parseCoursePdf` keeps its name despite accepting images now.** AC #5 in the spec defends this (forward-consumer stability — T2-4/T2-5 import the function by name). I agree with the call. The cost is purely cosmetic; the alternative (rename to `parseCoursecard`) would require a coordinated rename across consumers. A future story after T2-5 lands could rename with a deprecation period if confusion arises. Until then, the doc-comment update on `parseCoursePdf` is sufficient signal.

2. **`detectContentKind` is exported as a top-level helper** (not nested inside `parseCoursePdf`). This is correct — it's reusable from the route, from tests, and from any hypothetical future caller. The exported `MagicByteResult` discriminated union is the contract.

3. **No new module structure.** The change adds ~100 lines to `course-parser.ts` and ~30 to `admin-courses.ts`. Both files now hover around the size where I'd consider a 2-file split (parser core + content-block-builder; route handler + magic-byte-validator). But neither is over 500 lines and the cohesion is genuine. **Don't extract yet** — the 3rd consumer (T2-3b's frontend image preview, which may need to share `MagicByteResult`) is the natural trigger.

4. **`HEIC_BRANDS` as a `Set<string>`** is the right structure for membership testing. The explicit ISO/IEC citation in the comment + the reference to the round-2 codex feedback is good archeology — six months from now, someone wondering "why does this list have `hevx` but not `avif`" will find the answer in the comment, not in lost git-blame context.

**Recommendation:** ship. No architectural debt introduced. Followup-story candidate: when T2-3b lands and a 3rd consumer of `MagicByteResult` exists, consider extracting `magic-byte.ts` as its own file. Not before.

---

## 📋 John (PM) — User Value / Scope Perspective

**Does this satisfy the epic's user-visible value?**
Almost. T2-3a is the *enabling* half of "be at the course, snap a photo, parse it." The endpoint accepts JPEGs and PNGs and WebPs, returns clean `ParsedCourse` objects, and rejects HEIC/GIF with friendly codes. Real-API verified against an actual Talamore Resort scorecard JPEG — the parse-shape contract holds for live phone-uploadable images.

**The user-visible value is half-delivered.** T2-3a is curl-testable but no UI exists for an organizer to actually *use* it. T2-3b (the upload UI) is the next story in queue. Sequencing as A→B is the right call (smaller cycles, tighter codex/party loops); the alternative (A+B in one story) would have been a 1-day cycle vs. T2-3a's half-day. Splitting was correct.

**Scope discipline: excellent.** Zero SHARED files. Zero dependency adds. Zero migrations. The story stayed inside `apps/tournament-api/src/{lib,routes}/` exactly as Risk Acceptance §1 promised. The temptation to bundle "and also raise the body-limit cap" or "and also add HEIC server-side decode" was correctly resisted — both are explicitly future work.

**Test coverage: 23 new tests vs the +11 spec target.** Over-deliver, but for good reason — the `it.each` parameterized table (11 detection cases) is a single test file but 11 separate assertions, each catching a distinct regression class. Not bloat; genuinely useful coverage.

**Concerns:**

1. **HEIC end-to-end is unverified at the live-API path.** Mocked tests cover it. But Josh is on iPhone and his photos default to HEIC. The first time he tests T2-3b's UI on his actual phone, the flow will be: photo → HEIC → upload → backend rejects with `unsupported_mime_heic` → frontend converts to JPEG → re-upload → success. That second-step (frontend conversion) is T2-3b's work; T2-3a hands off via the `unsupported_mime_heic` error code as the contract. The contract is set, but the real iPhone smoke will only happen post-T2-3b. Acceptable for T2-3a to ship without it.

2. **The endpoint name `parse-pdf` is technically inaccurate now.** Spec acknowledged this. PM-level concern: future organizers reading the OpenAPI/route list might wonder "why is parse-pdf accepting JPEGs?" Mitigation lives in the route doc-comment (says "PDF or image"). Not a blocker; a T2-5-or-later story can clean up the route name with proper deprecation.

**Recommendation:** ship. T2-3b is the natural next director story.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

Coverage analysis on the 23 new tests + 6 round-1 ones (29 total covering the T2-3a surface):

**Well-covered failure modes:**
- All 6 magic-byte detection paths (PDF, JPEG, PNG, WebP, HEIC, GIF) — table-tested
- Multiple HEIC brand variants (heic, mif1, hevx) — catches future iPhone-OS drift
- Empty input, too-short input — boundary conditions
- ftyp box with non-HEIC brand → mismatch
- Image content-block emission for all 3 supported MIMEs at the parser layer
- PDF default + ordering pin (catches future regression that swaps content order)
- Route MIME pre-filter accept/reject for all 10 entries via the test cases that cover happy path + reject path
- HEIC + GIF route rejection with specific codes
- MIME-vs-magic mismatch (magic wins policy)

**Partially-covered or unverified:**
- WebP at the route level — covered by mocked tests; live-API not verified (deferred per AC #13 user gate)
- PNG at route level — covered by mocked tests; live-API not verified (same reason)
- HEIC with declared MIME `image/heif` (vs `image/heic`) — codex round-1 LOW #3 flagged this; gating rule says Lows don't block, but the test is small and worth adding in a future polish pass

**Missed (genuinely gaps):**
- **No structured-log assertion for the `inputKind` field on success.** AC #6 mandates the field be present in `vision_parse_success` logs. Tests verify the route returns 200 but don't capture/inspect the log line. If a future refactor accidentally drops `inputKind`, no test catches it. Could be fixed with a `vi.spyOn(log, 'info')` in one of the route happy-path tests.
- **No test for the "no file at all" edge case at the new MIME-class step.** T2-3 had a `missing_file` test; T2-3a inherits it; not re-tested with the new MIME accept-list. This is a low-priority gap because the missing_file check happens BEFORE the MIME check; same code path as T2-3.
- **No test for file with declared MIME `image/avif` (rejected at MIME pre-filter as `wrong_mime`).** Spec Risk Acceptance §3 explicitly excludes AVIF. A test confirming "declared image/avif → 400 wrong_mime" would pin this exclusion.

**Real-API smoke residual risk:** the JPEG smoke succeeded; PNG / WebP / HEIC at the route level not verified live. JPEG and PNG share code paths so the risk is genuinely tiny, but it's not zero. The user gate decision (option A) accepted this risk explicitly.

**Recommendation:** ship as-is. The 3 unverified gaps above are LOW-priority polish items that don't change the story's "ready to use" verdict. None warrant another codex iteration. Folding them into T2-3b's scope (where the UI smoke would naturally cover image MIMEs end-to-end) is the right place.

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Three observations:

1. **`detectContentKind` uses non-null assertions (`bytes[0]!`) inside the brand-extraction**. This is acceptable because `bytes.length >= 12` is the precondition. TypeScript can't narrow the indexed access to non-undefined without `noUncheckedIndexedAccess: false` (which we don't have — strict is on). The `!` is correct here; a future refactor that copies this pattern without checking the length precondition would crash. **Could be made more obvious by extracting a `readByteAtUnsafe(bytes, i)` helper** — but adds complexity for arguably-fine code. **Don't refactor**; the file-level comment + the length check on the line above are sufficient signal.

2. **The route handler's discriminated switch has no `default` branch** because TypeScript's exhaustiveness checking guarantees all 4 variants of `MagicByteResult` are covered. If `MagicByteResult` ever gains a 5th variant (unlikely), the route would fail to compile until updated. This is correct — `default: throw new Error('unreachable')` would be defensive but the type-system signal is stronger. **Don't add a default.**

3. **The route's `let parseKind` and `let inputKind`** are necessary because they're conditionally assigned in the switch and then used after. The alternative (`const { parseKind, inputKind } = (() => { switch ... })()`) is more idiomatic but harder to read. **`let` is fine here**; the switch's exhaustiveness ensures both are always assigned before use.

**Refactor opportunities (none worth doing):**
- The 6 happy-path route tests share helpers (`makeImageBytes`, `imageForm`, the seed/cookie pattern). Three-callers rule: extract into `routes/__test-helpers__/admin-courses.ts` when T2-5 adds the 3rd test file. Until then, the duplication is below the threshold.
- The HEIC fixture bytes in `course-parser.test.ts` (the it.each table) and `admin-courses.test.ts` (the route tests) are independently authored. Could be hoisted to a shared `test-fixtures/magic-bytes.ts` file. Same three-callers rule — defer.

**No `// eslint-disable`, no `as any`, no implicit any.** Type discipline is intact throughout.

**Recommendation:** ship. Code quality is solid for a backend extension story. The two `let` declarations + the `!` non-null assertions are conscious, justified choices, not code smells.

---

## Synthesis & Verdict

All five perspectives converge: **ship T2-3a as-is.**

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Analyst | Future "real-API smoke harness" story for committed image fixtures | T2-3b spec or later |
| Architect | Watch for `magic-byte.ts` extraction when 3rd consumer arrives | T2-3b spec note |
| Architect | Watch for `parse-pdf` route rename after T2-5 | Future story (post-T2-5) |
| PM | HEIC end-to-end live verification will happen via Josh's iPhone in T2-3b | T2-3b validation |
| QA | Add `inputKind` log-content assertion test | T2-3b polish OR followup |
| QA | Add explicit AVIF + HEIF-declared-MIME tests | T2-3b polish OR followup |
| Dev | Three-callers rule: extract test helpers when T2-5 third test file lands | T2-5 spec note |

**No agent has open questions for the user. No proposed code changes warrant another impl iteration. Director may proceed to step 9 (codex-on-party-review).**
