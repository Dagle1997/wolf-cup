# Codex Review

- Generated: 2026-04-27T17:22:14.296Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md

## Summary

Spec is close to terminal-clean, and the R2 issues you listed appear addressed. One remaining contract-level inconsistency exists around the `Secure` cookie attribute (conditional vs unconditional), which will likely cause implementation/test ambiguity and CI brittleness.

Overall risk: medium

## Findings

1. [medium] Cookie `Secure` attribute is specified as conditional in §3 but unconditional in AC #4 + test expectations
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:61-172
   - Confidence: high
   - Why it matters: The spec currently says `Secure` is only added when `NODE_ENV === 'production'` (lines 61-68), but AC #4 requires `Secure` to be present when inspecting Set-Cookie (lines 169-172), and the backend test targets also call out asserting `Secure` in Set-Cookie (lines 105-106). In typical test/dev runs, `NODE_ENV` is often not `production`, so an implementation matching §3 will fail tests/AC as written, or an implementation matching AC will break local HTTP dev (the exact issue you said was fixed). This is a spec-level contradiction that will propagate into inconsistent behavior and brittle tests.
   - Suggested fix: Make AC #4 and the test targets explicitly conditional: e.g., "`Secure` present iff `NODE_ENV==='production'`". Then update the backend cookie-attribute test plan to either (a) set `process.env.NODE_ENV='production'` for the cookie-attribute assertions, or (b) assert `Secure` presence/absence based on `NODE_ENV` in the test. Also mirror this conditional wording anywhere else `Secure` is treated as required.

2. [low] Section §2 UPDATE branch omits `device_info` update that AC #3 requires
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:43-50
   - Confidence: high
   - Why it matters: In §2 the UPDATE branch describes updating `player_id` only (line 49), while AC #3 requires updating both `player_id` and `device_info` (line 157). This is minor, but it can cause implementation drift (especially if a developer follows §2 narrative rather than AC).
   - Suggested fix: Amend §2 UPDATE branch text to explicitly include updating `device_info = UA.slice(0,256)` (matching AC #3), or add a sentence saying "UPDATE player_id + device_info" to keep sections consistent.

## Strengths

- AC #3 now explicitly prevents cross-event UPDATE corruption by requiring `context_id === 'event:{currentEventId}'` before UPDATE; otherwise INSERT a new row (lines 156-164).
- Privacy constraint is clear: UA-only, no IP, truncated to 256 chars (lines 50, 155).
- Body size limit contract and error shape for bodyLimit onError are explicitly specified (lines 137-139, 109).
- Test plan includes dedupe across multiple groups and cookie refresh on UPDATE branch, which are common regression points (lines 106-109).

## Warnings

None.
