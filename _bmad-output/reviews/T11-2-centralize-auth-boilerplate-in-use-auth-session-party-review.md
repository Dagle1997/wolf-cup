# Party-Mode Review — T11-2 centralize auth boilerplate

**Story:** `_bmad-output/implementation-artifacts/tournament/T11-2-centralize-auth-boilerplate-in-use-auth-session.md`
**Mode:** Non-interactive written review (per tournament-director step 8)
**Date:** 2026-05-21
**Reviewed scope:** hook + hook test + 17 route migrations + spec + sprint-status flip

---

## 📊 Mary (Analyst) — Does the dedup achieve its goal? Is the profile exception reasonable?

Goal achieved. ~427 lines of copy-pasted auth boilerplate deleted across the batch-migrated routes (script reported the count) plus the 5 manually-migrated variants, collapsing ~30 LOC/route × 17 routes into a single `return requireAuthOrRedirect()`. The single source-of-truth lives in `use-auth-session.ts` next to the queryKey it already owned. The profile.tsx exception is not just reasonable, it's the *correct* call: profile genuinely consumes `ghin` + `manualHandicapIndex` from the auth-status response, which the shared `fetchAuthStatus` deliberately doesn't surface. Forcing profile into the shared helper would have meant either widening the shared cache shape (risk to InstallPromptHost/AwardCelebration) or a profile-page refactor — both out of T11-2's "mechanical dedup" scope. 17/18 is the honest number; the 18th is documented with a clear followup path. The two dead-code discoveries (events-index viewerName, gallery name) are bonus value — the migration surfaced provably-dead branches (the API never returns `name`) that were quietly carried for who-knows-how-long. **Verdict: dedup goal met; profile exception is the right scope boundary, not a cop-out.**

## 🏗️ Winston (Architect) — Is the shared-helper design sound? Cache-shape consistency correct?

Sound. The H#1 resolution (requireAuthOrRedirect uses the existing `fetchAuthStatus` as its queryFn) is the load-bearing architectural decision and it's correct: the `['auth-status']` cache now has exactly ONE writer-shape (`{player, device}`) regardless of whether a route loader or the `useAuthSession` React hook populates it first. Pre-T11-2, a route loader could have written a `{player}`-only shape and starved InstallPromptHost of the `device` field — the migration eliminates that latent footgun. The H#2 resolution (fetchQuery for both freshness modes) is a defensible consistency choice: it gives variant-A's 11 admin routes a marginally more conservative stale-auth posture (blocking-refetch-on-stale instead of cached-stale+bg-refetch), which for an auth gate is the safer direction. The `freshness: 'cache' | 'always'` API is minimal and the only behavioral knob, which is right. One latent design note (not a defect): the hook file now has TWO validators — `fetchAuthStatus` (full shape, used by everything) and `loadLoaderAuthStatus` (subset, exported for parity but used by nobody now that requireAuthOrRedirect uses fetchAuthStatus). The spec's followup section already flags unifying them. Leaving `loadLoaderAuthStatus` as an exported-but-unused export is mild API surface bloat — a future cleanup, not a blocker. **Verdict: design is sound; cache-shape consistency is the right fix.**

## 📋 John (PM) — Right scope? Was 17/18 + dead-code-cleanup the right call?

Right scope, right calls. The story split (T11-1 primitives, T11-2 auth, T11-3 PageShell rollout) keeps each cycle's diff reviewable; T11-2's diff is large by line count (~430 deletions + 17 files) but mechanically uniform, which is exactly what makes it safe. The 17/18 decision was escalated to Josh mid-implementation when profile.tsx's richer-shape need was discovered — that's the correct behavior (surface the spec-assumption violation rather than silently fudge it). The dead-code cleanups (events-index, gallery) were judgment calls backed by hard evidence (read the API route, confirmed `name` is never returned) — the right kind of opportunistic cleanup: provably-safe, adjacent to code already being touched, documented. What stayed OUT (extending the shared shape, profile refactor, per-route auth tests) is correctly deferred. The only PM-flavored watch item: T11-3 will touch these same 17 routes again for PageShell rollout — the two passes are mechanically separable (a bisect can isolate either), which the spec explicitly preserved. **Verdict: scope and escalation discipline were correct.**

## 🧪 Quinn (QA) — Test coverage strong? Is 13 hook tests enough given 17 routes have no per-route auth test?

