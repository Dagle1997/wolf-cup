# Codex Review

- Generated: 2026-05-21T13:42:58.746Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/hooks/use-auth-session.test.ts

## Summary

PASS (with minor caveats). The window.location restore approach is materially improved and should prevent cross-test-file leakage in the same worker. The new `queryFn === fetchAuthStatus` assertion does lock the intended cache-shape-consistency decision via reference equality. Remaining concerns are edge-case completeness around restoring `window.location` if no own-property descriptor exists, and the fact that replacing `window.location` with a spread plain object can omit non-enumerable Location fields (potentially masking/creating behavior differences if code under test ever reads them).

Overall risk: low

## Findings

1. [low] Location restore is incomplete if `window.location` is not an own-property (descriptor null/undefined) — could still leak stub
   - File: apps/tournament-web/src/hooks/use-auth-session.test.ts:38-56
   - Confidence: medium
   - Why it matters: You correctly note that `Object.defineProperty` is not undone by `vi.unstubAllGlobals()`, and restoring the original descriptor is the right idea. However, `Object.getOwnPropertyDescriptor(window, 'location')` can be `undefined` in some environments/implementations if `location` is inherited rather than an own-property. In that case, the `beforeEach` creates an own-property stub, but `afterEach` won’t restore anything (since the `if (originalLocationDescriptor)` guard fails), leaving the stubbed `location` in place and reintroducing the pollution risk you were fixing.
   - Suggested fix: In `afterEach`, add an `else` branch that removes the test’s own-property override, e.g. `delete (window as any).location;` (or restore from `Window.prototype` descriptor if that’s your intended baseline). This makes the restore logic correct even when the original descriptor is missing.

2. [low] Replacing `window.location` with a spread plain object may drop non-enumerable Location fields, risking behavior divergence if code reads them
   - File: apps/tournament-web/src/hooks/use-auth-session.test.ts:43-46
   - Confidence: medium
   - Why it matters: The stub sets `window.location` to `value: { ...window.location, assign: assignSpy }`. Many `Location` properties are non-enumerable; spreading can omit them. If the implementation under test ever reads `window.location.*` (beyond `assign`), tests could fail for the wrong reason or pass while masking a real issue. This is not introduced by the restore change, but it’s a correctness/maintenance hazard in the stubbing pattern.
   - Suggested fix: Prefer stubbing only `assign` on the existing `window.location` object when possible (e.g., `vi.spyOn(window.location, 'assign')` if writable/configurable), or clone via `Object.create(window.location)` and then override `assign`, preserving prototype behavior more faithfully.

## Strengths

- The location-descriptor capture + restore via `Object.defineProperty` directly addresses the concrete leakage mechanism (`defineProperty` overrides surviving `vi.unstubAllGlobals`).
- Restoring in `afterEach` (not `afterAll`) is the right choice to prevent within-file coupling if a test fails mid-run.
- The new assertion `expect(callArgs.queryFn).toBe(fetchAuthStatus)` correctly enforces reference equality and will catch accidental wrapper lambdas (the stated intent for locking the cache-shape-consistency decision).
- The `fetchQuery` options assertions (queryKey/staleTime/retry/queryFn) are concrete and “load-bearing” in the way you describe, reducing risk of silent regressions.

## Warnings

None.
