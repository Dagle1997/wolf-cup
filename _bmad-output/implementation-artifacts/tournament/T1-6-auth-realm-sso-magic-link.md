# Story T1.6: Auth Realm — SSO + Magic-Link [SUPERSEDED 2026-04-20]

Status: superseded

> **This unified T1.6 story was superseded on 2026-04-20** per the 4-fork spec-gate + party advisory (`_bmad-output/reviews/T1-6-auth-realm-sso-magic-link-party-advisory.md`) + Josh's decision: split into **T1-6a** (schema + middleware + env + Dockerfile/compose-env infra) and **T1-6b** (arctic Google SSO). Magic-link deferred to a future T3.x story post-T3.1 (when `players.email` column lands). Epic T1 delivers auth via T1-6a + T1-6b instead of this unified story.
>
> Historical artifacts preserved for design context:
> - `_bmad-output/reviews/T1-6-auth-realm-sso-magic-link-spec-codex.md` — round-1 codex that surfaced the 4 forks
> - `_bmad-output/reviews/T1-6-auth-realm-sso-magic-link-party-advisory.md` — party recommendation
>
> Active specs: `T1-6a-auth-schema-middleware-env.md` + (backlog) `T1-6b-arctic-google-sso.md`.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a working auth realm in tournament-api with Google SSO via `arctic` + magic-link email via Resend + Drizzle-backed sessions and magic-link tokens + `require-session` and `require-organizer` middleware + first tournament migration,
so that subsequent tournament stories can require authentication on mutation routes (FD-4, NFR-S2) and T2+ admin endpoints have the gating infrastructure they need.

## Spec-Gate Ambiguity Flags

**The following epic-AC contradictions need a decision at the spec gate before implementation. Each is a concrete implementation fork.**

- **FLAG 1 — `google_sub` column scope.** Epic AC #1 (players table) says "T3.1 will extend this table with name/ghin/google_sub/etc." Epic AC #10 (SSO bind) says T1-6 populates `players.google_sub` on first SSO. **These contradict.** Resolution proposed in this spec: `google_sub` MUST ship in T1-6's players schema because SSO identity is impossible without it. T3.1 adds the remaining columns (name, ghin, email, apple_sub). See AC #1 below for the revised column set.
- **FLAG 2 — Seed scope.** Epic AC #13 says "Josh's player record is created" with `is_organizer = true`. But T1-6's minimal players schema has no `email` or `name` column — only `id`, `google_sub`, `is_organizer`, `created_at`, `tenant_id`, `context_id`. There is no attribute to identify "Josh" in the seed beyond an opaque UUID. Resolution proposed: T1-6's `seed.ts` is **infrastructure only** — creates no player rows. T2.2 ("Pinehurst seed importer + course-list api") is the "prerequisite consumer" referenced in the epic AC wording; T2.2 writes the real roster seed including Josh with `is_organizer = true`. T1-6 ships the seed runner + Dockerfile wiring so T2.2 just plugs into it.
- **FLAG 3 — SSO-first-bind matching.** When a new Google sub appears at `/auth/callback`, the handler has two choices: (a) create a new `players` row with that `google_sub`, or (b) match by some pre-existing identifier. With T1-6's minimal schema there is no `email` column, so (b) is impossible in this story. Resolution: T1-6 implements (a) — every new `google_sub` creates a new `players` row with `is_organizer = false`. Organizer-status promotion happens via the T2.2 seed matching `google_sub` (after Josh's first SSO Josh gets `is_organizer = true` manually OR the T2.2 seed writes his expected `google_sub` up front — T2.2 decides). T1-6 handles this by shipping the seed INFRASTRUCTURE; the promote-to-organizer logic is T2.2's responsibility.

