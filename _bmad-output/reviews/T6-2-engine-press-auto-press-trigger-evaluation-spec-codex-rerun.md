# Codex Review

- Generated: 2026-05-04T00:42:34.945Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md

## Summary

The prior-pass issues appear addressed in the spec text: Section 5 now specifies a fixed-point compound evaluation that re-walks carried-forward presses (lines 50–61, 299–308); Section 6b clarifies manual presses are always included in activePresses while canUndo is the only throughHole-gated concept (lines 78–89); AC-13 now mandates an explicit rank-map comparator (lines 240–248); and AC-2 expands validation for perHoleResults + existingPressLog (lines 174–189). 

Remaining gaps are mostly around compound semantics + dedupe identity and a couple internal spec contradictions that could lead to real money/ledger undercounting or implementation divergence.

Overall risk: medium

## Findings

1. [high] Compound evaluation semantics are internally contradictory: do manual presses spawn nested-match auto triggers or not?
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:50-305
   - Confidence: high
   - Why it matters: Section 5 defines compound presses as arising when an auto-press fires and creates a nested match (lines 52–53), but then the critical fix states “every press that EXISTS in the world spawns a child match” (line 54) and Task 1 Step 7 says to evaluate compound triggers “for each press in allPresses” (lines 299–304) without filtering to type==='auto'.

If implemented literally, manual presses will also generate nested-match auto-press triggers. That can materially change the ledger (extra auto presses) and/or interact badly with dedupe (see next finding), causing missing or phantom presses and downstream money miscomposition.
   - Suggested fix: Make the rule explicit and consistent in ONE place:
- If ONLY auto presses can generate compound auto presses: in Step 7 iterate only presses where press.type==='auto' (and adjust the “every press spawns a child match” sentence).
- If manual presses ALSO spawn nested matches eligible for auto triggers: add an explicit AC + fixture covering manual→compound behavior, and revisit dedupe identity to avoid collapsing distinct child presses from distinct parent matches.

2. [high] Global dedupe key (type, team, startHole) may collapse distinct compound presses when multiple matches share the same segment startHole
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:63-76
   - Confidence: medium
   - Why it matters: The dedupe key is specified as (type, team, startHole) (line 63) and duplicates in existingPressLog are forbidden by that same triple (AC-2, line 186). But the spec also explicitly allows manual and auto presses to coexist for the same team and hole (line 72).

If compound triggers are evaluated per-match (as Section 5’s nested-match model implies, lines 52–53), then having both an auto press and a manual press starting on the same hole creates two distinct matches with identical segments. Each could independently reach N-down and “should” be able to fire its own compound auto press at the same child startHole. With a global dedupe key, those two distinct child presses would be merged into one, undercounting presses (and money) in exactly the kind of “manual + auto interleaved” scenario you already model (AC-10).

Even if you *intend* to collapse them, the spec currently presents nested matches as distinct per press, which conflicts with a global dedupe that effectively treats matches with same startHole as the same match.
   - Suggested fix: Decide and encode the intended identity model:
- If matches are truly per-press: dedupe keys for auto presses need parent identity (e.g., include parentPressKey) and PressLogEntry likely needs a parent reference; update AC-2 duplicate rule + persistence followup accordingly.
- If the intended model is “at most one auto press per (team,startHole) regardless of which parent match would have spawned it”: explicitly state that overlapping matches with the same segment share the same auto-trigger chain, and add an AC/fixture demonstrating the collapse is expected (to prevent future ‘bug fixes’ that change it).

3. [medium] Iteration/depth cap guidance is inconsistent: spec says v1 ships without a cap but Tasks require a 50-iteration cap + throw
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:65-308
   - Confidence: high
   - Why it matters: Section 5 says “v1 ships without a cap” (line 65), while Task 1 requires a defensive max-iteration cap (line 308). The Risks section also repeats “v1 ships without the cap” (lines 345–346). This affects runtime behavior (possible throw in production) and test expectations.

Inconsistent requirements here can lead to: (1) missing the cap entirely (risking accidental infinite loop on a bug), or (2) adding a throw that isn’t expected/handled upstream.
   - Suggested fix: Pick one policy and align all sections:
- Prefer: keep the 50-iteration cap (safety), and add an explicit AC that defines the failure mode (e.g., throws Error('Press recursion exceeded cap')).
- Or remove the cap from Tasks if you truly want no cap in v1 (not recommended).

4. [medium] Validation gap: spec doesn’t require perHoleResults completeness for holes <= throughHole, risking silent mis-evaluation if inputs are inconsistent
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:44-190
   - Confidence: medium
   - Why it matters: The algorithm walks holes 1..throughHole to compute deltas (Task 1 Step 6, lines 295–297), but AC-2 validates only ranges/enums and duplicate holeNumbers (lines 183–185). If perHoleResults is missing a holeNumber <= throughHole (e.g., data bug or partial write), an implementation using a holeByNumber map could treat missing holes as ties/no-ops, delaying or preventing auto-press triggers.

Because press firing is money-critical and replay-based, failing fast on inconsistent state is safer than silently producing a different press ledger.
   - Suggested fix: Extend AC-2: if any holeNumber in [1..throughHole] is absent from perHoleResults, throw Error. Add at least one boundary-validation test case for this.

5. [low] Manual presses: duplicates within manualPresses aren’t specified (throw vs dedupe)
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:174-295
   - Confidence: high
   - Why it matters: AC-2 forbids duplicates in existingPressLog (line 186) but is silent on duplicates in manualPresses (same team + filedAtHole repeated). The algorithm will currently “dedupe” them via dedupeKeys (lines 291–295), which can mask upstream bugs or double-click UX issues.

This is unlikely to be catastrophic, but making it explicit improves determinism and debugging.
   - Suggested fix: Specify one:
- Throw Error on duplicate manualPresses entries (recommended), OR
- Explicitly state manualPresses are deduped by (team,filedAtHole) and only the first is used. Add a small test either way.

## Strengths

- Fixed-point compound evaluation now explicitly includes carried-forward presses, directly addressing the prior replay-miss bug (lines 54–61, 299–305).
- Manual press “active” semantics are now clear and explicitly decoupled from the undo window (lines 78–89, 94–97).
- AC-13 now mandates a rank-map comparator, avoiding reliance on enum string ordering (lines 240–248).
- Validation coverage is substantially expanded for perHoleResults and existingPressLog (AC-2, lines 174–189).

## Warnings

None.