Coverage is appropriately targeted. The 13 hook tests cover the load-bearing logic: `validateLoaderAuthStatus` (6 input shapes), `loadLoaderAuthStatus` (3 fetch outcomes), and `requireAuthOrRedirect` (4 cases incl the redirect path + a query-options assertion that now verifies `queryFn === fetchAuthStatus` by reference equality — locking the H#1 decision). The redirect test correctly asserts both `window.location.assign('/api/auth/google')` was called AND the thrown Error message is exactly `'redirecting-to-oauth'`. The honest characterization: the 17 routes have NO per-route auth-flow test, but that's the right tradeoff — the migration is mechanical (each route's beforeLoad is now identical: `return requireAuthOrRedirect()`), the helper IS unit-tested, and the full tournament-web suite (300 → 313) caught zero regressions, which means none of the 17 routes' EXISTING tests broke from the migration. Building 17 per-route auth fixtures would be disproportionate. Two test-fixture nano-risks codex flagged (location-restore edge cases, spread-plain-object dropping non-enumerable Location fields) are inherited from the existing me.test.tsx pattern — codebase-consistent, not T11-2-introduced. The window.location restore was hardened this cycle (captures + restores the original descriptor). **Verdict: targeted coverage is correct; per-route tests would be disproportionate.**

## 💻 Amelia (Dev) — Migration mechanical correctness? Any route lose its gate? Import hygiene?

Mechanically correct across all 17. Every migrated route's `beforeLoad` is now `return requireAuthOrRedirect()` (or `{freshness:'always'}` for me.tsx) — none lost its auth gate; the redirect-on-null-player + throw is preserved inside the shared helper. The freshness audit holds: me.tsx is the only `'always'` route in the migrated set (profile.tsx, the other staleTime:0 route, is the documented exception and unchanged). Import hygiene: 2 routes (`admin.event-rounds.$eventRoundId.sub-games.tsx`, `admin.events.$eventId.pairings.tsx`) had a leftover `appQueryClient` singleton import after migration — lint caught both (they use a SEPARATE `useQueryClient()` hook for invalidateQueries, so the singleton import was genuinely dead), fixed by removing the dead import lines. typecheck + lint now clean. The events-index dead-branch removal is verified safe: `EventHomePage`'s `viewerName` prop is optional, so omitting it (always-undefined behavior preserved) compiles + behaves identically. `use-auth-session.ts` itself: the 4 new exports are well-documented, `requireAuthOrRedirect` correctly defaults freshness to 'cache', narrows the `{player, device}` cache result to `{player}` for the return. **One nit (non-blocking):** `loadLoaderAuthStatus` is exported but now unused (requireAuthOrRedirect uses fetchAuthStatus instead) — see architect's note; spec followup covers it. **Verdict: migrations are correct, gates preserved, import hygiene clean post-lint-fix.**

---

## Open Questions for User

**None.** The two mid-implementation decisions that needed user input (profile.tsx exception via the codex-high gate, and the 1a+2a auth-flow resolutions) were already escalated and resolved by Josh during the cycle. The dead-code cleanups were evidence-backed judgment calls within scope. No open questions remain at review time.

---

## Summary verdict

**GO** — 17/18 routes migrated (profile.tsx documented exception), ~430 LOC of auth boilerplate deleted, shared helper unit-tested (13 tests), full regression green (engine 472, wolf-cup-api 517, tournament-api 965+2sk, tournament-web 300→313), typecheck + lint clean.

**Main risks:**
1. `loadLoaderAuthStatus` is exported-but-unused after the H#1 decision (requireAuthOrRedirect uses fetchAuthStatus). Mild API-surface bloat; spec followup covers unifying the two validators.
2. No per-route auth-flow integration test for the 17 migrated routes — mitigated by the mechanical-uniformity of the migration + helper unit tests + the no-regression gate on existing route tests.
3. profile.tsx still carries its own auth-loader boilerplate (the one un-deduped route) — intentional; revisit if its ghin/handicap read moves to a dedicated query.
4. T11-3 will touch these same 17 routes again for PageShell rollout — kept mechanically separable so a bisect can isolate either pass.
5. Test-fixture window.location stubbing carries 2 inherited nano-risks (codex Lows) shared with the existing me.test.tsx pattern — codebase-consistent, not introduced here.
