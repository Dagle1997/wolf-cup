# Codex Review

- Generated: 2026-06-21T16:49:56.293Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md, _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md, _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md

## Summary

Epic 1 stories are unusually concrete and encode many of the architecture’s money-safety load-bearers (golden-fixture gate, pure integer-cents engine, SettlementEdge IR, dual-read switch, provenance pinning, fail-closed). However, the artifact has several fidelity-breaking contradictions vs the locked PRD/architecture that would cause a dev agent to implement the wrong scope and/or the wrong data model (notably: FR10 lock toggle and FR34 mode switch mis-phased into Product B; and a stray `foursome_game_config` table reference contradicting D2’s single polymorphic `game_config`). There are also lingering “locked-HI” references and an internal inconsistency about whether recompute uses pinned CH vs recomputed CH from pinned HI. Finally, despite claiming a “complete epic and story breakdown,” only Epic 1 is decomposed into stories; Epics 2–6 have no stories/ACs, making the plan not executable end-to-end as-is.

Overall risk: high

## Findings

1. [critical] Product A/B split contradicts the locked PRD: FR10 (lock toggle) and FR34 (scores-only mode) are incorrectly deferred to Product B
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:181-220
   - Confidence: high
   - Why it matters: The epic plan is supposed to be the implementable breakdown of the locked PRD. Here the Coverage Map explicitly classifies Product B FRs as including **FR10** and **FR34(scores-only mode)** (line 181) and maps FR10→Epic 6 (line 183), and Epic 6 claims FR10 and FR34(scores-only) (lines 217–219). This conflicts with the PRD, where FR10 is not marked (B) and Product A explicitly includes the lock toggle (“admin creates/seeds a rule set … + lock toggle”) and MVP includes the leaderboard mode switch (money vs scores-only). If implemented as written here, Product A would ship without required MVP behaviors (unlock toggle and the unlocked-mode UX), creating a functional gap and forcing later epics to retrofit core routing/UX semantics in a real-money area.
   - Suggested fix: Update the Product A/B classification and epic mapping to match the locked PRD: move **FR10** into Product A (likely Epic 1 or its own early epic), and treat **FR34** as Product A (implement both locked money-mode and unlocked scores-only mode + signpost together with the lock toggle). Adjust Epic 1.3/1.4 ACs accordingly (don’t say unlock is Epic 6).

2. [high] Epic 6 references `foursome_game_config`, contradicting architecture D2 (single polymorphic `game_config` table)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:217-219
   - Confidence: high
   - Why it matters: Architecture D2 (locked) requires one polymorphic `game_config(level: event|round|foursome, ref_id, ...)`. This epic doc mostly follows that, but Epic 6 explicitly calls out a separate `foursome_game_config` table (line 218). A dev agent following this plan could create a second table and a second resolution path, breaking the dual-read switch, lock-gated cascade, and migration safety assumptions (and increasing money-correctness risk).
   - Suggested fix: Replace all mentions of `foursome_game_config` with `game_config` rows where `level='foursome'` and ensure the epic text/ACs consistently reference the single-table model (including ref_id validation-in-code).

3. [high] Handicap provenance terminology is inconsistent (“locked-HI” vs effective-HI); Story 1.4 still says it reads “locked-HI” even when not locked
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:158-404
   - Confidence: high
   - Why it matters: The recently-ratified rule (and your own Epic 1 note at line 199) is: locking as-of-date is optional; if not locked, default to most-recent GHIN; ALWAYS pin effective HI + computed CH per player at round-start; fail-closed only when no handicap exists. Yet the doc still repeatedly uses “locked-HI snapshot” language (e.g., architecture-derived bullet at line 158; Story 1.4 AC at line 367 says `games-money.ts` reads “scores + locked-HI + course-rev”). That wording can lead to a fail-closed bug in unlocked/default-GHIN cases or to recompute reading the wrong table (event_handicaps only) and silently producing wrong net money for rounds that were not explicitly locked.
   - Suggested fix: Normalize terminology everywhere to **effective handicap snapshot** and make the read contract explicit: `games-money.ts` reads the pinned per-player HI+CH snapshot regardless of whether it came from a lock-as-of-date or “most recent GHIN” resolution. Only mention “locked-HI overlay” as an input source for computing the effective snapshot at pin-time.

4. [medium] Internal inconsistency: Story 1.2 says recompute reads pinned CH and never re-derives it, but Story 1.4 computes net from effective HI via calcCourseHandicap
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:296-375
   - Confidence: high
   - Why it matters: Story 1.2 AC states: “recompute reads the pinned CH, never re-derives it from a live HI” (lines 299–301). Story 1.4 AC then says net computation imports `calcCourseHandicap` et al “off the effective HI” (lines 369–372). These are not the same implementation contract. A dev agent could (a) ignore pinned CH and recompute it (potentially diverging if the underlying helper uses slightly different rounding logic over time), or (b) attempt to force existing helpers to accept CH and introduce new handicap math (explicitly prohibited). This is a money-correctness landmine because net drives settlement outcomes.
   - Suggested fix: Clarify the exact deterministic pipeline: either (1) pin HI + course_rev/tee and deterministically recompute CH via the existing helper (but still *display* pinned CH for provenance), or (2) pin CH and ensure existing allocation helpers can use CH without introducing new math. Make 1.2 and 1.4 match.

