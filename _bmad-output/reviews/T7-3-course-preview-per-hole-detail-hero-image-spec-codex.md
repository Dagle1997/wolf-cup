# Codex Review

- Generated: 2026-05-05T00:57:41.675Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md

## Summary

Spec is generally coherent and scoped; it clearly trims unsupported fields and defines a deterministic “pinned revision” rule. Main risks are (1) ambiguity/edge cases in the pinning + defaultTeeColor selection when multiple rounds/players/tees exist, (2) an AC-2 “soft leak” that is partially mitigated but still allows differentiating “in event” vs “not in event” for participants, and (3) totals reconciliation rules that could be inconsistent (printed totals vs computed sums; handling of missing yardage). Tests list is good but misses a couple of the trickier edge cases implied by the rules.

Overall risk: medium

## Findings

1. [medium] Multi-revision pinning rule doesn’t specify tie-breaker when multiple rounds share the same lowest round_number (or multiple references exist at the same round_number)
   - File: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md:20-23
   - Confidence: medium
   - Why it matters: The rule says “pick the one with the lowest event_rounds.round_number” (line 22) for determinism. If the data model ever allows multiple event_rounds rows with the same round_number (e.g., shotgun/flight splits, multiple courses in same round number, or accidental duplicates), then “lowest round_number” alone is not deterministic, and you can flip revisions between requests depending on DB ordering. That undermines the core intent: stable preview of the pinned historical scorecard.
   - Suggested fix: Specify a deterministic secondary ordering for pinning when multiple rows qualify, e.g. (round_number ASC, event_rounds.id ASC) or (round_number ASC, tee_time ASC, id ASC), and state it explicitly in the rule + tests. If the schema guarantees uniqueness of (event_id, round_number), call that out explicitly as an invariant to justify determinism.

2. [medium] defaultTeeColor selection rule is underspecified when multiple rounds match the pinned revision (and/or when a participant has different tee_color assignments per round)
   - File: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md:45-46
   - Confidence: high
   - Why it matters: Spec says defaultTeeColor is “viewer’s tee for the round in this event that uses this revision (first matching event_round.tee_color)” (line 45) and AC-1 reiterates “first matching” (line 69). If the pinned revision is used by multiple rounds, “first matching” is ambiguous unless you define “first” ordering (by round_number? by created_at? by id?). Also, a viewer could have different tees across rounds; picking an arbitrary one could surprise users and makes tests flaky.
   - Suggested fix: Define defaultTeeColor selection precisely, e.g. “tee_color from the same event_round row that determined the pinned revision (i.e., the lowest-round_number row that references this course); if that tee_color is null/unset, return null.” Add an explicit test for multiple rounds using the same revision with different tee_color values to ensure stable behavior.

3. [medium] AC-2 “course exists but not in event” vs “course does not exist” handling is internally inconsistent with the soft-leak rationale
   - File: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md:71-76
   - Confidence: high
   - Why it matters: AC-2 first states: participant + course exists but not referenced → 404 course_not_in_event (line 73–75). Then it says unknown courseId → also 404 course_not_in_event “uniform shape” (line 75–76). That removes the leak between “exists elsewhere” and “doesn’t exist” at the API level (good), but the earlier note says it “DOES distinguish ‘course exists in another event’ from ‘course doesn’t exist at all’” (line 75), which contradicts the “uniform shape” requirement. As written, the intended trade-off is unclear: are you intentionally allowing distinguishing those two cases, or intentionally not?
   - Suggested fix: Decide and state one behavior: (A) fully uniform 404 (recommended if you want to minimize leak): always return course_not_in_event regardless of course existence; remove the sentence claiming it distinguishes. Or (B) intentionally distinguish with a different code/message when the courseId truly doesn’t exist; update AC-2 and tests accordingly. Given your stated preference (“uniform shape”), option A seems aligned.

