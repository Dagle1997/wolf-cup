# Codex Review

- Generated: 2026-05-01T16:21:46.426Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T5-8-round-lifecycle-state-machine-party-review.md, _bmad-output/reviews/T5-8-round-lifecycle-state-machine-impl-codex-rerun.md, apps/tournament-api/src/routes/round-lifecycle.ts, apps/tournament-api/src/services/round-state.ts, _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md

## Summary

From the provided files, the major correctness fixes claimed by the party review are largely present (idempotent 200 paths are behind in-tx auth checks; /finalize sources finalizedAt from round_states.entered_at after transitionState). However, there are two concrete drifts/bugs visible in the current code: (1) all lifecycle handlers still throw/branch on `round_state_missing` before authorization, which contradicts the party review’s repeated “auth-first” characterization and allows existence/state probing; and (2) `/complete` can throw a 404 but the error body labels it as `unprocessable`, which is an inconsistent/incorrect response shape for 404.

I cannot verify claims about tests (counts, specific assertions) because the referenced test files are not included in the provided contents.

Overall risk: medium

## Findings

1. [medium] Lifecycle endpoints still reveal `round_state_missing` before auth (state/existence probing) despite “auth-first” claims
   - File: apps/tournament-api/src/routes/round-lifecycle.ts:98-115
   - Confidence: high
   - Why it matters: All shown handlers read state and throw `round_state_missing` (422) before authorization. For an authenticated-but-unauthorized caller, this allows distinguishing “round has a round_states row” (403) vs “no round_states row” (422), which is an information leak. It also contradicts the party review’s repeated statement that auth runs first / before state-driven branching (it only runs before the *idempotent 200* path, not before all state/existence checks). This is the same residual called out in the impl-codex rerun report.
   - Suggested fix: If you want strict “no existence/state signal before auth,” reorder to do auth checks first using joins that naturally return false when the round doesn’t exist, and only then call `getRoundState` / return state-specific 422s. If you intentionally want 422 round_state_missing regardless of auth, document that rationale and align the party/spec wording accordingly.

2. [medium] `/complete` can return HTTP 404 with body.error = 'unprocessable' (incorrect/inconsistent error shape)
   - File: apps/tournament-api/src/routes/round-lifecycle.ts:136-190
   - Confidence: high
   - Why it matters: Inside `/complete`, `getRoundContext` null triggers `BusinessRuleError('round_not_found', ..., 404)` (lines 136-140). The catch block returns `err.status` (including 404) but sets `error` to `'unprocessable'` for any non-403 status (lines 181-190). That yields a 404 response whose body claims `error: 'unprocessable'`, inconsistent with `/finalize` (which maps 404 → `not_found`) and likely confusing for clients that branch on `error`.
   - Suggested fix: Update `/complete`’s catch mapping to treat 404 as `error: 'not_found'` (like `/finalize` does), or stop throwing 404 from `/complete` if it’s meant to always be a 422/403 surface.

## Strengths

- Idempotent 200 paths for /complete, /finalize, and /cancel are now gated behind in-transaction auth checks (no repeat of the earlier auth-bypass via idempotent branch).
- /finalize re-reads `round_states.entered_at` after `transitionState` and uses it as the response’s canonical `finalizedAt`, aligning first-call and idempotent-call behavior in the normal case.
- `transitionState` implements a race-safe conditional UPDATE on the state column and centralizes the `not_started → in_progress` opened_at side effect plus audit logging.

## Warnings

None.
