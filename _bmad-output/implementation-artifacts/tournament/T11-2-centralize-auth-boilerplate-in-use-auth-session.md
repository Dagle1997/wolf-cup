# T11-2: Centralize Auth Boilerplate in use-auth-session

## Status

done

## Story

As a future-tournament-web feature contributor (and as a T11-3 author rolling out PageShell across the same 18 routes), I want the auth-status boilerplate that's currently copy-pasted across 18 routes consolidated into `hooks/use-auth-session.ts`, so a new route can opt into the auth-required redirect-to-OAuth behavior with one import and one helper call instead of ~30 lines of identical defensive parsing + queryClient plumbing per file, and so any future bug fix in auth handling (e.g., the parsing logic that grew defensive over T8-4) lands in one place instead of needing a 18-file find-and-replace sweep.

T11-2 does NOT migrate routes to consume `PageShell`/`BackLink` — that's T11-3. T11-2 is the second of three foundation passes (T11-1 primitives, T11-2 auth dedup, T11-3 PageShell rollout). The two stories are independent in surface area but related in intent: both kill cross-cutting cost-of-change on the same 18 routes.

The audit data (from the 2026-05-20 T11 setup audit) found 18 route files (one more than the original "~17" estimate, observed via grep): `apps/tournament-web/src/routes/admin.courses.new.tsx`, `admin.courses.upload.tsx`, `admin.event-rounds.$eventRoundId.sub-games.tsx`, `admin.events.$eventId.index.tsx`, `admin.events.$eventId.pairings.tsx`, `admin.events.new.tsx`, `admin.groups.$groupId.edit.tsx`, `admin.rule-sets.$id.edit.tsx`, `events.$eventId.bets.tsx`, `events.$eventId.courses.$courseId.tsx`, `events.$eventId.gallery.tsx`, `events.$eventId.index.tsx`, `events.$eventId.leaderboard.tsx`, `events.$eventId.money.tsx`, `events.$eventId.schedule.tsx`, `events.$eventId.settle-up.tsx`, `me.tsx`, `profile.tsx`. Each contains an `~25-line type+validateAuthStatus+loadAuthStatus` block plus a `~10-line beforeLoad` body.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

Every file in `## Files this story will edit` classifies into the tournament-director's ALLOWED bucket (`apps/tournament-web/**` and `_bmad-output/implementation-artifacts/tournament/**`). No root config, no dependency changes (no `package.json`, no `pnpm-lock.yaml`), no `apps/tournament-api/**`, no Wolf Cup touches. 21 files total: 1 hook + 1 new hook test + 18 route migrations + sprint-status flip.

### 2. Pre-T11-2 boilerplate — exact shape observed in every one of the 18 routes

```ts
// In every route file (copy-pasted verbatim across 18 files; ~25 lines):
type AuthStatus = { player: null | { id: string; isOrganizer: boolean } };

function validateAuthStatus(body: unknown): AuthStatus {
  if (body === null || typeof body !== 'object') return { player: null };
  const p = (body as { player?: unknown }).player;
  if (p === null) return { player: null };
  if (
    p !== null &&
    typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { isOrganizer?: unknown }).isOrganizer === 'boolean'
  ) {
    return {
      player: {
        id: (p as { id: string }).id,
        isOrganizer: (p as { isOrganizer: boolean }).isOrganizer,
      },
    };
  }
  return { player: null };
}

async function loadAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateAuthStatus(body);
}
```

Plus a `beforeLoad` body — observable in THREE variants across the 18 routes (counts verified by grep at spec-authoring time):

- **Variant A — `ensureQueryData` + `staleTime: 30_000`** (admin.events.$eventId.index.tsx etc., 11 routes):
  ```ts
  beforeLoad: async () => {
    const status = await appQueryClient.ensureQueryData({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 30_000,
      retry: false,
    });
    if (status.player === null) {
      window.location.assign('/api/auth/google');
      throw new Error('redirecting-to-oauth');
    }
    return { player: status.player };
  }
  ```
