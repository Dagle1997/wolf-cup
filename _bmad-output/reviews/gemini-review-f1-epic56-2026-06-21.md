# Gemini Review

- Generated: 2026-06-21T18:28:56.831Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/_extract-epic56.md

## Summary

The epic structure is fundamentally sound and well-sequenced to minimize data risk through a strict additive migration. However, there are critical issues to resolve: the backfill strategy directly contradicts the 'sole routing check' invariant, and the introduction of a second writer for claims (self-report) exposes a schema flaw that will guarantee duplicate claims. Additionally, cross-group namespace overlap and deferred legacy presses threaten the integrity of the migration and disjointness tests.

Overall risk: high

## Findings

1. [critical] Backfill routing contradiction breaks F1 dual-read invariant
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:209-210
   - Confidence: high
   - Why it matters: The architecture strictly defines the F1 routing check as 'iff it has an EVENT-LEVEL game_config row' (the sole routing check, Line 150). Story 5.1 acknowledges this but proposes writing the row in a 'staged/disabled state'. If the mere existence of the row is the sole routing check, writing it will instantly route live requests to F1, breaking the offline comparison cutover gate. If a boolean flag is required instead, the 'sole routing check' invariant is false.
   - Suggested fix: Update the architecture to redefine the routing check (e.g., explicit `is_f1_active` flag) rather than mere row existence, or have the backfill write to a staging table/column.

2. [high] Self-report allows duplicate claims due to flawed UNIQUE constraint
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:264-265
   - Confidence: high
   - Why it matters: The schema defines `idempotency UNIQUE (round,player,hole,claim_type,client_event_id)` (Line 156). Story 6.2 introduces a second concurrent writer (the player) alongside the scorer. Because players and scorers are on different devices, their `client_event_id`s will always differ. The database will therefore allow BOTH claims to be inserted for the exact same hole/player, resulting in duplicated payouts.
   - Suggested fix: Change the schema constraint strictly to `UNIQUE (round, player, hole, claim_type)`. Handle `client_event_id` deduplication via application logic or standard `ON CONFLICT DO UPDATE` semantics, ensuring only one claim per type exists.

3. [high] Cross-group namespace overlap defeats producer-disjointness check
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:278-280
   - Confidence: high
   - Why it matters: Story 6.3 suggests emitting cross-group SettlementEdges using `sourceType: 'f1_game' (or a dedicated cross-group namespace)`. If `f1_game` is used, it overlaps with intra-foursome F1 games. This overlap makes it impossible to mechanically verify producer-disjointness (D1a) between intra-foursome and cross-group producers, masking potential double-payouts.
   - Suggested fix: Mandate a strict, dedicated namespace (e.g., `f1_cross_group`) in the AC. Do not allow the generic `f1_game` namespace for cross-group edges.

4. [medium] Byte-identical cutover gate blocked by deferred legacy presses
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:223-224
   - Confidence: medium
   - Why it matters: Story 5.2 requires a byte-identical old-vs-new money comparison before cutover. Line 152 states 'Presses OFF for F1 events in MVP'. If a backfilled legacy event contains active legacy presses, the F1 engine's output will intentionally differ, permanently failing the harness check and blocking cutover for that event.
   - Suggested fix: Either strictly exclude events with legacy presses from the migration cohort, or instruct the comparison harness to explicitly filter out legacy press edges before asserting byte-identity. Resolve the open question with Josh.

5. [medium] Missing fail-closed cascade for cross-group games
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:278-281
   - Confidence: high
   - Why it matters: Story 6.3 settles cross-group games by consuming results from individual foursomes. If an underlying intra-foursome game fails closed due to missing/untrustworthy data (FR44), proceeding with the cross-group settlement could result in settling on a guess or partial data, violating NFRs.
   - Suggested fix: Add an Acceptance Criterion explicitly stating that if any participating foursome fails closed, the dependent cross-group game must also fail closed and cascade the unsettleable status.

## Strengths

- Migration is rigorously gated by a byte-identical comparison harness, strictly enforcing additive rollouts and avoiding risky in-place data mutations.
- The use of polymorphic `game_config` perfectly enables the foursome-level self-serve feature (Story 6.1) without requiring any engine rewrite.
- Clear separation between intra-foursome isolation and cross-group settlement via disjoint edge producers correctly respects FR23.
- NFR-C1 golden test gating for cross-group settlement ensures high confidence in exact outputs.

## Warnings

None.
