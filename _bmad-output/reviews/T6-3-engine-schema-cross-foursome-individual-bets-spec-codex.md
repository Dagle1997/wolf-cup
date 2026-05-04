# Codex Review

- Generated: 2026-05-04T12:43:44.662Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md, apps/tournament-api/src/engine/handicap-strokes.ts, apps/tournament-api/src/engine/rules/press.ts, apps/tournament-api/src/middleware/require-event-participant.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/schema/events.ts, apps/tournament-api/src/db/schema/groups.ts, apps/tournament-api/src/lib/audit-log.ts

## Summary

The provided workspace snapshot contains the T6-3 spec document plus existing tournament-api code (handicap engine, press evaluator, requireEventParticipant middleware, schema barrel, audit-log helper). Since the new T6-3 files (bets schema, migration, engine, route, tests) are not included here, the review can only flag (a) ACs that are currently unmet in the shown code and (b) spec-to-existing-architecture conflicts that would prevent meeting the stated ACs (notably validation order vs middleware).

Overall risk: medium

## Findings

1. [high] AC-7/AC-12 validation-order requirement conflicts with current middleware behavior (eventId UUID validation cannot be first)
   - File: apps/tournament-api/src/middleware/require-event-participant.ts:42-83
   - Confidence: high
   - Why it matters: Your spec requires path UUID validation to run before other work (AC-7 step 1 / AC-12: “Validates path UUID + body Zod”). But the planned route is gated by `requireEventParticipant`, which immediately reads `:eventId` (line 55) and executes a DB query using it (lines 71–83). That means for an invalid/non-UUID `eventId`, the system will still hit the DB before any handler-level UUID validation can run. This is an AC compliance problem, and it can also create confusing error semantics (e.g., 403/422/500 depending on DB contents) instead of a deterministic 400 for invalid path params.
   - Suggested fix: Move `eventId` format validation into a middleware that runs before `requireEventParticipant`, or add UUID validation inside `requireEventParticipant` itself (before the DB query) and return a 400 invalid_path (or whatever your standard code is). Alternatively, relax the AC to allow “UUID validation occurs before handler logic” rather than “before all DB work,” but that would be a spec change.

2. [high] AC-3 audit constants (BET_CREATED / BET) are not present in current audit-log helper
   - File: apps/tournament-api/src/lib/audit-log.ts:23-40
   - Confidence: high
   - Why it matters: The spec/AC-3 requires adding `AUDIT_EVENT_TYPES.BET_CREATED = 'bet.created'` and `AUDIT_ENTITY_TYPES.BET = 'bet'`. In the provided file contents, `AUDIT_EVENT_TYPES` includes only scoring/round/ruleset events (lines 23–30), and `AUDIT_ENTITY_TYPES` does not include `BET` (lines 35–40). If the route is implemented without updating these constants, you’ll either (a) be forced to use string literals (fragmenting audit taxonomy) or (b) be unable to compile against the required constants.
   - Suggested fix: Add the two constants to `AUDIT_EVENT_TYPES` and `AUDIT_ENTITY_TYPES` (additive). Ensure any switch/validation logic elsewhere accepts them (if any exists). Add/adjust integration assertions accordingly.

3. [medium] AC-2 schema barrel re-exports for bets are not present in current schema index
   - File: apps/tournament-api/src/db/schema/index.ts:1-30
   - Confidence: high
   - Why it matters: The spec/AC-2 says `schema/index.ts` will re-export `individualBets`, `individualBetRounds`, `individualBetPresses` (and types). The provided file contents currently export existing domains only (players/auth/courses/events/groups/pairings/scoring/audit) and nothing bets-related. If the implementation forgets to update this barrel, downstream route code will either import from deep paths (inconsistent with repo conventions) or fail to compile.
   - Suggested fix: After adding `apps/tournament-api/src/db/schema/bets.ts`, export the new table objects and inferred types from `schema/index.ts` additively.

4. [medium] Spec has an internal naming/contract ambiguity: engine uses `startHole` while DB schema uses `fired_at_hole`
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:100-112
   - Confidence: high
   - Why it matters: In the spec SQL, `individual_bet_presses` stores `fired_at_hole` (line 104) but the engine `PressFireRow` shape uses `startHole` (lines 227–232). For auto-press, there are two distinct holes: the trigger hole (when the match reaches N-down) and the start hole (h+1 where the press begins). If `fired_at_hole` is intended to mean trigger-hole, the engine cannot reconstruct `startHole` without adding 1 (and would break the “trigger at hole 18 → no fire” rule). If it is intended to mean start-hole, the column name is misleading and will cause future confusion and bugs when T6-4 persists press rows on score commit.
   - Suggested fix: Clarify and align: either (A) rename the DB column to `start_hole` (preferred if migration can), or (B) keep `fired_at_hole` but explicitly define it as the press effective start hole and update comments/spec + route/T6-4 persistence accordingly. Also ensure UNIQUE/dedupe keys match what the engine returns.

## Strengths

- Existing T6-2 `evaluatePresses` implementation is defensively validated and deterministic (range checks, dedupe, fixed-point cap, deterministic sorting), which is a strong precedent for the planned T6-3 duplicated logic (apps/tournament-api/src/engine/rules/press.ts:202–377).
- `requireEventParticipant` is tenant-scoped on both joined tables and is explicit about middleware misuse modes (apps/tournament-api/src/middleware/require-event-participant.ts:23–37, 68–82), which is good security posture for the new bets route gates.
- `getHandicapStrokes` has strict stroke-index validation and plus-handicap clamping already implemented (apps/tournament-api/src/engine/handicap-strokes.ts:80–90), supporting the T6-3 engine’s net-score computation without new inline-port work.

## Warnings

None.
