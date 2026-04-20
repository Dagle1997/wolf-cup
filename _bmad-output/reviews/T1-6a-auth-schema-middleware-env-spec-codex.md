# Codex Review

- Generated: 2026-04-20T20:23:00.456Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md

## Summary

The spec is internally consistent and does stand on its own as an “infrastructure slice” (schema + env + session helpers + middleware + migrations + docker wiring) without requiring T1-6b to boot or to run tests. The main risks are (a) multi-tenant correctness around UNIQUE constraints/FKs when `tenant_id` exists but is not part of identity uniqueness, (b) env defaults that can silently misconfigure production security/CSRF, (c) CSRF origin matching pitfalls, and (d) potential flakiness in time-based session tests unless time is controlled.

Overall risk: medium

## Findings

1. [high] oauth_identities UNIQUE(provider, provider_sub) ignores tenant_id even though tenant_id exists everywhere
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:23-35
   - Confidence: high
   - Why it matters: The spec includes `...ecosystemColumns()` (tenant_id, context_id) on `players` and `oauth_identities` (lines 23, 33) but defines the key uniqueness for identities as only `(provider, provider_sub)` (line 34). If the system ever runs multiple tenants in the same DB (which the presence of tenant_id strongly implies), the same Google `sub` could legitimately exist in two tenants and would be blocked by this global unique constraint. Similarly, lookups/joins that don’t include tenant_id can accidentally cross tenant boundaries.
   - Suggested fix: Decide explicitly whether the DB is single-tenant-per-database. If multi-tenant-in-one-DB is possible, change the UNIQUE to include tenant_id: UNIQUE(tenant_id, provider, provider_sub) and consider adding tenant_id to the player FK shape/queries (and potentially composite FK constraints where applicable). If it is single-tenant, document that invariant and consider removing tenant_id from these tables or at least avoid implying multi-tenancy.

2. [medium] AUTH_COOKIE_DOMAIN and PUBLIC_APP_URL defaults can silently misconfigure production; NODE_ENV/DB_PATH lack defaults can break tests/boot if not set
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:56-66
   - Confidence: high
   - Why it matters: The env schema sets defaults for `AUTH_COOKIE_DOMAIN` and `PUBLIC_APP_URL` (lines 63-65). In production, forgetting to set either can lead to hard-to-diagnose auth failures (cookie Domain doesn’t match actual host) or security issues (CSRF origin allowlist doesn’t match real frontend origin). Conversely, `NODE_ENV` and `DB_PATH` have no defaults (lines 60-62), so module-load fail-fast is correct but will make unit tests and local scripts fail unless the test harness always sets them before importing `env`.
   - Suggested fix: Make production-critical values required when `NODE_ENV==='production'` (Zod refine/superRefine), and/or remove production-ish defaults for `AUTH_COOKIE_DOMAIN`/`PUBLIC_APP_URL` to force explicit configuration. Also ensure the test runner sets NODE_ENV/DB_PATH very early (e.g., via vitest/jest setup file) to avoid import-time crashes.

3. [medium] Global CSRF origin uses PUBLIC_APP_URL as a URL string; origin matching is sensitive to scheme/host/port and can break if PUBLIC_APP_URL has a path/trailing slash or multiple allowed origins
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:92-95
   - Confidence: medium
   - Why it matters: `csrf({ origin: env.PUBLIC_APP_URL })` (line 94) assumes the library compares against the request Origin header in a compatible way. Many CSRF middlewares expect an origin (scheme+host+port) rather than an arbitrary URL; any path, trailing slash normalization, or multiple frontend origins (preview deployments) can cause legitimate POST/PUT/DELETE requests to be rejected. Because this is mounted globally, it can become a broad availability issue for all unsafe methods.
   - Suggested fix: Normalize `PUBLIC_APP_URL` to an origin at runtime (e.g., `new URL(env.PUBLIC_APP_URL).origin`) and consider allowing a list (array) if needed. Add at least one test that an unsafe method without the right Origin is blocked and one that the configured origin is allowed (even if no routes currently use it heavily).

