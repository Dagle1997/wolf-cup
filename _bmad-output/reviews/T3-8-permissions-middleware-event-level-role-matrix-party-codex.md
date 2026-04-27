# Codex Review

- Generated: 2026-04-27T19:04:17.048Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T3-8-permissions-middleware-event-level-role-matrix-party-review.md, apps/tournament-api/src/middleware/require-event-participant.ts, apps/tournament-api/src/middleware/require-event-participant.test.ts, apps/tournament-api/src/middleware/require-invite-token.ts, apps/tournament-api/src/middleware/require-invite-token.test.ts, apps/tournament-api/src/types/hono.d.ts

## Summary

No concrete correctness/security blockers found in the provided middleware + tests. The main discrepancy is procedural: the provided git diff only shows a change to `hono.d.ts`, while the review narrative claims new middleware + 14 tests; either the diff is incomplete or the party review is describing a larger change-set than what’s actually in this diff. Test counts within the shown files match the party’s claimed 7+7=14.

Overall risk: low

## Findings

1. [medium] Potential review drift / incomplete diff: provided git diff only changes `hono.d.ts` but narrative claims multiple new/changed middleware + tests
   - File: (review packet):1
   - Confidence: high
   - Why it matters: Your questions (AC/test-count drift, path allowlist boundaries, accepted-but-not-implemented) depend on the actual change-set. With only `hono.d.ts` in the diff, it’s impossible to verify whether middleware/tests were truly added/modified in this PR, or if the party review is referencing work already merged elsewhere.
   - Suggested fix: Re-export a full `git diff` (or PR file list) that includes `require-event-participant.ts`, `require-invite-token.ts`, and both test files if they are part of this change. If they are already merged, adjust the party review/story linkage to avoid claiming test deltas for this PR.

2. [low] Invite token middleware distinguishes `invite_not_found` vs `invite_expired`, enabling token-state probing (low practical risk given high entropy)
   - File: apps/tournament-api/src/middleware/require-invite-token.ts:86-96
   - Confidence: medium
   - Why it matters: Returning different error codes for “exists but expired” vs “not found” can leak whether a token was ever valid. With 256-bit tokens this is not realistically brute-forceable, but it can matter if tokens are leaked/guessable in other ways (logs, referrers).
   - Suggested fix: If you want to harden, collapse both branches to a single 401 code (e.g. `invite_invalid`) or only reveal `expired` after additional proof (probably overkill for v1).

## Strengths

- `ContextVariableMap.invite` is correctly optional in `hono.d.ts`, preventing unsafe dereference on non-gated routes (apps/tournament-api/src/types/hono.d.ts:32-41).
- `requireEventParticipant` enforces tenant scoping on both joined tables and guards both missing `player` (misuse) and missing `eventId` (misuse) (require-event-participant.ts:46-66, 71-83).
- `requireInviteToken` has a cheap pre-DB shape guard (length + base64url charset) and tenant-scoped lookup before setting `c.set('invite', ...)` (require-invite-token.ts:63-99).
- Test files shown do contain 7 tests each (14 total), matching the party’s claimed split (require-event-participant.test.ts:116-246, require-invite-token.test.ts:84-197).

## Warnings

None.
