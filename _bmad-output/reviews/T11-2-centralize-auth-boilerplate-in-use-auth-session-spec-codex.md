# Codex Review

- Generated: 2026-05-20T22:44:25.982Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md

## Summary

Spec is generally detailed and mechanical, with strong AC coverage for redirect semantics, freshness modes, and route migration shape. However, there are a few concrete ambiguities/inconsistencies and two potentially load-bearing behavioral risks: (1) sharing the same TanStack Query key across helpers that return different data shapes, and (2) assuming `ensureQueryData` and `fetchQuery` are equivalent for “stale” behavior when collapsing variants A+B into a single “cache” mode.

Overall risk: high

## Findings

1. [high] Potential cache data-shape conflict on shared ['auth-status'] queryKey (loader returns subset, hook may expect full shape incl device)
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:85-130
   - Confidence: medium
   - Why it matters: The spec explicitly wants route loaders and the existing `useAuthSession` hook to “share ONE network round-trip” via the shared `['auth-status']` queryKey (lines 107–120). But the new loader helper’s type is a documented *subset* (`{ player }` only) of the “full AuthStatusResponse” (lines 85–90), and Dev Notes explicitly call out that `fetchAuthStatus`/`useAuthSession` deal with `{ player, device }` (lines 290–301). If `requireAuthOrRedirect` writes `{ player }` into the cache under `['auth-status']`, any component relying on `useAuthSession` for `device` may read an object without `device` (until a refetch occurs), causing subtle regressions (e.g., missing device-based UI behavior) that this story does not intend to change.
   - Suggested fix: Make the cached query data shape consistent across loader + hook. Options: (a) have `requireAuthOrRedirect` use the same queryFn/data shape as the hook (e.g., call `fetchAuthStatus`), then *derive* `{player}` for the return value; or (b) keep loader subset but use a different queryKey (e.g., `['auth-status-player']`) and accept the extra fetch; or (c) explicitly guarantee in the hook that missing `device` is handled (default/null) and add an AC + unit test to lock it.

2. [high] Back-compat risk: collapsing fetchQuery-based routes into ensureQueryData “cache” mode may change behavior on stale data
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:56-78
   - Confidence: medium
   - Why it matters: Pre-T11-2 has two observable 30s-caching variants: A uses `ensureQueryData`, B uses `fetchQuery` (lines 58–75). The spec asserts they’re “behaviorally identical” (line 74) and then mandates the unified `'cache'` mode use `ensureQueryData` even when the query is “cold or stale” (AC-2, lines 202–207). In TanStack Query, `fetchQuery` and `ensureQueryData` are not guaranteed to have identical semantics around staleness/refetching depending on version/config (e.g., `ensureQueryData` is primarily ‘ensure present in cache’, while `fetchQuery` is explicitly ‘fetch if stale’). If they differ, the 5 Variant-B routes could stop refetching after staleness and continue using older cached auth data longer than intended, which is an auth-gating surface.
   - Suggested fix: Explicitly verify (and cite) the TanStack Query version semantics in this codebase. If the goal is “refetch when stale; reuse when fresh,” consider implementing `'cache'` using `fetchQuery` with `staleTime: 30_000` (or implement logic that refetches when stale). Add a unit test that simulates a stale cache entry and asserts whether a network fetch happens for `'cache'` mode.

3. [medium] Spec/AC inconsistency: “3 loader-side exports” vs actually listing 4 (type + 3 functions); AC-1 wording contradicts itself
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:79-125
   - Confidence: high
   - Why it matters: The story intro says “3 loader-side exports” but enumerates `LoaderAuthStatus` plus three functions (4 exports) (line 9, lines 79–125). AC-1 repeats “Three new exports” but then requires exporting 4 items (lines 195–200). This is ambiguous for an implementation agent and also for review gates that may check exact wording/count.
   - Suggested fix: Update wording consistently: either say “4 loader-side exports” or clarify “3 loader helpers + 1 type export.” Ensure AC-1 title/body match.

