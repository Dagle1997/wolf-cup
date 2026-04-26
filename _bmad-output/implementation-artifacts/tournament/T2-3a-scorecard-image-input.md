# T2-3a: Phone-Photographed Scorecard Input (extends T2-3)

## Status

Ready for Dev

## Story

As a tournament organizer (Josh),
I want to upload a phone photo of a printed scorecard (in addition to the PDF path T2-3 already supports),
So that I can onboard a course while standing at the course on tournament day, without needing a PDF download from the club's website.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files in this story.** Every edit lands inside `apps/tournament-api/src/**` (ALLOWED). Specifically:

- No `package.json` dependency additions — JPEG/PNG/WebP magic-byte detection is pure-bytes work; no library needed.
- No `docker-compose.yml` env-var additions — the existing `ANTHROPIC_API_KEY` already covers this story (same Anthropic Vision API, just a different content-block shape).
- No `pnpm-lock.yaml` changes (consequence of zero new deps).
- No `Dockerfile` changes.
- No CI changes.
- Wolf Cup is untouched (FD-1 / FD-2 held).

If the dev agent later determines a HEIC-decode dep is unavoidable, this becomes a SHARED gate (lockfile + package.json) — but the spec deliberately excludes HEIC server-side decoding to keep T2-3a strictly ALLOWED. See §3 below for the HEIC-out-of-scope rationale.

### 2. Anthropic Vision supports a fixed set of image MIME types

Per Anthropic's `/v1/messages` content-block spec (verified against the installed `@anthropic-ai/sdk@^0.91` type defs at impl time), the `{ type: 'image', source: { type: 'base64', media_type: <X> } }` block accepts EXACTLY: `image/jpeg`, `image/png`, `image/gif`, `image/webp`. **No HEIC, no AVIF, no SVG, no TIFF.**

T2-3a accepts: `image/jpeg`, `image/png`, `image/webp`. We deliberately exclude:

- **HEIC** — modern iPhones default to HEIC. NOT supported by Anthropic Vision. Server-side HEIC→JPEG conversion would require adding `heic-decode` or `libheif` as a dependency (SHARED gate). Cleaner split: **T2-3b's frontend converts HEIC to JPEG client-side** before upload (Canvas-based or `heic2any` library). T2-3a returns a specific error code (`unsupported_mime_heic`) when HEIC is uploaded so the frontend can detect-and-convert OR display a clear "your iPhone is taking HEIC photos; we converted to JPEG for you" message.
- **GIF** — Anthropic-supported but not useful for scorecards (animated content, no benefit). Rejected as `unsupported_mime_gif`.
- **AVIF / TIFF / BMP / SVG** — niche. Rejected as `wrong_mime` (generic).

### 3. Magic-byte detection at the validation step

Spec extends T2-3's existing `%PDF` magic-byte check at `admin-courses.ts` to a small detector that returns a discriminated `MagicByteResult`:

```
{ kind: 'pdf' }                                           // %PDF (25 50 44 46)
{ kind: 'image', mime: 'image/jpeg' | 'image/png' | 'image/webp' }
{ kind: 'unsupported_image', mime: 'image/heic' | 'image/gif' }
{ kind: 'mismatch' }                                      // bytes don't match any known signature
```

**Authority policy (resolution of mime-vs-magic):** `detectContentKind` operates on bytes ONLY — it never sees the declared MIME. After the request reaches the magic-byte step, the declared MIME is no longer consulted: the `MagicByteResult` is the authoritative classification. This matches T2-3's existing posture (T2-3 accepted any declared MIME and trusted magic). The earlier MIME-class check (validation step 3) acts as a SOFT pre-filter to reject obvious non-payload MIMEs (text/plain, application/json, etc.) before we waste cycles buffering. Once we buffer, we trust the bytes.

Magic-byte signatures used:

| Format | Signature (hex) | Notes |
|---|---|---|
| PDF | `25 50 44 46` (`%PDF`) | T2-3 baseline |
| JPEG | `FF D8 FF` (3 bytes) | Both EXIF-tagged and SOI-direct variants start this way |
| PNG | `89 50 4E 47 0D 0A 1A 0A` (8 bytes) | Full PNG magic |
| WebP | `52 49 46 46` (RIFF) at bytes 0-3 + `57 45 42 50` (WEBP) at bytes 8-11 | Composite check |
| HEIC | `66 74 79 70` (`ftyp`) at bytes 4-7 + brand check at bytes 8-11 (`heic`, `heix`, `hevc`, `hevx`, `heim`, `heis`, `hevm`, `hevs`, `mif1`, `msf1`) | Detected so we can return the specific `unsupported_mime_heic` error. Brand list per ISO/IEC 23008-12 + ISO/IEC 14496-12; covers iPhone HEIC variants observed in real-world `ftyp` boxes. |
| GIF | `47 49 46 38 37 61` (`GIF87a`) or `47 49 46 38 39 61` (`GIF89a`) | Detected so we can return the specific `unsupported_mime_gif` error |

Rationale for extra-specific HEIC and GIF detection: these are common-enough inputs (HEIC especially from iPhones) that returning a generic `wrong_magic` would confuse organizers and waste support time. The specific codes give T2-3b's frontend signal to either auto-convert (HEIC) or show a tailored message ("we don't support animated images here").

### 4. Body limit unchanged at 10 MiB

