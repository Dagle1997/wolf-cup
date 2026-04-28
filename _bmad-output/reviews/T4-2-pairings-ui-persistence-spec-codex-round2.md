# Codex Review

- Generated: 2026-04-27T21:20:55.427Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md

## Summary

Round-1 fixes appear to be reflected in this spec (canonical 422 conflicts payload shape, explicit locked-row preservation responsibility split, and “three endpoints” wording). A couple of remaining spec-level ambiguities could cause drift/implementation mismatch, mainly around error-precedence feasibility with body-size limits and the exact semantics/mapping of lockedRounds.

Overall risk: low

## Findings

1. [medium] Error-precedence step #2 (body_too_large) is likely not implementable after Zod invalid_body
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:198-207
   - Confidence: high
   - Why it matters: In most setups, a body-size limit is enforced by middleware before the request body is fully read/parsed, meaning you won’t reliably get a Zod validation error when the body exceeds the limit. The spec’s deterministic precedence (“invalid_body” first, then “body_too_large”) may be impossible or flaky in practice, which can break tests and client expectations.
   - Suggested fix: Clarify that `body_too_large` can preempt parsing/validation (and therefore should take precedence over `invalid_body`), or explicitly document how the server detects oversize bodies in a way that still allows Zod to run (uncommon). Adjust AC/test expectations accordingly.

2. [medium] lockedRounds semantics rely on stable server-side round ordering/mapping that isn’t fully specified
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:107-123
   - Confidence: medium
   - Why it matters: The contract says `lockedRounds` is “1-indexed” and then describes substituting persisted pairings into the engine output’s “matching round slot.” That requires an unambiguous mapping from “round N” to a specific `event_round_id` and to the engine grid index. If ordering differs (e.g., DB returns event_rounds unsorted, engine grid is 0-indexed, or the event has non-1..N roundNumbers), the server could substitute the wrong round’s persisted pairings.
   - Suggested fix: Specify that `lockedRounds` refers to `roundNumber` (not array index) and that the server must fetch `event_rounds` ordered by `round_number ASC` and map `roundNumber -> eventRoundId -> grid[roundNumber-1]` (or whatever the engine uses). Consider using `lockedEventRoundIds: string[]` instead to avoid index ambiguity.

3. [low] Minor drift/ambiguity: Regenerate button visibility described as unconditional in Story but conditional in AC
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:100-242
   - Confidence: high
   - Why it matters: The Story text says the button is “unconditionally available” due to hard-import (lines ~13, 101), while AC #6 still states “HIDE if T4-1 not imported / available” (line ~241). This is probably legacy wording, but it can confuse implementers/test writers about the required behavior.
   - Suggested fix: Align the AC with the Story decision: either remove the hide condition entirely (since the module must exist or build fails), or restate it as a purely hypothetical non-shipped scenario that is not applicable in this repo state.

## Strengths

- 422 conflicts payload is now consistently specified with canonical `{ playerId, eventRoundId, foursomeNumbers }` shape and ASC ordering (lines 53-65, 203-206, 256-257).
- Locked-row preservation responsibility split is explicit: server does no merge/preservation on upsert; client must replay locked rows verbatim on every save (lines 83-87).
- Risk §4 and ACs consistently state there are three endpoints under the existing `/api/admin/events` router (lines 66-73).
- lockedRounds edge case behavior is clearly defined (warn + keep engine output), and is covered by an explicit test requirement (lines 121-122, 268-269).
- Path allowlist/footprint is enumerated and plausibly complete for the described change set (lines 132-147).

## Warnings

None.