4. [medium] 404 vs 403 boundary: participants can enumerate whether a course is referenced by the event (membership leak), which is bigger than the stated “library entries” leak
   - File: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md:71-80
   - Confidence: medium
   - Why it matters: Even with requireEventParticipant first (line 79), any participant can probe courseIds and learn whether a given course is used by the event (404 vs 200). That reveals event schedule/course usage to participants—which may be acceptable—but it’s a different leak than “course exists in another event.” If some events want to hide course lineup until published, this endpoint makes that impossible for participants. The spec currently frames the leak only in terms of cross-event course existence (line 75, 144–145).
   - Suggested fix: Clarify in AC-2/AC-3 that the endpoint intentionally allows participants to determine whether a course is part of the event (200 vs 404) and that this is acceptable per product policy. If not acceptable, you’d need a different approach (e.g., only allow courseIds that appear in published schedule for that participant), but that would change scope.

5. [medium] Totals reconciliation rule mixes “displayed totals” and “printed totals” in a way that can be confusing and test-ambiguous
   - File: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md:95-96
   - Confidence: high
   - Why it matters: AC-5 says the totals row is the sum of per-hole pars/yardages (line 95), and also says to “assert the displayed outTotal/inTotal/courseTotal match the revision’s printed totals…log a console.warn but render both values” (line 95). It’s unclear what exactly is rendered in the table row: are there separate columns/rows for computed vs printed? If only one is rendered, which wins? Also, tests (line 120) say totals “match the fixture” but don’t specify whether the fixture is printed totals, computed totals, or both—leading to brittle or misleading tests when upstream data inconsistencies occur.
   - Suggested fix: Make the UI contract explicit: e.g. “Totals row shows computed sums; printed totals are shown in parentheses (or a tooltip) when mismatched,” OR “Totals row shows printed totals; computed sums are used only for validation/warn.” Update AC-5 and web tests to assert the intended behavior for both the matching and mismatching cases (at least one mismatch fixture/unit test).

6. [low] Missing-yardage behavior is specified for cells but not for totals; totals rule should define how missing yardage affects Out/In/Total yardage sums
   - File: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md:95-97
   - Confidence: high
   - Why it matters: AC-5 says missing yardage cells render ‘—’ (line 96). But totals are defined as “sum of yardage…for the same ranges” (line 95). If some holes are missing yardage for the selected tee, summing becomes ambiguous: treat missing as 0, skip them, or render ‘—’ for totals as well? Without a rule, implementations may diverge and tests may not cover it.
   - Suggested fix: Specify totals behavior with missing yardage, e.g. “If any hole in the range has missing yardage for the selected tee, show ‘—’ for that range total; otherwise show the sum.” Add a test where one hole is missing yardage and verify both cell and totals behavior.

7. [low] Tees ordering states alphabetical by teeColor but doesn’t define normalization/collation; could be inconsistent if teeColor values vary (e.g., ‘Blue’, ‘blue’)
   - File: _bmad-output/implementation-artifacts/tournament/T7-3-course-preview-per-hole-detail-hero-image.md:38-39
   - Confidence: medium
   - Why it matters: If teeColor casing is inconsistent in data, ordering can differ between DB collation and frontend sort. That can change “first tee alphabetically” default selection (line 93) and affect snapshots/tests.
   - Suggested fix: Define teeColor normalization (e.g., store lowercase canonical values; or sort case-insensitively on the server and return canonical display label). At minimum, specify “case-insensitive alphabetical by teeColor” and ensure tests don’t rely on DB collation quirks.

## Strengths

- Scope trimming is justified by concrete schema constraints (lines 13–18), reducing risk of half-implemented UI.
- Auth ordering and the intent to run course checks only after participant verification is explicitly stated (lines 77–80).
- Acceptance criteria include a solid test matrix for API + web, including multi-revision pinning and 403/404 rendering (lines 108–124).
- The pinned revision selection rule is conceptually aligned with preserving historical scorecard data (lines 20–23, 81–86).

## Warnings

None.