If any FLAG answer changes, the story plan shifts materially. Josh answers at the spec gate.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/db/schema/players.ts`
   **When** inspected
   **Then** it exports a Drizzle `players` table (sqliteTable) with these columns (T1-6 minimal slice per FLAG 1):
   - `id TEXT PRIMARY KEY` — app-generated UUID (use `crypto.randomUUID()` at insert time). Opaque, used for `context_id` stamping.
   - `google_sub TEXT UNIQUE` — nullable; populated on first Google SSO bind. Indexed for lookup by SSO callback.
   - `is_organizer INTEGER NOT NULL DEFAULT 0` — SQLite bool as integer; `.notNull().default(false)` via Drizzle's `integer(...,{mode: 'boolean'})`.
   - `created_at INTEGER NOT NULL` — unix ms epoch.
   - Universal FD-6 columns via `...ecosystemColumns()` spread (from T1-2 scaffold): `tenant_id TEXT NOT NULL DEFAULT 'guyan'`, `context_id TEXT NOT NULL`.
   Table name: `players`. Exports both the table object and a TypeScript type (`type Player = typeof players.$inferSelect`). Re-exported from `src/db/schema/index.ts`.
2. **Given** `apps/tournament-api/src/db/schema/auth.ts`
   **When** inspected
   **Then** it defines two Drizzle tables:
   - `sessions`: `session_id TEXT PRIMARY KEY` (256-bit token from `crypto.randomBytes(32).toString('base64url')`); `player_id TEXT NOT NULL` FK → `players.id` (ON DELETE CASCADE); `created_at INTEGER NOT NULL`; `last_seen_at INTEGER NOT NULL`; `expires_at INTEGER NOT NULL`; `device_info TEXT` (nullable — free-form user-agent + IP summary); plus `...ecosystemColumns()`. Index on `player_id`.
   - `magic_link_tokens`: `token TEXT PRIMARY KEY` (256-bit from `crypto.randomBytes(32).toString('base64url')`); `player_id TEXT NOT NULL` FK → `players.id` (ON DELETE CASCADE); `expires_at INTEGER NOT NULL`; `consumed_at INTEGER` (nullable; null = unused); plus `...ecosystemColumns()`. Index on `player_id`.
   Both tables re-exported from `src/db/schema/index.ts`. No separate `users` table — `players.id` is the identity anchor per FD-4.
3. **Given** `apps/tournament-api/src/db/migrations/` directory + `apps/tournament-api/drizzle.config.ts`
   **When** `pnpm -F @tournament/api db:generate` runs
   **Then** at least one SQL migration file is emitted under `src/db/migrations/` (filename format `0000_*.sql` or whatever drizzle-kit produces for first-run). The migration creates `players`, `sessions`, `magic_link_tokens` tables with the columns from AC #1 and AC #2. The migration is committed (drizzle-kit tracks applied migrations via a journal). **This is the FIRST tournament-api migration.**
4. **Given** `apps/tournament-api/src/db/migrate.ts`
   **When** run as `node dist/db/migrate.js`
   **Then** it imports drizzle's libsql migrator + the local `db` client, points at `./migrations` (resolved via `import.meta.url`), and applies any un-applied migrations idempotently. Exit 0 on success. Shape mirrors `apps/api/src/db/migrate.ts` verbatim except for workspace path adjustments.
5. **Given** `apps/tournament-api/src/db/seed.ts`
   **When** run as `node dist/db/seed.js`
   **Then** it is an idempotent seed runner that currently creates **zero rows** (per FLAG 2 resolution — real seed data lands in T2.2). File exists with a single async function `seed()` exported, and a top-level `await seed()` + `process.exit(0)` guard. Placeholder body: a single `console.log('Tournament seed: no data at T1.6 — T2.2 adds roster.')`. Exists so the Dockerfile CMD can run `node dist/db/seed.js` without error, and so T2.2 can drop its seed body into the existing function.
6. **Given** `apps/tournament-api/src/lib/env.ts`
   **When** inspected
   **Then** it exports `env` — the result of `envSchema.parse(process.env)` — from a Zod object schema matching architecture.md:691-703 shape, scoped to T1-6's needed keys:
   - `NODE_ENV: z.enum(['development','production','test'])`
   - `DB_PATH: z.string()`
   - `PORT: z.coerce.number().default(3000)`
   - `ADMIN_SESSION_SECRET: z.string().min(32)` — 32+ chars (signed-cookie HMAC base)
   - `GOOGLE_OAUTH_CLIENT_ID: z.string()`
   - `GOOGLE_OAUTH_CLIENT_SECRET: z.string()`
   - `RESEND_API_KEY: z.string()`
   - `AUTH_COOKIE_DOMAIN: z.string().default('tournament.dagle.cloud')` — cookie `Domain` attribute
   - `PUBLIC_APP_URL: z.string().url()` — e.g. `https://tournament.dagle.cloud`, used in magic-link email links
   Parse failures throw at module-load (fail-fast on startup per architecture). No `process.env.X` access anywhere else in tournament-api after this story.
