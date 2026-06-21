# Gemini Review

- Generated: 2026-06-21T18:12:23.359Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

Epic 4 correctly layers recompute-safety and transparency onto the F1 spine, but contains several severe logical and architectural gaps. Story 4.1 incorrectly over-refuses global edits, violating the by-value pin's isolation. Story 4.2's before/after diff is unbuildable under the strict recompute-on-read constraint without an explicit in-transaction capture of the pre-mutation state. Story 4.3 lacks a storage model for forward-effective segment arrays, conflicting with the single-snapshot pin. Story 4.4's reconciliation requirement mathematically fails to account for the non-additive Event Pot from Epic 3.

Overall risk: high

## Findings

1. [high] Finalize state storage and canonical predicate undefined (Story 4.1)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:760-768
   - Confidence: high
   - Why it matters: The story mandates marking a round finalized and refusing writes across 'every' path, but fails to define the additive schema (e.g., `ADD COLUMN finalized_at` vs new table) or a single canonical predicate (e.g., `assertNotFinalized`) that all write mutations must invoke. Without this, the 'frozen' boundary will leak as new write paths are added.
   - Suggested fix: Explicitly define the schema addition and mandate a centralized `assertNotFinalized` predicate that wraps all score, claim, and round-level config write paths.

2. [high] Finalize rule over-refuses global event/team edits (Story 4.1)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:765-768
   - Confidence: high
   - Why it matters: The AC states 'any money-changing edit is attempted (score, claim, config, team)... the system refuses it.' Refusing an event-level config or global team edit because ONE round in the event is finalized is wrong. The finalized round is safely isolated by the by-value pin (Story 3.3); global edits should succeed and naturally apply only to un-finalized rounds.
   - Suggested fix: Clarify that the finalized refusal applies ONLY to round-scoped inputs (scores, claims, round-level config overrides). Global team and event-config edits must be allowed.

3. [critical] Before/after diff contradicts recompute-on-read architecture (Story 4.2)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:787-789
   - Confidence: high
   - Why it matters: The story requires surfacing a 'before→after delta' diff. Because Epic 1 enforces strict recompute-on-read with no stored money, the 'before' money ceases to exist the moment inputs are updated. The story lacks the architectural mechanism to capture this.
   - Suggested fix: Mandate that the correction transaction must explicitly compute the 'before' edges using pre-edit inputs, apply the edit, compute the 'after' edges, diff them, and durably persist the result for delivery.

4. [medium] Correction flip fails to account for Event Pot changes (Story 4.2)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:787-789
   - Confidence: high
   - Why it matters: A mid-round score correction could alter a team's best-ball-vs-par total, potentially flipping the winner of the Epic 3 Event Pot. The diff notification only mentions affected round participants, silently ignoring cross-round pot flips.
   - Suggested fix: Ensure the correction recompute path includes re-evaluating the event pot and generating diff notifications for event-pot flips (FR33).

5. [high] Forward-effective config lacks storage shape and pin compatibility (Story 4.3)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:797-803
   - Confidence: high
   - Why it matters: Forward-effective rules mean a round has multiple config segments (e.g., holes 1-5 use Config A, 6-18 use Config B). The current `game_config` schema and round pin hold a single `config_json` object. It is undefined how an ordered segment array is stored, how it interacts with the 1.1 front/back segmented schedules, or how hole-ordinal (not wall-clock) boundaries are handled.
   - Suggested fix: Define the schema change (e.g., converting `config_json` to an array of `{effective_from_hole, config}`), detail how this affects the round pin, and ensure the segment boundary utilizes hole ordinals.

6. [medium] Per-hole reconciliation breaks on non-additive Event Pot (Story 4.4)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:813-817
   - Confidence: high
   - Why it matters: The story asserts that 'per-hole figures reconcile exactly to the round total and the event total'. This is mathematically false because Epic 3 introduced the Event Pot (best-ball-vs-par), which is a cross-round aggregate that does not decompose into additive per-hole dollars.
   - Suggested fix: Distinguish additive intra-foursome money from non-additive event standings. Clarify that per-hole breakdown only sums to the additive game totals, while the Event Pot must be a distinct, non-decomposable line item.

7. [low] Incorrect citation for round pin story (Story 4.2)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:782-785
   - Confidence: high
   - Why it matters: The story cites '(the only path that re-pins, per Story 3.4)'. Story 3.4 is the Event Pot. The round pin mechanism is defined in Story 1.2, and the global-team pin is in 3.3.
   - Suggested fix: Update the citation to reference Story 1.2 and 3.3.

## Strengths

- Strict adherence to the immutable pin boundary and pure-function recompute architecture.
- Excellent intent-visibility features via the 'Mark test' active rules summary.
- Strong auditing requirements (actor + timestamp) on all money-affecting lifecycle changes.

## Warnings

- Truncated file content for review: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
