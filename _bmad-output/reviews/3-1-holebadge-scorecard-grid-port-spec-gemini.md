# Gemini Review

- Generated: 2026-06-22T22:12:03.118Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md

## Summary

The spec effectively scopes the S1 port to pure presentational components and correctly identifies the styling differences between the apps. However, the `ScorecardHole` type strictly defining `moneyNet` as a non-nullable number fundamentally contradicts the AC #6 requirement to avoid fabricating `$0` from absent data. Additionally, cross-app imports are not explicitly forbidden, and the CSS token mapping contains ambiguities.

Overall risk: high

## Findings

1. [high] Type definition structurally forces $0 fabrication, violating AC #6
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:39
   - Confidence: high
   - Why it matters: The `ScorecardHole` type defines `moneyNet: number`. Since it is non-nullable, developers are forced to pass `0` when money data is absent or uncomputed. This structurally forces the UI to render `$0`, violating the explicit constraint in AC #6 to 'NEVER fabricate $0 from absent live data'.
   - Suggested fix: Change the type to `moneyNet?: number` or `moneyNet: number | null` so that 'unknown/uncomputed' money can be structurally distinguished from an actual $0 net result.

2. [medium] Ambiguous CSS variable mapping for `bg-muted`
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:62
   - Confidence: high
   - Why it matters: The spec provides an ambiguous instruction for replacing `bg-muted/30`, stating 'e.g. var(--color-surface-sunken) or a low-alpha border tint'. Furthermore, Task 3 (line 44) entirely omits the replacement mapping for `bg-muted`. This forces the developer to guess the correct token, risking visual inconsistency.
   - Suggested fix: Remove the ambiguity and mandate a specific tournament token (e.g., strictly map it to `var(--color-surface-sunken)`). Add this specific mapping to Task 3.

3. [medium] Missing explicit guardrail against cross-app imports
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:66
   - Confidence: high
   - Why it matters: The scope guardrails strictly forbid *editing* files in `apps/web/**`, but fail to explicitly forbid *importing* from it. A developer porting components 'near-verbatim' might inadvertently import types or utility functions from `apps/web`, which would create an illegal cross-app dependency and break FD-1/FD-2 isolation.
   - Suggested fix: Update the Scope Guardrails to explicitly state: 'FORBIDDEN: Any imports from `apps/web/**`, `apps/api/**`, or `packages/engine/**`. All ported code must be completely standalone.'

## Strengths

- Excellent slicing of the feature into a fixture-driven presentation shell (S1) to avoid mixing UI layout work with API/business logic.
- Comprehensive test coverage requirements in AC #8 that focus on behavior rather than brittle class names.
- Good awareness of the underlying technical styling differences (Tailwind v4 vs shadcn aliases) between the apps.

## Warnings

None.
