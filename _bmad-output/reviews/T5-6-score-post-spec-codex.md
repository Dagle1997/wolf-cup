# Codex Review

- Generated: 2026-04-28T15:25:16.146Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md

## Summary

Spec is mostly implementable and test-driven, with clear path-allowlist compliance and a strong focus on single-writer enforcement + idempotency. The main issues are internal inconsistencies (error-path counts, middleware 403-code branching, body-parse validation split), and a few underspecified precedence/parameter-validation behaviors that could yield divergent implementations or mismatched tests.

Overall risk: medium

## Findings

1. [high] Middleware 403-code behavior is internally inconsistent (step 7 vs cross-foursome requirement)
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:57-66
   - Confidence: high
   - Why it matters: In §3 step 7, any scorer mismatch returns `not_scorer_for_this_foursome` (line 60). But immediately after, the spec requires a distinct `player_not_in_your_foursome` when the session user is a scorer for a different foursome (lines 62–66). Without a precise algorithm (e.g., an additional query to check whether session.userId is scorer anywhere in this round), different devs can implement different branching, causing client UI and tests (AC #5) to fail or become flaky.
   - Suggested fix: Explicitly specify the branching algorithm in the middleware section: (1) resolve target foursome via body.playerId; (2) fetch target foursome’s scorer; (3) if mismatch, also check whether session.userId is scorer for any foursome in this round; then choose `player_not_in_your_foursome` vs `not_scorer_for_this_foursome`. Update §3 step 7 text to match this and remove the contradictory single-code description.

2. [high] Error taxonomy count and labeling contradict the table contents ("8 distinct paths" but table lists more)
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:296-311
   - Confidence: high
   - Why it matters: The section title claims “8 distinct paths” (line 296), but the table includes 200, 201, two 422s, two 404s, a 409, another 422, two 403s, and a 400 (lines 300–310) — i.e., 11 rows. This mismatch can propagate into acceptance criteria, test planning, and reviewer expectations (your review request also mentions 11).
   - Suggested fix: Rename the section to the correct count and ensure the ACs/tests enumerate the same set. If the intended number is 8, remove/merge rows and specify how invalid-body vs invalid-player-id should be categorized.

3. [high] Missing/underspecified 400 behavior for invalid path params (roundId/holeNumber) and precedence vs middleware errors
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:84-86
   - Confidence: high
   - Why it matters: The spec says roundId/holeNumber are validated (lines 84–85) but the taxonomy table does not include explicit codes for invalid roundId or holeNumber, and AC #7’s integration tests don’t cover invalid params. Additionally, middleware runs before the handler (line 72), so malformed params or non-existent rounds could yield confusing/incorrect errors (e.g., middleware returning `player_not_in_any_foursome` when roundId doesn’t exist). Different implementations may validate in different layers, breaking clients and tests.
   - Suggested fix: Add explicit 400 codes for invalid `roundId` and invalid `holeNumber` (and whether holeNumber must also respect `rounds.holes_to_play`). Specify error precedence: e.g., validate params before middleware runs (or inside middleware for roundId), and ensure non-existent round produces `round_not_found` rather than a player/foursome error.

4. [medium] Body validation split between middleware and handler is inconsistent with taxonomy; could yield divergent 400 shapes
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:74-82
   - Confidence: high
   - Why it matters: The handler uses Zod validation for the full body (lines 74–82), but AC #1 requires the middleware to return 400 `invalid_player_id` if body.playerId missing/non-UUID (lines 329–330). Meanwhile, the taxonomy table lists “Invalid body | 400 | (Zod error)” (line 310) and does not mention `invalid_player_id`. This creates ambiguity about which layer owns body validation and what error shape the client should expect.
   - Suggested fix: Define a single canonical 400 error format for body validation. Either: (a) middleware does minimal parse and defers all validation to handler (so Zod owns 400), or (b) middleware validates playerId via a shared Zod schema and handler reuses the parsed/validated body (e.g., via `c.set`). Update taxonomy accordingly.

5. [medium] Hono body-cache reliance is treated as “safe” but ACs require it; should mandate a fallback mechanism
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:54-55
   - Confidence: high
   - Why it matters: The spec asserts Hono caches `c.req.json()` and calls it “safe” (line 54), while later acknowledging it as an integration risk requiring verification and potentially a fallback (`c.set('parsedBody', ...)`) (lines 292–295, 459–460). AC #1 currently hard-requires relying on the cache (line 329). If cache semantics differ by runtime, Hono version, or body stream handling, this can break scoring in production.
   - Suggested fix: Change AC #1 to require either (1) verified cache behavior via a dedicated test, OR (2) explicitly storing the parsed body on context in middleware and having handler read from there (preferred for robustness). Make the body-cache test an explicit named test in AC #7.

6. [medium] Auto-complete logic does not specify whether holeNumber must be ≤ rounds.holes_to_play, risking “extra holes” writes affecting completion
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:84-85
   - Confidence: high
   - Why it matters: You validate holeNumber 1–18 (line 84–85) but do not state whether POSTing hole 10 in a 9-hole round should be rejected. The completion logic filters `actualCount` by `hole_number <= holesToPlay` (lines 177–180), which prevents premature completion, but it still allows persisting out-of-scope hole scores unless separately blocked. That could create data integrity issues and complicate later correction/finalization flows.
   - Suggested fix: Add an explicit rule and test: if `holeNumber > rounds.holes_to_play`, return 422/400 with a specific code (e.g., `hole_out_of_range_for_round`). Alternatively, clamp allowed holeNumber range dynamically per round rather than 1–18.

7. [medium] `computeExpectedCells` definition and usage are slightly inconsistent/ambiguous (round variable, count_for_round meaning)
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:273-290
   - Confidence: medium
   - Why it matters: The helper sketch uses `round.eventRoundId` and `round.holesToPlay` (lines 283–288) but earlier the transaction code refers to `roundRows[0]` (lines 157–180). Also, the prose says `pairing_members.count_for_round` is “number of distinct players across all foursomes for this round” (line 275–276), but the query counts distinct players across pairings for the event_round_id (lines 278–286). If there are any edge cases where pairings exist for the event round but are not part of this round instance (or if multiple rounds share an event_round_id), implementers may diverge.
   - Suggested fix: Define the exact SQL/Drizzle query against the canonical key(s) (roundId vs eventRoundId) and ensure variable naming matches the transaction sketch. Add an explicit test seed ensuring expected count equals (players in the round) × holesToPlay and does not accidentally include other pairings.

8. [medium] Conflict path fetch assumes existing row always present; spec does not define fallback if it’s missing
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:118-135
   - Confidence: medium
   - Why it matters: On unique constraint error, the handler fetches the “existing” row and immediately indexes `existing[0]` to build `conflictingEntry` (lines 120–133). In normal conditions it should exist, but the spec doesn’t define what to do if it doesn’t (e.g., concurrent delete in future stories, or a mismatch in which unique constraint fired). This can turn a controlled 409 into an unhandled 500.
   - Suggested fix: Specify: if the follow-up select returns no rows, return a generic 409 without `conflictingEntry`, or return 500 `conflict_lookup_failed` with requestId. Also recommend checking which unique index fired if the DB exposes that detail.

9. [low] Tenant scoping wording uses both TENANT and TENANT_ID; could cause implementation drift in security-critical filters
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:99-101
   - Confidence: medium
   - Why it matters: The transaction sketch uses `eq(rounds.tenantId, TENANT)` (line 100) while later the spec says `tenant_id = TENANT_ID` (line 314). In security-sensitive code, inconsistent naming increases the chance of a missed filter or using the wrong variable/constant. Even if your codebase has a standard tenant accessor, the spec should be unambiguous.
   - Suggested fix: Standardize on one identifier name in the spec (TENANT_ID) and state where it comes from (e.g., env/config or session context). Add a test for middleware tenant scoping too (not just handler defense-in-depth).

10. [low] `emitActivity` stub forward-compat: spec claims T8 can change only the function body, but signature stability is not actually enforced across stories
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:252-266
   - Confidence: medium
   - Why it matters: The stub comment says T8 changes ONLY the function body (lines 253–257), but later acknowledges signature could change and would break call sites (lines 465–466). The “type-shape contract” is only implicitly enforced by a local test (line 271–272, 404–406). Without exporting a shared type (or pinning the signature in an interface used by both stories), T8 can inadvertently break T5-6+ call sites.
   - Suggested fix: Export an `ActivityEvent` type (or similar) from `lib/activity.ts` and require call sites/tests to use it. Update the comment to avoid promising “only body changes” unless the signature is treated as a public contract.

## Strengths

- Clear statement of single-writer enforcement boundary and its pairing with the write endpoint (lines 9–14).
- Good idempotency design tied to T5-1 dual-UNIQUE with explicit 200 replay vs 409 collision behavior (lines 103–142, 345–350).
- Inline state-transition approach is explicitly marked as temporary with a planned T5-8 extraction and call-site stability intent (lines 43–45, 160–191, 453–454).
- Strong test-floor discipline: enumerated tests match the net +18 requirement (lines 373–406).
- Path footprint is constrained to tournament-api with explicit zero-shared/zero-wolf-cup edits (lines 19–36, 419–424).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md
