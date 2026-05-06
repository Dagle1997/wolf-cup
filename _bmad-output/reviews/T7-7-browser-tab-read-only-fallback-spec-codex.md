# Codex Review

- Generated: 2026-05-05T21:56:40.173Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-7-browser-tab-read-only-fallback.md

## Summary

Spec is substantially tighter vs round 1: AC #6 is now explicitly anchored on `defaultNotFoundComponent` + `data-testid="not-found"`, and AC #7(c) is much less ambiguous by asserting the `role="dialog"` wrapper and the leaderboard link testid/href. The `useIsInstalledPWA()` contract is mostly sufficient for a stable implementation.

Two remaining issues look like they could still cause dev back-and-forth or flaky/non-actionable tests: (1) the proposed 404 test may not actually prove `main.tsx` wires `defaultNotFoundComponent` unless that component/router is exported (otherwise the test will likely duplicate the not-found component and can pass even if `main.tsx` is wrong), and (2) AC #7(c)’s UA seeding calls out “Chrome desktop UA” while also requiring the “Android branch” of `InstallPrompt`, which is inconsistent and may fail depending on how `install-prompt.tsx` detects Android vs. desktop Chrome.

Overall risk: medium

## Findings

1. [medium] 404 test as written may not validate `main.tsx` integration (likely requires exporting router or the NotFound component)
   - File: _bmad-output/implementation-artifacts/tournament/T7-7-browser-tab-read-only-fallback.md:91-105
   - Confidence: high
   - Why it matters: AC #6 requires that the production router in `apps/tournament-web/src/main.tsx` has a deterministic 404 via `defaultNotFoundComponent`. The proposed test in AC #7/Task 5b builds an in-test router using `{ routeTree, defaultNotFoundComponent, history }` (lines 241-244, 272-274). If `defaultNotFoundComponent` is defined inline inside `main.tsx` and not exported, the test will either (a) re-define its own `defaultNotFoundComponent` (which can pass even if `main.tsx` forgets to set it), or (b) require refactoring `main.tsx` anyway to make it importable. As currently specified, it’s ambiguous whether the test is asserting the actual integration point or just TanStack Router behavior in isolation.
   - Suggested fix: Make the test assert the real production wiring by exporting one of: (1) `export const defaultNotFoundComponent = ...` from `main.tsx`, or (2) `export function createAppRouter(opts?)` that returns the configured router, or (3) export the `router` instance (if safe) for tests. Then in `main.test.tsx`, import that exported symbol and render with memory history (or construct via exported factory) so the test fails if `main.tsx` omits `defaultNotFoundComponent`.

2. [medium] AC #7(c) UA seeding is internally inconsistent: “Chrome desktop UA” vs requiring Android branch rendering
   - File: _bmad-output/implementation-artifacts/tournament/T7-7-browser-tab-read-only-fallback.md:236-237
   - Confidence: medium
   - Why it matters: AC #7(c) requires asserting the inner `<InstallPrompt>` dialog wrapper and explicitly says to “stub `navigator.userAgent` to a Chrome desktop UA AND seed `window.__deferredInstallPrompt` … so the inner prompt renders the Android button branch” (line 236-237). If `install-prompt.tsx`’s branching is truly Android-specific (as the spec text claims), a desktop Chrome UA may not satisfy the branch conditions, leading to the prompt rendering null and making the dialog assertion fail. This is exactly the kind of test fragility that causes devs to re-open the spec.
   - Suggested fix: Change the spec to seed a clearly Android Chrome UA string (e.g., containing `Android` + `Chrome/`), or—better—describe the exact condition used by `InstallPrompt` (UA substring, platform detection, or “beforeinstallprompt present”) and seed accordingly. If the branch is actually “Chromium that supports beforeinstallprompt” (desktop included), rename the wording from “Android branch” to “Chromium/beforeinstallprompt branch” to remove the mismatch.

3. [low] SSR test suggestion `vi.stubGlobal('window', undefined)` may be brittle in jsdom unless isolated/restored carefully
   - File: _bmad-output/implementation-artifacts/tournament/T7-7-browser-tab-read-only-fallback.md:245-248
   - Confidence: medium
   - Why it matters: In a Vitest jsdom environment, globally stubbing `window` to `undefined` can have unexpected side effects across the test file (or leak if restoration is missed), potentially causing unrelated failures. The spec does say “then restored,” but it doesn’t prescribe isolation (module reset) which is often needed when testing SSR guards reliably.
   - Suggested fix: Prefer testing SSR safety by calling `isInstalledPWA()` in a `vi.isolateModules` / `vi.resetModules()` block with `vi.stubGlobal('window', undefined)` scoped to that block, or by temporarily setting `globalThis.window = undefined` with `try/finally` restoration and avoiding any other DOM calls in the same test case.

## Strengths

- AC #6 now has a concrete, testable anchor (`data-testid="not-found"` + heading), and explicitly calls out “no redirect to /” and “no unhandled exception.”
- AC #7(c) is much less ambiguous by specifying `getByRole('dialog', { name: 'Install app' })` and a concrete leaderboard link assertion (`data-testid` + href suffix).
- The `useIsInstalledPWA()` “implementation contract” clarifies SSR behavior, optional-chaining listener wiring, and the intent not to bridge deprecated Safari APIs, which should prevent a lot of cross-browser/jsdom friction.
- Clear gate-ordering rationale for the scorer install-required branch reduces risk of reintroducing the original non-scorer regression.

## Warnings

None.
