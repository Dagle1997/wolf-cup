# Codex Review

- Generated: 2026-05-04T15:54:30.282Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/money.ts, apps/tournament-api/src/services/money.test.ts, apps/tournament-api/src/routes/money.ts, apps/tournament-api/src/routes/money.integration.test.ts, apps/tournament-web/src/lib/format-cents.ts, apps/tournament-web/src/routes/events.$eventId.money.tsx, apps/tournament-web/src/routes/events.$eventId.money.test.tsx, apps/tournament-api/src/app.ts, apps/tournament-api/src/services/index.ts

## Summary

Implements a read-only money matrix service, GET endpoint, and minimal UI with solid baseline integration coverage (anti-symmetry, diagonal=0, auth/no-existence-leak, integer-only, cache-control). However, the current aggregation has a few correctness and privacy gaps that are likely to violate the “money visibility” and “match actual teams/rules” ACs in real events: (1) moneyVisibilityMode is returned but not enforced (viewer id unused), (2) 2v2 teams are derived by sorting playerIds rather than using pairing slot/team semantics, (3) ruleset revision selection is effectively arbitrary (no ordering/effective-from logic; may ignore event rule edits), and (4) holesToPlay is read but not respected (9-hole/partial rounds likely miscomputed).

Overall risk: high

## Findings

1. [high] Money visibility mode is not enforced; viewerPlayerId is unused (privacy/AC risk)
   - File: apps/tournament-api/src/services/money.ts:137-166
   - Confidence: high
   - Why it matters: The service returns `visibilityMode` (open/participant/self_only) but does not apply any masking to `matrix`/`totals`. The `_viewerPlayerId` parameter is explicitly unused (line 140), which strongly suggests the intended behavior (e.g., self_only should reveal only the viewer’s row/col or totals). As written, a participant can see everyone’s head-to-head balances even if the group is configured for `self_only`, which is a privacy regression if the UI later starts honoring that field.
   - Suggested fix: Use `viewerPlayerId` to enforce the configured visibility before returning the payload. For example:
- `open`: return full matrix.
- `participant`: likely same as open (or whatever spec says).
- `self_only`: either (a) return all players but zero/omit non-viewer cells, or (b) return only viewer row/col + totals.
Add integration tests that seed `groups.moneyVisibilityMode='self_only'` and verify non-viewer cells are masked.

2. [high] 2v2 team composition is derived by sorting player IDs, not pairing slots/recorded teams (can invert who owes whom)
   - File: apps/tournament-api/src/services/money.ts:279-293
   - Confidence: high
   - Why it matters: The service reads `pairingMembers` but then sorts the 4 playerIds and assigns teamA=[0,1], teamB=[2,3] (lines 290-293). In real events, team membership is typically determined by slotNumber or stored team assignment, not lexical ordering of UUIDs. This will misattribute 2v2 results (swap teammates/opponents), breaking anti-symmetry semantics relative to the real match and producing incorrect debts.
   - Suggested fix: Derive teams from authoritative pairing structure:
- Select `playerId` + `slotNumber` and `orderBy(pairingMembers.slotNumber)`.
- Map slots 1-2 to teamA and 3-4 to teamB (or whatever the domain model defines).
Add an integration test where slot ordering differs from alphabetical order and verify the matrix corresponds to slot-defined teams.

3. [high] Ruleset/ruleset revision selection is non-deterministic and likely ignores event-scoped rule edits
   - File: apps/tournament-api/src/services/money.ts:82-135
   - Confidence: high
   - Why it matters: `fetchActive2v2Config` claims to fetch the “latest” ruleset revision, but it does `.limit(1)` without any `orderBy` on either `ruleSets` (lines 93-97) or `ruleSetRevisions` (lines 100-109). If multiple rule sets/revisions exist, the chosen config is arbitrary. Additionally, this lookup is tenant-wide and does not appear to incorporate event-scoped rule-set revisions/effective-from-hole logic (T5-11), creating drift vs the rules actually applied to rounds/press orchestration.
   - Suggested fix: Make the selection deterministic and aligned with the event:
- Choose the event’s applicable ruleSetId (if events reference one) and select the highest revisionNumber / latest createdAt.
- Apply effectiveFromRoundId/effectiveFromHole semantics if required.
- At minimum: `orderBy(ruleSetRevisions.revisionNumber desc)` (or createdAt) and `orderBy(ruleSets.createdAt desc)` to reduce randomness.
Add a test with two revisions where only the latest should affect cents.

4. [medium] holesToPlay is fetched but not used; partial rounds (e.g., 9 holes) may be miscomputed
   - File: apps/tournament-api/src/services/money.ts:191-335
   - Confidence: medium
   - Why it matters: The service selects `eventRounds.holesToPlay` (line 196) but never uses it. It always loads all course holes (lines 249-267) and passes `holeMeta: []` (line 322) into `compute2v2BestBall`. If the engine expects hole meta or relies on the provided holes array to define the played segment, 9-hole/short rounds could incorrectly include unplayed holes (or compute allocations incorrectly).
   - Suggested fix: Plumb holesToPlay (and/or start hole if applicable) into the engine input in the way `compute2v2BestBall` expects. If the engine uses `holeMeta` for playable holes, populate it; otherwise slice the `holes` array to the played count.
Add an integration test for holesToPlay=9 and ensure only 9 holes contribute.

5. [medium] Individual bets query does not filter to “active” bets; may include canceled/settled bets depending on schema
   - File: apps/tournament-api/src/services/money.ts:355-371
   - Confidence: medium
   - Why it matters: The service selects all `individualBets` rows for the event (lines 355-370) but the stated scope says “active individual bets”. If the schema supports bet lifecycle (active/void/settled), this will overcount and display historical bets. The integration tests don’t cover this dimension, so the bug would slip through.
   - Suggested fix: If there is a status/isActive column in `individualBets`, add a `where(eq(individualBets.status,'active'))` (or equivalent). If lifecycle is modeled elsewhere, enforce it here.
Add an integration test that seeds one inactive bet and asserts it contributes 0.

6. [medium] Integer-cents discipline is asserted in tests but not enforced at the service boundary (config parsing allows floats)
   - File: apps/tournament-api/src/services/money.ts:82-135
   - Confidence: medium
   - Why it matters: `fetchActive2v2Config` accepts numeric fields directly from JSON (e.g., basePerHoleCents, bonuses) without `Number.isInteger` checks (lines 121-134). If configJson contains 100.5 (or a string), the engine/service could emit non-integer money values, violating the invariant enforced by UI `formatCents` (which throws on non-integers) and risking runtime crashes.
   - Suggested fix: Validate config numeric fields with `Number.isInteger` and reasonable bounds (>=0) before using; otherwise default or return null.
Optionally assert `Number.isInteger(bbResult.perPair[a][b])` / `Number.isInteger(betResult.netToPlayerACents)` and skip or throw with logging if violated.

## Strengths

- Good route-layer hardening for the endpoint: requireSession → requireEventParticipant plus `cache-control: no-store` and no-existence-leak integration coverage.
- Integration tests cover key matrix invariants (anti-symmetry, diagonal=0) and access control (non-participant and nonexistent eventId → 403).
- `formatCents` enforces integer-only inputs and has direct unit coverage, preventing silent float rendering bugs.
- Service is read-only and defensively wraps engine calls to avoid failing the entire response on one bad foursome/bet.

## Warnings

None.
