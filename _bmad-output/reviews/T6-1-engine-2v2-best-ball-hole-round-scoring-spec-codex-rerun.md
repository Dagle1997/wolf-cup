# Codex Review

- Generated: 2026-05-03T12:52:37.699Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md, apps/tournament-api/eslint.config.js, apps/tournament-api/src/services/handicap.ts, packages/engine/src/stableford.ts, packages/engine/package.json

## Summary

Several of the prior-pass issues look addressed at the intent level (AC-10 sign convention rewrite; sandies on ties clarified; greenie winner made explicit via closestToPinPlayerId; plus-handicap behavior specified; missing-cell behavior specified). However, there are still concrete internal inconsistencies in the spec that will lead to incorrect or divergent implementations, plus one clear mismatch between the spec’s layering decision and the provided current services/handicap.ts + spec snippets.

Overall risk: high

## Findings

1. [high] Greenie-on-tie behavior is internally contradictory (AC-4 vs AC-6/Section 6)
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:131-314
   - Confidence: high
   - Why it matters: AC-4 states that on a tied hole, `teamDeltaCents=0` but that `greenieAwarded` can still be awarded and pairwise money can flow for the greenie even though the base hole is tied (lines 291–295). But AC-6/its rules explicitly require the CTP player to be on the WINNING team (lines 304–313) and explicitly says if the CTP player is on the LOSING or TYING team, emit `greenieAwarded = null` (line 313). Section 6 also frames greenies as “when a winning-team player…” (line 132). These cannot all be true at once, and different devs/tests will implement different logic.
   - Suggested fix: Pick one rule and make AC-4, AC-6, and Section 6 consistent:
- If greenies pay only on won holes: delete the AC-4 tie exception language and keep AC-6 as-is.
- If greenies can pay on ties: update AC-6 to allow winner='tie' and define the sign/direction (e.g., no pairwise flow possible without a “winning team”, so you’d need a separate rule for direction or treat greenie as a side-pot independent of team win/loss).

2. [high] Hole iteration / completeness rule is inconsistent with “holeMeta optional” and likely skips legitimate scored holes
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:150-284
   - Confidence: high
   - Why it matters: The spec says “Holes without a corresponding `holeMeta` record are treated as ‘no greenie awarded’” (line 162), implying holes can be scored even when meta is missing. But AC-2 defines completeness/skip behavior keyed to “every hole numbered `h` in `holeMeta`” (lines 279–283), which implicitly makes `holeMeta` the driver set of holes to compute. If an input provides hole scores for hole 7 but omits holeMeta for hole 7, the natural reading of AC-2 is that hole 7 might never be considered at all (despite having complete score cells), contradicting line 162 and likely causing silent under-scoring.
   - Suggested fix: Define the authoritative set of holes to evaluate (recommended: from `course.holes` or from the set of holeNumbers present in `holeScores`, intersected with course holes). Then treat `holeMeta` as optional per-hole extra data used only for greenie eligibility. Rewrite AC-2 accordingly (e.g., “for each hole being evaluated, require all 4 scores else skip”).

3. [medium] Fixture JSON shape example omits required `holeMeta`, contradicting Compute2v2BestBallInput
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:225-383
   - Confidence: high
   - Why it matters: `Compute2v2BestBallInput` includes `holeMeta: HoleMetaInput[]` (line 227). But the fixture “input” example JSON omits `holeMeta` entirely (lines 376–382). This is a concrete spec contradiction that will break fixture-driven tests or lead to `holeMeta` being implemented as optional in code despite the type/AC-1 declaring it required.
   - Suggested fix: Either (a) include `"holeMeta": [...]` in the fixture input shape example and in all fixtures (possibly empty array), or (b) make `holeMeta` optional in `Compute2v2BestBallInput` and specify defaulting behavior (`[]`).

4. [medium] Engine→services layering decision conflicts with spec snippet and tasks: `handicap-strokes.ts` still described as importing from services
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:56-399
   - Confidence: high
   - Why it matters: Section 2b says v1 ships option (A): promote `calcCourseHandicap` into `apps/tournament-api/src/engine/handicap-strokes.ts`, and services becomes a re-export (lines 62–67). But Section 3’s code snippet for `handicap-strokes.ts` explicitly imports `calcCourseHandicap` from `../services/handicap.js` (lines 82–95). Task 1 also says “Calls `calcCourseHandicap` from `services/handicap.js`” (lines 394–399). That reintroduces the engine→services dependency the section claims to eliminate, and it’s confusing guidance for implementers.
   - Suggested fix: Update Section 3 snippet and Task 1 to match the chosen layering:
- `engine/handicap-strokes.ts` should *define* and export `calcCourseHandicap` (or import from a pure engine module), and `getHandicapStrokes` should call the engine-local function.
- `services/handicap.ts` should re-export from engine (if that’s truly the plan).

5. [medium] Provided services/handicap.ts content does not reflect the claimed “thin re-export” change
   - File: apps/tournament-api/src/services/handicap.ts:1-60
   - Confidence: medium
   - Why it matters: The review request says `services/handicap.ts` is modified to be a thin re-export of engine `calcCourseHandicap`, preserving API. But the provided file content still contains the full `calcCourseHandicap` implementation (lines 40–60) and has no re-export/import from `src/engine/handicap-strokes.ts`. If the repo currently matches this content, then the layering change described in the spec is not actually implemented.
   - Suggested fix: If layering option (A) is the desired final state, update `services/handicap.ts` to re-export `calcCourseHandicap` from the engine module and ensure any types (`CourseHandicapInput`) remain compatible. If you intentionally kept the implementation in services, revise the spec (Section 2b/Task 1/AC-1 import constraints) to match reality.

6. [medium] Plus-handicap clamp is specified, but base engine algorithm would return negative strokes without an explicit clamp
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:353-364
   - Confidence: high
   - Why it matters: AC-13(vii) requires: if `calcCourseHandicap` returns a negative integer, `getHandicapStrokes` returns 0 for every SI (line 363). However, the referenced baseline algorithm (packages/engine/src/stableford.ts:11-16) would produce negative strokes for negative `ch` because `Math.floor(ch/18)` and `ch % 18` are negative in JS (packages/engine/src/stableford.ts:13-15). The spec needs to ensure implementers add an explicit clamp before computing base/extra; otherwise the acceptance criterion will fail or be accidentally ignored.
   - Suggested fix: In the engine `getHandicapStrokes` implementation, explicitly clamp course handicap before division/modulo, e.g. `const ch0 = Math.max(0, ch)` (or if using a rounded HI directly, clamp that). Add/keep the AC-13(vii) unit test to enforce it.

## Strengths

- AC-10 now clearly defines the sign convention and ties perRound.total to both perHole deltas and the “team A side” pair-cell sum (lines 330–342).
- AC-5 removes the previous tie contradiction by making `sandiesApplied=false` on tied/lost holes and clarifies ‘par or better’ is gross par (lines 296–303).
- Greenie eligibility is now driven by explicit per-hole `closestToPinPlayerId` input rather than a fragile heuristic, which is more realistic and testable (lines 150–163, 304–313).
- AC-2 now explicitly specifies skip-not-throw behavior for missing per-hole score cells, which is a concrete contract for callers and tests (lines 279–283).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md
