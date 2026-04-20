# Story T1.6a: Auth Schema + Middleware + Env (infrastructure slice)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the tournament-api's auth infrastructure in place — `players` schema (minimal slice), `oauth_identities` table, `sessions` schema, `require-session` + `require-organizer` middleware, `src/lib/env.ts` Zod schema, first tournament-api migration wired through the Dockerfile CMD, and docker-compose env-var slots for auth config —
so that T1-6b (arctic Google SSO) drops in cleanly without schema/middleware churn, and T2 can start in parallel using `require-organizer` for its admin endpoints (T2.3/T2.5 per the epic amendment 2026-04-18).

**Scope context:** This is the T1-6 split per party advisory + Josh's call on 2026-04-20. T1-6a ships the infrastructure that's ecosystem-neutral (works for SSO, magic-link, and any future provider). T1-6b adds arctic Google OAuth on top. Magic-link is deferred past Epic T1 entirely — returns as a T3.x story when `players.email` lands.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/db/schema/players.ts`
   **When** inspected
   **Then** it exports a Drizzle `players` table (sqliteTable) with the **epic AC #1 minimal slice verbatim** (no `google_sub` — that identifier lives in `oauth_identities` per Fork 2b):
   - `id TEXT PRIMARY KEY` — app-generated UUID (`crypto.randomUUID()` at insert time); opaque, used for `context_id` stamping
   - `is_organizer INTEGER NOT NULL DEFAULT 0` — SQLite bool via Drizzle's `integer(...,{mode: 'boolean'}).notNull().default(false)`
   - `created_at INTEGER NOT NULL` — unix ms epoch
   - `...ecosystemColumns()` spread (T1-2 factory): `tenant_id TEXT NOT NULL DEFAULT 'guyan'`, `context_id TEXT NOT NULL`
   Exports `players` table object + `type Player = typeof players.$inferSelect`. Re-exported from `src/db/schema/index.ts`.
2. **Given** `apps/tournament-api/src/db/schema/oauth_identities.ts`
   **When** inspected
   **Then** it exports an `oauth_identities` table with:
   - `id TEXT PRIMARY KEY` — app-generated UUID
   - `provider TEXT NOT NULL` — e.g. `'google'`, `'apple'` (future); enforced as a Drizzle `$type<'google' | 'apple'>()` TS narrowing but not a SQL check constraint (SQLite tolerant; T1-6b uses `'google'` only)
   - `provider_sub TEXT NOT NULL` — the provider's stable user identifier (Google's `sub` claim, Apple's `sub`)
   - `player_id TEXT NOT NULL` FK → `players.id` ON DELETE CASCADE
   - `created_at INTEGER NOT NULL`
   - `...ecosystemColumns()`
   - Composite UNIQUE index on `(tenant_id, provider, provider_sub)` so the same Google sub in a given tenant can't bind to two players — the `tenant_id` prefix preserves FD-6 multi-tenant correctness (same Google account could legitimately belong to distinct `guyan` and `future-other-tenant` players). Separate index on `player_id` for reverse lookup.
   **Query patterns this index supports** (named here to lock in the lookup shape for downstream stories):
   - **Primary (T1-6b OAuth callback):** `SELECT ... FROM oauth_identities WHERE tenant_id = ? AND provider = ? AND provider_sub = ?` — uses the composite UNIQUE directly; `tenant_id` is the leftmost column so the index is hit even if only tenant+provider is filtered (future admin listing).
   - **Reverse (session/profile lookups):** `SELECT ... FROM oauth_identities WHERE player_id = ?` — uses the separate `player_id` index.
   Do NOT reorder the composite columns to `(provider, provider_sub, tenant_id)` — `tenant_id` first ensures tenant-scoped admin queries hit the index even when `provider` is not filtered.
   Exports table + `type OauthIdentity = typeof oauth_identities.$inferSelect`. Re-exported from `src/db/schema/index.ts`.
3. **Given** `apps/tournament-api/src/db/schema/auth.ts`
   **When** inspected
   **Then** it defines ONLY the `sessions` table (magic_link_tokens is NOT included — magic-link deferred per Fork 1c):
   - `session_id TEXT PRIMARY KEY` — 256-bit opaque token via `crypto.randomBytes(32).toString('base64url')`
   - `player_id TEXT NOT NULL` FK → `players.id` ON DELETE CASCADE
   - `created_at INTEGER NOT NULL`
   - `last_seen_at INTEGER NOT NULL`
   - `expires_at INTEGER NOT NULL`
   - `device_info TEXT` — nullable; truncated (≤128 char) `user-agent` + request IP summary
   - `...ecosystemColumns()`
   Index on `player_id`. Exports table + `type Session = typeof sessions.$inferSelect`. Re-exported from `src/db/schema/index.ts`.
4. **Given** `apps/tournament-api/src/db/migrations/` + `apps/tournament-api/drizzle.config.ts`
   **When** `pnpm -F @tournament/api db:generate` runs
   **Then** at least one SQL migration file emits under `src/db/migrations/` (drizzle-kit auto-numbered, typically `0000_*.sql`). The emitted SQL creates `players`, `oauth_identities`, `sessions` tables with the columns + indexes + FKs from AC #1-3. The migration + its `meta/` journal is committed. This is the **first tournament-api migration**.
5. **Given** `apps/tournament-api/src/db/migrate.ts`
   **When** `node dist/db/migrate.js` runs
   **Then** it imports drizzle's libsql migrator + the local `db` client + the migrations folder at `./migrations` (resolved via `import.meta.url` per Wolf Cup pattern at `apps/api/src/db/migrate.ts:9-12`), applies any un-applied migrations idempotently, and exits 0. Shape mirrors `apps/api/src/db/migrate.ts`.
6. **Given** `apps/tournament-api/src/db/seed.ts`
   **When** `node dist/db/seed.js` runs
   **Then** it is an idempotent placeholder seed runner (creates zero rows at T1-6a; T2.2 lands the real roster seed). Structure: single `async function seed()` + top-level `await seed()` + `process.exit(0)` + a single `console.log('Tournament seed: no data at T1.6a — T2.2 adds roster.')`. Exists so the Dockerfile CMD can `&& node dist/db/seed.js` without failing.
7. **Given** `apps/tournament-api/src/lib/env.ts`
   **When** inspected
   **Then** it exports `env` from a Zod object schema. T1-6a scope (no OAuth, no Resend — those land in T1-6b):
   ```
   NODE_ENV: z.enum(['development','production','test']),
   DB_PATH: z.string(),
   PORT: z.coerce.number().default(3000),
   AUTH_COOKIE_DOMAIN: z.string().min(1),        // REQUIRED — no default; silent-misconfig risk otherwise
   PUBLIC_APP_URL: z.string().url(),             // REQUIRED — no default; CSRF origin depends on this
   ```
   `process.env` access is centralized here — nowhere else in tournament-api reads `process.env.X` directly after this story. Parse failures throw at module-load (fail-fast on startup). **AUTH_COOKIE_DOMAIN and PUBLIC_APP_URL are REQUIRED with no defaults** — a silent wrong default in production (e.g., PUBLIC_APP_URL accidentally falling back to `http://localhost:5173`) would break CSRF origin checks and cookie scoping. Better to fail-fast at boot than ship with wrong values. **Required-values plumbing across execution contexts (all three must be satisfied for the module to import cleanly):**
   - **Production (VPS):** supplied by `docker-compose.yml` per AC #16 via bare `${VAR}` references (no compose-level fallback defaults — a missing value on the VPS fails Zod parse at boot; see AC #16 rationale).
   - **Local dev (`pnpm -F @tournament/api dev`):** Josh creates `apps/tournament-api/.env` with at minimum `NODE_ENV=development`, `DB_PATH=./data/tournament.db`, `AUTH_COOKIE_DOMAIN=localhost`, `PUBLIC_APP_URL=http://localhost:5173`. The `dev` script is `"dev": "node --watch --env-file=.env dist/index.js"` — already set up in T1-2 scaffold's package.json. If `.env` is missing, `node --env-file=` fails fast with a clear error. **Note: `apps/tournament-api/.env` MUST be in `apps/tournament-api/.gitignore` (already present from T1-2: `data/*.db` etc.; add `.env` to that list if absent — ALLOWED path edit).**
   - **Tests (`pnpm -F @tournament/api test`):** Vitest config loads `apps/tournament-api/.env.test` via a `setupFiles` entry at `src/test-setup.ts` that calls `process.env.NODE_ENV='test'` + supplies test-appropriate values for `DB_PATH`, `AUTH_COOKIE_DOMAIN`, `PUBLIC_APP_URL` BEFORE any code-under-test imports `env`. Alternative: use `vitest.config.ts`'s `test.env` option to inject inline. Either approach works; dev-agent picks. The test setup MUST precede any module import that touches `src/lib/env.ts`, else tests fail at the first env-touching import.
   **`ADMIN_SESSION_SECRET` is NOT included** — per codex round-1 finding #6 + architecture review: session cookie is opaque server-side-stored `session_id`, no cookie-signing HMAC is needed. Adding it would be unused complexity.
