# Codex Review

- Generated: 2026-04-26T17:04:16.789Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md

## Summary

Spec is generally well-scoped to ALLOWED paths and contains concrete tasks/tests, but it has two internal contradictions that would likely cause an incorrect implementation: (1) HEIC/GIF “specific error code” behavior is largely unreachable given the MIME-stage allowlist, and (2) MIME-vs-magic mismatch handling is inconsistent (magic authoritative vs. rejecting mismatches), with a route test asserting behavior that contradicts the earlier validation description. There are also a couple of medium-risk ambiguities (parser test list, potential message content ordering regression) and a likely-incomplete HEIC brand list that undermines the “friendly HEIC error” goal.

Overall risk: high

## Findings

1. [high] HEIC/GIF tailored error codes are unreachable under the specified MIME-stage allowlist
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:92-151
   - Confidence: high
   - Why it matters: The spec’s rationale is to detect HEIC/GIF via magic-bytes so the backend can return specific codes (`unsupported_mime_heic` / `unsupported_mime_gif`) for better UX and for T2-3b to trigger client-side conversion. However, the validation order and AC #5 say that any MIME outside the allowlist returns 400 `wrong_mime`, and the allowlist does NOT include `image/heic` or `image/gif` (lines 96-99, 145-151). In the common case where the browser correctly sends `image/heic`, the request will be rejected at step 3 with `wrong_mime`, never reaching magic-byte detection and never producing `unsupported_mime_heic`. This directly conflicts with Risk Acceptance §2/§3 and AC #5’s branching for `unsupported_image`.
   - Suggested fix: Decide which behavior is intended and make it consistent:
