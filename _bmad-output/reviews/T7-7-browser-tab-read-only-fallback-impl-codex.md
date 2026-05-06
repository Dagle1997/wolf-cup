# Codex Review

- Generated: 2026-05-05T22:26:12.732Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/lib/display-mode.ts, apps/tournament-web/src/lib/display-mode.test.ts, apps/tournament-web/src/components/not-found.tsx, apps/tournament-web/src/components/not-found.test.tsx, apps/tournament-web/src/router.ts, apps/tournament-web/src/main.tsx, apps/tournament-web/src/main.test.tsx, apps/tournament-web/src/routes/__root.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx

## Summary

Mechanical fixes generally improved test coverage (router factory sharing + hook listener tests) and reduced cross-test contamination risk, but there are still a few concrete gaps: (1) router factory typing currently discards TanStack Router type-safety, (2) the new main wiring test still doesn’t *prove* main.tsx uses the factory (only that the factory wires NotFound), (3) the hook cleanup test doesn’t ensure the same listener reference is removed, and (4) the navigator.userAgent teardown can still leak a mutated UA if deletion fails (the catch currently suppresses the failure without restoring the original descriptor).

Overall risk: medium

## Findings

1. [medium] Router factory return type `AnyRouter` degrades app-wide TanStack Router type safety
   - File: apps/tournament-web/src/router.ts:9-24
   - Confidence: high
   - Why it matters: In `router.ts`, `createAppRouter` is explicitly typed to return `AnyRouter` (line 17). In `main.tsx`, the module augmentation registers `router: typeof router` (apps/tournament-web/src/main.tsx:13-16). Because `router` is now inferred as `AnyRouter`, this largely defeats the “type registration — required for TanStack Router type safety” goal and can mask route/param typing regressions across the app.
   - Suggested fix: Let TypeScript infer the return type, or explicitly return `ReturnType<typeof createRouter>` / `Router<typeof routeTree>` instead of `AnyRouter`. Example: `export function createAppRouter(history?: RouterHistory) { return createRouter({ routeTree, defaultNotFoundComponent: NotFound, ...(history ? { history } : {}) }); }`.

2. [medium] `main.test.tsx` validates `createAppRouter` wiring, but still doesn’t prove `main.tsx` uses it
   - File: apps/tournament-web/src/main.test.tsx:15-47
   - Confidence: high
   - Why it matters: The test imports and exercises `createAppRouter` directly (main.test.tsx:23-46), which proves the factory wires `defaultNotFoundComponent: NotFound` (router.ts:18-21). However, it still does not fail if `main.tsx` stops calling `createAppRouter()` and instead constructs a router differently (e.g., `createRouter({ routeTree })`). In that scenario, production could lose the NotFound wiring while this test continues to pass.
   - Suggested fix: Add an assertion that `main.tsx` calls `createAppRouter` (e.g., `vi.mock('./router', ...)` and import `./main` in the test with `react-dom/client` mocked so it doesn’t actually mount), or export the production router instance from a module that both `main.tsx` and tests import. The key is: make the test fail if `main.tsx` no longer uses the shared factory.

3. [low] Hook cleanup test doesn’t verify the same callback reference is removed
   - File: apps/tournament-web/src/lib/display-mode.test.ts:81-139
   - Confidence: high
   - Why it matters: The new tests do verify `addEventListener('change', ...)` registration and that `removeEventListener` is called on unmount (lines 120-139). But the removal assertion uses `expect.any(Function)` (line 138), so a regression where the code removes a different function reference than the one added (effectively leaking the real listener) would still pass. This is a common subtle cleanup bug.
   - Suggested fix: Capture the exact function passed to `addEventListener` and assert `removeEventListener` is called with that same function. For example, in `stubMatchMediaWithListener`, store `captured` and then `expect(mql.removeEventListener).toHaveBeenCalledWith('change', captured)` after unmount.

4. [medium] navigator.userAgent teardown may leave global test environment mutated if deletion fails
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx:936-966
   - Confidence: medium
   - Why it matters: The new `afterEach` tries `Reflect.deleteProperty(navigator, 'userAgent')` and swallows failures (lines 944-952 in the diff section). If deletion fails, the overridden UA can persist into subsequent test files in the same Vitest environment, potentially causing order-dependent failures or masking UA-specific code paths. The comment says “safe to ignore,” but it is not safe for suite isolation if the override sticks.
   - Suggested fix: Before overriding, capture the original property descriptor (from the instance or prototype) and restore it in `afterEach` via `Object.defineProperty`. Avoid swallowing the failure without restoration. Since you define the override with `configurable: true` in test (line 981+), deletion *should* work; if it doesn’t, restoring the original descriptor is the robust fallback.

5. [low] `NotFound` component doc comment is now inaccurate (wiring moved to router.ts)
   - File: apps/tournament-web/src/components/not-found.tsx:1-5
   - Confidence: high
   - Why it matters: The comment says NotFound is wired via `defaultNotFoundComponent` in `main.tsx`, but the wiring now lives in `router.ts` (router.ts:18-21). This is minor, but misleading docs can cause future maintenance mistakes (especially since tests are trying to guarantee this wiring).
   - Suggested fix: Update the comment to reference `router.ts` (or the `createAppRouter` factory) instead of `main.tsx`.

## Strengths

- Extracting `createAppRouter()` into `router.ts` centralizes router configuration and removes duplicated test-only router setup.
- New `useIsInstalledPWA` tests cover: initial value, listener registration, state update on change, and unmount cleanup—good regression coverage for the matchMedia listener path.
- Score-entry install × scorer matrix tests explicitly validate the intended gating/ordering behavior (non-scorers never see install-required; scorers do when not installed).
- The route-level install-required branch short-circuits after the `!isScorer` branch, matching the stated spec intent and preventing misleading prompts.

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx
