# Codex Review

- Generated: 2026-04-27T20:48:06.153Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md

## Summary

Round-2 fixes appear correctly reflected in the spec text (Test F expectation, canonical fixture trigger explicitly handling `pins: []`, explicit sit-out RR formula, and pins>sit-out precedence + new Test H). Two concrete drifts/ambiguities remain in this spec doc: (1) test-count inconsistencies (7+ vs 8+), and (2) sit-out RR formula is defined over the full roster but also says sit-outs are chosen from the un-pinned remainder—those two rules need a precise, implementable combination to preserve the “no permanent benching when numRounds*sitOutCount >= roster.length” guarantee under pins.

Overall risk: medium

## Findings

1. [medium] Test-count drift: doc still says 7+ tests in places but AC #8 now requires ≥8
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:201-205
   - Confidence: high
   - Why it matters: This creates an easy failure mode where implementation/test-writing follows the earlier “7+” guidance (also repeated in the project structure section) and then misses the updated acceptance criteria requiring 8 tests. It also makes reviewer verification harder because the spec is internally inconsistent.
   - Suggested fix: Update all remaining “7+ / at least 7 tests” mentions to “8+ / at least 8 tests” (e.g., Task 3 at line ~201 and the structure note at lines ~233–235).

2. [medium] Sit-out rotation guarantee is specified over full roster but also constrained to “unpinned remainder”; needs an exact selection algorithm to keep the no-permanent-benching claim true under pins
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:31-34
   - Confidence: medium
   - Why it matters: The RR formula `roster[(r * sitOutCount + i) % roster.length]` (line ~31) does rotate cleanly over the full roster: if `numRounds * sitOutCount >= roster.length`, every index 0..N-1 appears at least once. However, line ~33 adds “sit-outs select from the un-pinned remainder” and “pinned players NEVER sat out.” If the implementation computes sat-outs by that formula and then filters out pinned players, you can end up with fewer than `sitOutCount` sit-outs (or require a “skip and continue” rule). Without a precisely defined skip/advance behavior, the rotation and fairness guarantee can drift, and you could still end up with some unpinned players never playing even when `numRounds * sitOutCount >= roster.length` (because pins effectively reduce the eligible sit-out pool and can change the per-round mapping).
   - Suggested fix: Codify the exact algorithmic rule in the spec: e.g., define an `eligible = roster.filter(notPinnedThisRound)` list and run RR over `eligible.length` (with its own rotation index), OR define a deterministic “walk forward until you accumulate sitOutCount non-pinned players” rule over the full-roster ring. Then restate the permanent-benching condition in terms of the actual eligible pool used for sit-outs.

## Strengths

- Canonical fixture trigger explicitly treats `pins: undefined` and `pins: []` identically (lines ~39–47), addressing the JS truthiness pitfall.
- Pins-vs-sit-out precedence is explicitly specified (pins first; pinned never sat out) and backed by a dedicated test case Test H (lines ~33–34, ~171–173).
- AC #6 now clearly requires an empty grid (not partial) for insufficient roster, and Test F is aligned to that exact shape (lines ~29–30, ~154–171).

## Warnings

None.
