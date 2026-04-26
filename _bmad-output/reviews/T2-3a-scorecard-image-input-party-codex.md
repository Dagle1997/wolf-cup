# Codex Review

- Generated: 2026-04-26T17:39:41.813Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T2-3a-scorecard-image-input-party-review.md, _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md, apps/tournament-api/src/lib/course-parser.ts, apps/tournament-api/src/routes/admin-courses.ts

## Summary

Verdict: PASS-with-Lows.

Core T2-3a implementation shown in the provided diff/files appears to meet the spec’s functional requirements (magic-byte detection, soft MIME allowlist, magic-wins policy, parser content-block branching, prompt +1 paragraph, and success log `inputKind`). No mechanically-fixable High/Med issues are evidenced in the provided code.

However, multiple party-review statements about *test counts* and detailed *coverage inventory* cannot be verified from the provided diff/file contents (no test files or test output included here). Those claims should be treated as “not provable from evidence in this review packet,” not as confirmed facts.

Overall risk: low

## Findings

1. [low] Party-review claims about test counts/coverage are not verifiable from the provided diff/file contents
   - File: _bmad-output/reviews/T2-3a-scorecard-image-input-party-review.md:47-83
   - Confidence: high
   - Why it matters: Director step 9 asks to verify factual accuracy. In the evidence provided here, only `course-parser.ts` and `admin-courses.ts` changes are shown; no `*.test.ts` or snapshot diffs are included. That means claims like “23 new tests”, “29 total tests covering the T2-3a surface”, and specific gap assertions (e.g., missing `inputKind` log assertion) cannot be confirmed against actual test code or test runner output within this review packet.
   - Suggested fix: If you need these claims to be auditable at this step, include either (a) the diffs for `apps/tournament-api/src/lib/course-parser.test.ts`, `apps/tournament-api/src/routes/admin-courses.test.ts`, and the snapshot file, or (b) a pasted `pnpm -F @tournament/api test` summary output showing counts plus the relevant test file excerpts for the coverage assertions.

## Strengths

- `detectContentKind(bytes)` is bytes-only and matches the spec’s detection signatures/order; returns a discriminated union (`MagicByteResult`) suitable for clean routing decisions (course-parser.ts:54-160).
- Route correctly implements the “soft MIME pre-filter” allowlist and then treats magic bytes as authoritative, ignoring declared MIME after buffering (admin-courses.ts:100-152).
- Friendly error codes for HEIC/GIF are reachable because those MIMEs are included in `ACCEPTED_MIMES` (admin-courses.ts:46-57, 107-146), which directly corroborates the round-1 HIGH resolution.
- `parseCoursePdf` preserves the `[discriminator-block, text-block]` content ordering for both PDF and image paths and defaults `contentKind` to `{ kind: 'pdf' }` for backward compatibility (course-parser.ts:406-494).
- `vision_parse_success` log includes the required `inputKind` field (admin-courses.ts:191-198), satisfying AC #6 at the code level.
- The route’s switch over `detected.kind` has no `default` and (given `let` variables used afterward) relies on TS definite-assignment analysis to enforce exhaustiveness; adding a new `MagicByteResult` variant should force a compile-time update. This corroborates the Dev agent’s exhaustiveness claim (admin-courses.ts:125-158).

## Warnings

None.