- **Variant B — `fetchQuery` + `staleTime: 30_000`** (events.$eventId.bets.tsx etc., 5 routes): same as A but `.fetchQuery` instead of `.ensureQueryData`. Behaviorally identical once the cache is warm (both 30s-fresh-cache hits skip the network).
- **Variant C — `fetchQuery` + `staleTime: 0`** (me.tsx, profile.tsx, 2 routes): intentionally stricter — me.tsx's existing comment explains: *"/me is the 'is this still me?' surface; reading a 30s-cached auth-status can let a server-deleted session keep the page visible until the cache expires."*

T11-2 collapses A and B into one `'cache'` mode (using `fetchQuery` per Section 3a §H#2) and preserves C as the `'always'` mode. **This is NOT a no-op for variant A's 11 routes**: their `ensureQueryData` semantics (cached-stale + background refetch) become `fetchQuery` semantics (blocking-refetch-on-stale, returning fresh value). Section 3a documents this as a deliberate security-posture tightening (stale auth detected one navigation sooner, at the cost of a small extra network call when crossing the 30s staleness boundary). Variant B's 5 routes and variant C's 2 routes are byte-for-byte preserved.

### 3. Post-T11-2 unified API in `hooks/use-auth-session.ts`

Four new exports added (1 type + 3 functions); the existing `fetchAuthStatus` + `useAuthSession` hook + `AuthStatusResponse` + `AuthDevice` types stay unchanged:

```ts
/**
 * Schema-shape returned by /api/auth/status's `player` field, used by
 * route loaders that gate access to authenticated views. Subset of the
 * full AuthStatusResponse — many loaders only care about `player`.
 */
export type LoaderAuthStatus = { player: null | { id: string; isOrganizer: boolean } };

/**
 * Validate + extract the `player` field from a raw /api/auth/status
 * response body. Defensive against missing/wrong-shape inputs (returns
 * { player: null } on any failure). Mirrors the per-route validateAuthStatus
 * function pre-T11-2 byte-for-byte.
 */
export function validateLoaderAuthStatus(body: unknown): LoaderAuthStatus;

/**
 * Fetch + validate /api/auth/status; returns { player: null } on any
 * network or parse failure. Mirrors the per-route loadAuthStatus function
 * pre-T11-2 byte-for-byte. NOTE: this is exposed for parity with the
 * pre-T11-2 per-route loader symmetry; `requireAuthOrRedirect` does NOT
 * use this as its queryFn (see Section 3a for why).
 */
export async function loadLoaderAuthStatus(): Promise<LoaderAuthStatus>;

/**
 * TanStack Router `beforeLoad` helper. Reads /api/auth/status via the
 * shared `['auth-status']` query — populated by the EXISTING
 * `fetchAuthStatus` (full `{player, device}` shape) so the cache stays
 * consistent with `useAuthSession`'s reads from InstallPromptHost and
 * AwardCelebration. The helper narrows the result to `{ player }` for
 * caller convenience.
 *
 * If `player` is null, redirects the browser to `/api/auth/google` and
 * throws `'redirecting-to-oauth'` to halt route loading. Otherwise
 * returns `{ player }` so the caller can chain
 * `return await requireAuthOrRedirect()` from beforeLoad.
 *
 * `opts.freshness`:
 *   - `'cache'` (default) — uses `fetchQuery` with `staleTime: 30_000`.
 *     If the cache is warm AND fresh (< 30s old), the cached value is
 *     returned without a network call. If stale, a fresh fetch is
 *     awaited and returned (NOT cached-stale + background refetch —
 *     `fetchQuery` is blocking-on-stale by design; see Section 3a §H#2).
 *   - `'always'` — uses `fetchQuery` with `staleTime: 0`, forcing a fresh
 *     server call on every navigation. Matches the variant-C behavior of
 *     me.tsx and profile.tsx, which need to detect server-deleted sessions
 *     before they expire from the 30s-cached read.
 *
 * Both code paths hardcode `retry: false` — auth failures (401/403) should
 * surface immediately as `player: null` → redirect, NOT trigger TanStack
 * Query's default 3-retry backoff.
 */
export async function requireAuthOrRedirect(
  opts?: { freshness?: 'cache' | 'always' },
): Promise<{ player: { id: string; isOrganizer: boolean } }>;
```

Internally `requireAuthOrRedirect` imports the `queryClient` singleton from `../lib/query-client` so callers don't have to. This is consistent with how the routes currently import + use it; we just move the import boundary inward.

### 3a. Resolution of two High codex findings (Josh decision 2026-05-20: 1a + 2a)

**H#1 (cache-shape conflict) → resolved by option 1a.** `requireAuthOrRedirect` uses the EXISTING `fetchAuthStatus` (not `loadLoaderAuthStatus`) as its `queryFn`. The cache for `['auth-status']` always stores the FULL `{player, device}` shape, so `useAuthSession` (consumed by InstallPromptHost + AwardCelebration) keeps reading the device field correctly regardless of which side (hook or loader) populates the cache first. The helper then narrows to `{player}` for the loader's return value — zero behavior change to existing useAuthSession consumers.

**H#2 (ensureQueryData vs fetchQuery collapse) → resolved by option 2a.** Both freshness modes use `fetchQuery` (not `ensureQueryData`). This preserves variant-B's literal behavior for those 5 routes. For variant A's 11 admin routes, the behavior shifts slightly: instead of `ensureQueryData`'s "return cached-stale + background-refetch" semantics, they get `fetchQuery`'s "blocking refetch on stale" — which is more conservative (deleted/expired sessions detected one navigation sooner, small extra network call at the 30s staleness boundary). This is an intentional security-posture tightening, not a regression. The behavior delta is invisible to a user whose session is healthy.

### 3b. Test setup hazards to address explicitly

Two test-infrastructure concerns surfaced in codex spec round-1 that the dev agent MUST handle:

- **QueryClient singleton state leakage** — the `queryClient` imported from `../lib/query-client` is a module-level singleton. Tests that exercise `requireAuthOrRedirect` populate the `['auth-status']` cache; subsequent tests inherit it. The test file MUST clear the relevant cache key in `beforeEach` (e.g., `queryClient.removeQueries({ queryKey: ['auth-status'] })`) to prevent inter-test contamination. Without this, a "fresh fetch" assertion can read stale data from a prior test.
- **`window.location.assign` stubbing** — vitest+jsdom's `window.location` is not directly assignable (read-only on `globalThis.location`). The test MUST stub via `Object.defineProperty(window, 'location', { value: { assign: vi.fn(), href: '' }, writable: true })` OR via `vi.spyOn(window.location, 'assign').mockImplementation(() => {})` — whichever pattern compiles cleanly in this codebase. Verify in subtask 2.2 with a quick spike before writing the redirect tests. The naïve `window.location = { assign: vi.fn() } as Location` will fail in modern jsdom.

### 4. Per-route migration shape (mechanical, identical across all 18 routes)

Pre-T11-2 (sample from `admin.events.$eventId.index.tsx`):
```ts
import { queryClient as appQueryClient } from '../lib/query-client';

type AuthStatus = { ... };  // ~25 lines of helpers
function validateAuthStatus(body: unknown): AuthStatus { ... }
async function loadAuthStatus(): Promise<AuthStatus> { ... }

export const Route = createFileRoute('/admin/events/$eventId/')({
  beforeLoad: async () => {
    const status = await appQueryClient.ensureQueryData({ ... });
    if (status.player === null) { window.location.assign(...); throw ...; }
    return { player: status.player };
  },
  component: RouteComponent,
});
```

Post-T11-2:
```ts
import { requireAuthOrRedirect } from '../hooks/use-auth-session';

export const Route = createFileRoute('/admin/events/$eventId/')({
  beforeLoad: async () => requireAuthOrRedirect(),
  component: RouteComponent,
});
```

For variant-C routes (me, profile):
```ts
beforeLoad: async () => requireAuthOrRedirect({ freshness: 'always' })
```

Net per-route: ~30 lines removed (the type + 2 helper functions + the beforeLoad body), ~2 lines added (the import + the one-line beforeLoad). Total reduction: ~540 lines across 18 routes.

### 5. What is NOT in this story

- No route migrations to consume T11-1's `PageShell`/`BackLink`/etc. (T11-3 scope).
- No changes to the existing `useAuthSession` hook (the React-component-side consumer used by InstallPromptHost/AwardCelebration). It already correctly reads from the shared `['auth-status']` queryKey; this story extends the hook FILE with route-loader helpers, doesn't touch the hook itself.
- No changes to `apps/tournament-api/**`. The /api/auth/status server contract is unchanged.
- No tightening of the auth `staleTime` policy beyond preserving the variant-C `'always'` path for me/profile. If we want all routes to be `always`-fresh, that's a separate decision/story.
- No new dependencies.
- No changes to T11-1's design tokens or shell components.

### 6. Backwards-compatibility / regression posture

The `['auth-status']` queryKey + the request URL are byte-for-byte identical to the pre-T11-2 routes.

**Parsing logic is NOT byte-for-byte identical** — per Section 3a §H#1, the loader now uses `fetchAuthStatus` (the existing full-shape parser used by `useAuthSession`) as its queryFn instead of the per-route `loadAuthStatus`. The two parsers produce equivalent `{player}` extraction under all non-malformed inputs we've tested; the difference is `fetchAuthStatus` ALSO parses out `{device}` and stores it in the cache. The helper narrows back to `{player}` for the loader's return, so callers see the same shape. If any future API response shape introduces a `player`-parse-divergence between the two functions, the loader-side migration would surface it as a test failure — which is the right direction (one parser is better than two divergent ones).

**Stale-data behavior is NOT byte-for-byte identical for variant A's 11 admin routes** — per Section 3a §H#2, they shift from `ensureQueryData`'s cached-stale+bg-refetch to `fetchQuery`'s blocking-refetch-on-stale. Deliberate security tightening, documented above.

The redirect-to-`/api/auth/google` behavior on null player IS byte-for-byte identical. The thrown `'redirecting-to-oauth'` error string IS byte-for-byte identical (TanStack Router's beforeLoad-throws-redirect pattern depends on it being a thrown Error; the message string is informational).

Cache sharing with the `useAuthSession` React hook is PRESERVED via the shared `['auth-status']` queryKey + the shared `fetchAuthStatus` queryFn — both sides read/write the same full `{player, device}` shape.

**Risk:** if the migration accidentally drops the `retry: false` option somewhere, TanStack Query would auto-retry the /api/auth/status call up to 3 times on transient 401/5xx, delaying the redirect. Spec requires the helper hardcodes `retry: false`. AC-3 has an explicit assertion.

### 7. Test coverage for the helpers

A new file `apps/tournament-web/src/hooks/use-auth-session.test.ts` tests the three new exports:

- **`validateLoaderAuthStatus`** — 6 test cases mirroring the existing per-route patterns: null input, non-object input, missing player, player=null, valid player, malformed player (string id missing or wrong type).
- **`loadLoaderAuthStatus`** — 3 cases: happy path (mock fetch returns valid body), non-ok response, fetch throws. Uses `vi.fn()` for fetch.
- **`requireAuthOrRedirect`** — 4 cases: happy path with cache freshness, happy path with always freshness, redirect on null player (assert `window.location.assign` called + error thrown), error message string `'redirecting-to-oauth'` for the thrown Error.

Total: ~13 tests added.

The migrated routes are NOT individually unit-tested for the auth flow this story — that would require building per-route fixtures, which is disproportionate. The route migrations are mechanical and the helpers ARE unit-tested; combined with the no-regression gate on the existing tournament-web suite (300 → 300+13 expected; no migration should drop any pre-existing test), the migration safety is bounded.

## Acceptance Criteria

**AC-1: Four new exports in `hooks/use-auth-session.ts` with the documented signatures (1 type + 3 functions).**

**Given** `apps/tournament-web/src/hooks/use-auth-session.ts`
**When** the file is parsed
**Then** it exports `LoaderAuthStatus` type, `validateLoaderAuthStatus` function, `loadLoaderAuthStatus` async function, and `requireAuthOrRedirect` async function with the signatures from Risk Acceptance §3
**And** the existing exports (`AuthStatusResponse`, `AuthDevice`, `fetchAuthStatus`, `useAuthSession`) are unchanged

**AC-2: `requireAuthOrRedirect` honors the `freshness` option exactly (per Section 3a §H#2 decision: fetchQuery for both modes).**

**Given** a call `requireAuthOrRedirect()` (or `requireAuthOrRedirect({ freshness: 'cache' })`)
**When** the helper runs and the auth-status query is cold or stale
**Then** it calls `queryClient.fetchQuery` with `staleTime: 30_000`, `retry: false`, and `queryFn: fetchAuthStatus` (the existing full-shape function — see Section 3a §H#1)
**And** when called with `requireAuthOrRedirect({ freshness: 'always' })`, it calls `queryClient.fetchQuery` with `staleTime: 0`, `retry: false`, and the same `queryFn: fetchAuthStatus`
**And** the helper narrows the `{player, device}` cache result to `{player}` for the return value (callers don't see the device field through this helper)

**AC-3: `retry: false` AND `queryKey: ['auth-status']` AND `queryFn: fetchAuthStatus` hardcoded on both code paths.**

**Given** the implementation of `requireAuthOrRedirect`
**When** the source is inspected
**Then** both the `'cache'` and `'always'` branches include `retry: false` in their query options (NOT defaulted; explicit literal)
**And** both branches use `queryKey: ['auth-status']` (NOT a different key — cache sharing with useAuthSession depends on this)
**And** both branches use `queryFn: fetchAuthStatus` (NOT `loadLoaderAuthStatus` — see Section 3a §H#1)
**And** there is no code path that allows TanStack Query's default retry behavior (3 attempts) to apply

**AC-4: Redirect-to-OAuth on null player matches pre-T11-2 byte-for-byte.**

**Given** the auth-status response returns `{ player: null }`
**When** `requireAuthOrRedirect` runs
**Then** it calls `window.location.assign('/api/auth/google')` exactly once
**And** it throws `new Error('redirecting-to-oauth')` with that exact message string

**AC-5: All 17 migrated routes use `requireAuthOrRedirect` (profile.tsx excepted — see Files list).**

**Given** `apps/tournament-web/src/routes/{17 files}` (enumerated in `## Files this story will edit`; profile.tsx is the documented exception and is NOT in the list)
**When** each file is parsed
**Then** the file does NOT declare a local `validateAuthStatus`, `loadAuthStatus`, or `AuthStatus` type (those are now imported from the hook OR deleted entirely if unused)
**And** the file's `beforeLoad` body is exactly one statement: `return requireAuthOrRedirect(opts?)` (where `opts` is omitted for variant A/B routes, or `{ freshness: 'always' }` for me.tsx + profile.tsx)
**And** the file imports `requireAuthOrRedirect` from `'../hooks/use-auth-session'` (all 18 routes live directly under `routes/`, no nested subdirectories — verified by file-list inspection; the import path is consistent across all 18)
**And** the existing `appQueryClient` / `queryClient` imports from `'../lib/query-client'` are removed if they're only used for the now-replaced auth flow (preserved if used elsewhere in the file for non-auth queries — Subtask 3.x.4 enumerates which routes keep the import)

**AC-6: me.tsx uses the `'always'` freshness variant (profile.tsx is unmigrated; it keeps its existing local staleTime: 0 loader).**

**Given** `apps/tournament-web/src/routes/me.tsx`
**When** the file is parsed
**Then** the `beforeLoad` body is `return requireAuthOrRedirect({ freshness: 'always' })`
**And** the existing inline comment explaining why me.tsx wants stricter freshness is preserved (relocated above the `beforeLoad` line if needed)
**And** `profile.tsx` is unchanged by this story (its local loader already uses staleTime: 0; it stays because it needs ghin + manualHandicapIndex — see Files list exception)

**AC-7: The new hook tests cover the four exports + the redirect path + load-bearing query options + test-isolation hazards.**

**Given** `apps/tournament-web/src/hooks/use-auth-session.test.ts` (NEW)
**When** `pnpm --filter @tournament/web test` runs
**Then** at least 13 new tests pass covering:
  - `validateLoaderAuthStatus` (6 input shapes): null input, non-object input, missing player, player=null, valid player, malformed player (missing string id OR wrong-type isOrganizer)
  - `loadLoaderAuthStatus` (3 fetch outcomes): happy path (fetch mock returns valid body), non-ok response (fetch resolves with `{ok: false}`), fetch throws (network error)
  - `requireAuthOrRedirect` (4 cases): 'cache' happy path returns `{player}`, 'always' happy path returns `{player}`, redirect-on-null-player path, error string assertion
**And** the redirect-on-null-player test asserts `window.location.assign` was called with `/api/auth/google` AND that the thrown Error's message is exactly `'redirecting-to-oauth'`
**And** at least one `requireAuthOrRedirect` test asserts the load-bearing query options via spy: `queryClient.fetchQuery` was called with `queryKey: ['auth-status']`, `queryFn: fetchAuthStatus` (reference equality OR function name match), `retry: false`, and the expected `staleTime` per the freshness mode

**Test setup hazards (mandatory):**
- `beforeEach` clears the `['auth-status']` cache via `queryClient.removeQueries({ queryKey: ['auth-status'] })` to prevent inter-test cache contamination (Section 3b)
- `window.location.assign` stubbing uses a jsdom-compatible pattern (Section 3b) — verify the pattern with a quick spike in subtask 2.2 before writing the redirect tests

**AC-8: No regression in any test suite + typecheck + lint clean.**

**Given** the full regression set
**When** `pnpm --filter @tournament/web test`, `pnpm --filter @tournament/api test`, `pnpm --filter @wolf-cup/engine test`, `pnpm --filter @wolf-cup/api test`, `pnpm -r typecheck`, `pnpm -r lint` all run
**Then** every previously-passing test still passes (no count drop in any suite)
**And** tournament-web's test count increases by approximately 13 (the new hook tests)
**And** typecheck + lint exit 0 with no new warnings or errors

**AC-9: Sprint-status flip lands atomically with the commit.**

**Given** the commit produced by step 10 of the director cycle
**When** the final commit is inspected
**Then** `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` has `T11-2-centralize-auth-boilerplate-in-use-auth-session: done`
**And** no other story's status changed in the same commit

## Tasks / Subtasks

1. **Extend use-auth-session.ts with the loader helpers**
   1.1. Add `LoaderAuthStatus` type, `validateLoaderAuthStatus`, `loadLoaderAuthStatus`, `requireAuthOrRedirect` exports per Risk Acceptance §3. Internal `queryClient` import from `'../lib/query-client'` for `requireAuthOrRedirect`. Doc comments explain the freshness option contract.
   1.2. Preserve the existing exports unchanged.

2. **Write hook tests**
   2.1. Create `apps/tournament-web/src/hooks/use-auth-session.test.ts` with the 13 tests per AC-7. Use `beforeEach(() => queryClient.removeQueries({ queryKey: ['auth-status'] }))` to prevent inter-test cache contamination per Section 3b.
   2.2. **Spike the window.location.assign stubbing pattern first.** Try `Object.defineProperty(window, 'location', { value: { assign: vi.fn(), href: '' }, writable: true })` AND `vi.spyOn(window.location, 'assign').mockImplementation(() => {})` — confirm which compiles + works in jsdom for this codebase, then pick one consistently. The naïve `window.location = { assign: vi.fn() } as Location` and `vi.stubGlobal('location', ...)` are FORBIDDEN per Section 3b (jsdom rejects direct assignment to the location object on modern versions). Use `vi.stubGlobal('fetch', vi.fn(...))` for the loadLoaderAuthStatus tests — that pattern IS jsdom-safe.
   2.3. Restore all stubs in `afterEach` (`vi.unstubAllGlobals()` AND restore the location property if `Object.defineProperty` was used).

3. **Migrate the 18 routes**
   For each of the 18 routes in `## Files this story will edit`:
   3.x.1 — Delete the local `type AuthStatus`, `validateAuthStatus`, `loadAuthStatus` block (~25 lines).
   3.x.2 — Replace the `beforeLoad` body with `return requireAuthOrRedirect()` (or `return requireAuthOrRedirect({ freshness: 'always' })` for me.tsx + profile.tsx). Use the explicit-`return` form, NOT an implicit-return arrow expression, for AC-5 conformance.
   3.x.3 — Add `import { requireAuthOrRedirect } from '../hooks/use-auth-session'`. All 18 routes live directly under `routes/` (no nested subdirectories — verified at spec-authoring time via `ls routes/`); the import path is `'../hooks/use-auth-session'` consistently. AC-5 mandates this exact path.
   3.x.4 — Remove the local `import { queryClient as appQueryClient }` / `import { queryClient }` if it's no longer used elsewhere in the file. If the file uses queryClient for non-auth queries (e.g., prefetching event data, invalidating other queries), keep the import. The dev agent MUST grep the file for `queryClient` / `appQueryClient` references AFTER deleting the auth block to confirm before removing the import.

4. **Verify**
   4.1. Run `pnpm --filter @tournament/web test` and confirm the 13 new tests pass AND no existing tests regress.
   4.2. Run `pnpm --filter @tournament/api test`, `pnpm --filter @wolf-cup/engine test`, `pnpm --filter @wolf-cup/api test`, `pnpm -r typecheck`, `pnpm -r lint`. Confirm clean.
   4.3. Smoke-check by reading 2 migrated routes (1 admin, 1 player) end-to-end to confirm no dead imports / unused vars / broken JSX.
   4.4. Record per-file LOC delta in Dev Agent Record Completion Notes (target ~30 lines removed × 18 = ~540 lines net deletion from routes; ~50 lines added to use-auth-session.ts; ~80 lines new in the hook test).

## Dev Notes

### Architectural alignment

T11-2 is mostly-mechanical refactoring: smaller surface area, single source-of-truth for auth-status route gating. Two deliberate behavior shifts are documented in Section 3a (both per Josh's 2026-05-20 codex-high decision): (a) loader uses `fetchAuthStatus` as queryFn so cache shape stays consistent with `useAuthSession`, (b) cache freshness mode uses `fetchQuery` for both modes, which tightens variant A's 11 admin routes from cached-stale-with-bg-refetch to blocking-refetch-on-stale. Variant B and C are byte-for-byte preserved. The `freshness` option is the user-visible behavioral knob; preserving variant-C's `'always'` semantics for me/profile is the load-bearing correctness check.

The hook file `use-auth-session.ts` is the right home for these helpers because (a) it already owns the `['auth-status']` queryKey and shares cache with the route loaders, (b) future fixes to the auth-status response shape land in one place, (c) the existing `useAuthSession` React hook can later be reworked to share the `validateLoaderAuthStatus` function (currently duplicated inside `fetchAuthStatus` — also a candidate for unification, but DEFERRED to keep T11-2's diff focused on route-side cleanup).

### Key references

- T11 audit (inline during cycle setup): 18 routes copy-paste auth boilerplate; ~540 LOC of dup.
- T8-4 commit history: `useAuthSession` hook was originally introduced for InstallPromptHost + AwardCelebration; route-loaders never adopted it — that's the gap T11-2 closes.
- T11-3 (next story): consumes nothing from T11-2 directly, but the migrated routes are the same 18 files T11-3 will further migrate to consume PageShell + BackLink. Two passes against the same surface area — keep changes mechanically separable so a bisect can isolate either.

### Risks / Followups

- **Discovered exception (Josh decision 2026-05-20): `profile.tsx` NOT migrated.** Its loader parses `ghin` + `manualHandicapIndex` from `/api/auth/status` (the API returns them; the shared `fetchAuthStatus` drops them). Migrating would require extending the shared hook contract (rejected as scope creep) or a profile-page refactor (out of scope). profile.tsx keeps its richer local loader. **Followup candidate:** if a future story wants 100% auth-loader dedup, either extend `AuthStatusResponse.player` to optionally include ghin/manualHandicapIndex (and add a `requireAuthOrRedirectFull` variant) OR move profile's ghin/handicap read to a dedicated profile query.
- **Discovered dead-code cleanup during migration: `events.$eventId.index.tsx` viewerName branch.** That route's local loader parsed an optional `name` field and the component had a `ctx.player.name !== undefined ? ... : ...` branch. `/api/auth/status` never returns `name` (verified: returns `{id, isOrganizer, ghin, manualHandicapIndex}`), so `name` was always undefined and the truthy branch was dead. Migration removed the dead branch; `EventHomePage`'s `viewerName` prop is optional and stays undefined (behavior-preserving). `events.$eventId.gallery.tsx` had the same `name?` parse but never consumed it (only `isOrganizer`), so migration there was a clean drop.
- **Followup: unify `fetchAuthStatus` and `validateLoaderAuthStatus`.** The hook file currently has TWO validators: `fetchAuthStatus` (used by useAuthSession; returns `{ player, device }`) and the new `loadLoaderAuthStatus` (used by route loaders; returns `{ player }` only). They share most logic. A future micro-enhancement could collapse to one validator with a shape-narrowing variant. Deferred because the diff would touch T8-4's InstallPromptHost flow and the marginal value is low.
- **Followup: per-route auth-flow integration tests.** This story unit-tests the helpers but does NOT add per-route fixtures that simulate "null player → redirect" for each of the 18 routes. The migration is mechanical (verified by grep + visual review) but a future story could add a per-route smoke test if any auth-edge-case bug ever ships.
- **Risk acceptance:** the migration changes ~18 route files in one commit. Each individual route migration is small (~30 LOC removed, ~3 added) but the aggregate diff is large. Codex impl review should focus on (a) the use-auth-session.ts changes (substantive), (b) sampling 2-3 route diffs (mechanical), (c) verifying no unused imports remain.
- **Risk acceptance:** if any route uses `appQueryClient`/`queryClient` for purposes OTHER than the auth-status flow (e.g., to prefetch event data), the import must be PRESERVED. Subtask 3.x.4 handles this case explicitly. Codex review must verify.

## Files this story will edit

- apps/tournament-web/src/hooks/use-auth-session.ts
- apps/tournament-web/src/hooks/use-auth-session.test.ts
- apps/tournament-web/src/routes/admin.courses.new.tsx
- apps/tournament-web/src/routes/admin.courses.upload.tsx
- apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.index.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx
- apps/tournament-web/src/routes/admin.events.new.tsx
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx
- apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx
- apps/tournament-web/src/routes/events.$eventId.bets.tsx
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx
- apps/tournament-web/src/routes/events.$eventId.gallery.tsx
- apps/tournament-web/src/routes/events.$eventId.index.tsx
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- apps/tournament-web/src/routes/events.$eventId.money.tsx
- apps/tournament-web/src/routes/events.$eventId.schedule.tsx
- apps/tournament-web/src/routes/events.$eventId.settle-up.tsx
- apps/tournament-web/src/routes/me.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

20 files (1 hook + 1 new hook test + 17 route migrations + sprint-status flip).

**EXCEPTION discovered during dev (Josh decision 2026-05-20): `profile.tsx` is NOT migrated** and is removed from this list. Its local `validateAuthStatus` parses `ghin` + `manualHandicapIndex` (which `/api/auth/status` DOES return) and `ProfilePage` consumes both for the GHIN/handicap editor. The shared `fetchAuthStatus` only extracts `{id, isOrganizer}`, so `requireAuthOrRedirect` cannot feed profile what it needs without extending the shared hook contract (rejected as scope creep). profile.tsx keeps its richer local loader. T11-2 migrates 17 of the 18 routes that had the auth boilerplate. Additional files MAY be added during implementation only under `apps/tournament-web/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director).

### Debug Log References

(to be populated during dev-story + codex passes)

### Completion Notes List

(to be populated during dev-story)

### File List

(to be populated during dev-story)
