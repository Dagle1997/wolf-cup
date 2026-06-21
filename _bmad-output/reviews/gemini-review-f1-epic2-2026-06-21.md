# Gemini Review

- Generated: 2026-06-21T17:29:20.871Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

VERDICT: HOLD Epic 2. The epic decomposition provides an excellent structural spine and properly isolates each game modifier behind a hand-approved golden fixture. However, there are critical data integrity risks and mathematical errors that must be fixed before implementation. The `hole_claims` unique constraint is flawed and will allow duplicate entries. The Sandie variant uses incorrect net-vs-par math instead of gross scores, risking incorrect money settlements. Additionally, there is a direct contradiction with Epic 1's 'recompute-on-read' architecture by demanding a phantom recompute trigger on writes. Finally, required UI authoring controls (FR2) and backend schema for custom presets are missing from the ACs.

Overall risk: high

## Findings

1. [critical] Flawed UNIQUE constraint allows duplicate claims per player/hole
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:450
   - Confidence: high
   - Why it matters: Including `client_event_id` directly in the sole UNIQUE constraint means a device retry with a new client ID, or a different scorer device, will insert a duplicate row rather than triggering the UPSERT / LWW tiebreaker. This causes double-claims in the engine and invalidates money calculations.
   - Suggested fix: Specify two constraints: a structural `UNIQUE(round_id, player_id, hole_number, claim_type)` to enforce business cardinality, and rely on `client_event_id` only in the application logic or UPSERT conflict-resolution to handle idempotency.

2. [high] Sandie modifier calculates eligibility using net-vs-par instead of gross
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:521
   - Confidence: high
   - Why it matters: Standard Guyan sandies (up-and-down from the bunker) are evaluated against gross/natural scores. Using `net-vs-par` means a player shooting a gross bogey on a stroke hole (net par) would falsely win a 'par-only' sandie, violating core golf settlement rules and causing incorrect payouts.
   - Suggested fix: Change 'net-vs-par' to 'gross-vs-par' (or natural score) for evaluating Sandie eligibility in the resolver.

3. [medium] Phantom 'recompute trigger' contradicts 'recompute-on-read' architecture
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:462
   - Confidence: high
   - Why it matters: The AC demands that an edit 'fans out a recompute'. Epic 1 and the global constraints establish that money is pure 'recompute-on-read' with NO stored money and NO recompute trigger. Building a fan-out trigger introduces dead/phantom code and race conditions.
   - Suggested fix: Remove the requirement to fan out a recompute. State that claim edits/removes simply update the immutable input so the next read calculates the correct money.

4. [medium] Missing authoring UI for FR2 (modifier toggles)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:569-570
   - Confidence: high
   - Why it matters: FR2 requires an organizer to 'enable/disable each modifier... and choose its variant'. Story 2.7 only specifies a template picker and 'live pills' to 'visually verify' the settings. There are no ACs for the actual interactive inputs (switches/dropdowns) needed to create the custom configurations before saving them.
   - Suggested fix: Add explicit AC defining interactive authoring controls for toggling modifiers and selecting variants, rather than just read-only 'live pills'.

5. [medium] Hidden schema dependency for preset library
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:574
   - Confidence: high
   - Why it matters: Story 2.7 expects to save custom configurations as a 'named preset'. Epic 1 explicitly restricted table creation to `game_config` and `round-pins`. No table exists for the preset library (`rule_set`), making this AC impossible to fulfill without undocumented schema drift.
   - Suggested fix: Explicitly define the additive schema migration for the preset library (e.g., `game_presets` table) in this story.

6. [low] Hidden API contract change extending holeState
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:485
   - Confidence: medium
   - Why it matters: Story 2.2 reads claims from `holeState`. However, Epic 1 defined `holeState` as carrying only par, net, and team splits. Story 2.1 captures claims in the DB but does not map them to the engine. This leaves a hidden integration gap.
   - Suggested fix: Add an AC to 2.1 to explicitly extend the `holeState` interface and update the chokepoint mapping to pass claims into the engine.

7. [low] Orphaned NFR-C4 adversarial golden cases
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:533
   - Confidence: high
   - Why it matters: NFR-C4 requires adversarial fixtures for 'all-push hole' and 'plus-handicap'. While cap boundaries and carryovers are covered in 2.2 and 2.6, these two specific cases are unassigned to any golden fixture AC in Epic 2, risking a release gate failure.
   - Suggested fix: Explicitly assign the 'plus-handicap' and 'all-push hole' adversarial fixtures to specific golden ACs, such as the Birdie generalized (2.5) or Epic 1 (1.1).

## Strengths

- Excellent risk mitigation by enforcing golden fixtures as a hard, pre-code CI gate (Pattern 18) for every modifier.
- Strong cross-validation approach against live Wolf Cup application (Story 2.8) rather than theoretical setups.
- Ensures backward compatibility by testing the generalized Birdie modifier against the Epic 1 base-game golden.
- Property tests explicitly call out cap limits and conserving totals with remainder pennies.

## Warnings

None.