4. [medium] Test plan under-specifies verification of load-bearing query options (retry:false, staleTime, ensureQueryData vs fetchQuery) and may leak singleton queryClient state across tests
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:181-245
   - Confidence: high
   - Why it matters: AC-2/AC-3 make `ensureQueryData` vs `fetchQuery`, `staleTime`, and `retry:false` non-negotiable (lines 202–215), but the described 4 `requireAuthOrRedirect` tests (lines 185–188) don’t explicitly require asserting the exact query options passed. Also, `requireAuthOrRedirect` will import a singleton `queryClient` (line 127), so tests can become order-dependent unless the query cache is cleared/reset between cases.
   - Suggested fix: In the helper tests, spy on `queryClient.ensureQueryData`/`queryClient.fetchQuery` and assert the full options object includes `queryKey: ['auth-status']`, correct `queryFn`, correct `staleTime`, and `retry:false` in both branches. Add `afterEach(() => queryClient.clear())` (or `queryClient.getQueryCache().clear()`) to prevent cross-test pollution.

5. [medium] Location stubbing guidance is ambiguous and may not stub the actually-used API (window.location.assign) in Vitest/JSDOM
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:267-270
   - Confidence: high
   - Why it matters: The code path under test calls `window.location.assign(...)` (AC-4, lines 216–222). The suggested `vi.stubGlobal('location', { assign: vi.fn() })` may not affect `window.location` (and `window.location` is often non-writable/non-configurable in JSDOM), causing brittle tests or false negatives.
   - Suggested fix: Specify a robust approach: `const assignSpy = vi.spyOn(window.location, 'assign').mockImplementation(() => {})` where supported; otherwise `Object.defineProperty(window, 'location', { value: { ...window.location, assign: vi.fn() }, writable: true })` with proper restoration in `afterEach`.

6. [low] File-count inconsistency (20 vs 21) could trip process checks and creates avoidable ambiguity
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:17-330
   - Confidence: high
   - Why it matters: Risk Acceptance §1 says “20 files total” (line 19), but the “Files this story will edit” section lists 21 files and explicitly says “21 files” (lines 305–330). If any tooling/process expects these counts to match, this creates friction for an otherwise mechanical refactor.
   - Suggested fix: Make the counts consistent (likely 21: hook + test + 18 routes + sprint-status).

7. [low] Minor spec contradiction on route import path expectations ('../hooks/...' “exactly” vs “may be ../../...”)
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:223-277
   - Confidence: high
   - Why it matters: AC-5 says each route imports `requireAuthOrRedirect` from `'../hooks/use-auth-session'` (lines 223–230), but Tasks say the path “may be '../../hooks/...' if subdirectory routes exist” (line 275). These routes appear to all be in `src/routes/` root (dot-delimited filenames), so the “may be ../../” clause may confuse an agent or cause inconsistent imports.
   - Suggested fix: Either remove the “may be '../../'” note for this story (if all 18 are same directory) or relax AC-5 to “correct relative path from that route file.”

## Strengths

- Clearly documents the exact pre-refactor boilerplate (type, validator, loader) and the three observed beforeLoad variants with route counts (lines 21–78).
- Acceptance Criteria explicitly lock the risky behaviors: freshness switching, retry:false on both branches, exact redirect URL and thrown error message (lines 202–222).
- Mechanical migration steps are enumerated and include a safeguard about preserving `queryClient` imports when still used for non-auth queries (lines 271–277, 303–304).
- Explicitly calls out the special-case freshness requirement for me.tsx/profile.tsx and requires preserving the explanatory comment (AC-6, lines 232–238).
- Paths listed under “Files this story will edit” appear to stay within the allowed buckets (apps/tournament-web/** and _bmad-output/**) with no forbidden-scope creep (lines 305–328).

## Warnings

None.
