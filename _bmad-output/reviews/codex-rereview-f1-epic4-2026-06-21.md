# Codex Review

- Generated: 2026-06-21T18:20:16.579Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

Epic 4 confirmation pass (Stories 4.1–4.5) based on the provided (truncated) file.

Per-item status:
- 4.1: CONFIRMED (testable ACs present for all requested points).
- 4.2: PARTIAL (key requested points are present and testable where visible, but Story 4.2 is truncated mid-AC, so cannot confirm the remaining ACs, including the full event-pot flip surfacing behavior).
- 4.3: NOT-RESOLVED (doc still inconsistently treats FR31/forward-effective as in-scope for Epic 4 in some places).
- 4.4: NOT-RESOLVED (Story 4.4 content not present in provided excerpt; cannot verify ACs).
- 4.5: NOT-RESOLVED (Story 4.5 content not present in provided excerpt; cannot verify ACs).

Ship/Hold verdict for Epic 4: HOLD until (a) FR31/Story 4.3 deferral is made internally consistent everywhere in the doc, and (b) the remainder of Epic 4 (Stories 4.2–4.5) is provided/verified with testable ACs.


Overall risk: high

## Findings

1. [high] FR31/Story 4.3 is marked deferred, but Epic 4 still claims FR31/forward-effective is included (internal contradiction / dangling scope)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:212-215
   - Confidence: high
   - Why it matters: Your note explicitly requires Story 4.3 (FR31 forward-effective) be DEFERRED post-MVP and that nothing else depends on it “as if it ships.” The doc is currently internally inconsistent:
- Epic 4 description still lists “forward-effective change from a hole” as part of Epic 4 (line 213).
- Epic 4 “FRs covered” still includes FR31 (line 214).
- But the FR Coverage Map marks FR31 as post-MVP deferred (line 186), and Epic 4 intro states forward-effective (FR31/Story 4.3) is deferred (lines 750–751).
This leaves readers unsure whether FR31 ships in MVP, and can cause downstream stories/tests to implicitly assume forward-effective exists.
   - Suggested fix: Make the deferral consistent everywhere:
- Remove FR31 from Epic 4 “FRs covered” (line 214) and from the Epic 4 summary sentence that lists forward-effective (line 213), or clearly annotate that it’s deferred.
- Ensure any later Story 4.4/4.5 cross-refs don’t require forward-effective semantics.
- Optionally add a short “Story 4.3 DEFERRED (no MVP deliverables)” stub in the story list so the numbering doesn’t imply a missing shipping requirement.

2. [medium] Cannot confirm Stories 4.4 and 4.5 now have testable ACs (content not present in provided excerpt)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:781-801
   - Confidence: high
   - Why it matters: The review request is to re-review Epic 4 Stories 4.1–4.5 and confirm each item is resolved by a testable AC. The provided file is truncated during Story 4.2 ACs (ends at line 801), and does not include any content for Stories 4.3–4.5. Without the actual AC text for 4.4/4.5, it’s not possible to verify:
- 4.4: reconciliation-as-a-test, non-additive event-pot line rules, money-detail.ts extension, ScrollableTable/no overflow.
- 4.5: tappable jargon gloss (Mark test), lock reminder behaviors.
This blocks your “confirmation pass” objective.
   - Suggested fix: Provide the remaining portion of the file containing the full Story 4.2 ACs and Stories 4.3–4.5. Re-run this pass once the excerpt includes those sections.

## Strengths

- Story 4.1 ACs explicitly meet the requested finalize-boundary design: additive `ADD COLUMN` finalize fields (no CHECK rebuild) (Story 4.1 AC, lines 760–763), canonical `assertNotFinalized(roundId, tx)` called by round-scoped write paths (Story 4.1 AC, lines 768–771), refusal scoped only to round-scoped re-pinning edits while allowing inert global edits (Story 4.1 AC, line 771), and explicit regression tests for {score, claim, round-config, correction} refusal + global-edit succeeds (Story 4.1 AC, line 772).
- Story 4.1 also covers the “indirect drift” concern via by-value pinning rationale in an acceptance-testable way (Story 4.1 AC, line 766) and requires un-finalize to surface participant notice (Story 4.1 AC, line 778).
- Story 4.2 (visible portion) includes the key correction mechanics you requested: overwrite the unique `round_id` pin row (Story 4.2 AC, line 791), NFR-R2 as a hand-approved golden asserting exact expected money (Story 4.2 AC, line 792), and in-tx capture of pre-correction edges before re-pin with durable per-recipient, audience-bounded notices meeting NFR-A1 (Story 4.2 AC, lines 795–799).
- Story 4.2 cross-reference looks corrected to Story 1.2 for the pin-row uniqueness/overwrite behavior (Story 4.2 AC, line 791), avoiding the older incorrect citation to Story 3.4.

## Warnings

- Truncated file content for review: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