8. **Given** `apps/tournament-api/src/lib/session.ts`
   **When** inspected
   **Then** it exports helpers shared by OAuth routes (T1-6b) and middleware (this story). **All time-reading goes through an injectable `now()` function** so tests can use `vi.useFakeTimers()` or pass a mock — direct `Date.now()` calls inside the helpers are forbidden to keep the time-sensitive tests in AC #18 deterministic:
   - `createSession(playerId: string, req: { userAgent: string, ip: string }, now?: () => number): Promise<{ sessionId: string, setCookieHeader: string }>` — inserts a row into `sessions`, generates the opaque token, returns the token + `Set-Cookie` header with env-aware attributes from AC #9. `device_info` is constructed as `${userAgent}|${ip}`.slice(0, 128) — the slice guarantees the 128-char cap regardless of input length.
   - `validateSession(sessionId: string, now?: () => number): Promise<{ playerId: string, isOrganizer: boolean } | null>` — reads the sessions row, checks `expires_at > now()` AND `created_at + 30*86400*1000 > now()` (rolling + hard 30-day cap per D2-4), updates `last_seen_at = now()` + `expires_at = now() + 7*86400*1000` if valid, returns `{ playerId, isOrganizer }` or `null`.
   - `deleteSession(sessionId: string): Promise<void>` — removes the row; used on logout + invalid-session cookie cleanup.
   - `sessionCookieHeader(value: string | null): string` — produces the `Set-Cookie` header string with env-aware attributes (Max-Age=0 if value is null — cookie clear).
   The `now?` parameter defaults to `Date.now` when omitted (production callers never pass it). All functions access the Drizzle `db` client from `src/db/index.ts`. The `device_info` 128-char truncation is asserted by at least one `session.test.ts` case (codex round-1 #8 — otherwise easy to regress to unbounded storage).
9. **Given** session cookie attribute decisions (per Fork 3a resolution — env-aware)
   **When** a cookie is emitted via `sessionCookieHeader`
   **Then** attributes are set by environment:
   - **Production (`env.NODE_ENV === 'production'`):** `HttpOnly; Secure; SameSite=Strict; Domain=${env.AUTH_COOKIE_DOMAIN}; Path=/; Max-Age=604800` (7 days). On clear: `Max-Age=0` with all same attributes so the browser removes the exact cookie.
   - **Development / test (`env.NODE_ENV !== 'production'`):** `HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` — NO `Secure`, NO `Domain` (host-only cookie on whatever dev host is in use). Cookie-jar libraries in integration tests persist these correctly against `localhost`.
   This branch lives in `sessionCookieHeader` in `src/lib/session.ts`. Name of the cookie: `tournament_session`.
10. **Given** `apps/tournament-api/src/middleware/require-session.ts`
    **When** inspected
    **Then** it exports a Hono middleware `requireSession` that:
    - Reads the `tournament_session` cookie
    - If absent → returns 401 `{ error: 'unauthenticated', code: 'session_missing', requestId: <string> }` (requestId placeholder until T1-7; use `crypto.randomUUID()` for now)
    - If present → calls `validateSession(sessionId)`; if null → clears the cookie (emits a `Set-Cookie` clear via `sessionCookieHeader(null)`) and returns 401 with `code: 'session_invalid'`
    - If valid → sets `c.set('session', { sessionId, playerId })` + `c.set('player', { id: playerId, isOrganizer })` + calls `next()`
    Typed via a Hono Variables augmentation in **`apps/tournament-api/src/types/hono.d.ts`** (a dedicated `.d.ts` file — NOT inline in a `.ts` file; see Dev Notes rationale re: `.d.ts` being picked up project-wide vs inline `.ts` augmentations that can silently fail to apply if the file isn't in the import graph). Shape: `declare module 'hono' { interface ContextVariableMap { session: { sessionId: string; playerId: string }; player: { id: string; isOrganizer: boolean } } }`. `tsconfig.app.json`'s `"include": ["src"]` automatically picks up the `.d.ts` file; no explicit import needed anywhere. Downstream handler writing `const { playerId } = c.get('session')` MUST compile without `as any` casts.
11. **Given** `apps/tournament-api/src/middleware/require-organizer.ts`
    **When** inspected
    **Then** it exports `requireOrganizer` that runs AFTER `requireSession` in the middleware chain, reads `c.get('player').isOrganizer`, and returns 403 `{ error: 'forbidden', code: 'not_organizer', requestId }` if false. If `c.get('player')` is undefined it's a misuse (`requireOrganizer` used without `requireSession` ahead of it) — return 500 with `code: 'middleware_misuse'` and log. Exports includes a JSDoc comment documenting the required chain: `app.use('/admin/*', requireSession, requireOrganizer)`.
12. **Given** `apps/tournament-api/src/app.ts`
    **When** inspected post-T1.6a
    **Then** it additionally imports `csrf` from `'hono/csrf'` (built-in to Hono 4.x — no new dep) and mounts it globally BEFORE any middleware that might read cookies:
    ```ts
    const origin = new URL(env.PUBLIC_APP_URL).origin;  // normalized scheme://host[:port], no path/trailing slash
    app.use('*', csrf({ origin }));
    ```
    The `new URL(...).origin` normalization avoids a class of CSRF-origin-matching bugs codex round-1 #3 flagged (trailing slash, path component, port mismatch). CSRF middleware only affects **unsafe methods** (POST/PUT/PATCH/DELETE) per Hono docs, so `GET /api/health` is unaffected. The existing `/api/health` route is preserved and remains unauthenticated. No auth routes are mounted in T1-6a (those land in T1-6b); `requireSession` + `requireOrganizer` are merely EXPORTED for downstream stories, not yet applied to any route.
13. **Given** `apps/tournament-api/src/routes/auth.ts`
    **When** inspected
    **Then** it exists as a stub Hono sub-router with a single placeholder `GET /status` route returning `{ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' }` (200). The `auth` router is NOT mounted on the main app yet — T1-6b will mount it at `app.route('/auth', authRouter)` when it adds the real sign-in routes. This stub exists so T1-6b can diff-add real handlers rather than introducing a whole new file; it also gives T1-6a a trivial integration-test anchor for the middleware chain.
    **Alternative considered and rejected:** omit this file entirely until T1-6b. Rejected because creating it now (a) lets T1-6b's diff look like pure handler additions rather than file-plus-handler, and (b) gives this story a non-trivial file count that makes impl-codex review worthwhile.
14. **Given** `apps/tournament-api/package.json`
    **When** inspected post-T1.6a
    **Then** NO new dependencies are added. `arctic` is T1-6b's concern; Resend is deferred with magic-link; crypto.randomBytes + crypto.randomUUID are Node built-ins; `hono/csrf` is built-in to Hono 4.x. This story touches NEITHER `pnpm-lock.yaml` NOR any `package.json` dep/devDep field. **Zero SHARED `pnpm-lock.yaml` gate in T1-6a** — a nice simplification vs the original unified T1-6 plan.
15. **Given** `apps/tournament-api/Dockerfile`
    **When** inspected post-T1.6a
    **Then** two changes (mirrors Wolf Cup `apps/api/Dockerfile` pattern):
    - A new `COPY apps/tournament-api/src/db/migrations/ ./apps/tournament-api/dist/db/migrations/` step is added to the runtime stage, after the existing `COPY --from=builder /app/apps/tournament-api/dist/ ...` step. (Pattern from `apps/api/Dockerfile:45`.)
    - The CMD is updated from `CMD ["node", "dist/index.js"]` → `CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js"]`. Migrate runs every container start (idempotent via drizzle's `__drizzle_migrations` journal); seed runs every container start (idempotent — T1-6a's placeholder is a no-op).
    (This carry-forward was deferred from T1-4 to the first schema-landing story; T1-6a is that story.)
16. **Given** `docker-compose.yml` at repo root (SHARED — explicit user approval required before editing)
    **When** inspected post-T1.6a
    **Then** the `tournament-api` service's `environment:` block is expanded ADDITIVELY with:
    - `AUTH_COOKIE_DOMAIN=${AUTH_COOKIE_DOMAIN}`
    - `PUBLIC_APP_URL=${PUBLIC_APP_URL}`
    **No `${VAR:-default}` fallbacks** — intentional. The Zod schema in `src/lib/env.ts` marks both as REQUIRED with no default (AC #7); if `.env.production` on the VPS is missing either, compose passes an empty string, Zod rejects (`z.string().min(1)` / `z.string().url()`), and the container fails fast at boot with a clear error. This is the desired behavior per codex round-1 finding #2 — shipping with wrong values is worse than failing to start. Josh's `.env.production` on the VPS MUST contain both keys before `docker compose up -d --build` runs (flagged in post-deploy Followups; Josh can set them once and forget). Existing env vars (NODE_ENV, DB_PATH, PORT, TZ from T1-4) are byte-unchanged. Wolf Cup services + tournament-web + networks + volumes are byte-unchanged. **This is T1-6a's ONLY SHARED edit.** OAuth-specific env vars (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET) land in T1-6b.
17. **Given** local execution
    **When** `pnpm -F @tournament/api db:migrate` runs on a fresh local DB (delete `apps/tournament-api/data/tournament.db*` first)
    **Then** it exits 0. Verification: a `sqlite3` query or a Node inspection script confirms `players`, `oauth_identities`, `sessions`, and `__drizzle_migrations` tables exist with expected column shapes.
18. **Given** tests for the middleware + session helpers
    **When** `pnpm -F @tournament/api test` runs
    **Then** new test cases pass alongside the existing 19 (= total ≥ 29):
    - `src/lib/session.test.ts` — at least 5 cases: createSession persists + returns cookie header, validateSession updates last_seen, validateSession rejects expired by 7-day, validateSession rejects past 30-day hard cap, sessionCookieHeader emits env-correct attributes under NODE_ENV=production vs development vs test.
    - `src/middleware/require-session.test.ts` — at least 4 cases: no cookie → 401 + session_missing, bad cookie → 401 + session_invalid + clear-cookie, valid cookie → next called + context set, context typing compiles (`c.get('session').sessionId` is `string`).
    - `src/middleware/require-organizer.test.ts` — at least 3 cases: is_organizer=true → next, is_organizer=false → 403 + not_organizer, no player context (misuse) → 500 + middleware_misuse.
    - `src/routes/auth.test.ts` — at least 1 case: GET /status returns `{ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' }`.
    All tests use programmatically-created session rows (direct DB inserts in test setup) since no OAuth or magic-link creates real sessions yet at T1-6a.
19. **Given** Wolf Cup workspaces (engine + api)
    **When** `pnpm -F @wolf-cup/engine test` and `pnpm -F @wolf-cup/api test` run post-T1.6a
    **Then** both continue to pass with zero net-negative test count change. Same regression guard as all prior Epic T1 stories.
20. **Given** `pnpm -F @tournament/api typecheck` and `pnpm -F @tournament/api lint`
    **When** run
    **Then** both exit 0 under the existing tsconfig strictness flags (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess, noImplicitOverride, noPropertyAccessFromIndexSignature).

## Tasks / Subtasks

- [ ] Task 1: Environment schema (AC #7)
  - [ ] Subtask 1.1: Create `src/lib/env.ts` with the 5-key Zod schema. Import + re-export `env` for use elsewhere.
- [ ] Task 2: Player + auth schema (AC #1, #2, #3)
  - [ ] Subtask 2.1: Create `src/db/schema/players.ts` (minimal slice).
  - [ ] Subtask 2.2: Create `src/db/schema/oauth_identities.ts`.
  - [ ] Subtask 2.3: Create `src/db/schema/auth.ts` (sessions only — no magic_link_tokens).
  - [ ] Subtask 2.4: Update `src/db/schema/index.ts` to re-export all three.
- [ ] Task 3: First migration (AC #4, #5, #6)
  - [ ] Subtask 3.1: Run `pnpm -F @tournament/api db:generate`. Inspect the emitted SQL — must include `CREATE TABLE players`, `CREATE TABLE oauth_identities` (with composite UNIQUE on provider+provider_sub), `CREATE TABLE sessions`, plus all FK constraints + indexes.
  - [ ] Subtask 3.2: Create `src/db/migrate.ts` mirroring Wolf Cup's `apps/api/src/db/migrate.ts` shape exactly.
  - [ ] Subtask 3.3: Create `src/db/seed.ts` — single async function + top-level await + exit 0 + placeholder console.log.
- [ ] Task 4: Session helpers (AC #8, #9)
  - [ ] Subtask 4.1: Create `src/lib/session.ts` with the four exported helpers.
  - [ ] Subtask 4.2: Create `src/lib/session.test.ts` with the 5 required cases from AC #18.
- [ ] Task 5: Middleware (AC #10, #11)
  - [ ] Subtask 5.1: Create `src/middleware/require-session.ts`.
  - [ ] Subtask 5.2: Create `src/middleware/require-session.test.ts` with the 4 required cases.
  - [ ] Subtask 5.3: Create `src/middleware/require-organizer.ts`.
  - [ ] Subtask 5.4: Create `src/middleware/require-organizer.test.ts` with the 3 required cases.
- [ ] Task 6: CSRF wiring + auth-router stub (AC #12, #13)
  - [ ] Subtask 6.1: Update `src/app.ts` to mount `hono/csrf` globally with `origin: new URL(env.PUBLIC_APP_URL).origin` (normalized scheme+host+port; avoids trailing-slash / path-component matching bugs per AC #12). Verify `/api/health` still returns 200 without auth (CSRF applies to unsafe methods only).
  - [ ] Subtask 6.2: Create `src/routes/auth.ts` (stub router with single `GET /status` route). Do NOT mount it on the main app yet — T1-6b does that.
  - [ ] Subtask 6.3: Create `src/routes/auth.test.ts` with the 1 required case.
- [ ] Task 7: Dockerfile update (AC #15)
  - [ ] Subtask 7.1: Add `COPY apps/tournament-api/src/db/migrations/ ./apps/tournament-api/dist/db/migrations/` to the runtime stage of `apps/tournament-api/Dockerfile`.
  - [ ] Subtask 7.2: Update CMD to `["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js"]`.
- [ ] Task 8: docker-compose env additions (AC #16) — **SHARED HARD STOP**
  - [ ] Subtask 8.1: Announce the 2 new env-var additions on `tournament-api` service. Wait for explicit Josh approval before editing.
- [ ] Task 9: Local verification (AC #17, #18, #20)
  - [ ] Subtask 9.1: `pnpm -F @tournament/api typecheck` → exit 0.
  - [ ] Subtask 9.2: `pnpm -F @tournament/api lint` → exit 0.
  - [ ] Subtask 9.3: `pnpm -F @tournament/api test` → all new + existing 19 tests pass.
  - [ ] Subtask 9.4: `pnpm -F @tournament/api build` → exit 0; `dist/db/migrate.js`, `dist/db/seed.js`, `dist/index.js` all emit.
  - [ ] Subtask 9.5: Fresh-DB migration sanity — delete `apps/tournament-api/data/tournament.db*`, run `pnpm -F @tournament/api db:migrate`, exit 0, confirm the 4 tables (`players`, `oauth_identities`, `sessions`, `__drizzle_migrations`) exist.
- [ ] Task 10: Wolf Cup regression (AC #19)
  - [ ] Subtask 10.1: `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` — both green with same counts.

## Dev Notes

- **Why the oauth_identities split (Fork 2b):** supports future Apple SSO per FD-4 with zero migration churn — new rows rather than new columns. Also keeps `players` minimal per the epic AC #1 wording. Cost: one extra JOIN per OAuth bind lookup; at 8 players unmeasurable.
- **Why env-aware cookies (Fork 3a):** integration tests per AC #18 can't run with unconditional `Secure`+`Domain` against `localhost`. Production cookies stay locked down via the NODE_ENV=production branch. Standard Express/Hono pattern.
- **Magic-link deferred (Fork 1c):** v1 = Pinehurst (8 Google users). v1.5 = Thursday league (older members who might prefer email link). Magic-link earns its keep at v1.5; shipping stubs at T1-6 carries nullable-FK schema debt we'd rewrite anyway. Magic-link returns as a T3.x story after T3.1 adds `players.email`.
- **No `ADMIN_SESSION_SECRET` in T1-6a env:** session cookie value IS the opaque 256-bit session_id stored server-side; no HMAC signing needed. Codex finding #6 was right. Reserved for a future admin-only signed-cookie feature if ever needed (e.g., CSRF double-submit with signed values).
- **Why T1-6a ships zero new deps:** arctic is OAuth-specific (T1-6b owns it); Resend is magic-link-specific (deferred); crypto is Node built-in; `hono/csrf` is built-in to Hono 4.x. **No SHARED pnpm-lock.yaml gate in T1-6a** — only the docker-compose env-add gate.
- **Why include a stub auth router in T1-6a (AC #13):** T1-6b's diff becomes "add handlers to an existing file" rather than "create file + add handlers", keeping the arctic story's commit scoped to handler logic. Also gives T1-6a a trivial test anchor.
- **Session token entropy:** `crypto.randomBytes(32)` = 256 bits; `.toString('base64url')` = 43 URL-safe chars, no padding. Well above current best-practice thresholds.
- **Rolling 7-day / 30-day hard cap** (per D2-4): implemented entirely in `validateSession` — no additional background job, no cleanup cron at T1-6a. Expired-row cleanup can be added in T1-7 or later if DB size becomes a concern.
- **`c.get('session')` / `c.get('player')` type safety:** Hono's `ContextVariableMap` augmentation pattern. **Prefer `src/types/hono.d.ts`** (a dedicated `.d.ts` file at a path TS picks up automatically per `tsconfig.app.json`'s `include: ["src"]`) over inline augmentation in a `.ts` file. `.d.ts` module augmentation is guaranteed to be picked up across the project without requiring every consumer to `import './middleware/require-session'` as a side effect; inline augmentation in `.ts` can silently fail to apply if the file isn't in the import graph (codex round-1 #6). Downstream handler writing `const { playerId } = c.get('session')` MUST compile without `as any` casts.
- **Dockerfile CMD carry-forward:** T1-4 documented this as "T2.1's responsibility" but since schema lands at T1-6a before T2.1, T1-6a owns it. Pattern is byte-match with Wolf Cup's `apps/api/Dockerfile` CMD + COPY-migrations step.
- **Wolf Cup isolation (FD-1/FD-2):** T1-6a writes under `apps/tournament-api/**` only, plus ONE SHARED edit to `docker-compose.yml`. Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`. Zero root file touches beyond docker-compose.yml.
- **SameSite=Strict is safe under current topology** (codex round-1 #4 noted the concern). Tournament-web's nginx at `apps/tournament-web/nginx.conf` (T1-4) proxies `/api/` on the SAME origin the browser sees (`tournament.dagle.cloud` → nginx → internal tournament-api). All browser requests to the API appear same-origin; SameSite=Strict does not block them. If T1-6b or a later story shipped tournament-api at a separate origin (e.g. `api.tournament.dagle.cloud`), SameSite would need to relax to `Lax` — revisit then. Not a concern today.
- **Cookie Max-Age near 30-day hard cap** (codex round-1 #7 noted): a user at day 29 gets a cookie with `Max-Age=604800` (7 days) that the server will reject at day 30. The user would hit a single 401 + clear-cookie, then a sign-in prompt. Acceptable — the 30-day hard cap is expected behavior; the user's UX is "please sign in again after a month", which is the intent. Optimizing `Max-Age` down near the cap adds complexity for zero real benefit.
- **Time injection in session helpers** (codex round-1 #5): session helpers accept an optional `now?: () => number` parameter defaulting to `Date.now`. Tests pass `() => fixedTime` for deterministic 7-day / 30-day boundary tests. Production callers omit it. This is the minimum footprint for deterministic time-based tests; alternatives (patching global Date, vi.useFakeTimers everywhere) are more fragile.

### Project Structure Notes

Shape after T1-6a:
```
apps/tournament-api/
  Dockerfile              # MODIFIED: +COPY migrations, CMD runs migrate+seed+index
  package.json            # UNCHANGED (no new deps)
  src/
    app.ts                # MODIFIED: +csrf global mount
    db/
      schema/
        players.ts        # NEW
        oauth_identities.ts  # NEW
        auth.ts           # NEW (sessions only)
        index.ts          # MODIFIED: re-export three new files
      migrations/
        0000_*.sql        # NEW (drizzle-kit generated)
        meta/_journal.json # NEW
      migrate.ts          # NEW
      seed.ts             # NEW (placeholder)
    lib/
      env.ts              # NEW
      session.ts          # NEW
      session.test.ts     # NEW
    middleware/
      require-session.ts       # NEW
      require-session.test.ts  # NEW
      require-organizer.ts     # NEW
      require-organizer.test.ts # NEW
    routes/
      auth.ts             # NEW (stub router)
      auth.test.ts        # NEW (single /status test)
docker-compose.yml        # MODIFIED (SHARED, +2 env vars on tournament-api)
```

**Explicitly NOT in T1-6a (reserved for T1-6b):**
- `arctic` dep + `src/lib/arctic.ts`
- OAuth sign-in/callback routes (handlers added to the existing stub `src/routes/auth.ts`)
- OAuth-specific env vars (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`)
- Integration tests with arctic stubs

### References

- Supersession context: `_bmad-output/implementation-artifacts/tournament/T1-6-auth-realm-sso-magic-link.md` (banner-only).
- Round-1 codex on unified T1-6: `_bmad-output/reviews/T1-6-auth-realm-sso-magic-link-spec-codex.md`.
- Party advisory: `_bmad-output/reviews/T1-6-auth-realm-sso-magic-link-party-advisory.md`.
- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 486-544 (unified T1.6; T1-6a covers ACs #1, #2, #7 (session cookie attrs), part of #12 middleware, partially #14 deps posture; T1-6b covers the OAuth-specific ACs).
- Architecture §Authentication & Security: `_bmad-output/planning-artifacts/tournament/architecture.md` lines 404-437.
- Architecture §Environment variable access: `_bmad-output/planning-artifacts/tournament/architecture.md` lines 687-707.
- FD-4 (identity shape): architecture.md line 23.
- D2-4 (session lifetime): architecture.md line 411.
- Wolf Cup reference (READ only):
  - `apps/api/src/db/migrate.ts` — migrate runner shape.
  - `apps/api/src/db/seed.ts` — seed runner shape (non-trivial seed body will inform T2.2).
  - `apps/api/Dockerfile:45,58` — migrations COPY + CMD chain pattern.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
