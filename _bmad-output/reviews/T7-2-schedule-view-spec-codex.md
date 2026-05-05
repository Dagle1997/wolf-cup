# Codex Review

- Generated: 2026-05-05T00:07:26.798Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-2-schedule-view.md

## Summary

Spec is mostly implementable and stays within the allowed path footprint, but it contains a few internal contradictions/ambiguities that are likely to cause incorrect behavior (especially around `pairing === null` semantics, FR-H6 visibility vs “viewer-only” scoping, and the “groupedByDate rendering hint” that’s referenced but not defined in the response contract). Tightening those areas will prevent mismatched API/UI behavior and misleading UX.

Overall risk: medium

## Findings

1. [high] `pairing === null` collapses two distinct states, but UI text assumes only one (“Pairings not set yet”)
   - File: _bmad-output/implementation-artifacts/tournament/T7-2-schedule-view.md:59-88
   - Confidence: high
   - Why it matters: AC-1/AC-2 define `pairing: … | null` where null can mean either (a) pairings not created for the round yet, or (b) pairings exist but the viewer is not assigned (subbed out, omitted, etc.). AC-4 then mandates rendering the placeholder text “Pairings not set yet” whenever `pairing === null`. That would be misleading in case (b), and it also makes it impossible for the client to display a correct state (“You are not assigned to a foursome for this round”). This ambiguity will also complicate tests: your API test case “round with no pairing for viewer” (line 98) could be interpreted either way, but the UI expectation (line 87) assumes one specific meaning.
   - Suggested fix: Split the state explicitly in the API contract, e.g. `pairingStatus: 'assigned' | 'unassigned' | 'not_set'` plus `pairing?: …` (or `pairing: … | null` + `pairingReason: 'not_set' | 'viewer_unassigned'`). Update AC-4 placeholder copy to depend on the status. If you intentionally want to keep `null` only for “not set”, then add a separate representation for “viewer unassigned” (and specify how the API detects “pairings exist”).

2. [high] FR-H6 statement (“pairings ARE shared event-wide”) conflicts with AC-2 (“viewer’s foursome only”) and story intent
   - File: _bmad-output/implementation-artifacts/tournament/T7-2-schedule-view.md:25-74
   - Confidence: high
   - Why it matters: Line 27 asserts: “Other players' pairings are visible (FR-H6 explicit: pairings ARE shared event-wide)”. But AC-2 explicitly scopes the response to ONLY the viewer’s foursome for each round. Those can both be true as a product decision (participants may be allowed to see all pairings, but v1 chooses not to return them), but the spec currently reads like a policy statement (visibility model) that contradicts the endpoint behavior. This is especially important for security reviews: implementers may incorrectly conclude they must return all pairings to satisfy FR-H6, or conversely that returning only viewer pairing is a permission constraint rather than a v1 trim.
   - Suggested fix: Clarify that FR-H6 permits event-wide viewing, but v1 endpoint intentionally returns only viewer’s pairing as a product/data-minimization choice (not a permission restriction). Consider adding an explicit non-goal note: “v1 does not expose other foursomes; follow-up T7-2c will.”

3. [medium] `groupedByDate` is referenced as an API output (“rendering hint”) but is not defined in the response schema
   - File: _bmad-output/implementation-artifacts/tournament/T7-2-schedule-view.md:20-65
   - Confidence: high
   - Why it matters: In “What v1 ships” (line 22) the backend is said to return a `groupedByDate` rendering hint. But AC-1’s TypeScript response shape has only `event` and `rounds` and no `groupedByDate`. This mismatch will lead to either unused backend work, frontend guessing, or tests that don’t match the agreed contract.
   - Suggested fix: Either (a) remove `groupedByDate` mention and standardize on grouping by `roundDate` alone, or (b) add `groupedByDate` (or `dateGroups`) to AC-1 with an explicit structure (e.g., `{ date: roundDate, roundIds: [...] }`).

4. [medium] No-existence-leak requirement for “malformed eventId” is underspecified and may be impossible at router/validation layer without guidance
   - File: _bmad-output/implementation-artifacts/tournament/T7-2-schedule-view.md:75-103
   - Confidence: medium
   - Why it matters: AC-3 requires malformed `:eventId` to return 403 `not_event_participant` to avoid 404 leakage. Depending on how `eventId` is parsed (UUID validator, zod schema, route param constraints), malformed values often trigger 400 (bad request) or a framework-level 404 before your handler runs. Without specifying where/ how to coerce errors into 403, different implementations may violate this invariant, and tests may be flaky or hard to implement.
   - Suggested fix: Add an explicit rule: “All `eventId` parse/validation failures must be caught and mapped to 403 `not_event_participant` (do not allow 400/404).” If this is a cross-app invariant, reference the existing T7-1/money/bets implementation pattern concretely (e.g., ‘use parseEventIdOrNull and treat null as not_event_participant’).

5. [medium] Same-day grouping requirement is directionally correct but missing a precise grouping key / ordering rule within a date
   - File: _bmad-output/implementation-artifacts/tournament/T7-2-schedule-view.md:55-89
   - Confidence: medium
   - Why it matters: AC-1 defines `roundDate` as “ms-since-epoch (event-tz local-day-start, per T7-1 convention)” and AC-4 requires grouping multiple rounds sharing the same `roundDate` under one header. However, it doesn’t explicitly say whether the client must group by the provided `roundDate` value (recommended) vs re-derive local-day-start from some other field. It also doesn’t specify ordering of rounds within the same date group (by `roundNumber` asc is implied globally, but grouping UIs sometimes sort within each group). DST boundaries and timezone conversions are common sources of subtle bugs if the grouping key is recomputed.
   - Suggested fix: Add an explicit instruction: “UI groups by exact equality of the `roundDate` number returned by the API; do not recompute.” Also state ordering: “Within each date header, rounds remain in `roundNumber` asc.”

6. [low] ACs don’t state what happens if `event.timezone` is missing/invalid, yet the UI must format dates in it
   - File: _bmad-output/implementation-artifacts/tournament/T7-2-schedule-view.md:49-110
   - Confidence: medium
   - Why it matters: AC-4 mandates `Intl.DateTimeFormat` with `event.timezone` “NEVER viewer's local”. If timezone is empty/invalid, browsers may throw RangeError or fall back to local time depending on usage. The spec doesn’t define whether timezone is guaranteed by schema/migrations, or what fallback behavior is acceptable.
   - Suggested fix: If timezone is guaranteed non-null/valid by DB constraints, state it. Otherwise add handling: API validates timezone and returns a 500/explicit error, or UI falls back to UTC with clear label (but that would violate “NEVER viewer local”).

## Strengths

- Clear v1 trims vs follow-ups, with concrete reasons (missing columns/routes) and explicit follow-up tickets.
- Path footprint is explicitly constrained to allowed directories and lists exact files to touch.
- Good attention to no-existence-leak behavior (403 for unknown/malformed) and alignment with prior routes (T7-1/money/bets/leaderboard).
- AC-6 includes meaningful test matrix (happy paths, scoping across rounds, auth failures, grouping, timezone formatting).
- Explicit cache-control (`no-store`) requirement reduces risk of stale schedule data on shared devices.

## Warnings

None.