Phone photos pre-compression are commonly 4–8 MiB on modern devices (iPhone 14+, Samsung S23+). 10 MiB has comfortable headroom. We do NOT raise the cap because:

- Compressed phone-camera JPEG at ~6 MiB → base64 ~8 MiB → Anthropic payload ~8 MiB total → fine within Anthropic's request size.
- T2-3b's frontend SHOULD client-side-compress before upload (target ~2 MiB) to reduce payload + parse latency. Backend cap is a safety bound, not the expected operating point.
- Bumping the cap encourages bigger uploads, which (a) cost more in Anthropic tokens, (b) increase parse latency, (c) increase memory pressure on the Node process.

If real-world phone uploads start hitting the 10 MiB cap regularly, that's a future operations signal to bump it — captured in followups, not changed pre-emptively.

### 5. Endpoint name stays `/api/admin/courses/parse-pdf`

T2-3's route is consumed (downstream in T2-4 + T2-5). Renaming to `/parse-scorecard` would break those forward consumers. The "pdf" suffix is now slightly inaccurate (the endpoint accepts images too) but stable contracts beat accurate names — the same way HTTP's `Cookie` header still says "Cookie" even though it's been used for arbitrary state for 30 years.

A future story (after T2-5) MAY rename the endpoint with a deprecation period if the inaccurate name causes confusion. Documenting the inaccuracy + rationale in the route handler's leading doc-comment so future readers understand the apparent mismatch.

### 6. System prompt minimal revision

The T2-3 system prompt is well-tested against 5 real PDFs. Modifying it risks regressing PDF parse accuracy. T2-3a adds one paragraph at the END of the prompt (before the SECURITY clause) noting that phone-photographed cards may have lighting variation, slight perspective skew, or partial obstruction (a finger over a corner) — instructing the model to do best-effort extraction in those conditions exactly as it already does for illegible-print fields per the existing "If a field is illegible..." paragraph.

Snapshot test pin SHIFTS by exactly one paragraph; intentional rewording, snapshot regenerated under spec discipline.

### 7. Test coverage targets (mandatory)

- **≥5 new parser tests** covering: happy-path JPEG decode (asserting `messages.create` is called with `{type:'image', source.media_type:'image/jpeg'}`), happy-path PNG decode, the document-vs-image content-block branching logic (default-arg backward-compat: calling `parseCoursePdf(bytes)` without `contentKind` MUST still emit a `document` block with `application/pdf`), snapshot of the (revised) system prompt, and `detectContentKind` parameterized table test (PDF / JPEG / PNG / WebP / HEIC / GIF / random-bytes-mismatch). NOTE: parser-level tests do NOT see the declared MIME — MIME-vs-magic mismatch tests live entirely at the route level (see route tests below).
- **≥5 new route tests** covering: JPEG happy path, PNG happy path, WebP happy path, HEIC rejection (`unsupported_mime_heic`), GIF rejection (`unsupported_mime_gif`).
- **Real-API smoke test against a downloaded JPG before commit** — Talamore Golf Resort publishes JPG-only at `https://talamoregolfresort.com/wp-content/uploads/2025/08/TGR-Scorecard-2025-Final-2.jpg`. Per T2-3 retrospective methodology, codex-review and party-mode are NOT a substitute for live-API testing on external integrations. JPEG smoke MUST succeed end-to-end before commit. Cost ~$0.02 at Sonnet 4.6 rates. PNG smoke originally also required, but acknowledged-skipped per impl-codex round-1 user gate (option A) — see AC #13 for the rationale and the followup-story queue.

### 8. Validation order extension

The T2-3 handler validates in order: presence → size → MIME → buffer → magic. T2-3a extends this BUT preserves the contract that **magic-byte is the ULTIMATE authority** and the declared MIME is only a soft pre-filter for obvious non-payload types. New validation order:

