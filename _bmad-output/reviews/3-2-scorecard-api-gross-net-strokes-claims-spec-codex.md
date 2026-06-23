# Codex Review

- Generated: 2026-06-23T13:14:48.034Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md

## Summary

Spec is largely implementable and stays within the tournament-api-only boundary, but a few areas remain ambiguous or risk producing silently misleading data: (1) the “no-pin” fallback can’t be detected by clients and may look like valid net scoring, (2) 9-hole selection is underspecified (front-9 only vs back-9), (3) the stroke-allocation helper import path is ambiguous and could violate layering/build constraints, and (4) several response-field presence rules (claims booleans, relativeStrokes optionality) are not fully pinned down, which can lead to inconsistent API output and brittle UI/tests.

Overall risk: medium

## Findings

1. [high] AC #6 “explicit, not silent” fallback is still silent to clients; net=gross may be misinterpreted as true net scoring
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:34-39
   - Confidence: high
   - Why it matters: AC #6 says the no-pin/null-CH behavior must be “explicit, not silent,” but the response shape (AC #1) contains no field that lets the consumer distinguish “proper pinned net” from “fallback net=gross.” In practice the UI will show a plausible netScore and stroke dots of 0, which looks like a real computed net and can mislead users for legacy/non-F1 rounds (the spec itself notes this risk in Forward concerns, lines 107–110). This is especially risky if this endpoint is later reused beyond the “during-round F1 only” context.
   - Suggested fix: Keep ScorecardHole as-is, but add an explicit top-level indicator alongside holes, e.g. `{ holes, handicapBasis: 'pinned_ch' | 'none' }` or `{ holes, isHandicapPinned: boolean }`, or at minimum return `relativeStrokes: null` (instead of 0) when no pin is available so the UI can show “net unavailable.” If you cannot change the response, tighten AC #6 wording to acknowledge it is silent-by-design and document a UI banner requirement in Story 3-4.

2. [high] AC #2 hole range assumes holes 1..holesToPlay; no spec for back-9 or non-1 start holes in 9-hole rounds
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:29-31
   - Confidence: medium
   - Why it matters: AC #2 hard-codes the returned holeNumbers to `1..holesToPlay`. If the product supports (now or later) a 9-hole round that plays holes 10–18 (back nine) or a shotgun/rotation start, this endpoint would return the wrong holes/par/si, and all scoring/claims would misalign. The spec doesn’t state “9-hole rounds always play holes 1–9,” and the current contract doesn’t allow expressing any alternate mapping.
   - Suggested fix: Confirm and document the invariant: either (A) rounds always play holes starting at 1, or (B) add/consult round metadata that defines the hole set (e.g. `startHole` / `holesPlayed` list). If (A), make it explicit in AC #2 and add a validation/500 with clear error when the course_holes available set doesn’t match `1..holesToPlay` (and test it).

3. [medium] Stroke-allocation helper import path is ambiguous and may force forbidden/unstable dependency on packages/engine internals
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:92-95
   - Confidence: high
   - Why it matters: AC #4 requires using an engine allocation (`getHandicapStrokes(ch, si)`), and the Dev Notes mention `packages/engine/src/stableford.ts` as the source (line 94) but also note tournament-api has a local helper (`engine/handicap-strokes.ts`). If tournament-api imports from `packages/engine/src/...` directly, that’s a layering/build risk (depending on workspace TS path config) and can implicitly couple this endpoint to engine source layout. The story also forbids editing `packages/engine/**` (line 102), so if the needed export isn’t available, devs may get stuck or be tempted to violate scope.
   - Suggested fix: Make the spec decisive: require using the in-app `apps/tournament-api/src/engine/handicap-strokes.ts` (or a public package entrypoint if one already exists) and prohibit deep imports from `packages/engine/src/**`. Add a small adapter function if needed so allocation uses pinned integer CH without recomputation.

4. [medium] Claims booleans are underspecified: “false/absent” ambiguity can lead to inconsistent API output
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:40-41
   - Confidence: high
   - Why it matters: AC #7 states: “A hole with no current claim returns all three flags `false`/absent.” That’s ambiguous: should the API always include `hasGreenie/hasPolie/hasSandie` as explicit booleans, or may it omit them? AC #1 says each ScorecardHole carries those fields (implying presence). Inconsistent presence causes fragile UI logic and brittle tests/typing (especially since the referenced web type marks these fields optional in Dev Notes, line 86).
   - Suggested fix: Choose one rule and lock it: either always include the three booleans (preferred for API stability) or always omit when false and document that the UI must treat undefined as false. Update AC #1/#7 accordingly and encode it in tests.

5. [medium] Course revision source is described as “pinned/effective” but join chain always uses event_rounds.courseRevisionId; clarify if pin-time course changes are possible
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:29-31
   - Confidence: medium
   - Why it matters: AC #2 says holes are sourced from the round’s “pinned/effective course revision,” but the specified join is `round → event_rounds.courseRevisionId → course_holes`. If the system ever allows changing `event_rounds.courseRevisionId` after round start, then pinned CH (AC #4) would apply to a potentially different stroke index table than the one used at pin-time, producing inconsistent relativeStrokes. If changes are impossible by design, the “pinned/effective” wording is confusing and invites incorrect future assumptions.
   - Suggested fix: Either (1) state explicitly that `event_rounds.courseRevisionId` is immutable once rounds exist / once pinned, or (2) if round_pin stores/should store the courseRevisionId used at pin-time, specify using that value for `course_holes` lookup.

6. [low] AC #2 and AC #10 mention missing course_holes is a 500 data error, but tests don’t require it
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:29-53
   - Confidence: high
   - Why it matters: AC #2 mandates a hard failure (500) if any in-play hole is missing in `course_holes`, but AC #10’s listed tests don’t include this case. Without coverage, it’s easy for an implementation to silently drop holes or fabricate defaults, contradicting AC #2 and potentially breaking UI assumptions (exactly N holes).
   - Suggested fix: Add a unit test (service-level) that seeds a course revision with a missing hole row within 1..holesToPlay and asserts a clear error/exception (and, if you wrap it at the route layer, that it becomes a 500).

7. [low] Auth semantics: ensure all membership checks are tenant-scoped, not just round lookup
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:44-49
   - Confidence: medium
   - Why it matters: AC #9 correctly tenant-scopes round resolution (line 46), but it doesn’t explicitly require tenant scoping for (a) event participant/organizer checks and (b) the “playerId is part of the round” check. If any of those queries are not tenant-filtered (or rely on globally unique IDs as an assumption), cross-tenant information leakage bugs become easier to introduce during implementation.
   - Suggested fix: Add explicit language to AC #9 / Task 2 that every DB query in auth checks (event membership, organizer exemption, pairing membership) must include `tenantId` constraints consistent with existing `scores.ts` patterns.

## Strengths

- Clear scope guardrails (tournament-api only, no schema/migrations, no cross-app imports) with an explicit edited-file list (lines 55–64, 101–105).
- Good reuse direction for existing claim folding via `deriveCurrentClaims` (AC #7; lines 40–41, 95–96), reducing correctness drift vs score-entry behavior.
- Good explicitness around unplayed holes vs played holes nullability (AC #3/#5) and moneyNet=null seam for Story 3-3 (AC #8).
- Auth expectations are mostly well-specified (requireSession, tenant-scoped 404, participant-or-organizer 403, player_not_in_round 404) and reference existing precedents in `scores.ts` / `require-event-participant.ts` (lines 44–49, 90–92).

## Warnings

None.
