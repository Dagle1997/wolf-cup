# Codex Review

- Generated: 2026-06-21T18:34:10.448Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/_extract-epic56.md

## Summary

Per-item status (Story ID + AC):

1) Story 5.1 — PARTIAL
- Most requested elements are covered and testable in ACs (additive `cutover_state`, staged backfill, router check, deterministic mapping, fail-closed on unrepresentable features/presses, idempotent rerun) (lines 209–212).
- NEW inconsistency: AC text defines “F1 iff … cutover_state is active” (line 207) but also requires router to allow `{native, active}` (line 209) and the architecture dual-read bullet already says `{native, active}` (line 150).

2) Story 5.2 — PARTIAL
- Flip-time recompute + canonicalization coverage for legacy shape + fail-on-diff + explicit “0 differences” + staged→active flip + rollback + round-trip test + sibling-untouched test are all present and testable (lines 225–232).
- NEW inconsistency with 5.1: rollback mentions restoring flags “the cutover changed” with example implying presses were toggled (line 230), but 5.1 explicitly fail-closes backfill on presses (line 211), implying presses-on events never reach cutover.

3) Story 6.1 — PARTIAL
- Covers: “event must already be F1/no orphan”, `requireFoursomeMember`, `pairing_members` gate, `ref_id = pairings.id`, validator extension, 2.7 pills + 4.5 summary parity, lock-on-start signposting + server-side rejection of late/offline edits, pin storing per-foursome config keyed by pairing_id, and re-lock affects only future edits (lines 248–257).
- NEW inconsistency vs routing definition: “already F1” is asserted as “has an event-level game_config row” (line 248), but elsewhere F1 routing is “row exists AND cutover_state ∈ {native, active}” (lines 150, 209). As written, a `staged` backfill event could satisfy 6.1’s gate even though it is not F1-routed.

4) Story 6.2 — CONFIRMED
- Idempotent upsert on the existing cell-unique (not amended), scorer-marked→no-op, unmarked→insert, reporter provenance recorded + shown on chip, inside score-entry flow, finalized-frozen refusal via 4.1 are all explicit and testable (lines 267–271).

5) Story 6.3 — CONFIRMED
- Organizer forms cross-group team via reused 3.1 teams store; reads finalized per-player results; mandatory dedicated sourceType `f1_cross_group`; disjointness key `(debtor, creditor, sourceType, sourceId)` across full D1a matrix; golden covering ≥2 foursomes + overlapping intra+cross-group obligations; fail-closed on missing data are explicit and testable (lines 282–286).

6) Routing cross-ref consistency (Story 1.3 + architecture dual-read bullet) — NOT-RESOLVED
- Architecture bullet is consistent with the two-part check (line 150), and 5.1 includes it (line 209), but 5.1 also contradicts it by stating “iff … active” (line 207). This prevents confirming the cross-ref is now consistent.

7) NEW contradictions/dangling refs introduced
- Presses decision remains marked “open / needs Josh confirmation” in architecture (line 152) while 5.1/5.2 encode hard fail-closed + rollback semantics involving presses (lines 211, 230).

Epic ship/hold verdict:
- Epic 5: HOLD (routing-definition contradiction + presses toggle contradiction in the migration/cutover spec).
- Epic 6: HOLD (depends on Epic 5 routing semantics; Story 6.1 gate is inconsistent with cutover_state routing definition).

Overall risk: high

## Findings

1. [high] Story 5.1 contradicts itself on what qualifies as an “F1 event” (active-only vs {native,active})
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:207-212
   - Confidence: high
   - Why it matters: This is the core routing invariant for dual-read. Line 207 states “an event is F1 iff … cutover_state is active”, but the same AC (line 209) and the architecture routing bullet (line 150) require routing to F1 when `cutover_state ∈ {native, active}`. If implemented ambiguously, you risk either (a) routing new-native F1 events back to legacy incorrectly, or (b) routing staged backfills to F1 early (money change risk). This also blocks confirming the requested Story 1.3 cross-ref update.
   - Suggested fix: Pick one authoritative definition and make all mentions match. Suggested: “F1 iff event-level row exists AND cutover_state ∈ {native, active}” (native=new F1 event; staged=backfilled-not-routed; active=cutover complete). Update line 207 accordingly and ensure any referenced Story 1.3 bullet uses the exact same predicate.

2. [high] Presses handling is inconsistent across 5.1 vs 5.2 rollback semantics
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:211-231
   - Confidence: high
   - Why it matters: Story 5.1 AC fail-closes backfill when legacy presses are ON (line 211), implying such events never reach cutover. But Story 5.2 rollback requires restoring “any flag the cutover changed” with an example implying presses toggling (line 230). This creates an untestable/unclear migration contract: either presses-on events are blocked (so rollback doesn’t need to restore presses), or cutover will mutate presses (contradicting the earlier fail-closed rule and increasing data-risk).
   - Suggested fix: Decide one path and encode it consistently:
- If presses-on events are refused at 5.1 (recommended per your text), remove/adjust the 5.2 rollback example and any mention that cutover toggles presses.
- If you intend to support presses-on legacy events by toggling presses off during F1 routing, then 5.1 must not fail-close; instead define explicit cutover/rollback mutations and ensure the compare harness accounts for the presses delta (likely impossible if F1 MVP truly cannot represent presses).

3. [medium] Story 6.1 “already F1” precondition checks only row existence, not `cutover_state`, allowing staged events to pass
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:248-252
   - Confidence: high
   - Why it matters: Routing elsewhere is defined as “row exists AND cutover_state ∈ {native, active}” (lines 150, 209). But 6.1’s gate equates F1 with merely “has an event-level game_config row” (line 248). That would allow foursome-level writes against a backfilled-but-still-legacy (`staged`) event, undermining the stated ‘no orphan’ guarantee and creating config state that won’t be used until later cutover (surprising behavior / potential integrity issues).
   - Suggested fix: Change the 6.1 precondition to match the routing predicate: require event-level row AND `cutover_state ∈ {native, active}`. If you intentionally want to allow configuration while staged, state that explicitly (and explain how it’s surfaced/guarded so users understand it won’t affect money until cutover).

4. [medium] Presses decision remains marked “open” in architecture while stories now hard-depend on it
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:152
   - Confidence: high
   - Why it matters: The architecture bullet says “Presses OFF for F1 events in MVP … Needs Josh’s confirmation” (line 152), but 5.1/5.2 now encode operational behavior (fail-closed at backfill due to presses; rollback mentions restoring presses). This is a dangling decision that affects whether migration/cutover is even feasible for a class of legacy events and what tests should exist.
   - Suggested fix: Resolve or explicitly gate the stories on that decision. Either remove the “needs confirmation” note if presses-off is committed, or add an explicit HOLD/decision point in 5.1/5.2 (and avoid specifying rollback behavior for presses until the policy is finalized).

## Strengths

- Epic 5.2 ACs are unusually testable: flip-time recompute, canonicalization requirements for legacy shapes, explicit non-zero-exit on diff, and an affirmative “0 differences” signal (lines 225–226).
- Good migration safety gates: staged backfill + explicit flip, idempotent backfill, and a positive rollback round-trip test plus sibling-event untouched routing test (lines 209–213, 231–232).
- Epic 6.1 correctly calls out server-side enforcement against late/offline edits after lock and requires provenance regression tests around pin immutability (lines 255–257).
- Epic 6.3 explicitly separates producers via mandatory `sourceType` and requires both disjointness and input double-consumption coverage in a golden fixture (lines 283–285).

## Warnings

None.
