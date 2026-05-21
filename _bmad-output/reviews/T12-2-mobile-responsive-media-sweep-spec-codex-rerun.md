# Codex Review

- Generated: 2026-05-21T20:25:43.130Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md

## Summary

The revised spec meaningfully addresses the prior review’s core risks: it removes the global `table { display:block }` change in favor of per-route overflow wrappers, drops `white-space: nowrap`, tightens AC-1 to combine (a) grep-verifiable wrapping with (b) a Chromium layout-based harness, improves the overflow assertion to check both `documentElement` and `body`, and scopes the 44px tap-target bump to already-scoped selectors (explicitly excluding checkbox/radio/range).

However, there are a few remaining spec-level inconsistencies and some acceptance-criteria overclaim/ambiguity that could cause the implementation to drift back toward the earlier rejected approach or make ACs hard to verify unambiguously. Also, wrapping tables in an `overflow-x:auto` container has a couple real-world downsides that are not yet acknowledged/mitigated (focus outline clipping; flex-item min-width behavior; iOS momentum scrolling).

Overall risk: medium

## Findings

1. [medium] Spec contradicts itself on `white-space: nowrap` (dropped vs still discussed as an option)
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:24-80
   - Confidence: high
   - Why it matters: The spec states the fix uses natural wrapping and explicitly says “NO `white-space: nowrap` — dropped” (line 25). But later the Risks/Followups section discusses a “`white-space: nowrap` tradeoff” and even suggests it as acceptable (line 78). This inconsistency can lead to reintroducing the previously removed behavior and re-opening the readability concern.
   - Suggested fix: Either remove the nowrap discussion entirely, or reword it to reflect the current decision (e.g., “We are not using nowrap in this story; if a specific table later needs it, handle per-table in a followup”).

2. [medium] Dev Notes still describe the rejected `display:block` responsive-table pattern, conflicting with the chosen wrapper approach
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:69-71
   - Confidence: high
   - Why it matters: The story’s chosen fix is explicit wrappers around each table (line 25) and “no `@media` needed for tables.” But Dev Notes say the standard pattern is `display:block; overflow-x:auto` under a media query (line 70), which is the approach previously rejected as too semantically risky. This can confuse implementers/reviewers and cause regression toward the earlier risky change.
   - Suggested fix: Update Dev Notes to describe the wrapper pattern as the selected fix (and optionally note that the `display:block` pattern is intentionally not used here).

3. [medium] AC-2 overclaims verifiability: “scrollWidth matches the unwrapped baseline” is not well-defined post-change
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:44-48
   - Confidence: high
   - Why it matters: AC-2 requires that at desktop width the wrapper is transparent and that `scrollWidth` “matches the unwrapped baseline” (line 47). After implementation, the unwrapped baseline may no longer be available to measure in the same build, and `scrollWidth` can vary due to scrollbar presence, font rendering differences, or minor DOM changes unrelated to overflow. This risks false failures or unverifiable claims.
   - Suggested fix: Rewrite AC-2 to assert observable outcomes without needing a historical baseline (e.g., at ≥1024px: no horizontal page overflow; wrapper `scrollWidth === clientWidth` (no internal horizontal scroll); table layout visually unchanged in a screenshot diff, if you want a stronger check).

4. [low] Wrapper downsides not acknowledged/mitigated: focus outline clipping, flex-item min-width behavior, and iOS scroll feel
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:24-65
   - Confidence: medium
   - Why it matters: Wrapping a table in `overflow-x:auto` is generally safe, but it can introduce:
- Focus ring/outline clipping if interactive elements exist inside the scroll container (overflow clipping can cut off box-shadows/outlines).
- If the wrapper ends up inside a flex container, default `min-width:auto` on flex items can prevent shrinking and cause the wrapper to expand instead of scrolling.
- On iOS, horizontal scroll containers often benefit from `-webkit-overflow-scrolling: touch` for smoother scrolling.
These are plausible in route layouts and can lead to “still overflows” or degraded UX even with correct wrapping.
   - Suggested fix: In the spec, call out these known edge cases and standard mitigations. Consider using a small reusable CSS class (e.g., `.table-scroll { overflow-x:auto; max-width:100%; -webkit-overflow-scrolling:touch; }` and, where needed in flex contexts, ensure the wrapper (or its parent) has `min-width:0`). If you keep inline styles, at least mention `maxWidth:'100%'` as a guard.

5. [low] Allowed-path constraint is stated, but the spec file itself lives outside the allowed code paths
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:21-23
   - Confidence: medium
   - Why it matters: Risk Acceptance says edits are allowed only in `apps/tournament-web/src/**` plus sprint-status (line 21–23), but this spec lives under `_bmad-output/...`. If the process commits spec changes alongside code, that technically violates the stated constraint (even if it’s non-shipped). This is mostly a governance/documentation mismatch, but it can create review friction.
   - Suggested fix: Clarify that the “ALLOWED only” constraint applies to shipped product code, and that story/spec artifacts under `_bmad-output` are expected to change as part of planning (or add `_bmad-output/.../T12-2...md` to the explicitly allowed list).

6. [low] AC-1’s “grep-verifiable” wrapping requirement is directionally good but still ambiguous about detection scope
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:38-43
   - Confidence: medium
   - Why it matters: AC-1 relies on grep to prove all table sites are wrapped (line 40–42). If a route renders a table via a shared component or conditional rendering, simple grep for `<table>` in those routes may not prove runtime wrapping in all paths. You partially address this by scoping to the “7 routes that render `<table>`,” but the grep criterion could still be interpreted loosely.
   - Suggested fix: Tighten the wording: define the exact grep target (e.g., each of the 7 route files contains exactly one `<table` and it appears lexically within the wrapper `div`), or require an explicit wrapper component usage around the table callsite (if table is produced by a subcomponent).

## Strengths

- High-risk global semantic change removed: wrapper approach keeps `table` semantics intact (lines 24–25).
- `white-space: nowrap` removed from the proposed fix (line 25).
- AC-1 now combines a per-route enforcement mechanism (grep) with a real layout-capable harness (Chromium), and explicitly documents the harness limitation (lines 38–43).
- Overflow verification improved to check both `documentElement` and `body` scrollWidth (line 41).
- Tap-target bump is scoped to existing selectors and explicitly excludes checkbox/radio/range (lines 49–53).
- Rejected the risky `overflow-x:hidden` guard (line 25).
- File list enumerates 7 route files + index.css + sprint-status (lines 81–90), matching the narrative claim of 7 table routes.

## Warnings

None.
