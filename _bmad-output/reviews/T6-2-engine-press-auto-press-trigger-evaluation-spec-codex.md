# Codex Review

- Generated: 2026-05-04T00:38:31.582Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md, apps/tournament-api/src/engine/formats/best-ball-2v2.ts, _bmad-output/planning-artifacts/tournament/epics-phase1.md

## Summary

Spec is detailed and mostly internally consistent on match-play “N-down” semantics and next-hole activation. Two areas look likely to cause real correctness gaps in the eventual implementation: (1) compound auto-press recursion needs to evaluate children of *logged* (already-fired) presses, not just presses newly fired in the current call, otherwise stacked auto-presses won’t appear on replay; (2) manual-press “active” semantics around the hole-in-progress are contradictory in the spec text and could make presses filed between holes invisible until after they should have applied. Deterministic ordering and validation surfaces are mostly well-specified but should be made explicit in comparator logic and runtime checks for perHoleResults shape to avoid drift.

Overall risk: medium

## Findings

1. [critical] Compound auto-press recursion as written will miss stacked presses when the parent press is already in existingPressLog
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:174-183
   - Confidence: high
   - Why it matters: AC-5 requires idempotency (don’t re-fire an already-logged press), but AC-6 requires compound presses to fire inside a nested match. The algorithm sketch only says “For each fired press, recurse” (Task 1 step 6 / line 268). If press_1 is already in existingPressLog (common on subsequent evaluations as throughHole advances), it won’t be “newly fired” in this call; if recursion only happens for newly fired presses, press_2 will never be discovered/fired. This breaks deterministic replay and makes stacked auto-presses depend on evaluation history rather than current snapshot.
   - Suggested fix: When building the match tree, recurse into *all active auto-presses* (carried-forward from existingPressLog + those newly fired), not just newly fired in this pass. Concretely: (a) materialize a list of auto presses from log+new; (b) for each auto press, evaluate its child segment for additional fires (respecting dedupe); (c) continue until no new fires. Add a fixture/test: existingPressLog contains press_1 (startHole=5) and throughHole=8 state should newlyFire press_2 (startHole=9).

2. [high] Manual press “active” rule is contradictory and may exclude presses filed for the current (in-progress) hole
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:60-63
   - Confidence: high
   - Why it matters: Section 6 says manual presses are echoed back if `filedAtHole <= throughHole + 1`, but then immediately states v1 includes manual presses only when `filedAtHole <= throughHole` (line 61). Task 1 step 5 also uses `filedAtHole <= throughHole` (line 263–264). If `throughHole` means “last fully committed hole” (AC-1 line 137–138), then during hole 7 play `throughHole=6`; a press filed at hole 7 should arguably be active (and undoable) for hole 7, but this rule would omit it until after hole 7 is committed, which can be too late for downstream computation/UI depending on how T6-4 calls this function.
   - Suggested fix: Pick one semantic and encode it consistently in AC + tasks + tests. If the function must support “current hole in progress” display/undo, include manual presses when `filedAtHole <= throughHole + 1` and compute canUndo accordingly. If the function is only ever called post-commit and never used mid-hole, explicitly state that and remove the contradictory `throughHole+1` mention. Add a test covering `throughHole=N-1` with a manual press at `filedAtHole=N` and expected presence/absence (whichever you choose).

3. [medium] Deterministic ordering should not rely on default string comparison for type/team
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:214-218
   - Confidence: medium
   - Why it matters: AC-13 says ordering is load-bearing for deterministic replay. If implementation uses plain `localeCompare` or default `<` comparisons, it will currently put `'auto' < 'manual'` and `'teamA' < 'teamB'`, but this is an implicit assumption. Any future type value changes (or accidental capitalization) could silently break ordering and replay stability.
   - Suggested fix: Implement an explicit comparator with rank maps, e.g. `typeRank = { auto: 0, manual: 1 }`, `teamRank = { teamA: 0, teamB: 1 }`, then compare `(startHole, typeRank, teamRank)`.

4. [medium] Runtime validation surface doesn’t mention perHoleResults invariants (winner enum, holeNumber range), despite “defensive validation” goal
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:81-86
   - Confidence: medium
   - Why it matters: The spec promises defensive validation (line 85–86) but AC-2 does not require validating `perHoleResults` contents. In practice, this function will be fed JSON-derived data eventually; a bad `winner` value or out-of-range/non-integer `holeNumber` could cause incorrect deltas, missed triggers, or non-deterministic behavior if filtering/sorting assumes valid data.
   - Suggested fix: At minimum validate each `HoleResult.winner` is one of `'teamA'|'teamB'|'tie'` and `holeNumber` is an integer in [1,18]. Decide whether to also enforce uniqueness/sortedness or just tolerate any order by sorting/filtering defensively. Add a small throw-test (AC-2 extension) for unknown winner/holeNumber.

## Strengths

- Clear separation of concerns: trigger/ledger only (no money composition), keeping `evaluatePresses` pure and golden-testable (spec lines 38–41, 81–86).
- Auto-press semantics are explicitly defined in match-play terms (holes won vs lost; ties no-op), which matches standard convention (spec lines 44–48).
- Edge cases are explicitly pinned (hole 18 no-fire, autoPressTriggerAtNDown null/0 disabled), reducing ambiguity (spec lines 58–66, 204–213).
- Idempotency contract is explicit via `(type, team, startHole)` dedupe and duplicate-log rejection, supporting replay correctness (spec lines 56–57, 162–177).
- Undo semantics are well-scoped (manual only; auto never undoable) and expressed as a simple predicate (spec lines 69–76).

## Warnings

- Truncated file content for review: _bmad-output/planning-artifacts/tournament/epics-phase1.md