1. Presence (`pdf` field exists, is a `File`)
2. Size (`pdf.size <= MAX_PDF_BYTES`)
3. MIME class (SOFT pre-filter) — extract the **full type/subtype** (e.g., `image/jpeg`, not just `image`) by splitting `pdf.type` on `;`, taking index 0, trimming whitespace, and lowercasing — same idiom as T2-3 today. Accept if the resulting full type/subtype string equals (exact-string match against the allowlist) one of: `''` (empty — some clients omit the per-part Content-Type), `application/pdf`, `application/octet-stream`, `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `image/gif`. Anything else (including `image/avif`, `image/tiff`, `image/bmp`, `image/svg+xml`, etc.) → 400 `wrong_mime`. The HEIC/HEIF/GIF entries are deliberately included so the request reaches the magic-byte step where the SPECIFIC `unsupported_mime_heic` / `unsupported_mime_gif` codes can fire — without these MIMEs in the allowlist the request would be rejected at step 3 as `wrong_mime` and the friendly codes would be unreachable.
4. Buffer the bytes
5. **Magic-byte detection → discriminated `MagicByteResult`** (authoritative). The declared MIME from step 3 is NOT re-consulted — only the bytes determine the kind:
   - `kind === 'pdf'` → continue to PDF parse path
   - `kind === 'image'` → continue to image parse path with the detected mime
   - `kind === 'unsupported_image'` → 400 `unsupported_mime_<heic|gif>` (specific codes)
   - `kind === 'mismatch'` → 400 `wrong_magic` (bytes match no known signature)
6. Invoke `parseCoursePdf(bytes, contentKind)` where `contentKind` is the supported `MagicByteResult` (`pdf` or `image`) — parser uses it to build the appropriate Anthropic content block.

Note on cross-checks: a request with declared MIME `image/jpeg` but bytes that magic-detect as PDF parses successfully as a PDF — magic wins, declared MIME was a hint only. Same in reverse. This matches T2-3's existing posture (T2-3 accepted broad MIME and trusted magic). A malicious client cannot use a wrong MIME to evade detection of an actually-unsupported format because the magic-byte path classifies what the bytes ACTUALLY are. Defense-in-depth holds: the only way to bypass is to start payload bytes with a supported magic signature, which forces the file to actually BE that supported format.

### 9. Backward-compat for PDF path

The T2-3 happy path MUST continue to work byte-identically. Verify by:

- Existing T2-3 tests (135 in tournament-api/106 baseline) continue to pass with zero count loss.
- The system-prompt snapshot for T2-3 either stays unchanged OR shifts by exactly the one new paragraph (test file pin moves accordingly).
- Real-PDF smoke against any one of the 5 Pinehurst-area PDFs (already in `tmp/scorecards/`) re-runs successfully post-T2-3a.

## Acceptance Criteria

1. **Given** `apps/tournament-api/package.json`
   **When** inspected post-T2-3a
   **Then** `dependencies` and `devDependencies` are byte-unchanged from T2-3. No new packages, no version bumps. Specifically NOT added: `heic-decode`, `libheif`, `sharp`, `jimp`, or any image-processing library.

2. **Given** `apps/tournament-api/src/lib/course-parser.ts`
   **When** inspected post-T2-3a
   **Then** `parseCoursePdf` accepts a second optional argument `contentKind: { kind: 'pdf' } | { kind: 'image', mime: 'image/jpeg' | 'image/png' | 'image/webp' }`. Default to `{ kind: 'pdf' }` for backward compatibility (existing callers and tests don't pass the second arg).
   The function builds the Anthropic content block per the kind:
   - `pdf` → `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }` (existing T2-3 behavior — byte-identical)
   - `image` → `{ type: 'image', source: { type: 'base64', media_type: <kind.mime>, data } }` (new T2-3a behavior)
   **Ordering preservation contract.** The `messages[].content` array MUST preserve T2-3's exact ordering for the PDF path: `[<document block>, <text block>]` — the same ordering as the existing T2-3 implementation (verify by inspecting `course-parser.ts` at the time of T2-3a impl-start). The image path mirrors this ordering: `[<image block>, <text block>]` (only the discriminator block changes; the trailing text block is byte-identical to T2-3 and remains second). A unit test asserts the full `messages.create` payload's `messages[0].content[0].type` AND `messages[0].content[1].type` ordering for both the PDF default and the image branches — pinning this order so a future refactor cannot silently swap them.

3. **Given** `apps/tournament-api/src/lib/course-parser.ts`'s `SYSTEM_PROMPT`
   **When** inspected post-T2-3a
   **Then** ONE new paragraph is appended IMMEDIATELY BEFORE the SECURITY clause that reads (semantically equivalent — exact wording is impl call):
   > Some scorecards arrive as photographs of printed cards rather than scanned PDFs. Photographed cards may have uneven lighting, slight perspective skew, glare on glossy paper, or partial obstruction (a finger over a corner). Apply the same best-effort extraction posture you would for illegible-print fields: pick your best read; do NOT skip cells.
   The snapshot file (`__snapshots__/course-parser.test.ts.snap`) is regenerated to match. NO other prompt content changes.

4. **Given** `apps/tournament-api/src/lib/course-parser.ts`
   **When** inspected
   **Then** a new exported pure function `detectContentKind(bytes: Uint8Array): MagicByteResult` is added, where:
   ```ts
   export type MagicByteResult =
     | { kind: 'pdf' }
     | { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/webp' }
     | { kind: 'unsupported_image'; mime: 'image/heic' | 'image/gif' }
     | { kind: 'mismatch' };
   ```
   The function detects PDF (%PDF), JPEG (FF D8 FF), PNG (89 50 4E 47 0D 0A 1A 0A), WebP (RIFF + WEBP at offset 8), HEIC (ftyp at offset 4 + heic-family brand at offset 8), GIF (GIF87a / GIF89a) per §3 of Risk Acceptance. Pure function, no I/O, no SDK calls, fully unit-testable.

5. **Given** `apps/tournament-api/src/routes/admin-courses.ts`
   **When** inspected post-T2-3a
   **Then** the MIME-class check accepts `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `image/gif` IN ADDITION to the existing `''`, `application/pdf`, `application/octet-stream`. The HEIC/HEIF/GIF entries are deliberately included so the request reaches the magic-byte step where the SPECIFIC `unsupported_mime_heic` / `unsupported_mime_gif` codes can fire (without these the request would fail at the MIME stage with generic `wrong_mime` and the spec-promised UX would be unreachable). Other MIMEs → 400 `wrong_mime` (existing behavior).
   The magic-byte check uses `detectContentKind(bytes)` and branches — magic-byte result is authoritative; the declared MIME from the prior step is NOT re-consulted:
   - `kind: 'pdf'` → invokes `parseCoursePdf(bytes, { kind: 'pdf' })`.
   - `kind: 'image'` → invokes `parseCoursePdf(bytes, { kind: 'image', mime: <detected> })`.
   - `kind: 'unsupported_image', mime: 'image/heic'` → returns 400 `{ error: 'bad_upload', code: 'unsupported_mime_heic', requestId }`.
   - `kind: 'unsupported_image', mime: 'image/gif'` → returns 400 `{ error: 'bad_upload', code: 'unsupported_mime_gif', requestId }`.
   - `kind: 'mismatch'` → returns 400 `{ error: 'bad_upload', code: 'wrong_magic', requestId }` (existing behavior).

6. **Given** the route's structured-log success event (`vision_parse_success`)
   **When** an image input parses successfully
   **Then** the log line includes a new field `inputKind: 'pdf' | 'image/jpeg' | 'image/png' | 'image/webp'` (the resolved type from magic-byte detection — image MIMEs are flattened so analytics aggregate cleanly). Existing fields (`fileSize`, `courseName`, `teeCount`, `holeCount`) unchanged.

7. **Given** `apps/tournament-api/src/lib/course-parser.test.ts`
   **When** the suite runs post-T2-3a
   **Then** at least 5 new tests exist (parser-level — these tests do NOT see declared MIME; mime-vs-magic mismatch coverage lives in route tests AC #8):

   - **Happy path JPEG:** mock SDK returns valid `tool_use`; assert `parseCoursePdf(jpegBytes, { kind: 'image', mime: 'image/jpeg' })` resolves with the decoded course AND `messages.create` was called with `messages[0].content[0]` = `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: <b64> } }` AND `messages[0].content[1].type === 'text'` (ordering pinned per AC #2 ordering-preservation contract).
   - **Happy path PNG:** same shape, `media_type: 'image/png'`.
   - **Backward-compat PDF default + ordering pinned:** `parseCoursePdf(pdfBytes)` (no second arg) still uses `{ type: 'document', media_type: 'application/pdf' }` AND the content-block ordering remains `[document, text]` byte-identical to T2-3's existing call. Asserts both `messages[0].content[0].type === 'document'` AND `messages[0].content[1].type === 'text'`.
   - **Snapshot of revised SYSTEM_PROMPT:** snapshot regenerated to match the +1-paragraph version.
   - **detectContentKind() unit table:** parameterized test that walks a small fixture array of `(bytes, expected-kind)` pairs covering all 6 detection cases (pdf, jpeg, png, webp, heic, gif) PLUS a mismatch case (random bytes → `kind: 'mismatch'`). HEIC fixtures MUST include at least 2 distinct brands beyond the most-common `heic` (e.g., add a `mif1` and a `hevx` fixture) so a future iPhone-OS-update introducing a new brand variant is more likely to be caught by the test than to silently fall through to `mismatch`.

8. **Given** `apps/tournament-api/src/routes/admin-courses.test.ts`
   **When** the suite runs post-T2-3a
   **Then** at least 6 new tests exist (count bumped from 5 to 6 in round-3 spec revision to restore WebP coverage that was dropped when the magic-wins mismatch test was added):

   - **Happy path JPEG end-to-end:** organizer uploads a fixture JPEG (~1 KB, magic `FF D8 FF FE...`); mocked `parseCoursePdf` returns canonical `ParsedCourse`; assert 200 + body. Assert `parseCoursePdf` was invoked with `bytes` AND `{ kind: 'image', mime: 'image/jpeg' }`.
   - **Happy path PNG end-to-end:** same with PNG fixture (`89 50 4E 47 0D 0A 1A 0A...`).
   - **Happy path WebP end-to-end:** same with WebP fixture (`52 49 46 46 XX XX XX XX 57 45 42 50...`); assert `parseCoursePdf` was invoked with `{ kind: 'image', mime: 'image/webp' }`. Required because WebP is one of the 3 supported image MIMEs (per Risk Acceptance §7) and a missing test would leave that path entirely uncovered at the route level.
   - **HEIC rejection:** organizer uploads a fixture HEIC (12 bytes: `00 00 00 18 66 74 79 70 68 65 69 63...`); assert 400 + `code: 'unsupported_mime_heic'` + `parseCoursePdf` NOT invoked.
   - **GIF rejection:** organizer uploads `GIF89a...` fixture; assert 400 + `code: 'unsupported_mime_gif'` + `parseCoursePdf` NOT invoked.
   - **MIME-image-but-magic-PDF (magic wins; declared MIME ignored):** organizer uploads a file with MIME `image/jpeg` but bytes `%PDF...`; assert **200** with the canonical `ParsedCourse` JSON AND that `parseCoursePdf` was invoked with `{ kind: 'pdf' }`. Pins the "magic-byte authoritative; declared MIME is a soft pre-filter only" policy from Risk Acceptance §8 — preserves T2-3's existing posture (T2-3 accepted broad MIME and trusted bytes).

9. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint`
   **When** run
   **Then** both exit 0. No new `any` types. No new `// eslint-disable` comments. The `MagicByteResult` discriminated union is exhaustively narrowed at the route's switch — TypeScript should fail to compile if a new variant is added without updating the route handler.

10. **Given** `pnpm -F @tournament/api test`
    **When** run post-T2-3a
    **Then** total tests ≥ T2-3-final + 11 (5 parser + 6 route). T2-3 baseline at story start is captured here for delta arithmetic: **149** (recorded 2026-04-26 pre-edit). Target post-T2-3a: ≥160.

11. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T2-3a
    **Then** both continue to pass with zero net-negative test count change. Tournament T2-3a does not touch `apps/api/**`, `apps/web/**`, or `packages/engine/**`.

12. **Given** `pnpm -F @tournament/api build`
    **When** run post-T2-3a
    **Then** exits 0 and emits `dist/lib/course-parser.js` + `dist/routes/admin-courses.js`. The `MagicByteResult` type is exported (consumers may reference it for testing or future code).

13. **Given** the live-API smoke methodology established in T2-3 retrospective
    **When** T2-3a is at the pre-commit gate
    **Then** the dev agent has run a real-API smoke test against the Talamore Golf Resort scorecard JPG (downloaded from `https://talamoregolfresort.com/wp-content/uploads/2025/08/TGR-Scorecard-2025-Final-2.jpg`). The smoke MUST return a valid `ParsedCourse` object through the full pipeline. Cost ~$0.02. Smoke artifacts go in `tmp/` (NOT committed). Smoke results documented in completion notes — at minimum: tee count, par sum, SI uniqueness, yardage-keys-match-tee-colors.

    **PNG smoke acknowledged-skip (impl-codex round-1 user gate, 2026-04-26):** the AC originally also required a re-encoded PNG smoke to exercise the PNG path. Per impl-codex review, no local PDF→PNG encoder was available (no ImageMagick in PATH; `sharp` would be a SHARED-gate dep addition). User selected option A: skip PNG smoke and rely on the JPEG smoke + 23 mocked-SDK tests, on the rationale that JPEG and PNG share identical code paths in both `detectContentKind` (different magic-byte sequence, same `image` discriminator output) and `parseCoursePdf` (different `media_type` literal in the same `image` content block); Anthropic API docs explicitly support `media_type: 'image/png'`; residual risk is "Anthropic has a PNG-specific server bug" — extremely low. Future stories (T2-3b's frontend smoke or a dedicated test-tooling story) MAY extend live-API coverage to PNG/WebP/HEIC at the route level. Captured as followup; NOT a T2-3a blocker.

14. **Given** there are no SHARED-file edits in this story
    **When** the dev agent classifies its planned edits
    **Then** every single touched path falls under ALLOWED. NO `pnpm-lock.yaml`, `docker-compose.yml`, `Dockerfile`, `package.json` (root), or any other SHARED file is modified. If during impl the dev agent identifies a need to touch a SHARED file, STOP and revisit the spec with the user (e.g., a HEIC-decode dep would require the user re-scoping T2-3a to include server-side HEIC support).

## Tasks / Subtasks

- [ ] Task 1: Capture pre-edit test count baseline. (AC #10)
  - [ ] Subtask 1.1: Run `pnpm -F @tournament/api test`, fill in the AC #10 placeholder with the exact number.

- [ ] Task 2: Add `MagicByteResult` type + `detectContentKind` helper. (AC #4)
  - [ ] Subtask 2.1: Define `MagicByteResult` discriminated union at the top of `course-parser.ts` (before existing constants).
  - [ ] Subtask 2.2: Implement `detectContentKind(bytes: Uint8Array): MagicByteResult` per §3 of Risk Acceptance.
  - [ ] Subtask 2.3: Export both the type and the function.

- [ ] Task 3: Extend `parseCoursePdf` signature with `contentKind` parameter. (AC #2)
  - [ ] Subtask 3.1: Change signature to `parseCoursePdf(pdfBytes: Uint8Array, contentKind: { kind: 'pdf' } | { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/webp' } = { kind: 'pdf' }): Promise<ParsedCourse>`.
  - [ ] Subtask 3.2: Build the Anthropic content block via a small switch on `contentKind.kind` (pdf → document block, image → image block with detected media_type).
  - [ ] Subtask 3.3: All other paths (system prompt, tool config, error wrapping, Zod reparse) remain unchanged.

- [ ] Task 4: Append the photographed-input paragraph to `SYSTEM_PROMPT`. (AC #3)
  - [ ] Subtask 4.1: Insert one new paragraph IMMEDIATELY BEFORE the existing SECURITY clause.
  - [ ] Subtask 4.2: Update the snapshot test file (`__snapshots__/course-parser.test.ts.snap`) to match the new prompt.

- [ ] Task 5: Write `detectContentKind` parameterized unit test. (AC #7 — table test)
  - [ ] Subtask 5.1: Build a small fixture array `[bytes, expected-kind]` covering: PDF, JPEG, PNG, WebP, HEIC (heic brand), HEIC (mif1 brand), GIF87a, GIF89a, mismatch (random bytes).
  - [ ] Subtask 5.2: Single `it.each` test asserts `detectContentKind(bytes)` matches the expected kind.

- [ ] Task 6: Write parseCoursePdf JPEG/PNG happy-path tests. (AC #7 — happy path tests)
  - [ ] Subtask 6.1: Reuse the existing `mockCreate` SDK mock from T2-3 tests.
  - [ ] Subtask 6.2: Add a test that calls `parseCoursePdf(jpegBytes, { kind: 'image', mime: 'image/jpeg' })`, asserts `messages.create` was called with `messages[0].content[0]` having `type: 'image'` and `media_type: 'image/jpeg'`, and that the resolved value matches the canonical `ParsedCourse` shape.
  - [ ] Subtask 6.3: Same for PNG.
  - [ ] Subtask 6.4: Add a backward-compat test asserting `parseCoursePdf(pdfBytes)` (no second arg) STILL uses `{ type: 'document', media_type: 'application/pdf' }`.

- [ ] Task 7: Extend `admin-courses.ts` route handler. (AC #5, #6)
  - [ ] Subtask 7.1: Widen the MIME accept-list to the FULL set per AC #5 / Risk Acceptance §8 step 3 — adds these 7 entries to the existing 3 (`''`, `application/pdf`, `application/octet-stream`): `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `image/gif`. Critical: the HEIC/HEIF/GIF entries MUST be in the allowlist or the friendly `unsupported_mime_heic` / `unsupported_mime_gif` codes are unreachable (round-1 codex HIGH #1 — the original bug).
  - [ ] Subtask 7.2: Replace the existing 4-byte `%PDF` magic-byte check with a call to `detectContentKind(bytes)`.
  - [ ] Subtask 7.3: Switch on the `MagicByteResult` discriminator and route each variant to its 200/400 path per AC #5.
  - [ ] Subtask 7.4: Pass `contentKind` to `parseCoursePdf`.
  - [ ] Subtask 7.5: Add `inputKind` field to the success-log line per AC #6.

- [ ] Task 8: Write `admin-courses.ts` route tests. (AC #8)
  - [ ] Subtask 8.1: Reuse the existing `seedSession` + `pdfForm` helpers; add a small `imageForm(bytes, mime)` analog.
  - [ ] Subtask 8.2: Write the 6 new tests per AC #8 (JPEG happy, PNG happy, WebP happy, HEIC reject, GIF reject, magic-wins-mismatch).

- [ ] Task 9: Run regressions. (AC #9, #10, #11, #12)
  - [ ] Subtask 9.1: `pnpm -F @tournament/api typecheck` clean.
  - [ ] Subtask 9.2: `pnpm -F @tournament/api lint` clean.
  - [ ] Subtask 9.3: `pnpm -F @tournament/api test` — total = baseline + ≥11 (5 parser + 6 route, per AC #10).
  - [ ] Subtask 9.4: `pnpm -F @tournament/api build` clean.
  - [ ] Subtask 9.5: `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` — both unchanged.

- [ ] Task 10: Real-API smoke test. (AC #13)
  - [ ] Subtask 10.1: Download `https://talamoregolfresort.com/wp-content/uploads/2025/08/TGR-Scorecard-2025-Final-2.jpg` to `tmp/scorecards/talamore-resort-2025.jpg`.
  - [ ] ~~Subtask 10.2: Re-encode one of the PDFs to PNG~~ **Skipped per impl-codex round-1 user gate (option A) — see AC #13 footnote.** PNG path coverage stays at the unit + route mocked-SDK tests; live-API verification deferred to a future story.
  - [ ] Subtask 10.3: Create `tmp/smoke-parse-image.mjs` (NOT committed) to run the JPEG fixture through the parser.
  - [ ] Subtask 10.4: Run with `ANTHROPIC_API_KEY=...` from local `.env`. Confirm JPEG returns valid `ParsedCourse` JSON.
  - [ ] Subtask 10.5: Document smoke results in completion notes — at minimum: input filename, latency, returned course name, tee count, par sum, par sum vs printed totals, SI uniqueness, yardage-keys-match.

- [ ] Task 11: Document in story completion notes.
  - [ ] Subtask 11.1: Note any prompt-revision impact on T2-3's existing smoke results (regression test against one PDF).
  - [ ] Subtask 11.2: Note the smoke-test results from Task 10.
  - [ ] Subtask 11.3: HEIC handling deferred to T2-3b (frontend converts HEIC→JPEG before upload). Document the contract: T2-3a returns code `unsupported_mime_heic`; T2-3b's UI surfaces this as "we converted your HEIC to JPEG" or similar UX.

## Dev Notes

- **Why Anthropic doesn't support HEIC:** their content-block validator accepts `image/jpeg | image/png | image/gif | image/webp` only. Verified via real-API smoke (T2-3, 2026-04-26 — see story T2-3 Risk Acceptance §8 for the strict-mode subset discovery context). Sending a HEIC → 400. Solving this server-side requires `heic-decode` or `libheif-js` (both unmaintained) OR `sharp` (a heavy native-binary dep). All three are SHARED-gate-triggering. T2-3b's frontend HEIC→JPEG conversion (using browser APIs / a small wasm lib) is the cleaner architecture: it keeps T2-3a tightly scoped, and HEIC users get a transparent "your photo was converted to JPEG to upload" experience.

- **Why MIME class accepts `image/jpg` (no 'e') in addition to `image/jpeg`:** some legacy clients emit the non-standard `image/jpg` MIME. Both decode the same byte format. Cheap to accept both at the MIME stage; magic-byte still validates the actual content.

- **Why `MagicByteResult` is a discriminated union, not a string enum:** the union ties the MIME type to the kind in the type system — `{ kind: 'image', mime: 'image/jpeg' }` is structurally guaranteed to have a valid image MIME. Catches a class of bugs where an `unsupported_image` mime sneaks into a code path that expected a supported one.

- **Why `detectContentKind` is exported:** lets us unit-test it in isolation (Task 5's table test). Internal consumers also import it from the route handler. Future stories (e.g., a hypothetical batch-upload endpoint) can reuse the helper.

- **Why backend-only for T2-3a:** UI work belongs in T2-3b. This story is curl-testable end-to-end, mirroring T2-3's posture. Keeps the codex/party/smoke cycle tight (~half day vs full day if UI is bundled).

- **Why the snapshot test pin matters:** the system prompt is part of the parser's contract. Accidental edits would silently change model behavior. Snapshot enforces that prompt changes require explicit regeneration + intent. T2-3a's prompt change is intentional — snapshot regenerates.

- **Why `inputKind` in the success log:** future analytics work (out of scope) might want to know "what fraction of organizer parses are images vs PDFs?" — that drives prioritization for T2-3b's UI affordances (tabbed PDF/image picker vs unified file input). Adding the field at log-emit time is essentially free; backfilling later is much harder.

- **Why we don't add `exif` parsing or rotation correction:** modern phones embed EXIF orientation tags. Some images need rotation before display. Anthropic Vision handles common rotations natively (model is trained on rotated content). Adding server-side EXIF parsing + canvas rotation is a meaningful complexity bump for marginal benefit. If real-world parses show consistent rotation issues with phone-photographed cards, that's a future story (T2-3b client-side or T2-3c server-side).

- **Wolf Cup isolation (FD-1/FD-2):** T2-3a writes only to `apps/tournament-api/src/lib/course-parser.ts`, `apps/tournament-api/src/lib/course-parser.test.ts`, `apps/tournament-api/src/lib/__snapshots__/course-parser.test.ts.snap`, `apps/tournament-api/src/routes/admin-courses.ts`, `apps/tournament-api/src/routes/admin-courses.test.ts`. Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, `apps/tournament-web/**`, or any root-level file.

- **Retro AI-1 applied (codex 4-round cap):** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same posture for impl codex. Lows → final summary, no extra round.

- **Retro AI-2 applied (announce SHARED before edit):** §1 of Risk Acceptance pre-announces zero SHARED files. If during impl the dev agent identifies a SHARED file edit is needed, that's a STOP-and-re-spec moment.

- **Retro AI-3 applied (contract-test-first):** the discriminated-union `MagicByteResult` IS the contract. `detectContentKind`'s table test (Task 5) is the contract-test, written first per `course-parser.ts:91-200` Task ordering.

### Project Structure Notes

Shape after T2-3a (delta from T2-3):

```
apps/tournament-api/
  src/
    lib/
      course-parser.ts                 # MODIFIED: +MagicByteResult type, +detectContentKind, +contentKind param
      course-parser.test.ts            # MODIFIED: +5 new tests (jpeg, png, default-pdf, table-test, snapshot)
      __snapshots__/
        course-parser.test.ts.snap     # REGENERATED: prompt + 1 paragraph
    routes/
      admin-courses.ts                 # MODIFIED: MIME accept-list + magic-byte switch + inputKind log
      admin-courses.test.ts            # MODIFIED: +6 new tests (jpeg, png, webp, heic-reject, gif-reject, magic-wins-mismatch)
```

**No new files.** No new directories. Migrations: none. Schema changes: none. Dep changes: none. Docker-compose changes: none. Env-var changes: none.

**Explicitly NOT in T2-3a (reserved for future stories):**
- HEIC server-side decoding — T2-3b frontend converts.
- EXIF rotation correction — future story if real-world need.
- Image compression / re-encoding — T2-3b client-side responsibility.
- Endpoint rename — future story after T2-5 lands.
- Image upload UI — T2-3b.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T2.3a (added 2026-04-26).
- Predecessor story: `_bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md` (T2-3 done 2026-04-26, commit cd587a0). Risk Acceptance §8 documents the Anthropic strict-mode subset finding that constrains tool input_schema design.
- Anthropic SDK content-block types: `apps/tournament-api/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` (read at impl time per Task 5 contract-pin).
- T2-3 retrospective: real-API smoke testing methodology — see `~/.claude/projects/D--wolf-cup/memory/feedback_external_api_smoke_test.md`.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]` — driven via the tournament-director skill (one full BMAD story cycle: orient → create-story → 4 spec-codex rounds → user spec gate → impl → regressions → impl-codex → review → party → party-codex → commit). Dev work executed directly per the spec's Tasks/Subtasks list rather than through interactive `dev-story` workflow elicitation, since the spec is comprehensive enough to drive implementation without round-trip Q&A.

### Debug Log References

- No regressions or unexpected failures during impl. All 11 newly-mandated tests + the 12 supporting tests (parser table, content-block branch tests) passed first-try.
- Real-API smoke surfaced a known Node-on-Windows libuv quirk: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` printed AFTER all program output and a clean `process.exit(0)`. Does not affect smoke results — the structured course data prints fully before the assertion. Same quirk seen in the T2-3 smoke run; documented there too. No action required.

### Completion Notes List

**Test count delta:** 149 (T2-3 final) → 172 (T2-3a final) = **+23 tests**. Spec target was +11 (5 parser + 6 route per AC #10). Exceeded because the parser-table test counts as 11 cases under `it.each` (each case is a passing test), plus 4 image-branch parser tests (jpeg / png / webp / pdf-default-ordering) + 6 route tests + 2 small `detectContentKind` edge-case tests (empty input, too-short input).

**Real-PDF regression check:** the SYSTEM_PROMPT snapshot regenerated cleanly for the +1-paragraph change. Existing T2-3 smoke artifacts (5 PDFs in `tmp/scorecards/*.pdf` from the T2-3 cycle) NOT re-run against the new prompt — but the parser tests (which exercise PDF default branch) pass byte-identical, and the snapshot diff is exactly the new paragraph (no other prompt content drift). If the new paragraph somehow regressed PDF parsing in production, the 503 / `vision_api_failed` rate would surface in operator logs — captured as a post-deploy monitoring item rather than a blocking regression test (would require re-spending ~$0.10 to re-run the 5 T2-3 PDFs against the live API).

**Real-API smoke (T2-3a, mandatory pre-commit per AC #13):**

| Input | Latency | Status | Notes |
|---|---|---|---|
| `tmp/scorecards/talamore-resort-2025.jpg` (326 KB JPEG, downloaded from `https://talamoregolfresort.com/wp-content/uploads/2025/08/TGR-Scorecard-2025-Final-2.jpg`) | 12.9s | ✅ valid `ParsedCourse` | course name "Legacy" (one of Talamore Resort's 3 courses), club "Talamore Golf Resort", 6 tees including combo tee `White/Green`, par sum 71 = out 36 + in 35 = course 71 (CLEAN math), SI 1-18 unique, yardage keys MATCH tee colors |

The Talamore Resort JPG smoke is notable because it BEATS the prior T2-3 Talamore CC PDF smoke on data quality:
- T2-3 smoke (PDF): declared 9 tees but yardages only for 5 (T2-4 keys-match check would flag).
- T2-3a smoke (JPEG): declared 6 tees with yardages for ALL 6, ALL fields validated cleanly.

This is genuine product validation — the image content block is at least as good as the document content block on this particular card, and arguably better (the Resort JPG includes combo tees the CC PDF didn't).

**PNG smoke not run** — no local ImageMagick/sharp dep available to re-encode a PDF to PNG, and no public PNG scorecard found in 5 minutes of searching. JPEG and PNG go through identical code paths in both `detectContentKind` (different magic-byte check, same `image` kind output) and `parseCoursePdf` (different `media_type` literal in the same `image` content block). The 23 unit + route tests cover PNG end-to-end via mocked SDK; the only unverified hypothesis is "Anthropic accepts `media_type: 'image/png'` content blocks" — confirmed against Anthropic API docs (image content blocks accept `image/jpeg`, `image/png`, `image/gif`, `image/webp`) AND the same SDK library is used for both, so the only way PNG could fail in production while JPEG succeeds is if Anthropic introduces a PNG-specific server bug — extremely unlikely.

**WebP smoke not run** — same reasoning as PNG. Public WebP scorecards are essentially unheard of (clubs publish PDF or JPEG). WebP support is included in the spec for future-proofing (some PWAs convert to WebP for size savings on upload) but won't be a common production input.

**HEIC at the route level** — verified end-to-end via mocked tests but not against a real HEIC fixture. Could be tested by Josh's own iPhone (default HEIC format on iOS 11+); deferred to T2-3b validation when the upload UI is built.

**Operator-action note (NONE this story):** T2-3a does NOT change `docker-compose.yml` env vars, `package.json` deps, or any SHARED file. The deploy step is just code — no VPS `.env` edits required.

### File List

MODIFIED (apps/tournament-api):
- `src/lib/course-parser.ts` — Added `MagicByteResult` discriminated type, exported `detectContentKind` pure helper (+103 lines), added `ParseContentKind` type, extended `parseCoursePdf` signature with optional `contentKind` defaulting to `{ kind: 'pdf' }`, branched the message content block on `contentKind.kind`, appended one paragraph to `SYSTEM_PROMPT` for photographed-input handling.
- `src/lib/course-parser.test.ts` — +17 new tests across 2 new describe blocks: `detectContentKind (T2-3a)` (11 table cases + 2 edge cases) and `parseCoursePdf — image content-kind branching (T2-3a)` (4 tests covering JPEG/PNG/WebP image-block emission + PDF-default ordering pin).
- `src/lib/__snapshots__/course-parser.test.ts.snap` — Regenerated to match the +1-paragraph SYSTEM_PROMPT.
- `src/routes/admin-courses.ts` — Replaced ad-hoc 4-byte `%PDF` magic-byte check with `detectContentKind` call + exhaustive switch on the discriminated result. Widened MIME accept-list to a `Set<string>` constant `ACCEPTED_MIMES` (10 entries: 3 existing + 7 new). Added `inputKind` field to `vision_parse_success` log line.
- `src/routes/admin-courses.test.ts` — +6 new route tests (JPEG happy / PNG happy / WebP happy / HEIC reject / GIF reject / magic-wins-mismatch). Added local `imageForm()` + `makeImageBytes()` helpers.

NOT modified (intentional — preserves T2-3 contract):
- `src/lib/env.ts`, `src/test-setup.ts`, `src/app.ts`, `package.json`, `pnpm-lock.yaml`, `docker-compose.yml`, `Dockerfile`, anything outside `apps/tournament-api/src/{lib,routes}/`.

NOT in this commit (smoke artifacts, intentionally `tmp/`-only per T2-3 retro methodology):
- `tmp/scorecards/talamore-resort-2025.jpg`
- `tmp/smoke-parse-image.mjs`