4. [medium] Cookie policy SameSite=Strict may block legitimate cross-site usage depending on final deployment topology (app vs api origins)
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:75-80
   - Confidence: medium
   - Why it matters: The spec mandates `SameSite=Strict` in all envs (lines 78-79). This is safest, but if tournament-web and tournament-api ever end up on different “sites” (not just subdomains) or if any auth flow needs cookies on cross-site navigations/requests, Strict can prevent the browser from sending the session cookie, producing confusing 401s. The spec currently assumes subdomain/same-site behavior without stating it explicitly.
   - Suggested fix: Either (a) explicitly document the assumption that app+api are same-site (eTLD+1) and keep Strict, or (b) make SameSite configurable and consider `Lax` if you anticipate cross-site navigations that must carry cookies. Ensure T1-6b OAuth callback behavior is validated under real deployment domains.

5. [medium] Time-based session tests are likely to become flaky without explicit clock control
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:70-124
   - Confidence: high
   - Why it matters: `validateSession` updates timestamps and enforces both rolling expiry and a 30-day hard cap (lines 71-72), and the test plan asserts specific behaviors (lines 120-123). If tests rely on real time (`Date.now()`), they can be flaky (race conditions around boundary checks, different environments).
   - Suggested fix: In the implementation plan, require fake timers or an injected `now()` function for session logic. In tests, set `now` deterministically and assert exact stored values (or use ranges) to avoid boundary flake.

6. [low] ContextVariableMap typing may not be reliably visible project-wide if augmentation lives in a regular .ts file and isn’t included/imported in some compilation contexts
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:81-89
   - Confidence: medium
   - Why it matters: The spec allows the Hono module augmentation to live at the top of `require-session.ts` (lines 88-89). That can work, but type augmentations are easiest to break when build tooling changes (isolatedModules, tsconfig includes/excludes, test compilation not importing that file, etc.). If the augmentation isn’t picked up, downstream code will regress to `unknown` variables and force casts.
   - Suggested fix: Prefer a dedicated `src/types/hono.d.ts` (or similar) that is always included by tsconfig, and keep runtime code separate. Add a lightweight typecheck-only assertion (as planned) but ensure it doesn’t depend on importing the middleware module in the same file.

7. [low] Cookie Max-Age remains 7 days even when near the 30-day hard cap; can cause repeated 401+clear cycles after hard cap is exceeded
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:71-80
   - Confidence: medium
   - Why it matters: At ~day 29, `validateSession` will extend `expires_at` by 7 days (line 71), but the hard cap is enforced by `created_at + 30days > now` (line 71). After day 30, the cookie may still be present (Max-Age always 7d; lines 78-79) and users will get 401 + cookie clear until the response is processed. Not catastrophic, but it’s avoidable UX noise.
   - Suggested fix: Optionally cap `expires_at` and cookie Max-Age to the remaining hard-cap window (min(7d, hardCapRemainingSeconds)). At least ensure `requireSession` clears the cookie on invalid sessions as specified (line 86).

8. [low] Spec requires device_info truncation but doesn’t require a test or a DB constraint; easy to accidentally violate and store unbounded user-agent strings
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:44-45
   - Confidence: high
   - Why it matters: SQLite won’t enforce `≤128 char` unless you add a CHECK constraint; the spec currently relies on application truncation (line 44). Without a test, it’s easy to miss and store very large UA strings, which can bloat DB rows and logs.
   - Suggested fix: Either add a CHECK(LENGTH(device_info) <= 128) in the migration or enforce truncation in `createSession` and add a small unit test to lock it in.

## Strengths

- Clean split boundary: T1-6a delivers bootable schema/migrations/env/session+middleware without pulling OAuth deps (lines 220-224).
- Env-aware cookie branching is explicitly specified and test-required, covering the common localhost/domain+secure pain (lines 75-80, 120-121).
- Middleware error shapes and cookie-clearing behavior are spelled out, which tends to prevent security/UX regressions (lines 84-87, 91).
- Dockerfile migration-copy + migrate/seed-on-start pattern is clearly described and aligns with an existing repo pattern (lines 102-107).

## Warnings

None.