5. [medium] Story 1.1 engine inputs are ambiguous (“per-player scores” vs per-player net); net-birdie rule definition is underspecified
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:242-260
   - Confidence: medium
   - Why it matters: Story 1.1 defines fixtures/holeState as carrying “per-player net” (lines 242–243, 250, 256), but later acceptance criteria say “Given per-player scores, par, and the team split” (line 253) which can be read as gross scores. That ambiguity can lead to an engine that mixes gross and net incorrectly. Separately, “net-birdie is detected from net vs par” (line 256) is not precise enough to prevent implementing ‘exactly birdie’ vs ‘birdie-or-better’ vs ‘gross birdie’—any of which changes money. Golden fixtures help, but an agent can still build the wrong rule and “fix the fixture” to match, defeating the intent of hand approval.
   - Suggested fix: Make the engine contract explicit in 1.1: either `holeState` includes gross + allocated strokes and the engine derives net, or `holeState` includes `netScore` only (recommended for 1.1) and never mentions “scores” generically. Also define net-birdie precisely in AC (e.g., `netScore <= par-1`), and reference the exact countingRule semantics for ties/halves.

6. [medium] FR3 coverage risk: epic only models front/back segmentation but does not specify 9-hole rounds or play-sequence mapping semantics
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:30-261
   - Confidence: medium
   - Why it matters: FR3 requires segmented point values with segments mapping to holes explicitly and being defined for 9-hole rounds and the round’s play sequence. Epic 1 implements only “flat OR front/back” (lines 30–31, 244–245, 346–348) and golden-tests the 9/10 boundary (line 261), but does not state what happens for 9-hole rounds or non-1..18 play sequences. In real trips, 9-hole rounds happen; a wrong segment mapping changes dollars and is hard to detect after the fact.
   - Suggested fix: Add explicit acceptance criteria for 9-hole rounds and for mapping point-value segments to the round’s play sequence (even if the only supported segmentation is front/back). Include a golden fixture for a 9-hole round and/or a non-standard sequence if the product supports it.

7. [high] Artifact claims “complete epic and story breakdown” but only Epic 1 has story decomposition; Epics 2–6 are not implementable by an agent
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:19-226
   - Confidence: high
   - Why it matters: The Overview claims this document provides the “complete epic and story breakdown” (line 19), but the file only contains stories/ACs for Epic 1 (lines 226–410). For a dev agent, Epics 2–6 currently lack story-level scope, dependencies, and money-safety ACs (goldens, fail-closed, provenance, audit, offline idempotency, etc.). This is a planning completeness gap, and in a real-money engine it increases the risk that later work is implemented inconsistently or without the required test gates.
   - Suggested fix: Either (a) mark the document as explicitly incomplete and remove “complete breakdown” claims, or (b) add story decompositions + ACs for Epics 2–6, especially around claims (`hole_claims` + offline dedup), caps, variants, teams snapshot pinning, finalize/unfinalize immutability, per-hole breakdown reconciliation, and migration compare harness + backfill procedure.

8. [low] “Presses OFF for F1 events” is asserted as confirmed here, but the locked architecture calls it an open item
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:195-379
   - Confidence: medium
   - Why it matters: This doc states “Confirmed product decision: presses are OFF for F1 events in MVP” (line 195) and repeats it in Story 1.3/1.4 (lines 349, 378). The locked architecture document still flags this as needing Josh’s confirmation. If this is not actually confirmed, hard-coding it into acceptance criteria risks either scope churn late or silently disabling a money feature users rely on.
   - Suggested fix: Align with the locked architecture: either label presses-off as an explicit open item with a decision checkpoint, or (if confirmation happened after architecture lock) note it as an approved override and update the architecture in the next revision process (not by ad-hoc contradictions).

## Strengths

- Epic 1 sequencing (1.1 pure engine + goldens → 1.2 schema/pins → 1.3 seed UI → 1.4 integration) is dependency-ordered and matches the architecture’s risk-sequenced build discipline.
- Story 1.1 acceptance criteria explicitly encode core money-safety patterns: golden-fixtures-first hard gate, integer-cents, order-independence, loss-less ledger→edges, fail-closed on unknown modifier/config_version, and fast-check invariants.
- Story 1.4 calls out the required settlement chokepoint (`services/games-money.ts`), dual-read routing by presence of event-level config row, producer-disjointness testing, and fail-closed semantics on genuinely missing handicap data.
- Provenance pinning is explicitly included (resolved-config snapshot + per-player HI+CH + course_rev/tee pinned at round-start) and is tied to deterministic recompute expectations and UI visibility for past rounds.

## Warnings

None.