7. **Given** a player taps "Sign in with Google" → GET `/auth/google/sign-in?next=<encoded-url>`
   **When** the handler runs
   **Then** it calls `arctic`'s Google OAuth builder (`new Google(CLIENT_ID, CLIENT_SECRET, callback_url)`) to create an authorization URL with state + code_verifier + scope `['openid', 'email', 'profile']`, sets two intermediate cookies (`oauth_state`, `oauth_code_verifier`) with `SameSite=Lax`, `HttpOnly`, `Secure`, 10-minute `Max-Age`, `Domain=tournament.dagle.cloud`, `Path=/`, and 302-redirects to the Google authorization URL. Also sets a `next` cookie with the same attributes + the intended post-login destination.
8. **Given** the OAuth callback GET `/auth/google/callback?code=...&state=...`
   **When** the handler runs
   **Then** it validates the `state` cookie matches the query-param `state`, exchanges the `code` using arctic's `validateAuthorizationCode(code, code_verifier)`, fetches the Google user info endpoint (`https://openidconnect.googleapis.com/v1/userinfo`) with the returned access token to extract `sub` + `email`, looks up `players` by `google_sub`, creates a new row via `crypto.randomUUID()` + `context_id='league:guyan-wolf-cup-friday'` + `is_organizer=false` if none exists (else uses the existing row), issues a session cookie, clears the three intermediate cookies, and 302-redirects to the stored `next` URL (or `/` if absent). On any failure the handler clears intermediate cookies, logs, and 302s to `/auth/sign-in?error=oauth_failed`.
9. **Given** a successful session issuance
   **When** the `session` cookie is set on the response
   **Then** it has: `HttpOnly`, `Secure`, `SameSite=Strict`, `Domain=tournament.dagle.cloud` (NEVER `.dagle.cloud` parent), `Path=/`, `Max-Age=604800` (7 days), and the value is the opaque `session_id` from the newly-inserted `sessions` row. `expires_at` on the DB row = now + 7 days; `created_at` = now; `last_seen_at` = now; `device_info` = truncated (128-char) `user-agent` + request IP.
