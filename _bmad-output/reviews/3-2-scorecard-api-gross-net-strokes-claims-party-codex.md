# Codex Review

- Generated: 2026-06-23T13:54:21.942Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md, _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md

## Summary

Party review mostly matches the described shipped implementation (read-only GET scorecard, pinned-CH strokes, claims fold reuse, participant/organizer auth, moneyNet=null seam). However, it contains at least one concrete factual mismatch (test DB strategy) and it slightly overclaims “every AC maps to code + a test” without acknowledging doc-level inconsistencies in the updated story artifact. No clear case where a party recommendation was marked ACCEPTED-but-missed appears in the provided materials. Followups listed are largely non-blocking, though cache-control is the only one that could become must-fix once money is exposed (as the review itself notes).

Overall risk: low

## Findings

1. [medium] Party review misstates the test DB approach (in-memory vs per-pid temp-file), reducing trustworthiness of the review
   - File: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md:39-42
   - Confidence: high
   - Why it matters: The party review’s Dev section asserts a “:memory: test DB choice” (line 41). The updated story’s completion notes explicitly say the opposite: tests use a per-pid temp-file libsql DB (not shared in-memory) to avoid cache leakage (Story file line 143). This is a concrete accuracy error in the review, and it matters because test isolation/reliability was a known issue (T14-2 lesson).
   - Suggested fix: Update the party review to reflect the actual harness choice (per-pid temp-file) and the rationale; avoid asserting infra/testing details unless verified from the implementation or run logs.

2. [medium] Updated story file contains contradictory scope statements; party review does not surface this, creating a rubber-stamp risk for future readers
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:20-25
   - Confidence: high
   - Why it matters: The story narrative says “does NOT wire any web route (that is 3-4)” (line 24), but the same document’s ACs and tasks clearly specify implementing and mounting a new API route in tournament-api (e.g., AC #1 line 28, Tasks 2/registration lines 77–80, and file list including app.ts line 66). This inconsistency can mislead stakeholders and makes the party review’s “scope discipline” claims easier to over-accept without noticing the doc conflict.
   - Suggested fix: Clarify wording to “does NOT wire any tournament-web client/UI” (3-4), while 3-2 does add the API route + mount. Align the story intro with the ACs/tasks/completion notes.

3. [low] Story doc still recommends a different stroke helper than the completion notes say was used (potential boundary/consistency confusion)
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:91-99
   - Confidence: medium
   - Why it matters: Dev Notes specify using in-tree `getHandicapStrokes` (lines 97–98), while completion notes say the implementation uses `allocateStrokesFromCourseHandicap(pinnedCh, si)` (line 136). Even if both live in the same in-tree helper, the mismatch can cause future edits to “fix” the code toward the doc and accidentally break the pinned-CH invariant or re-derive CH from HI/tee (a stated anti-goal).
   - Suggested fix: Update Dev Notes to match the actual chosen helper and explicitly restate the invariant (pinned CH in, SI in; no HI/tee re-derivation). Remove or qualify the alternative helper mention.

4. [low] Followup classification: Cache-Control/no-store is plausibly non-blocking now, but becomes security-relevant once moneyNet stops being null
   - File: _bmad-output/reviews/3-2-scorecard-api-gross-net-strokes-claims-party-review.md:45-49
   - Confidence: medium
   - Why it matters: The review treats cache headers as a future concern (consolidated followups). That’s reasonable for 3-2 with moneyNet always null, but once 3-3 introduces dollars, missing `Cache-Control: no-store` can become a real data leakage vector through intermediaries or shared devices. This is not a present gap in 3-2, but the “non-blocking” label should be explicitly scoped to “while moneyNet is null.”
   - Suggested fix: In the party review, tighten wording: non-blocking for 3-2 specifically because moneyNet is null; elevate to must-fix criterion for 3-3/3-4 when dollars are exposed.

## Strengths

- Party review correctly spotlights the key trust invariant (“never fabricate a number”) and ties it to moneyNet=null and netScore=null when strokes are unknown.
- It explicitly calls out reuse of existing claim fold and stroke allocation kernel (the most important consistency seam).
- It lists concrete, plausible hardening followups (plus-handicap coverage, route-level 500 mapping test, cross-event/IDOR belt-and-suspenders) without demanding scope creep.

## Warnings

None.
