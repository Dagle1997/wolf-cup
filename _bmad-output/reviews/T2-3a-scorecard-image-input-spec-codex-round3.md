# Codex Review

- Generated: 2026-04-26T17:12:18.998Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md, _bmad-output/reviews/T2-3a-scorecard-image-input-spec-codex.md, _bmad-output/reviews/T2-3a-scorecard-image-input-spec-codex-round2.md

## Summary

Round-2 MED fixes appear genuinely closed: (1) MIME pre-filter now unambiguously extracts the full `type/subtype` via `split(';')[0].trim().toLowerCase()` and the allowlist values match that; (2) Task 7.1 now enumerates the full set of 3 existing + 7 new MIME entries, consistent with AC #5 and Risk Acceptance §8 step 3.

One new coherence issue remains: Risk Acceptance §7 mandates a WebP route test, but AC #8’s enumerated route-test list omits WebP (replacing it with the “magic wins” mismatch test). That inconsistency can yield an implementation with an untested WebP path while still “passing AC”.

Verdict: NEEDS-CHANGES (mechanical spec/text fix).

Overall risk: medium

## Findings

1. [medium] WebP route-test coverage required in Risk Acceptance, but missing from AC #8’s route-test list (spec inconsistency)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:86-182
   - Confidence: high
   - Why it matters: Risk Acceptance §7 explicitly calls out “≥5 new route tests” including **WebP happy path** (lines 88–90). However, AC #8’s concrete list of “at least 5 new tests” does **not** include a WebP happy path; it includes JPEG, PNG, HEIC rejection, GIF rejection, and a MIME-vs-magic “magic wins” test (lines 173–182). A dev agent typically treats ACs as the binding checklist; this mismatch makes it plausible to ship WebP support (or changes to it) without the intended route-level test protection, even though WebP is a supported `MagicByteResult` and a required success path elsewhere.
   - Suggested fix: Make Risk Acceptance §7 ↔ AC #8 consistent. Easiest: add a **WebP happy path end-to-end** bullet to AC #8 and keep the “magic wins” mismatch test as a 6th test (AC already says “at least 5”). Alternatively, if you want exactly 5, replace one bullet with WebP and ensure the “magic wins” policy is pinned elsewhere (but current spec clearly wants that pinned at the route level).

2. [low] HEIF is allowed through MIME pre-filter but only HEIC/GIF have explicit magic-result + error-code mapping (minor ambiguity)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:28-157
   - Confidence: medium
   - Why it matters: The MIME pre-filter allowlist includes `image/heif` (lines 96–99, 149–152), but `MagicByteResult` and the route’s explicit error-code mapping only name `unsupported_image` mimes `image/heic` and `image/gif` (lines 45–47, 144–145, 155–157). In practice you likely intend HEIF uploads to produce the same friendly `unsupported_mime_heic` code (since both require client-side conversion), but that is implied rather than stated. An implementer could mistakenly add a separate code, reject HEIF at MIME stage, or treat it as `wrong_magic` depending on how they interpret “HEIC detection.”
   - Suggested fix: Add one explicit sentence in Risk Acceptance §2/§8 and/or AC #5 clarifying the intended contract for HEIF: e.g., “HEIF uploads (declared `image/heif` or detected via ftyp brands) return `unsupported_mime_heic` (single code for the HEIF/HEIC family).” If you actually want a distinct `unsupported_mime_heif`, update `MagicByteResult`, AC #5, and tests accordingly.

## Strengths

- Round-2 MED #1 is clearly closed: MIME extraction is now described as full `type/subtype` normalization, and the allowlist matches exact strings (lines 96–99).
- Round-2 MED #2 is clearly closed: Task 7.1 enumerates all 10 MIME allowlist entries and cross-references AC #5 / Risk Acceptance §8 step 3 (lines 236–238).
- End-to-end policy is now largely coherent: magic-byte detection is consistently described as authoritative after buffering, and AC #8’s “MIME-image-but-magic-PDF” test pins that behavior (lines 94–107, 173–182).
- Ordering-preservation contract is explicit and test-pinned for both PDF-default and image branches, reducing regression risk to the already-tested PDF path (lines 126–130, 167–170).

## Warnings

None.
