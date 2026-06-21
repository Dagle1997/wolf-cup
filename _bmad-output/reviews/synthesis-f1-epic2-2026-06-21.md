# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-21T17:31:59.501Z
- Synthesized sources: codex-review (gpt-5.2, high), gemini-review (gemini-pro, high), party-panel (PM/Architect/Dev/QA/UX, 5 personas, code-verified against shipped hole_scores/offline-queue/money.ts)
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Verdict

**HOLD** — confidence: high

## Executive summary

Decision: whether Epic 2 (Stories 2.1–2.8) is specification-ready to build for the real-money Guyan settlement engine. All three sources converge that Epic 2 has multiple correctness and contract gaps (claims dedupe/uniques, recompute-on-read contradiction, FR2 authoring/presets, and Wolf-Cup cross-validation definition), so it is not safe to build as-written. Verdict: HOLD until the must-fix spec edits below are folded and owners are assigned for orphaned adversarial fixtures/ACs.

## High-confidence findings (consensus)

1. [critical] Story 2.1: hole_claims needs BOTH a cell-level UNIQUE and a dedupe UNIQUE (otherwise duplicate claims can double-settle)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, gemini-review, party-panel
   - Summary: Story 2.1 AC at L450 specifies idempotency UNIQUE (round_id, player_id, hole_number, claim_type, client_event_id) but does not explicitly require the cell-level UNIQUE that shipped hole_scores carries; reviewers verify hole_scores has uniq_cell + uniq_dedupe and warn two different client_event_id values can insert two rows for the same (round,player,hole,claim_type) cell and double-pay.
   - Recommended action: Story 2.1 / AC (L450): add `UNIQUE(round_id, player_id, hole_number, claim_type)` (cell) in addition to the existing dedupe unique, and define the upsert conflict target as the cell-unique so exactly one claim exists per cell.

2. [critical] Story 2.1: 'fans out a recompute' AC contradicts locked recompute-on-read (no stored money / no trigger)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, gemini-review, party-panel
   - Summary: Story 2.1 AC (L462) requires an edit/remove write that 'fans out a recompute', but the locked architecture is pure engine + recompute-on-read with no stored money and no recompute trigger; sources flag this as a phantom/unfalsifiable requirement and must be reworded to match the chokepoint behavior.
   - Recommended action: Story 2.1 / AC (L462): replace 'fans out a recompute' with 'persists the claim durably so the next money read via services/games-money.ts reflects the change (recompute-on-read); no stored-money recompute trigger exists'.

3. [high] Story 2.7 (FR2): missing organizer authoring for per-modifier enable/disable + variant selection (pills are display-only)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, gemini-review, party-panel
   - Summary: Story 2.7 AC (L569–L575) provides a template picker + live pills + preset save, but there is no acceptance criterion that lets an organizer actually toggle each modifier (enabled/disabled) or choose variants and write those settings to game_config, so FR2 is not satisfied as scoped.
   - Recommended action: Story 2.7 / AC (L569–L575): add explicit organizer controls for each modifier’s `{enabled, variant}` (and persist to event-level game_config in the same audited tx), or explicitly remap FR2 authoring to another epic/story with an owner.

4. [high] Story 2.7 (FR6/FR7): preset storage/persistence is undefined (risk of hidden schema dependency/new table)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, gemini-review, party-panel
   - Summary: Story 2.7 AC (L572–L574) says 'stored as a reusable, selectable preset' but does not define where/how presets persist (table/columns/constraints) under the additive-only migrations rule; multiple sources flag this as a hidden schema dependency and a build-time ambiguity.
   - Recommended action: Story 2.7 / AC (L572–L574): name the concrete persistence mechanism (e.g., new additive `game_presets` table or explicit reuse of an existing rule-set revision store), including keys/uniques and how presets are listed for the picker.

5. [high] Story 2.4: Sandie basis is wrong as written (uses net-vs-par; should be gross/natural up-and-down basis per Standard Guyan)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, gemini-review, party-panel
   - Summary: Story 2.4 AC (L521) says the sandie resolver pays based on 'that player's net-vs-par'; sources agree Standard Guyan sandie is gross/natural (up-and-down for par-only or any-score) and net-vs-par would produce wrong payouts.
   - Recommended action: Story 2.4 / AC (L521): change sandie eligibility/basis to gross(natural) vs par (and update fixture expectations accordingly); do not use net-vs-par for sandie.

