# Codex Review

- Generated: 2026-04-28T16:57:51.395Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md, _bmad-output/planning-artifacts/tournament/epics-phase1.md

## Summary

STOP-on-High: Round-3 issues (auto-advance allowing “20”; skippedHoles persistence intent) are mostly addressed in prose, but the spec now contains a concrete, load-bearing correctness bug/contradiction in the `currentHole` selection algorithm that will likely snap the UI onto already-scored holes (or otherwise fail the pinned scenario). There are also a couple of spec ambiguities that could easily produce implementation bugs (controlled input requirement for “reject keystrokes”, and skippedHoles clear/persist equality semantics).

Overall risk: high

## Findings

1. [high] `currentHole` computation as specified can select an already-scored hole; contradicts the pinned “skip 5, score 6, stay on 7” behavior
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:181-186
   - Confidence: high
   - Why it matters: The spec defines:
- `firstUnscoredHole = min({ h | ... AND any member has no hole_score for hole h })`
- `currentHole = min({ h | h ∉ skippedHoles AND h ≥ firstUnscoredHole })`
This `currentHole` set does **not** filter to “unscored holes”; it includes *all* holes ≥ `firstUnscoredHole` that aren’t skipped—including holes that are already fully scored.

Concrete failure against the spec’s own pinned scenario (line 185): if hole 5 is skipped and remains unscored, and hole 6 is fully scored, then `firstUnscoredHole` is still 5, and the formula yields `currentHole = 6` (since 6 ≥ 5 and not skipped), not 7—directly contradicting “UI stays on 7 (NOT snapped back to 5).” Depending on implementation, this can cause re-entry attempts for hole 6, confusion, or inability to progress deterministically—trip-critical for FR-B2/B3 and the offline cadence goal.
   - Suggested fix: Redefine `currentHole` explicitly as the minimum hole needing action, e.g.:
- Compute `unscoredHoles = { h | 1..holesToPlay AND hole h is NOT fully scored for the foursome }`
- Then `currentHole = min(unscoredHoles \ skippedHoles)`.
If you need “optimistic advance while offline,” define an `optimisticallyCompletedHoles` set (or optimistic holeScores in query cache) that participates in the “fully scored” predicate. Update the pinned test statement to match the corrected algorithm.

2. [medium] Skipped-holes “computed clear + persist via useEffect” is underspecified: must update state and use value equality, or it will loop or never clear in UI
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:187-191
   - Confidence: high
   - Why it matters: The spec requires computing `next = skippedHoles - { h | server has all 4 cells filled }` and persisting `next` to sessionStorage “if differs” via a `useEffect`. But it does not explicitly require updating the in-memory `skippedHoles` state to `next`, nor define how to compare Sets for “differs.”

Two realistic failure modes:
1) Persist-only: sessionStorage updates but the live UI keeps using the old `skippedHoles` Set (so cleared holes remain skipped until refresh).
2) Infinite/extra writes: if the effect compares Sets by reference (`next !== skippedHoles`) it will always differ (new Set each render) and will write every render; if it also sets state each time, it can thrash.

This is exactly the class of issue round-3 was trying to eliminate; the spec needs to be unambiguous here.
   - Suggested fix: In the spec, require:
- A stable equality check (e.g., compare sizes + every element, or compare canonical sorted arrays) before writing.
- When cleared, call `setSkippedHoles(next)` (or maintain `effectiveSkippedHoles` derived value used for `currentHole` and persistence) so the UI reflects the cleared set immediately.
- Ensure the `useEffect` depends on the derived canonical representation (e.g., `clearedSkippedHolesKey = JSON.stringify([...next].sort())`) to avoid reference-churn loops.

3. [medium] Score input “reject keystrokes” guidance relies on `preventDefault` in onChange, and does not mandate controlled inputs—can break the 1–20 validation in practice
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:158-170
   - Confidence: high
   - Why it matters: The spec says invalid patterns are reverted via `e.preventDefault()` OR ignoring state update in `onChange`. In React, `preventDefault` in `onChange` generally cannot prevent the DOM value from changing (the change already happened). The “ignore state update” approach only reliably “reverts” if the input is **controlled** (`value={state}`), which the spec does not explicitly require.

If a dev implements the input as uncontrolled (or partially controlled), invalid values like `0`, `21`, or non-digits can appear and persist, breaking the auto-advance and Save-disable logic.
   - Suggested fix: Make it explicit that the score input is controlled and the rendered `value` always comes from `currentInputs[playerId] ?? ''`. If you want true keystroke-blocking, specify `onBeforeInput`/`onKeyDown` handling; otherwise specify the controlled-input revert pattern only (and remove `preventDefault` from the spec to avoid misleading guidance).

4. [low] 1500ms wait for single-digit 1/2 is a likely cadence hit; spec should justify or provide a faster escape hatch
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:171-177
   - Confidence: medium
   - Why it matters: The new state machine fixes the “20” entry problem, but makes the common single-digit scores of 1 or 2 require either a 1.5s pause or an explicit blur/tap elsewhere to advance. That may materially impact the ≤10s/hole interaction goal (NFR-P1), especially on fast-entry holes.

Not strictly a correctness bug, but it’s a product-risk tradeoff that should be consciously accepted or tuned (e.g., a shorter delay, or a dedicated explicit ‘Next’ action on the keypad row).
   - Suggested fix: Consider reducing the timer (e.g., 400–700ms) and/or allowing an explicit user action to commit/advance immediately (Enter/Done button, or a visible Next chevron) so 1/2 don’t impose a full 1500ms pause.

5. [low] `registerTerminalErrors` effect pinned to `[]` deps may conflict with exhaustive-deps unless the function is stable
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:121-132
   - Confidence: medium
   - Why it matters: AC #8 mandates `useEffect(..., [])` for one-time registration. If `registerTerminalErrors` comes from a hook and is not referentially stable, lint will either complain or the effect will capture a stale reference. Not necessarily broken, but it’s a common source of churn in implementation.
   - Suggested fix: Either (a) require `registerTerminalErrors` to be stable (document it in T5-3 API), or (b) explicitly allow disabling exhaustive-deps for this effect with a comment explaining why (and include the function in deps if it’s stable).

## Strengths

- Auto-advance state machine explicitly covers the previously-blocked “20” path and explains the rationale for immediate advance on 3–9 and delayed commit for 1/2 (T5-2 spec lines 171–177).
- Backend GET endpoint error-shape obfuscation (404 for non-participant) is clearly specified and addresses the earlier info-leak concern (lines 93–107).
- The iOS keyboard fix is called out as load-bearing and correctly requires synchronous focus inside the click handler plus stable keys (lines 54–55, 200–205, AC #6).
- Good explicit tenant-scoping posture: ‘every SELECT filters on tenant_id’ and a clear lookup chain (lines 100–107).
- Test-count gating and explicit backend/frontend test surfaces are called out (lines 243–250, AC #10), though the detailed list appears truncated in the provided content.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md
- Truncated file content for review: _bmad-output/planning-artifacts/tournament/epics-phase1.md
