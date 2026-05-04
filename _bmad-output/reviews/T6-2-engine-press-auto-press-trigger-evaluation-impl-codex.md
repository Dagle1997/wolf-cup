# Codex Review

- Generated: 2026-05-04T12:19:49.460Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/rules/press.ts, apps/tournament-api/src/engine/rules/press.test.ts, apps/tournament-api/src/engine/rules/__fixtures__/press-a-no-press.json, apps/tournament-api/src/engine/rules/__fixtures__/press-b-single-auto.json, apps/tournament-api/src/engine/rules/__fixtures__/press-c-compound-auto.json, apps/tournament-api/src/engine/rules/__fixtures__/press-d-idempotent-replay.json, apps/tournament-api/src/engine/rules/__fixtures__/press-e-manual-with-undo.json, apps/tournament-api/src/engine/rules/__fixtures__/press-f-manual-and-auto-interleaved.json, _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md

## Summary

Implementation largely matches the spec: pure function, boundary validation, deterministic ordering, multiplier preservation for carried-forward log entries, base + compound auto-press evaluation, hole-18 suppression, and auto-disabled semantics. The main concrete gaps are spec/fixture drift for AC-6 (compound example) and incomplete boundary-validation test coverage relative to the AC-2 surface (several enum/range/dedupe cases aren’t exercised).

Overall risk: medium

## Findings

1. [medium] Fixture (c) does not match the AC-6 compound scenario described in the spec (throughHole=8, second press at startHole=9)
   - File: apps/tournament-api/src/engine/rules/__fixtures__/press-c-compound-auto.json:1-27
   - Confidence: high
   - Why it matters: The spec’s AC-6 explicitly describes a compound press where press_2 fires at startHole=9 with throughHole=8. The provided fixture (c) uses throughHole=7 and expects press_2 at startHole=7. Even though the engine logic appears capable of handling the AC-6 scenario, the golden fixture suite no longer validates the stated acceptance criteria. This creates drift risk: a regression that breaks the hole-8→startHole-9 compound case could slip through while fixtures still pass.
   - Suggested fix: Either (1) update fixture (c) to exactly represent the AC-6 scenario from the spec (include hole 8, set throughHole=8, expect press_2 at startHole=9), or (2) update the spec text/AC-6 section to match the intended fixture and ensure the acceptance criteria reflect what’s actually tested.

2. [medium] Boundary-validation tests do not cover several AC-2-required failure modes (enum membership, negative values, existingPressLog dedupe/type/team/trigger)
   - File: apps/tournament-api/src/engine/rules/press.test.ts:99-182
   - Confidence: high
   - Why it matters: The implementation has broad validation (e.g., manualPress.team, perHoleResults[].winner, existingPressLog[].type/team/trigger, duplicate existingPressLog keys), but the test suite only exercises a subset (throughHole range/integer, pressMultiplier, autoPressTriggerAtNDown > 18, duplicate/missing perHoleResults, duplicate manualPresses, existingPressLog multiplier). If future edits accidentally weaken validation for untested categories, CI may not catch it, despite AC-2 requiring fast-fail behavior for those cases.
   - Suggested fix: Add targeted tests for at least: (a) manualPress.team invalid, (b) manualPress.filedAtHole out of range, (c) perHoleResults[].winner invalid, (d) config.autoPressTriggerAtNDown negative and/or non-integer, (e) duplicate existingPressLog (same type/team/startHole), (f) existingPressLog[].type invalid, (g) existingPressLog[].team invalid, (h) existingPressLog[].trigger non-string.

## Strengths

- Pure function discipline is upheld in the engine code: no I/O, no time/env/crypto usage, and tests assert no input mutation (press.ts:197-377; press.test.ts:87-97).
- Carry-forward correctly preserves historical multiplier and trigger from existingPressLog (press.ts:277-288), matching the mid-event rule-change resilience requirement (AC-14/T5-11 note).
- Auto-press disabling semantics (null or 0) are implemented exactly (press.ts:306-308) and covered by tests (press.test.ts:256-296).
- Hole-18 suppression is correctly implemented by dropping candidates with startHole > 18 (press.ts:175-186) and is covered by a dedicated test (press.test.ts:221-254).
- Deterministic ordering uses explicit rank maps and a comparator (press.ts:135-143) and is asserted structurally in tests (press.test.ts:44-74).
- Compound evaluation walks nested matches for every known press (existing + manual + newly fired) (press.ts:329-368), consistent with the spec’s replay correctness requirement.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md