6. [high] Story 2.5: Birdie generalization must preserve Epic 1 behavior byte-identically and define config_version/back-compat mapping
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, party-panel
   - Summary: Story 2.5 AC (L531–L538) intends to generalize birdie variants; reviewers require explicitly: (a) Epic 1 net-birdie/single golden must re-run byte-identically, (b) a config_version bump where shape changes, and (c) a legacy→{basis:'net',bonus:'single'} default mapping so existing configs don’t fail-closed inadvertently.
   - Recommended action: Story 2.5 / AC (L535–L538): explicitly require a config_version bump + backward-compatible default mapping for legacy configs and a non-regression test that re-runs the Epic 1 golden byte-identically.

7. [high] Epic 2: NFR-C4 adversarial fixtures are orphaned (all-push hole, plus-handicap) with no Story owner
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, gemini-review, party-panel
   - Summary: NFR-C4 lists adversarial fixtures (incl. all-push hole and plus-handicap). Sources note Epic 2 stories cover carryover→non-par-3 (2.2) and cap boundary (2.6), but 'all-push hole' and 'plus-handicap' are not clearly owned by any Epic 2 story/AC, creating a test gate with no implementation home.
   - Recommended action: Assign each NFR-C4 fixture to a specific story AC (e.g., all-push hole in 2.3/2.2; plus-handicap in 2.5 or earlier net logic story), and add explicit golden filenames/criteria to that story.

8. [high] Story 2.8: Wolf-Cup cross-validation is underspecified (needs frozen fixture + canonical normalization + CI-fail diff)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, party-panel
   - Summary: Story 2.8 AC (L595–L602) calls for reproducing Wolf Cup money, but sources require: a frozen, checked-in reference fixture (not a live read); canonical normalization for edge comparisons; and an explicit 'non-empty diff fails CI' contract, otherwise the gate is flaky/ambiguous.
   - Recommended action: Story 2.8 / AC (L595–L602): require a checked-in frozen reference dataset, define canonical normalization for SettlementEdge[] comparison, and mandate CI failure on any non-empty diff.

9. [medium] Story 2.2: holeState must clearly carry claims (and deterministic hole order/ordinal) for stateful carryover to be well-defined
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, party-panel, gemini-review
   - Summary: Story 2.2 AC (L485–L486) requires greenie to read claim from holeState and be stateful across holes; reviewers flag the spec needs an explicit hole order/ordinal (or equivalent deterministic sequencing) and a clear ownership point for extending holeState to include claims so the reducer is deterministic and the API contract change is not hidden.
   - Recommended action: Story 2.2 / AC (L485–L486): explicitly define holeState fields for claims + hole sequencing (e.g., `holeNumber` or `holeOrdinal` and an engine rule to sort by it), and assign the owner story (2.1 vs 2.2) for the type/API change.

10. [medium] Story 2.6: cap-resolution algorithm + remainder-penny rule is not fully specified/tested
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
   - Affirming sources: codex-review, party-panel
   - Summary: Story 2.6 AC (L553–L556) says 'cap-resolution rule … applied deterministically' but does not concretely specify the algorithm (e.g., single-payee collapse) nor require a golden/property that covers multiple modifiers firing under a cap; sources ask to explicitly name the remainder-penny rule (NFR-C7) and cap collapse semantics.
   - Recommended action: Story 2.6 / AC (L553–L556): write the exact cap distribution algorithm in prose + add a golden that includes multiple contributions under cap and asserts loss-less + cap-respected + deterministic remainder allocation.

## Divergent findings (need resolution)

1. Story 2.1 edit/remove semantics: LWW+delete-to-remove can resurrect deleted claims; reassigning 'belongs to' cannot be a single upsert
   - Only one source flags deeper concurrency/semantics issues in the delete-to-remove + LWW monotonic sequence approach and notes that changing which player a claim belongs to cannot be an in-place upsert if player_id is part of the key.
   - Positions:
     - **codex-review** (raise): “delete-to-remove + LWW monotonic seq underspecified/incompatible: deleting a row then a stale late write resurrects it; LWW needs tombstones or seq-compare on a non-deleted model … ‘edit claim changes whom it belongs to’ CANNOT be a single upsert under (round,player,hole,claim_type) because player_id is IN the key — reassigning to another player is delete+insert, not an edit-in-place.”
     - **party-panel** (not_raised): Panel did not call out tombstones/resurrection or key-based reassign specifically; it focused on uniqueness, recompute wording, offline-queue union, and ownership assignments.
     - **gemini-review** (not_raised): Gemini did not discuss tombstones/resurrection or reassign semantics.
   - Synthesizer lean: Keep. Even with single-writer + dedupe, the story text explicitly specifies LWW monotonic seq and delete-to-remove, so the spec should either (a) define tombstone/seq semantics to prevent resurrection, or (b) remove the LWW claim and define a simpler deterministic conflict rule consistent with the offline queue contract. Also, ‘change whom it belongs to’ should be rewritten as delete+insert (two operations) if player_id is key material.

