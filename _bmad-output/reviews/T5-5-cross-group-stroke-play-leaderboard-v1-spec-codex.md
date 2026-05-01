# Codex Review

- Generated: 2026-05-01T00:36:23.169Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md

## Summary

Spec is largely within the tournament allowlist and is detailed enough to implement, but it has a few correctness/architecture ambiguities that will likely surface during implementation: (1) event-scope tie-break semantics are underspecified/possibly incoherent across multiple rounds, (2) handicap/net math is likely not defensible vs known Wolf Cup behavior and needs explicit “provisional” handling (nulls, missing config), (3) tenant/context and round=current resolution rules are not fully specified, and (4) the Acceptance Criteria section’s “verbatim from epic” claim is likely inaccurate because it includes extra constraints and forward-dep language.

Net: medium risk of rework unless these are clarified before dev starts.

Overall risk: medium

## Findings

1. [high] Event-scope tie-break is ambiguous/likely incorrect across multiple rounds (back-9 + hole-by-hole from 18 backward)
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:69-80
   - Confidence: high
   - Why it matters: The spec says event-scope aggregates strokes across ALL rounds and then applies the same tie-break tuple including “back-9 (holes 10–18)” and “hole-by-hole from 18 backward” to the aggregated data (lines 75–80). With multiple rounds, there are multiple hole-18s and multiple “back 9s”; without defining a deterministic ordering (e.g., last round only, most recent in-progress round, or a flattened (roundIndex, holeNumber) sequence), different implementations will produce different rankings. This will especially matter in real events (multi-day), and will make the eventual T6-10 extraction brittle because the engine function will need a well-defined input model.
   - Suggested fix: Add explicit rules for event scope tie-break inputs:
- Define what “back-9” means across multiple rounds (e.g., only the most recent round’s holes 10–18; or the last 9 holes actually played in the event, regardless of round).
- Define the hole-by-hole comparison sequence for event scope (e.g., compare from the last hole of the most recent round backwards across that round, and only if still tied fall back to prior rounds; or disallow hole-by-hole for event scope and leave event ties shared).
- Add at least one acceptance test fixture for event-scope tie-break across 2 rounds to lock behavior.

2. [high] Handicap/net math is likely non-compliant with known Wolf Cup behavior and missing null/missing-config handling
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:81-88
   - Confidence: high
   - Why it matters: The spec derives “course handicap” as `players.handicap_index * handicapAllowance` with rounding and then allocates proportionally by holes played (line 85). This omits slope/rating/tee selection that you explicitly recall as important in Wolf Cup and “recently fixed” there. Additionally, required edge cases are not specified: `players.handicap_index` may be null; `event_rounds.rule_set_id` or `rule_sets.config_json` may be missing; config may omit roundingMode/handicapAllowance (defaults are stated, but missing row/null object isn’t). Without explicit rules, net ranking/values will be inconsistent and could break UI expectations.
   - Suggested fix: Either:
1) Declare net as “provisional v1” and specify strict fallback rules (recommended if deferring full USGA math):
- If handicap_index is null → `netThroughHole = null` (and clarify sorting: gross-only) OR treat handicap as 0.
- If rule_set/config missing → default allowance=1.0 and rounding=half-up (and specify how to detect missing).
- Clarify whether net affects ranking in v1 (spec currently implies ranking by gross tie-break only; make that explicit).
OR
2) Explicitly defer handicap math to a future rule-engine story and in T5-5 return net as null / omit the net column until the engine exists.
Also add at least one fixture covering null handicap_index and missing handicapAllowance.

3. [medium] Acceptance Criteria section claims “verbatim from epic” but includes forward-dep and additional constraints; cannot be simultaneously “verbatim” and expanded
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:95-117
   - Confidence: medium
   - Why it matters: The AC section states it is “Verbatim from epics-phase1.md … kept here as the contract” (lines 95–98), but it includes forward-dependency constraints about T6.10 delegation (line 105) and additional behavior statements (polling cadence, score commit propagation wording) that are unlikely to be literally present in an epic AC block. This matters because your explicit review focus is whether the “4 epic ACs” are faithfully reproduced; as written, the spec is asserting a provenance it likely doesn’t have, which undermines spec gate confidence and can cause disputes later (“the epic didn’t require X”).
   - Suggested fix: Change the wording to one of:
- “Derived from epic ACs (see …); additions noted inline” and annotate which lines are additions, or
- Actually paste the epic AC text as-is and move forward-dep/polling/extra constraints into a “Non-AC Implementation Notes” section.
Also explicitly enumerate/mapping: “Epic AC1..AC4 correspond to bullets A..D below” so the “4 ACs” check is mechanically verifiable.

4. [medium] Tenant/context requirement is asserted but service signature doesn’t specify how tenant_id is obtained
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:49-56
   - Confidence: medium
   - Why it matters: The spec requires `tenant_id = :TENANT_ID` on every query (line 190) and even shows SQL fragments using `:TENANT_ID` (lines 139–140), but `computeLeaderboard(eventId, opts)` does not accept a tenant identifier, and query services are described as “never import db for writes” but do import db for reads (lines 51–56). If tenant comes from request/session, that’s a layering concern (service reaching into request context) unless you already have a global tenant binding or db wrapper that injects tenant_id. Without clarification, implementation will likely either (a) violate the tenant isolation rule or (b) invent an ad-hoc way to fetch tenant from globals.
   - Suggested fix: Specify one supported pattern for tenant scoping in services, e.g.:
- `computeLeaderboard(ctx, eventId, opts)` where ctx includes tenantId, OR
- `dbTenant(tenantId)` helper returning a scoped Drizzle client, OR
- confirm single-tenant constant and where it is defined.
Add an AC or dev note that services must not read tenant from Express req directly (if that’s the intended layering).

5. [medium] `round=current` resolution rule is underspecified (ordering field) and “no rounds yet” behavior is not defined
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:111-163
   - Confidence: high
   - Why it matters: AC defines `round=current` as “most-recent in-progress (else most-recent complete_editable, else most-recent any-state)” (line 113), and tasks require implementing this via DB query (lines 155–161), but it does not define what “most recent” means (created_at? start_time? event_round sequence? id sort?). Also missing: what if the event exists but has zero rounds yet? Should it fall back to scope='event' with rows, return 404, or return `{round:null, scope:'round', rows:[]}`? This will otherwise be discovered mid-implementation and can cause API/UI mismatch.
   - Suggested fix: Define deterministic ordering (e.g., by `rounds.started_at DESC, rounds.created_at DESC` or by event_rounds.day_number then round number). Add explicit behavior for:
- event exists but has no rounds,
- event exists, has rounds, but none match the specified state(s).
Add an integration test for “event exists with zero rounds” and for the tie between multiple in-progress rounds.

6. [medium] Test plan undercovers event-scope aggregation and partial-hole tie-break behavior
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:127-154
   - Confidence: high
   - Why it matters: The 4 required fixtures (lines 127–130, 148–154) focus on round-scope and full 18-hole tie-break scenarios. There is no fixture that locks event-scope aggregation across multiple rounds (a core story goal) and no fixture clarifying tie-break when hole 18 (or back-9 holes) are unscored in a partial round. Without these, two reasonable implementations can both “pass” but rank differently in real mid-round usage.
   - Suggested fix: Add at least:
- A service-level fixture for `scope:'event'` aggregating 2 rounds (one complete, one partial) verifying `throughHole` sums correctly and ranking is deterministic.
- A partial-round tie-break fixture where tied players have not played holes 10–18 yet (define how back-9 and hole-by-hole comparisons treat missing holes).

7. [low] Machine-checkable file list is present, but spec also signals unlisted files may be added later
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:209-237
   - Confidence: high
   - Why it matters: The “Files this story will edit” list is clean and parseable (lines 209–218), but later the Dev Agent Record says “final actual file set may add tests not pre-listed” (lines 234–236). For future auto-approve based on a fixed footprint, that caveat weakens the contract and could allow drift outside the declared list without an explicit spec update.
   - Suggested fix: If you want this to be machine-checkable, tighten language to: “Additional files may be added only under apps/tournament-*/** and must be appended to this list before merge.” Or remove the caveat.

## Strengths

- All declared edit paths are within the tournament allowlist (apps/tournament-*/**) and the spec explicitly avoids FORBIDDEN Wolf Cup imports (lines 87–88).
- Clear “no caching; recompute on read” alignment with D1-1 and explicit 15s polling choice (lines 47, 89–94).
- Good upfront declaration that this is the first services-layer file and that routes should call services (lines 49–55).
- API contract includes `computedAt` for future UX improvements without forcing it into v1 UI (lines 93–94, 111–114).
- Includes both unit/service tests and route-level integration tests with concrete scenarios (lines 127–130, 166–169).

## Warnings

None.
