# Codex Review

- Generated: 2026-06-21T18:11:40.482Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

## Ship/Hold Verdict: **HOLD**
Epic 4 (Stories 4.1–4.5) has multiple **spec holes that block correct implementation** under the locked constraints (recompute-on-read; finalize = input immutability; pin-by-value; single chokepoint). The largest gaps are: **(1) no canonical finalized-state storage design**, **(2) no defined forward-effective segment storage**, **(3) no defined correction diff/notice mechanism that works without stored “before” money**, and **(4) incorrect reconciliation requirement given the non-additive event pot**.

### MUST-FIX (blocking)
- **Story 4.1 / FR32+FR43:** Finalize-state storage is unspecified; canonical frozen-boundary predicate is asserted but not constructed; refusal scope likely over-broad (blocks global edits that are inert-on-pin).
- **Story 4.2 / FR30+FR33:** Correction re-pin semantics + diff/notice persistence/delivery are undefined and currently contradict recompute-on-read (no stored “before”); must also account for event-pot flips.
- **Story 4.3 / FR31:** Forward-effective requires per-hole config segments, but no storage/shape is defined; cannot be implemented with a single pinned snapshot.
- **Story 4.4 / FR41+NFR-T1:** Reconciliation invariant is wrong as written because the event pot is non-additive per hole.

### SHOULD-FIX
- Ensure Epic 4 routes all writes through **one named** finalized guard (closing Story 2.1’s interim seam) and define preconditions (pin exists, round lifecycle state).
- Make rules summary genuinely “plain language” for NFR-A3 (gloss jargon), and ensure handicap-lock reminder re-surfaces until locked.

### QUESTIONS
- How will you preserve prior pins/inputs under corrections to satisfy durability/audit expectations (NFR-D1/FR45), given the context says the pin row is rewritten only by correction?
- What is the exact inclusivity/clock definition for `effective_from_hole` (hole ordinal vs course hole number; inclusive)?


Overall risk: high

## Findings

1. [critical] Story 4.1 (FR43/FR32): Finalize-state storage is undefined (where is “finalized” persisted, additive migration shape, audit fields)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:752-773
   - Confidence: high
   - Why it matters: ACs require “the round is marked finalized” and that writes are refused (finalized-frozen), but Epic 4.1 never specifies **which table/columns** hold finalized state (or unfinalize reason/actor/time), nor how to do this under the stated migration constraints (additive-only; avoid CHECK-driven rebuild gotcha). Without a concrete storage contract, downstream stories (4.2/4.3) cannot reliably enforce the frozen boundary, and Story 2.1’s interim finalized-refusal can’t be made canonical.
   - Suggested fix: In Story 4.1 ACs, explicitly choose and document one storage approach:
- **Option A (recommended for audit):** new additive table `round_finalizations(round_id, finalized_at, finalized_by, unfinalized_at, unfinalized_by, reason, ...ecosystem)` (append-only or at least revisioned).
- **Option B:** `ADD COLUMN` on an existing table (e.g., `rounds.finalized_at/by`) + a separate audit table for unfinalize reason.
Also explicitly call out “no CHECK constraints” / statement-breakpoints per T13-4.

2. [high] Story 4.1 AC over-refuses edits: blocking global team/config edits is likely wrong because pins are by value (edits are inert to finalized rounds)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:765-769
   - Confidence: high
   - Why it matters: The AC says any money-changing edit (including “team”) is refused on finalized rounds. But per the spec/context, a finalized round recomputes **only from pinned snapshots** (config/teams by value). Therefore, editing **event-level teams** or **event-level config** should not change a finalized round’s money and should remain allowed; refusing them because some round is finalized would block legitimate organizer workflows (re-teaming the event for future rounds) without protecting finalized money.
   - Suggested fix: Narrow the refusal scope to **round-scoped mutations that can change pinned inputs for that round** (scores/claims; round-level override; forward-effective segments for that round; correction re-pin for that round). Allow global edits that are inert-on-pin; they simply won’t affect already-finalized/pinned rounds.