- If you truly want specific HEIC/GIF codes: include `image/heic` and `image/gif` in the MIME-stage allowlist (step 3 / AC #5) so the upload reaches `detectContentKind`, then reject with `unsupported_mime_*` based on magic.
- If you want to reject by MIME early: remove the `unsupported_image` variants from `MagicByteResult`, remove the HEIC/GIF magic-byte detection requirement, and update ACs/tests accordingly.
Also align AC #8 route tests with the chosen approach.

2. [high] MIME-vs-magic mismatch policy is contradictory (and tests demand behavior that conflicts with “magic is authoritative”)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:92-176
   - Confidence: high
   - Why it matters: The spec states “magic-byte is the ULTIMATE authority” and that after magic detection, `pdf` or `image` continues (lines 92-100). But it then states: “a MIME-says-image-but-magic-says-PDF (or vice versa) is treated as `wrong_magic`” (line 101). AC #8 further requires a route test where MIME is `image/jpeg` but bytes are `%PDF...` and expects 400 `wrong_magic` (lines 175-176). These can’t all be true simultaneously unless you add an additional cross-check step that compares declared MIME to detected kind and deliberately rejects mismatches. Without resolving this, an implementer could ship the opposite behavior from what you intend.
   - Suggested fix: Make the mismatch rule explicit and implementable:
- Option A (consistent with “magic is authoritative”): ignore declared MIME after buffering; accept based on `detectContentKind` result. Update line 101 and remove/replace the mismatch test.
- Option B (stricter): define an explicit cross-check step: compute `declaredKind` from MIME (pdf vs image vs unknown) and reject if it conflicts with detected kind. In that case, update the validation order text to include this step and clarify what happens for `application/octet-stream` / empty MIME.
Ensure AC #5 branching and AC #8 tests match the chosen rule.

3. [medium] Parser-test list includes a “JPEG-MIME-typed PDF mismatch” concept that parser-level unit tests can’t observe
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:84-166
   - Confidence: high
   - Why it matters: Risk Acceptance §7 and AC #7 mention “magic-byte mismatch on a JPEG-MIME-typed PDF (cross-check)” as a parser test target (line 86). But `parseCoursePdf` operates on bytes + `contentKind` (AC #2) and does not receive the upload’s declared MIME; that mismatch can only be tested at the route level where MIME exists. Separately, `detectContentKind` would classify `%PDF...` bytes as `{ kind: 'pdf' }`, not `{ kind: 'mismatch' }`, so calling it on a PDF won’t yield a mismatch outcome anyway. This makes the test guidance internally inconsistent and could lead to wasted/incorrect tests.
   - Suggested fix: Move MIME-vs-magic mismatch assertions entirely to route tests (AC #8) and remove the parser-test bullet about “JPEG-MIME-typed PDF mismatch”. For parser tests, keep coverage focused on: pdf default branch, image branch (jpeg/png/webp), prompt snapshot, and `detectContentKind` table including an actual random-bytes mismatch case.

4. [medium] Potential regression risk: spec appears to change Messages content-block ordering for PDFs
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:117-124
   - Confidence: medium
   - Why it matters: AC #2 specifies that `messages[].content` is “the discriminated content block followed by the unchanged `{ type: 'text' }` block” (lines 120-124). If T2-3 previously sent text first then document (or had any other ordering), enforcing this ordering change could subtly alter model behavior and regress the already-verified PDF parsing. The spec’s own risk section emphasizes prompt stability and regression sensitivity; ordering is another behavior-affecting change that isn’t guarded by an explicit regression test unless you pin it.
   - Suggested fix: Clarify the requirement as: preserve the exact prior ordering from T2-3 for the PDF path, and for image path mirror the same ordering (only swapping document→image). Add/adjust a unit test that asserts the full `messages.create` payload ordering for the PDF default case matches T2-3’s prior snapshot/expectation (not just that the document block exists).

5. [medium] HEIC magic-byte “brand list” is likely incomplete, undermining the promised `unsupported_mime_heic` UX
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:49-60
   - Confidence: medium
   - Why it matters: The spec detects HEIC via `ftyp` at bytes 4–7 plus a brand check at bytes 8–11, with an explicit brand allowlist (line 57). Real-world HEIF/HEIC files may use additional common major brands (e.g., `hevx` is a known HEVC-based brand; other HEIF family brands exist beyond the list provided). If an iPhone-origin HEIF variant uses a brand not in the list, the upload will fall through to `mismatch` → `wrong_magic` instead of the promised `unsupported_mime_heic`, defeating the stated purpose of “extra-specific HEIC detection”.
   - Suggested fix: Broaden HEIC/HEIF detection criteria:
- Expand the brand allowlist to include additional known HEIF/HEIC major brands (at minimum consider `hevx` alongside `hevc/heic/heix/mif1/msf1`).
- Alternatively, treat any ISO BMFF file with `ftyp` + major brand in a broader HEIF family set as HEIC/HEIF (still returning `unsupported_mime_heic`), while keeping AVIF explicitly excluded if desired.
Add a unit-test fixture for at least one additional brand beyond `heic`/`mif1` to prevent regressions.

6. [low] Smoke-test mandate is process-enforced only; no repo artifact makes it hard to audit or rerun
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:193-253
   - Confidence: medium
   - Why it matters: AC #13 requires real-API smoke and says scripts/artifacts go in `tmp/` and are not committed (lines 193-196, 248-253). That’s fine operationally, but it’s not mechanically enforceable or reviewable after the fact; future maintainers can’t easily re-run the same smoke without recreating steps. Given that external integrations are the main risk driver here (Anthropic image blocks), this leaves a gap.
   - Suggested fix: If you want this to be auditable without SHARED changes, consider committing a small smoke runner under an ALLOWED path (e.g., `apps/tournament-api/src/scripts/` if that exists) that reads local files from `tmp/` but the script itself is versioned; or require a structured “smoke results” section to be copied into the story completion notes with exact command + git hash + model name.

## Strengths

- Clear ALLOWED-path scoping and explicit SHARED/FD boundary constraints; no AC appears to require touching prohibited directories.
- Good use of discriminated unions and an exported pure `detectContentKind` helper to make validation unit-testable.
- Acceptance criteria include concrete test-count deltas and specify both unit and route-level coverage, plus a PDF regression smoke re-run.
- Magic-byte signatures for PDF/PNG/GIF/WebP are correctly described at a high level (composite WebP RIFF+WEBP check is called out).

## Warnings

None.
