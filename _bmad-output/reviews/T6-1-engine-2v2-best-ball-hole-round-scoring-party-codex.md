# Codex Review

- Generated: 2026-05-03T13:19:00.226Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T6-1-engine-2v2-best-ball-hole-round-scoring-party-review.md, apps/tournament-api/src/engine/formats/best-ball-2v2.ts, apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts, apps/tournament-api/src/engine/handicap-strokes.ts, apps/tournament-api/src/engine/handicap-strokes.test.ts, apps/tournament-api/src/services/handicap.ts

## Summary

Several claims in the party-mode written review are supported by the provided code/tests (notably: the key validation hardenings in compute2v2BestBall and handicap-strokes, and the 6-fixture + 3-extra test layout). However, the review also contains a few concrete inaccuracies (greenie validation described as unconditional; slope-adjusted test count overstated; AC-10 invariant overstated), plus multiple assertions that cannot be verified from the provided sources (spec AC list/line refs, file-count/git-status claims, legacy T5-5 test counts).

Overall risk: medium

## Findings

1. [medium] Greenie validation described as unconditional “putts ≤ 2”, but implementation makes it conditional on config.greenieValidation
   - File: _bmad-output/reviews/T6-1-engine-2v2-best-ball-hole-round-scoring-party-review.md:19-20
   - Confidence: high
   - Why it matters: The review states “Validation: par-3 + valid CTP + winning team + putts ≤ 2.” In the actual engine, the putts constraint is enforced only when `config.greenieValidation === '2-putt'`; when `greenieValidation === 'none'`, the engine will award even with `putts === null` or `putts > 2` (apps/tournament-api/src/engine/formats/best-ball-2v2.ts:297-311). This makes the review’s AC-6 compliance statement too strong / potentially misleading.
   - Suggested fix: Update the review text to reflect conditional behavior: “putts ≤ 2 only when greenieValidation='2-putt'; otherwise no putt validation.” If the spec requires always enforcing 2-putt, then the implementation (not the review) needs adjustment.

2. [low] AC-10 claim overstates what assertResultStructure actually checks (does not check perHole sum explicitly)
   - File: _bmad-output/reviews/T6-1-engine-2v2-best-ball-hole-round-scoring-party-review.md:23-24
   - Confidence: high
   - Why it matters: The review claims “perRound = sum of perHole = sum of A-side perPair” and that `assertResultStructure` checks the “third leg”. In tests, `assertResultStructure` checks only (a) integer-only, (b) anti-symmetry, and (c) sum of four Team-A cross-team pair cells equals `perRound.teamTotalCents` (apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts:60-102). There is no explicit assertion that `sum(perHole[].teamDeltaCents) === perRound.teamTotalCents` (even though perRound is computed from perHole in the implementation).
   - Suggested fix: Adjust the review to describe the actual invariant check (perPair↔perRound). Optionally add a test assertion summing perHole deltas if you want the review claim to be literally true.

3. [low] Handicap-strokes test coverage count claim is inaccurate: only 2 “slope-adjusted” tests exist, not “+4 additional slope-adjusted cases”
   - File: _bmad-output/reviews/T6-1-engine-2v2-best-ball-hole-round-scoring-party-review.md:26-27
   - Confidence: high
   - Why it matters: The review claims: “getHandicapStrokes 7 cases … + 4 additional slope-adjusted cases.” The provided test file has 7 AC-13 tests (i–vii), plus exactly 2 slope-adjusted tests (apps/tournament-api/src/engine/handicap-strokes.test.ts:86-108), plus 2 calcCourseHandicap validation tests (110-122). The review’s slope-adjusted count is overstated based on the evidence provided.
   - Suggested fix: Correct the review to “+2 slope-adjusted tests” (and optionally mention the 2 validation tests separately).

4. [medium] Multiple claims cite spec/AC traceability and repo-wide file/test counts that are not verifiable from provided sources
   - File: _bmad-output/reviews/T6-1-engine-2v2-best-ball-hole-round-scoring-party-review.md:12-51
   - Confidence: high
   - Why it matters: The review asserts items like “15 ACs traced… from epic line 1701–1745” (line 12), “Path footprint… 11 files (10 NEW + 1 additive MOD)… Verified via git status” (line 36), and suite totals “tournament-api 634 → 654” (line 74), plus legacy “T5-5’s 14 handicap.test.ts cases pass” (line 38). None of these are confirmable from the provided spec content (not included) or from the provided file list/diff (only one diff shown, and only a subset of files provided). This makes the review less reliable as an audit artifact.
   - Suggested fix: Either (a) include the referenced spec sections/line ranges and the relevant repo evidence (file list, test output), or (b) downgrade language to “expected/claimed” and scope it to what is directly observable in the included code/tests.

## Strengths

- Test count claims that are directly verifiable are accurate: compute2v2BestBall has 6 fixture tests + 3 additional tests (=9) (apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts), and handicap-strokes has 11 tests (apps/tournament-api/src/engine/handicap-strokes.test.ts).
- Most implementation-hardening claims in the review match the engine code: missing handicap index throws (best-ball-2v2.ts:123-134, 231-237), duplicate holeScores/holeMeta throw (193-211), config enum/boolean runtime validation (175-187), non-negative integer money validation (110-121, 171-173), strokeIndex range validation (handicap-strokes.ts:80-84), and calcCourseHandicap finite/positive validation (handicap-strokes.ts:51-62).
- AC-2 “complete-cell gate skip” description matches implementation and has a targeted test (best-ball-2v2.ts:224-230; best-ball-2v2.test.ts:173-190).

## Warnings

None.