3. [critical] Story 4.1 AC asserts canonical frozen-boundary enforcement across all write paths but does not define the single predicate/hook (seam with Story 2.1 remains)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:765-769
   - Confidence: high
   - Why it matters: The AC requires finalized refusal across `hole_scores`, `hole_claims`, config overrides, and team edits, and says Story 2.1’s interim check “routes through this canonical check.” But there’s no explicit contract like `assertNotFinalized(roundId, tx)` or an equivalent shared guard enforced at the DB/mutation boundary. Without this, you risk partial enforcement (some routes forget the check) and silent money drift (violating NFR-C5).
   - Suggested fix: Amend Story 4.1 ACs to require exactly one shared guard (named, imported by all handlers) and a test matrix proving every mutation path hits it. Example AC language: “All money-affecting mutations call `assertRoundNotFinalized(roundId, tx)` before writing; Story 2.1 replaces its interim check with this guard.”

4. [critical] Story 4.2 (FR33): Diff/notice is underspecified and currently contradicts recompute-on-read (no stored “before” money to diff against)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:774-790
   - Confidence: high
   - Why it matters: AC demands a before→after delta notice when a correction changes money, but recompute-on-read means there is no cached/stored “before” output to compare unless you explicitly compute and persist it at correction time. Without a defined mechanism, FR33 becomes non-implementable or will be implemented inconsistently (e.g., diffing against whatever the client last saw). This is especially risky for real money trust/auditability.
   - Suggested fix: Define in Story 4.2:
- In the **same transaction** as the correction write, compute `edges_before = gamesMoney(roundId)` from the pre-write snapshot and `edges_after` post-write (or vice versa) using consistent reads.
- Persist a `round_corrections` record containing: changed input metadata, canonicalized edge sets, per-player deltas, and recipients.
- Deliver via existing activity/notifications plumbing (explicit table/event type).

5. [high] Story 4.2: Correction re-pin semantics are ambiguous (overwrite vs insert) and don’t address preserving prior pin history (audit/durability expectations)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:782-786
   - Confidence: high
   - Why it matters: The AC says correction “re-pins + recomputes the whole round” but does not specify whether this **overwrites** the unique `round_id` pin row (as required by the context’s “one snapshot per round_id”) or creates a second pin row/version. Either choice has major consequences for idempotency, reads, and auditability. Additionally, if you overwrite pins, you may violate the document’s durability posture (“never overwritten” elsewhere) unless you store prior snapshots somewhere.
   - Suggested fix: Make the pin write behavior explicit:
- If the contract is “single row per round_id,” require `UPDATE` (or upsert to same PK) and explicitly store prior pin JSON in a `round_pin_revisions`/history table (append-only) referenced by correction id.
- Add an AC/test that after correction there is still exactly one active pin for the round, and the previous pin is still retrievable for audit.

6. [medium] Story 4.2 incorrectly cites “only path that re-pins” as Story 3.4 (looks like a spec regression / wrong dependency)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:782-785
   - Confidence: high
   - Why it matters: The AC states “the only path that re-pins, per Story 3.4,” but Story 3.4 is the event pot; pinning is defined in Story 1.2 and the global-team snapshot in Story 3.3. Wrong references tend to produce wrong implementations and missed test coverage because engineers follow the spec’s dependency map.
   - Suggested fix: Fix the reference in Story 4.2 AC to the correct story/contract (Story 1.2 for pin store + Story 3.3 for team snapshot pin).

7. [critical] Story 4.3 (FR31): Forward-effective requires per-hole config segmentation, but no storage/shape exists (pin is one snapshot)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:791-804
   - Confidence: high
   - Why it matters: AC requires earlier holes to settle under prior config and later holes under new config, and says recompute reads “per-segment config.” But the architecture earlier defines the pin as **one fully-resolved snapshot**; there is no defined segment list representation in the pin store or in `game_config`. Without a concrete data model, FR31 can’t be implemented deterministically, and risks violating NFR-C8 (unambiguous timing) and NFR-C6 (order-independence).
   - Suggested fix: Amend Story 4.3 to introduce an explicit segment model, e.g. pinned `config_segments: Array<{effectiveFromHole: number, resolvedConfigJson: ...}>` sorted by `effectiveFromHole`, inclusive semantics, validated. Also specify whether forward-effective appends a new segment (keeping prior bytes identical) vs re-pins whole snapshot; and how this composes with the existing front/back pointValue schedule segments (FR3).

