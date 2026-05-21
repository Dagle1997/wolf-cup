# Codex Review

- Generated: 2026-05-21T13:41:38.524Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/hooks/use-auth-session.ts, apps/tournament-web/src/hooks/use-auth-session.test.ts, apps/tournament-web/src/routes/admin.courses.new.tsx, apps/tournament-web/src/routes/admin.courses.upload.tsx, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx, apps/tournament-web/src/routes/admin.events.$eventId.index.tsx, apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx, apps/tournament-web/src/routes/admin.events.new.tsx, apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx, apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx, apps/tournament-web/src/routes/events.$eventId.bets.tsx, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx

## Summary

Within the provided diff/files, the new `requireAuthOrRedirect` matches the documented decisions/spec intent: it uses `queryClient.fetchQuery` in both freshness modes, uses the existing `fetchAuthStatus` as `queryFn` (preserving the shared `['auth-status']` cache shape for `useAuthSession` consumers), hardcodes `retry:false`, and redirects + throws when `player` is null. The sampled route migrations shown (admin + event routes) preserve the auth gate by calling `return requireAuthOrRedirect()` from `beforeLoad`.

Main gaps are in test “load-bearing options” coverage (it doesn’t assert the `queryFn` is specifically `fetchAuthStatus`) and a potential global-test pollution risk from stubbing `window.location` without restoring it.

Overall risk: medium

## Findings

1. [medium] Test pollution risk: window.location is replaced but never restored
   - File: apps/tournament-web/src/hooks/use-auth-session.test.ts:34-47
   - Confidence: high
   - Why it matters: The test suite replaces `window.location` via `Object.defineProperty` (line 37-40) but never puts the original `Location` object back in `afterEach`. If Vitest is configured without per-file isolation (or if other tests in the same environment rely on full `Location` behavior like `origin`, `href`, etc.), this can cause unrelated tests to fail/flap depending on execution order.
   - Suggested fix: Capture the original descriptor/value before overwriting, and restore it in `afterEach`. Example: `const originalLocation = window.location;` (or `Object.getOwnPropertyDescriptor(window,'location')`) then in `afterEach` re-`defineProperty` with the original value/descriptor.

2. [low] requireAuthOrRedirect tests don’t assert the critical cache-shape consistency decision (queryFn should be fetchAuthStatus)
   - File: apps/tournament-web/src/hooks/use-auth-session.test.ts:121-157
   - Confidence: high
   - Why it matters: A key acceptance criterion/decision is that `requireAuthOrRedirect` must use the existing `fetchAuthStatus` as the queryFn to keep the `['auth-status']` cache in the full `{player, device}` shape used by `useAuthSession`. The tests currently only assert `typeof callArgs.queryFn === 'function'` (line 138), which would not catch a regression back to a narrower loader function (e.g., `loadLoaderAuthStatus`) that would again risk cache-shape mismatch.
   - Suggested fix: Import `fetchAuthStatus` into the test and assert identity: `expect(callArgs.queryFn).toBe(fetchAuthStatus)` (and similarly for the 'always' test). Optionally also assert `callArgs.queryKey` exactly equals `['auth-status']` (already done) and that `fetch` was called with `/api/auth/status` + `{credentials:'same-origin'}` to indirectly validate queryFn behavior.

3. [low] requireAuthOrRedirect hard-depends on window; will throw outside browser/jsdom contexts
   - File: apps/tournament-web/src/hooks/use-auth-session.ts:170-184
   - Confidence: medium
   - Why it matters: `requireAuthOrRedirect` directly calls `window.location.assign(...)` (line 182). If any future usage calls this helper in a non-DOM context (SSR, node-only tests, router pre-render), it will crash before it can even return/throw the sentinel error. This may not matter today if the app is strictly client-only, but it’s a sharp edge for reuse.
   - Suggested fix: If SSR/non-browser execution is plausible, guard: `if (typeof window !== 'undefined') window.location.assign(...)` else `throw new Error('redirecting-to-oauth')` (or return a redirect instruction compatible with the runtime).

## Strengths

- requireAuthOrRedirect uses `queryClient.fetchQuery` with `queryKey: ['auth-status']`, `queryFn: fetchAuthStatus`, and `retry:false` as required (apps/tournament-web/src/hooks/use-auth-session.ts:175-180).
- Correct redirect gating: when `status.player === null`, it performs `window.location.assign('/api/auth/google')` and throws `Error('redirecting-to-oauth')` (use-auth-session.ts:181-184).
- Freshness semantics are centralized and explicit: `'cache'` → `staleTime: 30_000`, `'always'` → `staleTime: 0` (use-auth-session.ts:173-175).
- Route migrations shown preserve the auth gate by calling `return requireAuthOrRedirect()` from `beforeLoad` (e.g., admin.courses.new.tsx:676-681; events.$eventId.bets.tsx:204-209; events.$eventId.courses.$courseId.tsx:241-246).
- Good defensive parsing helpers (`validateLoaderAuthStatus`, `loadLoaderAuthStatus`) and unit coverage for multiple malformed shapes and fetch failures.

## Warnings

None.
