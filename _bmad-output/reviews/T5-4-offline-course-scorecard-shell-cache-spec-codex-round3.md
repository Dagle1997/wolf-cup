# Codex Review

- Generated: 2026-04-28T19:09:51.601Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md

## Summary

Round-2 items are mostly resolved in the spec text (auth chain tightened; __source removal; JSON.stringify replaced). However, the current spec contains a few concrete inconsistencies and one likely-incorrect implementation suggestion (TanStack Query `meta` mutation), plus an underspecified guard for “first fetch” banner behavior. These create medium risk of dev mis-implementation/regression, especially around the offline chip/source tracking and the course-superseded banner.

Overall risk: medium

## Findings

1. [medium] Spec still contradicts itself about banner being in-scope vs deferred
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:160-285
   - Confidence: high
   - Why it matters: The spec requires and tests a “course-revision-superseded banner” (in scope) but the Risks section still says it’s deferred to v1.5. This is a direct contradiction that can cause dev to skip the banner or under-test it.
   - Suggested fix: Remove/replace the Risks bullet that says the banner UX is deferred (lines ~281-282) so it aligns with the in-scope banner requirement and AC #7 test #11 (lines ~163-165, 246-250). If something else is deferred, state precisely what (e.g., banner in read-only placeholders only).

2. [medium] TanStack Query `meta` approach is likely incorrect as described (queryFn cannot reliably mutate meta)
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:160-162
   - Confidence: high
   - Why it matters: The spec suggests “Cleaner: use TanStack Query's meta per-query … and the queryFn writes to query.meta.source” (line ~161). In TanStack Query, `meta` is an options/config value (and in queryFn you typically only receive `QueryFunctionContext` with a `meta` snapshot). Treating it as mutable runtime state is likely to fail silently or be non-idiomatic, leading to the Offline chip not updating or being flaky.
   - Suggested fix: Constrain the spec to a known-good mechanism: (a) keep the explicit `onSource` callback and update React state from it, or (b) set a separate query (or local state) via `onSuccess` / `onError` callbacks, or (c) derive “offline mode” from a dedicated piece of state stored outside the queryFn. If you keep `meta`, specify it as read-only tagging only, not a mutable source channel.

3. [medium] `onSource` callback + refetching may cause repeated state updates; React 19 safety not addressed
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:122-162
   - Confidence: medium
   - Why it matters: The queryFn calls `onSource('network'|'cache')` as a side-effect (lines ~124-152), and the queries also have `refetchInterval: 15_000` (line ~158). If the app is offline, every interval will run queryFn, hit cache, and call `setState` again. This can cause unnecessary rerenders, and can trigger “setState on unmounted component” warnings if navigation occurs mid-fetch (a practical risk when using async queryFns).
   - Suggested fix: Specify debouncing/guarding semantics: only update source state if it actually changed (e.g., keep last value in a ref and call setState only on change), and/or cancel updates when unmounted. Alternatively move source tracking to `onSuccess` and ensure it only runs when a fetch actually resolves to new data.

4. [medium] Course-change banner: spec doesn’t explicitly guard “first fetch with no cached value” from firing
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:163-165
   - Confidence: high
   - Why it matters: You explicitly want “banner shouldn't fire on first fetch.” The spec says to compare cached hash vs fresh hash (lines ~163-165) but doesn’t state what to do when there is no cached course (null). Without an explicit guard, an implementation could treat missing cache as empty hash and always show the banner on initial online load.
   - Suggested fix: Add a normative rule: only compute/compare `prevHash` if a cached payload existed (non-null) *before* the network fetch; otherwise skip banner. Also add a test note (or acceptance text) stating “no banner on first successful fetch when cache was empty.”

5. [low] Inconsistent test-plan counts (2 vs 3 frontend integration tests)
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:166-268
   - Confidence: high
   - Why it matters: The file states `rounds.$roundId.score-entry.test.tsx` adds 2 tests (lines ~29 and ~172-173; tasks line ~267), but AC #7 enumerates +3 integration tests including the banner case (lines ~246-250). This is minor but will cause confusion when devs reconcile baseline counts and required coverage.
   - Suggested fix: Make all references consistent: either require 3 integration tests everywhere (preferred since banner behavior is explicitly required), or explicitly state “+3 tests” and update Tasks item 7 accordingly.

## Strengths

- Auth hardening is now explicit: `requireSession → requireEventParticipant` and a defense-in-depth `round.event_id === :eventId` check (lines ~46-55, AC #1 at ~188-193).
- Course-change detection moved off JSON.stringify to a stable, deterministic hash over holeNumber/par/si (lines ~163-165).
- `__source` pollution is addressed in the design: queryFn returns unmodified data and the UI source signal is tracked separately (lines ~122-123, ~160-162).
- Test surface is well-scoped and enumerated across backend, cache-lib, and route integration (lines ~166-175, AC #7 at ~224-250).

## Warnings

None.