10. **Given** `POST /auth/magic-link/send` with JSON body `{ email: string }`
    **When** received
    **Then** the handler validates the email (Zod `z.string().email()`), checks the in-memory token bucket rate-limiter (per D2-7: 5 requests/email/hour AND 30 requests/IP/hour — BOTH must be satisfied), and if rate-limited, returns HTTP 429 with JSON `{ error: 'rate_limited', code: 'magic_link_rate_limit', requestId: <string> }`. If within limits: looks up `players` by email (T1.6 has no email column yet per FLAG 1 — defer this lookup to return 200 with a benign "if an account exists, a link has been sent" response; NO player row is created by send). Generates a token via `crypto.randomBytes(32).toString('base64url')`, inserts a row into `magic_link_tokens` with `expires_at = now + 15min` and **`player_id = NULL-placeholder`** (see FLAG 3 — magic-link alone cannot create a player at T1-6 because there's no email column to match on; the consume step identifies the player via the token itself, which at T1-6 cannot meaningfully identify an existing player). Calls `resend.emails.send({ from, to: email, subject: 'Tournament sign-in link', html: <template with link to {PUBLIC_APP_URL}/auth/magic-link/consume?token=...> })`. Returns 200 with `{ sent: true }` regardless of whether the email matched an existing player (info leak prevention).
    **Note: FLAG 1 resolution materially affects this AC.** If Josh wants magic-link to actually work end-to-end at T1-6, `email` must also land in the T1-6 players schema. Otherwise magic-link is best-effort-stubbed at T1-6 and completed in T3.1. **Ask Josh at spec-gate.**
11. **Given** `GET /auth/magic-link/consume?token=...`
    **When** the handler runs
    **Then** it looks up the token in `magic_link_tokens`, verifies `expires_at > now`, `consumed_at IS NULL`, marks `consumed_at = now`, issues a session cookie (same as AC #9), and 302s to `/`. If lookup fails or token is expired/consumed: 302s to `/auth/sign-in?error=invalid_link`. **Like AC #10, this AC is bounded by FLAG 1** — without email on `players`, the consume handler has no way to match a token to an actual player unless the send step created a player row. T1-6's pragmatic shape: send step inserts a `players` row with a placeholder UUID, ties the token to that row's `player_id`; consume step hands that session to the client. Functional but somewhat silly at v1 — full flow makes sense after T3.1 extends schema.
12. **Given** both Google OAuth AND Resend are unreachable simultaneously
    **When** a player attempts to sign in via either path
    **Then** the API returns HTTP 503 `{ error: 'auth_unavailable', code: 'auth_provider_outage', requestId }` per architecture validation gap #3. Implementation: `/auth/google/sign-in` wraps arctic URL generation in try/catch (though arctic URL generation is local — actual outage detection happens at `/auth/google/callback` during token exchange); `/auth/magic-link/send` wraps Resend call in try/catch. If EITHER path succeeds, no 503. If BOTH fail in short succession (tracked via a simple boolean flag with 60s TTL), 503 on the next attempt. Invite-link reads (T3.6) continue to function — they don't hit arctic or Resend.
13. **Given** an authenticated request (session cookie present)
    **When** `require-session` middleware runs
    **Then** it: (a) extracts the `session` cookie, (b) looks up the row in `sessions`, (c) verifies `expires_at > now` AND `created_at + 30days > now` (rolling 7-day AND hard 30-day per D2-4), (d) updates `last_seen_at = now` and `expires_at = now + 7days`, (e) populates `c.set('session', { sessionId, playerId })` + `c.set('player', { id, is_organizer })` on the Hono context, (f) calls `next()`. On any failure: deletes the `session` cookie (by setting Max-Age=0) and returns HTTP 401 `{ error: 'unauthenticated', code: 'session_invalid', requestId }`. Exported from `src/middleware/require-session.ts`.
14. **Given** a request that passed `require-session`
    **When** `require-organizer` middleware runs
    **Then** it reads `c.get('player').is_organizer` and returns HTTP 403 `{ error: 'forbidden', code: 'not_organizer', requestId }` if false. Exported from `src/middleware/require-organizer.ts`. (Intended mount point in downstream stories: `app.use('/admin/*', requireSession, requireOrganizer)`.)
15. **Given** `apps/tournament-api/package.json`
    **When** inspected post-T1.6
    **Then**:
    - `bcrypt` is NOT present (FD-4; T1-2 already enforces).
    - `arctic` is added at a pinned major range (`^1.9.0` or current-at-impl-time, NOT `@latest`). Record the exact range in Completion Notes.
    - `resend` SDK is added at a pinned major range (`^4.0.0` or current).
    - No new `@types/*` needed — both `arctic` and `resend` ship TS types.
    - `hono/csrf` is a built-in import path in Hono 4.x — NO separate package is added; the middleware is wired in `src/app.ts` (`import { csrf } from 'hono/csrf'; app.use(csrf({ origin: env.PUBLIC_APP_URL }))`).
16. **Given** integration tests for auth routes at `apps/tournament-api/src/routes/auth.test.ts`
    **When** `pnpm -F @tournament/api test` runs
    **Then** the tests exercise `/auth/google/sign-in`, `/auth/google/callback`, `/auth/magic-link/send`, `/auth/magic-link/consume` end-to-end with **stubbed** Arctic state/code-verifier exchange and **stubbed** Resend SDK (architecture validation gap #5). Stubs live at `src/lib/arctic.ts` (exports a factory `makeGoogleClient` that the route uses; tests inject a fake factory) and `src/lib/magic-link.ts` (exports a `sendMagicLink` function that tests can spy on). Zero production credentials exercised. At minimum: 10 test cases (happy-path SSO, bad state, expired code; happy-path magic-link send/consume, rate-limited send, expired token consume, already-consumed token, 503 both-down, require-session 401, require-organizer 403).
17. **Given** `apps/tournament-api/src/lib/magic-link.ts`
    **When** inspected
    **Then** it exports: (a) `sendMagicLink(email: string, ip: string): Promise<{sent: boolean} | {rateLimited: true}>` which encapsulates rate-limit check + token insert + Resend send; (b) `consumeMagicLink(token: string): Promise<{playerId: string} | {error: 'invalid' | 'expired' | 'already-consumed'}>`. The rate limiter is a module-local in-memory Map-based token bucket with two buckets per key (per-email + per-IP), 60-minute refill, limits from D2-7 (5/email/hr, 30/IP/hr). The limiter is tournament-api-process-local: a restart resets buckets. Acceptable at v1's single-container scale; if tournament-api ever scales horizontally, move to Redis/libSQL-backed store.
18. **Given** `apps/tournament-api/src/lib/arctic.ts`
    **When** inspected
    **Then** it exports a factory `makeGoogleClient(): Google` that returns a fresh `arctic.Google(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET, `${env.PUBLIC_APP_URL}/auth/google/callback`)` instance. Tests import this factory to inject fakes. The auth route handler imports and calls the factory per-request (cheap; Google constructor is not resource-heavy).
19. **Given** `apps/tournament-api/src/app.ts`
    **When** inspected post-T1.6
    **Then** it additionally: (a) imports `csrf` from `'hono/csrf'` and mounts `app.use('*', csrf({ origin: env.PUBLIC_APP_URL }))` BEFORE any mutation routes, (b) imports the auth router from `'./routes/auth.js'` and mounts it at `app.route('/auth', authRouter)`, (c) leaves the existing `/api/health` endpoint unchanged. `/api/health` must NOT require auth (public health-check endpoint). CSRF mount is global but only affects unsafe methods (POST/PUT/PATCH/DELETE); GETs on auth routes are not CSRF-checked.
20. **Given** `apps/tournament-api/Dockerfile` (T1-4 left CMD as `["node", "dist/index.js"]` with carry-forward responsibility for T2.1 — reassigned here to T1-6 since T1-6 introduces the first schema/migration)
    **When** inspected post-T1.6
    **Then** (a) a new `COPY apps/tournament-api/src/db/migrations/ ./apps/tournament-api/dist/db/migrations/` step is added to the runtime stage (mirrors Wolf Cup's api Dockerfile:45 pattern), AND (b) CMD is updated from `["node", "dist/index.js"]` to `["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js"]`. Migrate runs every container start (idempotent — drizzle's journal tracks applied migrations). Seed runs every container start (idempotent — T1.6 placeholder is a no-op; T2.2 implementation will also be idempotent).
21. **Given** `docker-compose.yml` (SHARED path — explicit user approval required before editing)
    **When** inspected post-T1.6
    **Then** the `tournament-api` service's `environment:` block is expanded ADDITIVELY with:
    - `GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:-}`
    - `GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET:-}`
    - `RESEND_API_KEY=${RESEND_API_KEY:-}`
    - `ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET}`
    - `AUTH_COOKIE_DOMAIN=${AUTH_COOKIE_DOMAIN:-tournament.dagle.cloud}`
    - `PUBLIC_APP_URL=${PUBLIC_APP_URL:-https://tournament.dagle.cloud}`
    The existing 4 env vars (NODE_ENV, DB_PATH, PORT, TZ) are byte-unchanged. Wolf Cup services + `tournament-web` + networks + volumes are byte-unchanged. `wolf-cup` service's `ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET}` env line already exists (for Wolf Cup); tournament-api reuses the same env-var name — **Josh confirms at spec gate whether tournament should share Wolf Cup's `ADMIN_SESSION_SECRET` or use a separate `TOURNAMENT_SESSION_SECRET`.** Simplest choice: share (same `.env.production` on the VPS already has it). Most isolated choice: separate.
22. **Given** `pnpm-lock.yaml` (SHARED path — explicit user approval required before editing)
    **When** inspected post-T1.6
    **Then** it has been rewritten by pnpm to reflect the new `arctic` and `resend` deps in `apps/tournament-api/package.json`. **Unavoidable — any new dep requires lockfile update.**
23. **Given** Wolf Cup workspaces (engine + api)
    **When** `pnpm -F @wolf-cup/engine test` and `pnpm -F @wolf-cup/api test` run after T1.6 lands
    **Then** both continue to pass with zero net-negative test count change. Same regression guard as prior Epic T1 stories.

## Tasks / Subtasks

- [ ] Task 1: Spec gate resolution (prerequisite)
  - [ ] Subtask 1.1: Josh answers the 3 FLAG questions at the spec gate. Updates to schema scope may cascade through ACs #1, #10, #11. Don't start implementation until answered.
- [ ] Task 2: Add deps (AC: #15) — **SHARED (pnpm-lock.yaml) HARD STOP**
  - [ ] Subtask 2.1: Add `arctic` + `resend` to `apps/tournament-api/package.json` (pinned major ranges). Announce the exact pinned versions to the user before running install.
  - [ ] Subtask 2.2: Run `pnpm install --lockfile-only` to update `pnpm-lock.yaml`. STOP for user approval before staging the lockfile change.
- [ ] Task 3: Env schema (AC: #6)
  - [ ] Subtask 3.1: Create `apps/tournament-api/src/lib/env.ts` with the Zod schema from AC #6. Parse at module-load; throw on invalid (startup fails fast).
- [ ] Task 4: Schema + migration (AC: #1, #2, #3, #4)
  - [ ] Subtask 4.1: Create `src/db/schema/players.ts`.
  - [ ] Subtask 4.2: Create `src/db/schema/auth.ts`.
  - [ ] Subtask 4.3: Update `src/db/schema/index.ts` to re-export both new files.
  - [ ] Subtask 4.4: Run `pnpm -F @tournament/api db:generate`. Verify the emitted SQL creates all three tables with the right columns + constraints. If drizzle-kit emits multiple statements or splits the migration oddly, manually review; do NOT hand-edit the SQL.
  - [ ] Subtask 4.5: Create `src/db/migrate.ts` (mirror `apps/api/src/db/migrate.ts` shape).
- [ ] Task 5: Seed runner (AC: #5)
  - [ ] Subtask 5.1: Create `src/db/seed.ts` with the placeholder body. Export `seed()` async function. Guard with top-level `await seed()` + exit 0.
- [ ] Task 6: Auth libs (AC: #17, #18)
  - [ ] Subtask 6.1: Create `src/lib/arctic.ts` with `makeGoogleClient()` factory.
  - [ ] Subtask 6.2: Create `src/lib/magic-link.ts` with token bucket + send/consume helpers. Rate limiter: `const buckets = new Map<string, { tokens: number, lastRefill: number }>()` + refill-on-check algorithm.
  - [ ] Subtask 6.3: Create `src/lib/session.ts` — cookie issuance + validation helpers shared by auth routes + middleware.
- [ ] Task 7: Middleware (AC: #13, #14)
  - [ ] Subtask 7.1: Create `src/middleware/require-session.ts`.
  - [ ] Subtask 7.2: Create `src/middleware/require-organizer.ts`.
- [ ] Task 8: Auth routes (AC: #7, #8, #10, #11, #12)
  - [ ] Subtask 8.1: Create `src/routes/auth.ts` — Hono sub-router. Routes: GET `/google/sign-in`, GET `/google/callback`, POST `/magic-link/send`, GET `/magic-link/consume`.
  - [ ] Subtask 8.2: 503 "both-down" handling — simple module-local tracker with 60s TTL.
- [ ] Task 9: Update app.ts (AC: #19)
  - [ ] Subtask 9.1: Add `csrf` middleware mount + auth router mount to `src/app.ts`. Preserve existing `/api/health` route.
- [ ] Task 10: Update Dockerfile (AC: #20)
  - [ ] Subtask 10.1: Add migrations COPY + update CMD per AC #20. Verify with local docker build if Docker available (deferred to VPS if not).
- [ ] Task 11: Update docker-compose.yml (AC: #21) — **SHARED HARD STOP**
  - [ ] Subtask 11.1: Announce the 6 new env-var additions to the user. Wait for approval. Also confirm the `ADMIN_SESSION_SECRET` share-vs-separate decision.
- [ ] Task 12: Tests (AC: #16)
  - [ ] Subtask 12.1: Unit tests for the magic-link rate limiter in `src/lib/magic-link.test.ts`.
  - [ ] Subtask 12.2: Unit tests for session cookie issuance/validation in `src/lib/session.test.ts`.
  - [ ] Subtask 12.3: Integration tests for auth routes in `src/routes/auth.test.ts` with Arctic + Resend stubs. At least 10 cases per AC #16.
  - [ ] Subtask 12.4: Unit tests for `require-session` + `require-organizer` middleware.
- [ ] Task 13: Run + verify
  - [ ] Subtask 13.1: `pnpm -F @tournament/api typecheck` → exit 0.
  - [ ] Subtask 13.2: `pnpm -F @tournament/api lint` → exit 0.
  - [ ] Subtask 13.3: `pnpm -F @tournament/api test` → all new tests + existing 19 pass.
  - [ ] Subtask 13.4: `pnpm -F @tournament/api build` → exit 0; `dist/db/migrate.js`, `dist/db/seed.js`, `dist/index.js` all emit.
  - [ ] Subtask 13.5: `pnpm -F @tournament/api db:migrate` on a fresh local DB (delete `apps/tournament-api/data/tournament.db*` first) → exit 0. Confirm all 3 tables exist via `sqlite3` or a tiny Node inspection script.
  - [ ] Subtask 13.6: Wolf Cup regression: engine + api tests zero delta.
- [ ] Task 14: Update .env.example (SHARED — root file)
  - [ ] Subtask 14.1: Announce the intent to add GOOGLE_OAUTH_*, RESEND_API_KEY, AUTH_COOKIE_DOMAIN, PUBLIC_APP_URL stubs to `.env.example`. Wait for user approval. If Josh declines (wants `.env.example` to stay minimal), skip this subtask — the Zod env schema self-documents.

## Dev Notes

- **D2-1..D2-7 are already decided** (architecture §Authentication & Security). This story implements those decisions verbatim; no re-litigating the choice of arctic / Resend / 7-day-rolling-30-day-max / in-memory-token-bucket / hono-csrf / --env-file-secrets.
- **hono/csrf is built-in to Hono 4.x** — no separate package. Import path: `'hono/csrf'`. Wire as global middleware with `origin: env.PUBLIC_APP_URL`.
- **Rate limiter is process-local** (in-memory Map). If tournament-api ever runs multi-replica, move to a shared store (Redis or libsql table). v1 single-container is fine.
- **Session cookie Domain scope:** `tournament.dagle.cloud` — NEVER the parent `.dagle.cloud`. Wolf Cup's cookies similarly must stay on `wolf.dagle.cloud` only. Sibling-app isolation at the cookie layer.
- **CSRF pairs with Strict session cookie.** `SameSite=Strict` covers most CSRF; Hono's built-in middleware covers the edge cases (cross-origin POSTs from misbehaving clients). Both together are belt+suspenders.
- **`crypto.randomBytes(32)` + `base64url`** for session IDs and magic-link tokens. 256 bits of entropy; URL-safe encoding; no padding.
- **Migration runs on every container boot.** Idempotent — drizzle tracks applied migrations via `__drizzle_migrations` table. Cheap (single SELECT on empty state).
- **Wolf Cup isolation (FD-1/FD-2):** T1-6 writes under `apps/tournament-api/**` only, plus SHARED edits to `pnpm-lock.yaml`, `docker-compose.yml`, and potentially `.env.example`. Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`.
- **Seed at T1-6 is a no-op.** Real seed body lands in T2.2. This story ensures the infrastructure (file exists, runs in the Dockerfile CMD, exits cleanly).
- **The 3 FLAGS at spec gate are genuine forks.** Don't try to resolve them inside the spec — Josh decides before impl. If he says "no, ship email column in T1.6's players too", rewrite AC #1 and parts of #10/#11 before impl starts.

### Project Structure Notes

Shape after this story:
```
apps/tournament-api/
  package.json            # MODIFIED: +arctic +resend
  Dockerfile              # MODIFIED: +COPY migrations, CMD runs migrate+seed+index
  src/
    app.ts                # MODIFIED: +csrf, +auth router mount
    db/
      schema/
        players.ts        # NEW
        auth.ts           # NEW
        index.ts          # MODIFIED: re-export players + auth
      migrations/
        0000_*.sql        # NEW (drizzle-kit generated)
        meta/             # NEW (drizzle-kit metadata)
      migrate.ts          # NEW
      seed.ts             # NEW (placeholder)
    lib/
      env.ts              # NEW
      arctic.ts           # NEW
      magic-link.ts       # NEW
      magic-link.test.ts  # NEW
      session.ts          # NEW
      session.test.ts     # NEW
    middleware/
      require-session.ts       # NEW
      require-session.test.ts  # NEW
      require-organizer.ts     # NEW
      require-organizer.test.ts# NEW
    routes/
      auth.ts             # NEW
      auth.test.ts        # NEW
pnpm-lock.yaml            # MODIFIED (SHARED)
docker-compose.yml        # MODIFIED (SHARED)
.env.example              # OPTIONALLY MODIFIED (SHARED, Josh's call)
```

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 486-544.
- Architecture §Authentication & Security: `_bmad-output/planning-artifacts/tournament/architecture.md` lines 404-437.
- Architecture §Environment variable access: `_bmad-output/planning-artifacts/tournament/architecture.md` lines 687-707.
- Architecture validation gap #3 (both-down 503): architecture.md line 1148.
- Architecture validation gap #5 (OAuth stubs in CI): architecture.md per T1-5 epic AC #3.
- D2-1..D2-7 decisions: architecture.md lines 370-414.
- FD-4: architecture.md line 23.
- Wolf Cup reference (READ only):
  - `apps/api/src/db/migrate.ts` — migrate runner pattern.
  - `apps/api/src/db/seed.ts` — seed runner shape.
  - `apps/api/Dockerfile` — migrations COPY + CMD chain pattern.
- T1-4's Dockerfile carry-forward note: `_bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md` AC #1 final paragraph (T2.1→T1.6 reassigned here since T1.6 introduces the first schema).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
