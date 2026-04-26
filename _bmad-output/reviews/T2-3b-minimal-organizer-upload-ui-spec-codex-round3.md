# Codex Review

- Generated: 2026-04-26T17:53:04.017Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3b-minimal-organizer-upload-ui.md, _bmad-output/reviews/T2-3b-minimal-organizer-upload-ui-spec-codex-round2.md

## Summary

Round-3 spec review: The new 5-step auth-status loader contract closes the prior HIGH cleanly (it now covers network errors, non-ok HTTP, JSON parse failures, and unexpected shapes without relying on fetch throwing). The dual-export requirement (Route + UploadCoursePage) closes the prior MED and should not conflict with TanStack Router’s file-route generation conventions. One concrete internal contradiction remains in the Acceptance Criteria around how many API tests are added, which risks making the “baseline + N” gating uncheckable as written.

Overall risk: medium

## Findings

1. [medium] AC #5 vs AC #12 contradict on how many /api/auth/status tests are added (baseline +3 vs baseline +2)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3b-minimal-organizer-upload-ui.md:153-216
   - Confidence: high
   - Why it matters: AC #5 explicitly requires rewriting the existing status test and adding 3 new tests (anonymous, invalid session_id, organizer, non-organizer) (lines 155–160). Later, AC #12 asserts total tests are “baseline + 2” (line 215) and describes “2 new auth-status tests,” which conflicts with AC #5. This makes objective verification ambiguous and could cause a false acceptance/rejection depending on which AC is followed.
   - Suggested fix: Make the test-count delta consistent. Either (a) keep AC #5’s 4-case requirement and update AC #12 to “baseline + 3”, or (b) reduce AC #5’s required new tests to match “+2” (but that would drop coverage you previously called out as important, especially the invalid-session defense-in-depth case).

## Strengths

- The 5-step loader contract now explicitly handles the real fetch semantics (no throw on 4xx/5xx) and includes shape validation, closing the Round-2 HIGH without leaving obvious auth-status shapes that would still crash the loader (see §3 loader contract at lines 57–63).
- The dual-export mandate in AC #6 (Route + named UploadCoursePage) directly resolves the Round-2 MED testability gap; additional exports in a TanStack Router route module are generally compatible as long as `export const Route = ...` remains present (lines 162–167).
- Redirect URLs are consistently specified as same-origin relative (`/api/auth/google`), avoiding prod/local mismatch (lines 52–53, 170–173, 188–189).

## Warnings

None.
