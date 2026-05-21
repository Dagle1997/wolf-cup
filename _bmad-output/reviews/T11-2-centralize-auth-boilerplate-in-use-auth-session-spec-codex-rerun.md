# Codex Review

- Generated: 2026-05-20T22:50:30.834Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md

## Summary

High-findings resolutions are captured concretely in both the spec body (Section 3a) and the ACs (AC-2/AC-3 explicitly mandate `fetchQuery` and `queryFn: fetchAuthStatus`). However, a few internal contradictions/ambiguities remain—most notably around the mandated `window.location.assign` stubbing pattern (Section 3b/AC-7 vs Tasks 2.2), and a reintroduced import-path hedge that conflicts with the “no nested routes” resolution. There’s also some lingering language that still implies variant A/B equivalence and “byte-for-byte” parsing parity despite the switch to `fetchAuthStatus` as the loader queryFn.

Overall risk: medium

## Findings

1. [high] Tasks 2.2 contradicts Section 3b + AC-7 by recommending `window.location.assign = vi.fn()` / `vi.stubGlobal('location', ...)` stubs that the spec elsewhere forbids as non-jsdom-safe
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:149-308
   - Confidence: high
   - Why it matters: Section 3b and AC-7 correctly call out that `window.location` is often non-writable in vitest+jsdom and require a jsdom-compatible approach (e.g., `Object.defineProperty(window, 'location', ...)` or `vi.spyOn(window.location, 'assign')`). But Tasks 2.2 (line 307) tells the implementer to use `vi.stubGlobal('location', { assign: vi.fn() })` or `window.location.assign = vi.fn()`—exactly the kind of naive approach that can fail at runtime and undermine the mandated redirect-path tests.
   - Suggested fix: Update Tasks 2.2 (lines 305–308) to match Section 3b/AC-7 verbatim. For example: “Use `Object.defineProperty(window, 'location', { value: { assign: vi.fn(), href: '' }, writable: true })` OR `vi.spyOn(window.location, 'assign')...` (pick the one that works in this repo), and restore in `afterEach`.” Remove the suggested `window.location.assign = ...` / `vi.stubGlobal('location', ...)` fallback if it’s not guaranteed to work.

2. [medium] Tasks 3.x.3 reintroduces the import-path ambiguity that AC-5 says is resolved (mentions `'../../hooks/...'` despite “no nested subdirectories” decision)
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:253-314
   - Confidence: high
   - Why it matters: AC-5 (lines 253–260) explicitly mandates that all 18 routes are directly under `routes/` and must import from `'../hooks/use-auth-session'`. But Tasks 3.x.3 (line 313) says the path “may be `'../../hooks/...'` if subdirectory routes exist,” which conflicts with the resolved assumption and can cause inconsistent migrations (and review churn) if implementers follow the task text instead of the AC.
   - Suggested fix: Edit Tasks 3.x.3 to match AC-5: require `'../hooks/use-auth-session'` for all 18 route files, and remove the “may be '../../'” clause (or move it behind an explicit “If audit list changes, update AC-5 + file list” note).

3. [medium] Spec still claims variant A/B collapse is “behaviorally equivalent” and “intent preserved exactly,” but Section 3a now documents a deliberate behavior change for variant A
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:56-148
   - Confidence: high
   - Why it matters: In Section 2/77, the text says T11-2 collapses A and B “because they're behaviorally equivalent” and “The intent of each call site is preserved exactly.” But Section 3a (lines 147–148) explicitly states variant A’s behavior changes from `ensureQueryData` to `fetchQuery` (blocking refetch on stale) as an intentional tightening. Leaving the earlier “equivalent/exact” phrasing can confuse implementers/reviewers about whether a behavior delta is expected and acceptable.
   - Suggested fix: Adjust the Section 2 summary (around lines 74–77) to reflect the updated resolution: e.g., “T11-2 standardizes on fetchQuery for both A and B; B stays equivalent, A becomes more conservative on stale (as documented in Section 3a).”

4. [low] AC-5 demands an explicit `return requireAuthOrRedirect(...)` statement, but the “Post-T11-2” example uses an implicit-return arrow expression
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:176-259
   - Confidence: high
   - Why it matters: Section 4’s example (line 181) shows `beforeLoad: async () => requireAuthOrRedirect(),` (implicit return). AC-5 (line 258) says the `beforeLoad` body is exactly one statement: `return requireAuthOrRedirect(opts?)`. Both are correct JS, but the mismatch creates unnecessary ambiguity about what reviewers should enforce and what “exactly” means here.
   - Suggested fix: Either (a) loosen AC-5 wording to allow “one expression that returns the Promise from requireAuthOrRedirect” or (b) update the example to `beforeLoad: async () => { return requireAuthOrRedirect(); }` so it matches the AC literally.

5. [medium] “Byte-for-byte identical response-parsing logic” claim is potentially inconsistent with switching the loader queryFn to `fetchAuthStatus`
   - File: _bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md:100-206
   - Confidence: medium
   - Why it matters: The spec states the old per-route `loadAuthStatus` parsing is mirrored byte-for-byte in `loadLoaderAuthStatus` (lines 100–106), but also mandates that `requireAuthOrRedirect` uses `fetchAuthStatus` as its `queryFn` (lines 145–146; AC-2/AC-3). Section 6 then claims “the response-parsing logic [is] byte-for-byte identical to the pre-T11-2 routes” (line 204). That “byte-for-byte” guarantee is no longer anchored to the loader behavior unless `fetchAuthStatus` is known (and required) to be equivalently defensive. As written, it’s an overclaim/ambiguity in the spec text.
   - Suggested fix: Tighten the statement in Section 6 to reflect reality: either (a) explicitly require/verify that `fetchAuthStatus` is already behaviorally equivalent to pre-route parsing for the `player` field (including network/parse failure behavior), or (b) soften “byte-for-byte identical parsing logic” to apply only to `loadLoaderAuthStatus`, and clarify that loader gating now relies on `fetchAuthStatus`’s existing semantics.

## Strengths

- High-resolution changes are clearly captured in Section 3a and enforced by AC-2/AC-3 with literal requirements (`fetchQuery` for both modes; `queryFn: fetchAuthStatus`; consistent `queryKey`; `retry: false`).
- Section 3b + AC-7 explicitly mandate test isolation via `removeQueries({ queryKey: ['auth-status'] })` and require a load-bearing query-options assertion via spy—both address real, common failure modes.
- Cache-shape narrowing is described explicitly (full `{player, device}` in cache; `{player}` returned to loaders), reducing the risk of accidental device-field loss.

## Warnings

None.
