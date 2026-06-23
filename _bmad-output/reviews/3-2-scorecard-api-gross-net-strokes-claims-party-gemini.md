# Gemini Review

- Generated: 2026-06-23T13:55:39.961Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md, _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md

## Summary

The party review correctly identifies the architectural wins (e.g., reusing the money engine kernel to maintain stroke consistency) but fundamentally rubber-stamps a flawed deferral of cache headers and hallucinates implementation details regarding the test database. A critical missed risk is that deferring `Cache-Control: no-store` will break the live updating of the during-round board.

Overall risk: medium

## Findings

1. [medium] Must-Fix Masquerading as Followup: Cache-Control Deferral
   - File: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md:47
   - Confidence: high
   - Why it matters: The review accepts deferring `Cache-Control: no-store` to Story 3-3 because 'money isn't exposed yet'. However, this API serves highly dynamic during-round data (gross scores and claims) for a live board to be wired in 3-4. Without a `no-store` header, standard browser heuristics or intermediate CDNs will cache the GET requests, causing the live board to render stale data. This is a must-fix for the data API, regardless of whether money is present.
   - Suggested fix: Reject the deferral. Require the immediate addition of `c.header('Cache-Control', 'no-store')` to the scorecard route.

2. [medium] Review Hallucination: Test DB Strategy Falsified
   - File: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md:41
   - Confidence: high
   - Why it matters: The Dev review explicitly praises the use of a 'private `:memory:` test DB choice (after the temp-file timeout)'. This completely contradicts the Dev Agent record, which states it specifically built a 'per-pid temp-file libsql DB (not file::memory:?cache=shared)' to avoid known memory cache leaks. The reviewer hallucinated an inverse narrative to praise the code, proving a lack of rigorous artifact inspection.
   - Suggested fix: Correct the review to reflect and evaluate the actual implementation (a per-pid temp-file database), and warn reviewers against fabricating narratives.

3. [low] Incorrect Domain Validation: Plus-Handicap Net Calculation
   - File: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md:32
   - Confidence: high
   - Why it matters: The QA review asserts that clamping a plus handicap (`ch ≤ 0`) to 0 strokes (making net=gross) is 'correct'. In real golf, a plus handicap gives strokes back to the course, meaning their net score should be higher than their gross score on designated holes. While it is architecturally correct to inherit the engine's behavior (to maintain consistency), declaring the engine's flawed domain logic as 'correct' masks a latent bug that will disrupt competitive fairness in the Wolf game.
   - Suggested fix: Update the review to classify the 0-stroke clamping as a known limitation/bug inherited from the engine, rather than validating it as accurate golf rules logic.

4. [low] False Technical Assertion Regarding Hono Routing
   - File: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md:34
   - Confidence: high
   - Why it matters: The review claims 'path-shadowing is impossible under Hono segment matching'. Hono utilizes a Radix Trie, not literal segment-count matching. Path shadowing is absolutely possible in Hono (e.g., via greedy parameters). It does not occur here simply because the static path segments (`/players` vs `/holes`) differentiate the branches safely.
   - Suggested fix: Correct the technical justification to accurately cite Radix Trie node separation rather than declaring shadowing 'impossible'.

## Strengths

- Correctly highlights the architectural necessity of reusing the engine's stroke allocation to guarantee scorecard vs. money-net consistency.
- Validates the proper handling of the 3-3 money seam (`moneyNet: null`) without leaking dollars.
- Confirms the safety of the tenant-scoped lookups and participant auth boundaries.

## Warnings

None.
