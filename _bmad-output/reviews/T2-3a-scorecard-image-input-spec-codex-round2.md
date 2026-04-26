# Codex Review

- Generated: 2026-04-26T17:09:32.307Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md, _bmad-output/reviews/T2-3a-scorecard-image-input-spec-codex.md

## Summary

Round-1 findings #1–#5 appear substantively addressed in the updated spec: (1) HEIC/HEIF/GIF are now explicitly included in the MIME-stage allowlist so the request can reach magic-byte detection and return tailored codes; (2) mime-vs-magic authority is now unambiguous (“bytes only; declared MIME ignored after buffering”) and AC #8’s mismatch test now matches that policy (expects 200 with PDF parsing when bytes are %PDF); (3) parser-vs-route test layering is clarified (parser tests can’t observe declared MIME); (4) a concrete ordering-preservation contract is added and pinned by tests for both PDF and image branches; (5) HEIC brand list is expanded and the test mandate now requires multiple brands.

However, there are two remaining spec-level contradictions/ambiguities that could cause an implementer to reintroduce the original bugs (especially #1) or implement the MIME filter incorrectly. Verdict: NEEDS-CHANGES (spec text fixes), not because the core policy is wrong, but because the doc still contains conflicting implementation instructions.

Overall risk: medium

## Findings

1. [medium] MIME pre-filter step says “extract main-type” but then compares against full MIME strings (ambiguous and easy to implement incorrectly)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:94-99
   - Confidence: high
   - Why it matters: Risk Acceptance §8 step 3 says: “extract main-type, lowercase” but then lists values like `application/pdf`, `image/jpeg`, etc. “Main-type” normally means just `application` / `image`, which—if implemented literally—would either (a) accept all `image/*` (defeating the intended `wrong_mime` behavior for AVIF/TIFF/BMP/SVG) or (b) reject legitimate full types due to comparing unlike strings. This is exactly the kind of small wording mismatch that creates regressions at the gatekeeping validation layer.
   - Suggested fix: Change the wording to something implementable and unambiguous, e.g. “extract the full MIME type (type/subtype), lowercase, trim; accept if it equals one of: …”. If you truly mean class-level filtering, then list `image/*` explicitly and update the promised error-code behavior accordingly (but that would be a policy change).

2. [medium] Tasks section contradicts AC/Risk Acceptance about widened MIME allowlist (“4 image MIMEs” vs including HEIC/HEIF/GIF)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:236-242
   - Confidence: high
   - Why it matters: Task 7.1 says “Widen the MIME accept-list to include the 4 image MIMEs” (line 237), but the actual required allowlist (Risk Acceptance §8 step 3; AC #5) includes **7** image MIMEs: jpeg/jpg/png/webp/heic/heif/gif. A dev agent following Tasks more than ACs could reintroduce Round-1 HIGH #1 (HEIC/GIF friendly error codes become unreachable because HEIC/GIF get rejected at the MIME stage).
   - Suggested fix: Update Task 7.1 to explicitly name the full allowlist (or reference AC #5 verbatim). Also consider removing the “4” phrasing anywhere else so it can’t drift out of sync again.

3. [low] HEIC brand expansion is asserted but not grounded with a verifiable in-spec mapping (risk of over/under-classification remains)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:53-62
   - Confidence: medium
   - Why it matters: The spec now includes `hevx`, `hevm`, `hevs` in the major-brand list (line 59) and cites ISO specs, but doesn’t include enough detail to verify that these brands correspond to the intended iPhone-origin still-image HEIC/HEIF cases (vs e.g. other ISO-BMFF/HEVC-family files). If any of these are not actually “HEIC still image” in practice, the API may return `unsupported_mime_heic` for non-HEIC payloads, nudging the frontend to attempt HEIC→JPEG conversion unnecessarily (confusing UX). This is a low-severity correctness/UX risk since the endpoint rejects the payload either way; it’s mainly about returning the most accurate tailored code.
   - Suggested fix: Tighten the wording to “HEIF-family (HEIC/HEIF) major brands” and add a short note of observed real-world provenance for each added brand (e.g., “seen from iOS X exports”) or constrain the list back to the most defensible/common (`mif1/msf1/heic/heix/hevc/hevx`) if you can’t justify `hevm/hevs`. Keep the ≥2-brand fixture requirement.

## Strengths

- Round-1 HIGH #1 closure is real: HEIC/HEIF/GIF are now explicitly allowed through the MIME pre-filter so magic-byte detection can return `unsupported_mime_heic` / `unsupported_mime_gif` (Risk Acceptance §8; AC #5).
- Round-1 HIGH #2 closure is real: the spec now states a single, implementable policy (“detectContentKind uses bytes only; declared MIME ignored after buffering”), and AC #8’s mismatch test now asserts the matching behavior (200 with PDF parse when bytes are %PDF).
- Parser-vs-route test layering is clarified: parser tests no longer pretend to cover declared-MIME mismatch, and route tests own that responsibility (Risk Acceptance §7; AC #7/#8).
- Ordering regression risk is now mechanically guarded: AC #2 defines a preservation contract and AC #7 pins content-block ordering for both PDF default and image branches.
- HEIC brand list expansion plus the “≥2 distinct brands” fixture mandate improves resilience against iOS variant drift relative to Round-1.

## Warnings

None.