8. [high] Story 4.2/4.3 don’t account for cross-round event pot flips on correction/forward-effective, but FR33 requires surfacing money moves (including pot winner changes)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:774-804
   - Confidence: high
   - Why it matters: Epic 3’s event pot is winner-take-all and cross-round. A correction or forward-effective change in a single round can change team standings and flip the pot winner, causing large money deltas outside the edited foursome. Story 4.2’s diff banner requirement doesn’t specify that it includes **downstream producer outputs** (event pot edges), so participants could see pot money silently change—violating FR33’s “nothing changes silently.”
   - Suggested fix: Define FR33 diff scope as “all affected SettlementEdges across all F1 producers for the event” (at least intra-foursome + event pot). In the correction/forward-effective transaction, compute and diff both round edges and any event-level pot edges derived from the changed round, and persist/announce both.

9. [critical] Story 4.4 (FR41/NFR-T1): Requires per-hole reconciliation to event total, but event pot is explicitly non-additive per hole
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:805-816
   - Confidence: high
   - Why it matters: AC says per-hole figures reconcile exactly to the round total **and the event total**. That is incompatible with the event pot model described earlier: the pot is cross-round, winner-take-all, and has **no per-hole attribution**. Enforcing “sum(per-hole)==event total” would either force fake attribution (bad auditability) or fail tests for valid states.
   - Suggested fix: Split invariants:
- For additive per-round games: `sum(perHoleContrib) == roundEdgesTotal`.
- For event pot: show as a separate event-level line item with its own traceability (standing inputs + buy-in), not per-hole.
Add an explicit test/property covering both invariants without conflating them.

10. [medium] Story 4.4 does not require the reconciliation to be test-gated (missing explicit property/regression test despite money-traceability requirement)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:811-818
   - Confidence: high
   - Why it matters: Given real-money integrity, the reconciliation claim should be enforced by automated tests (similar to NFR-R2 for corrections). Without a required test, a per-hole breakdown can drift from totals due to rounding, ordering, or missing modifiers—eroding trust and violating NFR-T1 in practice.
   - Suggested fix: Add an AC that requires an automated test: for arbitrary fixtures, per-hole breakdown sums to round totals (and separately, event pot totals reconcile to standing/buy-in inputs). Consider a `fast-check` property for additive games plus a golden for a known full round.

11. [medium] Story 4.5 (FR35/NFR-A3): “Plain-language summary” example relies on group jargon (polie/sandie/off the low) without requiring gloss; may fail the Mark test
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:819-831
   - Confidence: medium
   - Why it matters: AC asserts a non-technical player can read the summary and state their game, but the provided example includes terms that may not be self-explanatory outside the existing group’s vernacular. If the UI uses these labels without definitions, NFR-A3 can fail even if the computation is correct.
   - Suggested fix: Require either (a) short inline definitions/tooltips (“Polie: longest made putt claim”, “Sandie: up-and-down from sand”, “Off the low: lower net score wins the hole”), or (b) a fully plain-language rendering with jargon as secondary labels.

12. [low] Story 4.5 (FR38): Handicap-lock reminder is specified as a setup-flow prompt but not required to re-surface while still unlocked/pre-play
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:832-836
   - Confidence: medium
   - Why it matters: A one-time reminder can be missed; organizers often return later. Since handicaps materially affect net money, the reminder’s effectiveness depends on recurring visibility until locking occurs (without blocking). Current AC doesn’t require that behavior, risking the reminder being implemented as a single dismissible toast.
   - Suggested fix: Add an AC that the reminder persists/re-surfaces in relevant admin contexts until `handicaps_locked_as_of` is set (non-blocking), and is suppressed once locked.

## Strengths

- Story 4.1 correctly frames finalized-frozen as **input immutability** under recompute-on-read (no cached-output freeze) (lines 760–764).
- Story 4.2 explicitly requires correction-recompute correctness to be an **automated test gate** (NFR-R2) (line 784).
- Story 4.3 includes a regression requirement that earlier holes remain byte-identical after forward-effective (line 803), which is the right safety property—once the segment model exists.
- Story 4.4/4.5 consistently reiterate the **single chokepoint** and **audience-bounded money** constraints (lines 816–818, 829–830).

## Warnings

- Truncated file content for review: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