2. Story 2.1 introduces a new offline-queue MutationKind (`claim`) but does not enumerate required code touchpoints
   - Only the party-panel report is code-verified here and states MutationKind is a closed union and will require explicit edits + a server route; other sources did not mention this implementation contract gap.
   - Positions:
     - **party-panel** (raise): “Story 2.1 adding a `claim` MutationKind is undisclosed work on a CLOSED union (verified offline-queue.ts MutationKind = closed 4-value union + VALID_KINDS_INTERNAL + isValidKind guard) + needs a server route — name the edits.”
     - **codex-review** (not_raised): Did not mention MutationKind/route enumeration.
     - **gemini-review** (not_raised): Did not mention MutationKind/route enumeration.
   - Synthesizer lean: Keep. This is a concrete, code-verified contract gap: Story 2.1 AC (L454–L455) requires a `claim` kind, so the story should explicitly list the offline-queue union/guards and server handler route as part of acceptance.

## Dismissed findings

1. General praise / 'structural spine is excellent' (non-actionable)
   - Raised by: gemini-review
   - Dismissal reason: theoretical
   - Reasoning: Positive commentary does not translate into a fixable Epic 2 finding set; retained implicitly but not as a build-blocking item.

## Prioritized actions

1. [must_fix_before_send] Story 2.1 (AC L450): add cell-level UNIQUE on (round_id, player_id, hole_number, claim_type) in addition to the dedupe UNIQUE with client_event_id; define upsert conflict target accordingly.
2. [must_fix_before_send] Story 2.1 (AC L462): remove/replace 'fans out a recompute' to match recompute-on-read (next read reflects durable claim inputs; no stored-money trigger).
3. [must_fix_before_send] Story 2.7 (AC L569–L575): add organizer authoring AC for FR2 (toggle modifiers enabled/disabled, choose variants) that persists to event-level game_config; if not in Epic 2, explicitly remap FR2 authoring to a different epic/story with owner approval.
4. [must_fix_before_send] Story 2.7 (AC L572–L574): specify exact preset persistence mechanism (schema/keys/listing) under additive-only migrations; remove ambiguity about where custom presets live.
5. [must_fix_before_send] Story 2.4 (AC L521) + fixtures: change sandie basis from net-vs-par to gross/natural vs par; ensure goldens cover both variants on the corrected basis.
6. [must_fix_before_send] Story 2.8 (AC L595–L602): define frozen reference fixture, canonical normalization for SettlementEdge[] equality, and CI behavior (non-empty diff fails) so cross-validation is deterministic and non-flaky.
7. [should_fix] Story 2.5: require config_version bump + explicit backward-compat mapping + explicit non-regression that re-runs Epic 1 net-birdie/single golden byte-identically.
8. [should_fix] Assign owners for orphaned NFR-C4 adversarial fixtures (all-push hole, plus-handicap) by adding them to specific Story 2.x acceptance criteria with explicit fixture names.
9. [should_fix] Story 2.2: explicitly define holeState additions (claims + deterministic hole sequencing/ordinal) and assign the owner story for the API/type changes.
10. [should_fix] Story 2.6: write the exact cap-resolution algorithm + remainder-penny rule and add a golden/property test case where multiple modifiers fire under a cap.
11. [optional] Story 2.1: clarify edit semantics for 'changes whom it belongs to' (delete+insert) and address delete-to-remove + LWW resurrection risk (tombstone/seq semantics) if concurrent/offline reorder is possible.
12. [optional] Story 2.1: explicitly enumerate required code touchpoints for the new offline-queue `claim` MutationKind and the server route/handler to satisfy AC L454–L455 (per code-verified panel note).

## Open questions (for human judgment)

- FR2 authoring scope decision: must Epic 2 deliver organizer per-modifier enable/disable + variant selection UI (beyond template selection), or is that deferred/remapped (panel says needs Josh confirmation)?
- Preset persistence: what is the intended canonical storage for saved presets (new additive table vs reuse of an existing rule-set/preset mechanism), and how are presets tenant-scoped and listed?
- Wolf-Cup cross-validation gate: should CI compare against a frozen snapshot only (panel lean) or also run against live Wolf Cup reconciliation data (risk of flake/blocking Epic 5)?
- Story 2.1 conflict semantics: is true multi-device concurrency for claim edits/deletes in scope now (requiring tombstones/seq rules), or is single-writer strict enough to simplify/remove the LWW requirement?

## Warnings

None.
