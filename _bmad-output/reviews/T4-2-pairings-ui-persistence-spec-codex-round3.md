# Codex Review

- Generated: 2026-04-27T21:22:05.546Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md

## Summary

Round-2 intent is mostly reflected (body_too_large precedence and lockedRounds semantics are now explicitly described), but there are two remaining spec-level ambiguities/contradictions that could reintroduce drift at implementation time: (1) middleware ordering isn’t fully specified relative to auth, so the “step #1 body_too_large” contract is not actually deterministic; (2) Regenerate button visibility is contradictory in two places. lockedRounds round_number→event_round_id mapping is clear, but only unambiguous if (event_id, round_number) is unique in event_rounds (not evidenced here).

Overall risk: medium

## Findings

1. [medium] body_too_large precedence still ambiguous unless bodyLimit is ordered before auth middlewares (requireSession/requireOrganizer)
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:66-75
   - Confidence: high
   - Why it matters: AC #3 codifies deterministic precedence with body_too_large as step 1 (lines 203-205), but the spec only says routes are gated by requireSession→requireOrganizer (line 74) and that POST endpoints have bodyLimit (line 74); it does not explicitly state mount order among these middlewares. If requireSession runs before bodyLimit, an anonymous/forbidden request with an oversized body will return 401/403 instead of body_too_large, violating the stated precedence contract (and your specific round-3 concern about T3-3/T3-9 patterns).
   - Suggested fix: Explicitly state middleware order for POST routes, e.g. `bodyLimit({maxSize})` mounted before any handler/body parsing (and clarify whether it is before or after auth; if you truly want body_too_large to win globally, it must run before requireSession/requireOrganizer too). Add/keep a test that sends >16KB body and asserts body_too_large even when unauthenticated/unauthorized, or scope the precedence contract to authenticated organizers only.

2. [low] Regenerate button visibility contradicts itself (unconditionally visible vs hide-if-engine-missing)
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:13-14
   - Confidence: high
   - Why it matters: Story preface says Regenerate is unconditionally available because T4-1 is shipped (line 13). But AC #6 says “Regenerate-unpinned button … HIDE if T4-1 not imported / available” (line 246). This is exactly the kind of doc drift that can cause implementation/test mismatch (and was noted as Low previously).
   - Suggested fix: Pick one rule and make both sections match. If T4-1 is guaranteed present (hard import), remove the hide-if-missing language from AC #6; if you want the UI to compile without engine, revert to conditional import/feature omission and update line 13 accordingly.

3. [medium] lockedRounds mapping is specified, but round_number→event_round_id resolution is only unambiguous if (event_id, round_number) is unique
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:117-121
   - Confidence: medium
   - Why it matters: You now precisely define lockedRounds as 1-indexed event_rounds.round_number and resolve via `SELECT id ... WHERE event_id AND round_number AND tenant_id` (lines 117-120). If event_rounds allows duplicate round_number rows per event (not evidenced here), that SELECT could return multiple ids, making replacement behavior nondeterministic (or error-prone).
   - Suggested fix: Confirm/point to an existing DB constraint/unique index on (event_id, round_number, tenant_id). If it doesn’t exist, add it (or adjust resolution to handle multiples deterministically + warn/fail). Add a test that ensures duplicates cannot exist / or that mapping is stable.

## Strengths

- lockedRounds semantics are now explicitly codified as 1-indexed round_number and include unknown-round handling + warnings (lines 117-120), reducing the prior “unspecified mapping” risk.
- Error precedence list is explicitly documented (lines 203-211) and calls out bodyLimit vs Zod ordering, which is the right direction for determinism—just needs the middleware-order clarification noted above.
- The spec anticipates the lockedRounds ‘no persisted pairings’ edge case with a warning rather than failing (lines 126-127), which is practical and testable.

## Warnings

None.
