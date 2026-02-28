# Story 2.1: API Foundation & Database Schema

Status: done

## Story

As a developer,
I want the Hono API scaffold wired up with Drizzle ORM, a fully defined SQLite schema, drizzle-kit migrations, auth middleware stubs, and a health check,
so that all subsequent Epic 2 and Epic 3 stories can add routes and business logic on a stable, correctly structured foundation.

## Acceptance Criteria

1. `apps/api/src/index.ts` exports a Hono app and starts with `serve()` from `@hono/node-server`; `GET /api/health` returns `{ status: "ok", timestamp: "<ISO>" }` with HTTP 200.

2. `apps/api/src/db/schema.ts` defines all 13 tables using `drizzle-orm/sqlite-core`: `admins`, `sessions`, `seasons`, `rounds`, `groups`, `players`, `round_players`, `hole_scores`, `round_results`, `harvey_results`, `wolf_decisions`, `side_games`, `side_game_results` — with correct column types, `NOT NULL` constraints, foreign key references, and named indexes on all FK columns.

3. `apps/api/src/db/index.ts` exports a singleton Drizzle client (`db`) using `@libsql/client`, reading the DB path from `process.env.DB_PATH ?? './data/wolf-cup.db'`.

4. `apps/api/drizzle.config.ts` points `schema` to `./src/db/schema.ts` and `out` to `./src/db/migrations`; running `pnpm drizzle-kit generate` in `apps/api` produces a valid migration; running `pnpm drizzle-kit migrate` applies it against the local SQLite file without errors.

5. `apps/api/src/db/seed.ts` inserts the two admin users (Jason, Josh) with bcrypt-hashed passwords and the 18-hole Guyan G&CC course data when run directly (`ts-node` / `tsx`); script is idempotent (safe to re-run).

6. `apps/api/src/middleware/admin-auth.ts` exports `adminAuthMiddleware`: reads the `session` cookie, validates against the `sessions` table, returns `{ error: "Unauthorized", code: "UNAUTHORIZED" }` HTTP 401 if invalid/expired; passes to `next()` and attaches `c.set('adminId', adminId)` if valid.

7. `apps/api/src/middleware/entry-code.ts` exports `entryCodeMiddleware`: reads `x-entry-code` request header, compares bcrypt hash against `rounds.entry_code_hash` for the active round, returns `{ error: "Invalid entry code", code: "INVALID_ENTRY_CODE" }` HTTP 403 if invalid; bypasses check (calls `next()`) for rounds with `type = 'casual'`.

8. `pnpm --filter @wolf-cup/api typecheck` passes with zero TypeScript errors.

9. `pnpm --filter @wolf-cup/api lint` passes with zero ESLint errors.

10. The new dependencies (`drizzle-orm`, `drizzle-kit`, `@libsql/client`, `zod`, `bcrypt`, `@types/bcrypt`, `@types/node`) are added to `apps/api/package.json` and installed via `pnpm install`.

## Tasks / Subtasks

- [x] Task 1: Install dependencies (AC: #10)
  - [x] Add `drizzle-orm@^0.45.1`, `@libsql/client`, `bcrypt`, `zod` to `dependencies` in `apps/api/package.json`
  - [x] Add `drizzle-kit`, `@types/bcrypt`, `@types/node`, `tsx` to `devDependencies`
  - [x] Add `generate` and `migrate` scripts: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`
  - [x] Run `pnpm install` from repo root

- [x] Task 2: Write database schema (AC: #2)
  - [x] Create `apps/api/src/db/schema.ts`
  - [x] Define `admins` table: `id integer PK autoincrement`, `username text NOT NULL UNIQUE`, `password_hash text NOT NULL`, `created_at integer NOT NULL` (Unix ms)
  - [x] Define `sessions` table: `id text PK` (UUID), `admin_id integer NOT NULL REFERENCES admins(id)`, `created_at integer NOT NULL`, `expires_at integer NOT NULL`; index on `admin_id`
  - [x] Define `seasons` table: `id integer PK autoincrement`, `name text NOT NULL`, `start_date text NOT NULL` (ISO), `end_date text NOT NULL`, `total_rounds integer NOT NULL`, `playoff_format text NOT NULL`, `harvey_live_enabled integer NOT NULL DEFAULT 0` (boolean as 0/1), `created_at integer NOT NULL`
  - [x] Define `players` table: `id integer PK autoincrement`, `name text NOT NULL`, `ghin_number text`, `is_active integer NOT NULL DEFAULT 1`, `created_at integer NOT NULL`
  - [x] Define `rounds` table: `id integer PK autoincrement`, `season_id integer NOT NULL REFERENCES seasons(id)`, `type text NOT NULL CHECK(type IN ('official','casual'))`, `status text NOT NULL CHECK(status IN ('scheduled','active','finalized','cancelled'))`, `scheduled_date text NOT NULL`, `entry_code_hash text`, `auto_calculate_money integer NOT NULL DEFAULT 1`, `headcount integer`, `created_at integer NOT NULL`; index on `season_id`
  - [x] Define `groups` table: `id integer PK autoincrement`, `round_id integer NOT NULL REFERENCES rounds(id)`, `group_number integer NOT NULL`, `batting_order text` (JSON array of player IDs); index on `round_id`
  - [x] Define `round_players` table: `id integer PK autoincrement`, `round_id integer NOT NULL REFERENCES rounds(id)`, `player_id integer NOT NULL REFERENCES players(id)`, `group_id integer NOT NULL REFERENCES groups(id)`, `handicap_index real NOT NULL`, `is_sub integer NOT NULL DEFAULT 0`; unique on `(round_id, player_id)`; indexes on `round_id`, `player_id`
  - [x] Define `hole_scores` table: `id integer PK autoincrement`, `round_id integer NOT NULL REFERENCES rounds(id)`, `group_id integer NOT NULL REFERENCES groups(id)`, `player_id integer NOT NULL REFERENCES players(id)`, `hole_number integer NOT NULL CHECK(hole_number BETWEEN 1 AND 18)`, `gross_score integer NOT NULL`, `created_at integer NOT NULL`, `updated_at integer NOT NULL`; unique on `(round_id, player_id, hole_number)`; indexes on `round_id`, `group_id`
  - [x] Define `round_results` table: `id integer PK autoincrement`, `round_id integer NOT NULL REFERENCES rounds(id)`, `player_id integer NOT NULL REFERENCES players(id)`, `stableford_total integer NOT NULL`, `money_total integer NOT NULL`, `updated_at integer NOT NULL`; unique on `(round_id, player_id)`; index on `round_id`
  - [x] Define `harvey_results` table: `id integer PK autoincrement`, `round_id integer NOT NULL REFERENCES rounds(id)`, `player_id integer NOT NULL REFERENCES players(id)`, `stableford_rank integer NOT NULL`, `money_rank integer NOT NULL`, `stableford_points real NOT NULL`, `money_points real NOT NULL`, `updated_at integer NOT NULL`; unique on `(round_id, player_id)`; index on `round_id`
  - [x] Define `wolf_decisions` table: `id integer PK autoincrement`, `round_id integer NOT NULL REFERENCES rounds(id)`, `group_id integer NOT NULL REFERENCES groups(id)`, `hole_number integer NOT NULL`, `wolf_player_id integer NOT NULL REFERENCES players(id)`, `decision text NOT NULL CHECK(decision IN ('partner','alone'))`, `partner_player_id integer REFERENCES players(id)`, `outcome text CHECK(outcome IN ('win','loss','push'))`, `created_at integer NOT NULL`; index on `round_id`
  - [x] Define `side_games` table: `id integer PK autoincrement`, `season_id integer NOT NULL REFERENCES seasons(id)`, `name text NOT NULL`, `format text NOT NULL`, `scheduled_round_ids text` (JSON array), `created_at integer NOT NULL`; index on `season_id`
  - [x] Define `side_game_results` table: `id integer PK autoincrement`, `side_game_id integer NOT NULL REFERENCES side_games(id)`, `round_id integer NOT NULL REFERENCES rounds(id)`, `winner_player_id integer REFERENCES players(id)`, `winner_name text`, `notes text`, `created_at integer NOT NULL`; index on `round_id`

- [x] Task 3: Create Drizzle client singleton (AC: #3)
  - [x] Create `apps/api/src/db/index.ts`
  - [x] Import `createClient` from `@libsql/client` and `drizzle` from `drizzle-orm/libsql`
  - [x] Read `DB_PATH` from `process.env.DB_PATH ?? './data/wolf-cup.db'`
  - [x] Ensure parent directory exists before opening (use `fs.mkdirSync(dir, { recursive: true })`)
  - [x] Export `db` as singleton

- [x] Task 4: Configure drizzle-kit (AC: #4)
  - [x] Create `apps/api/drizzle.config.ts` with `dialect: 'turso'`, `schema: './src/db/schema.ts'`, `out: './src/db/migrations'`
  - [x] Run `pnpm --filter @wolf-cup/api db:generate` to produce migration SQL
  - [x] Run `pnpm --filter @wolf-cup/api db:migrate` — applied successfully

- [x] Task 5: Write seed script (AC: #5)
  - [x] Create `apps/api/src/db/seed.ts`
  - [x] Import `db` from `./index.js` and `bcrypt`
  - [x] Insert admin users Jason and Josh (passwords from `ADMIN_JASON_PASSWORD` / `ADMIN_JOSH_PASSWORD` env vars; fallback to dev defaults for local use only)
  - [x] Idempotent: checks existing row before insert (safe to re-run)
  - [x] Course data stays hardcoded in engine package (MVP approach per architecture)
  - [x] Added `"seed": "tsx src/db/seed.ts"` script to `apps/api/package.json`

- [x] Task 6: Implement auth middleware stubs (AC: #6, #7)
  - [x] Create `apps/api/src/middleware/admin-auth.ts`:
    - Read `session` cookie from context via `getCookie`
    - Query `sessions` table for matching `id` where `expires_at > Date.now()`
    - On miss/expired: return `c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)`
    - On hit: `c.set('adminId', session.adminId)` then `await next()`
  - [x] Create `apps/api/src/middleware/entry-code.ts`:
    - Read `x-entry-code` header from context
    - Look up round by `roundId` param; if `type === 'casual'`, call `await next()` and return
    - Compare provided code against `rounds.entry_code_hash` via `bcrypt.compare`
    - On fail: return `c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403)`
    - On pass: `await next()`

- [x] Task 7: Wire up Hono app and health check (AC: #1)
  - [x] Rewrite `apps/api/src/index.ts`:
    - Create `new Hono<{ Variables: { adminId: number } }>()` app
    - Register `GET /api/health` route returning `{ status: 'ok', timestamp: new Date().toISOString() }`
    - Call `serve({ fetch: app.fetch, port })` from `@hono/node-server`
    - Export `app` for potential testing use

- [x] Task 8: Typecheck and lint (AC: #8, #9)
  - [x] `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] `pnpm --filter @wolf-cup/api lint` — zero errors
  - [x] `tsconfig.base.json` uses `moduleResolution: "NodeNext"` — compatible with ESM

## Dev Notes

### Architecture Summary
- Framework: Hono 4.x + `@hono/node-server` (already in package.json)
- ORM: Drizzle ORM 0.45.1 + `@libsql/client` (SQLite via libsql; Rust prebuilt binaries, no MSVC required)
- Migrations: drizzle-kit with `dialect: 'turso'` for local libsql files
- Auth: custom cookie session (`httpOnly`, `Secure`, `SameSite=Strict`); bcrypt hashed passwords
- Validation: Zod installed; schemas in `src/schemas/` deferred to later stories
- This story establishes the skeleton only — no business-logic routes

### Driver Decision: @libsql/client over better-sqlite3
`better-sqlite3` requires native compilation via node-gyp and has no prebuilt binaries for Node 24 on Windows. `@libsql/client` uses Rust prebuilt binaries, works on all platforms without build tools, and is fully supported by Drizzle ORM via the `libsql` adapter. Functionally equivalent for local SQLite file usage.

### Schema Design Notes
- Money values: **integers** (whole dollar amounts, never fractions)
- Stableford points: **integers**
- Harvey Cup points: **real** (0.5 increments from tie-split logic)
- Timestamps: **integer** (Unix milliseconds, `Date.now()`)
- Dates: **text** (ISO 8601 `YYYY-MM-DD`)
- Booleans: **integer** `0`/`1` (SQLite has no native boolean)
- JSON arrays: **text** (e.g., `batting_order`, `scheduled_round_ids`)
- Entry codes: stored as bcrypt hash in `rounds.entry_code_hash`; never stored plain

### Auth Middleware Context
- `adminAuthMiddleware` uses `c.get('adminId')` / `c.set('adminId', id)` — typed via `Hono<{ Variables: { adminId: number } }>` generic on the app
- `entryCodeMiddleware` resolves `roundId` from query param or route param

### Recalculate-on-Write (Future Context)
- Every `POST /api/scores` in a later story will run the full engine recalculation atomically
- This story does NOT implement that — just ensures the DB schema supports it

### Project Structure Notes
- Files to create/modify in this story:
  - `apps/api/package.json` — added deps + scripts
  - `apps/api/drizzle.config.ts` — new
  - `apps/api/src/index.ts` — rewritten
  - `apps/api/src/db/schema.ts` — new
  - `apps/api/src/db/index.ts` — new
  - `apps/api/src/db/seed.ts` — new
  - `apps/api/src/db/migrations/0000_busy_toad_men.sql` — generated by drizzle-kit
  - `apps/api/src/middleware/admin-auth.ts` — new
  - `apps/api/src/middleware/entry-code.ts` — new

### References
- [Source: _bmad-output/planning-artifacts/architecture.md#Database Design]
- [Source: _bmad-output/planning-artifacts/architecture.md#API Layer]
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2]
- FR52, FR53 (player/roster), FR63 (admin auth), FR20–FR23 (round types)
- NFR12 (atomic DB writes), NFR22 (session auth), NFR23 (entry code invalidation)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `better-sqlite3@11.10.0` has no prebuilt binaries for Node 24.13.0 on Windows and requires MSVC. Switched to `@libsql/client@0.17.0` (Rust prebuilt, no native compilation).
- Drizzle 0.45.1 has no `node-sqlite` adapter; uses `drizzle-orm/libsql` with `dialect: 'turso'` in drizzle-kit config for local file URLs.
- Migration file named `0000_busy_toad_men.sql` (drizzle-kit auto-names).
- `data/` directory must exist before `db:migrate`; `db/index.ts` creates it at runtime via `mkdirSync`.

### Completion Notes List

- All 13 tables defined with correct types, NOT NULL constraints, FK references, named indexes, and CHECK constraints for enum-like columns.
- `adminAuthMiddleware` fully implemented: cookie validation → sessions table lookup → expiry check → sliding TTL update → `c.set('adminId')`.
- `entryCodeMiddleware` fully implemented: roundId query param → casual bypass → bcrypt.compare → 403 on failure; try/catch on all DB calls.
- Seed script is idempotent via SELECT-before-INSERT pattern.
- `pnpm --filter @wolf-cup/api typecheck` — zero errors.
- `pnpm --filter @wolf-cup/api lint` — zero errors.
- Engine regression suite: 426 tests passing.
- Code review fixes: exported shared `Variables` type to `src/types.ts` (H1); added sliding session expiry to adminAuthMiddleware (M1); removed unreliable `c.req.param()` from entryCodeMiddleware (M2); added try/catch to all middleware DB calls (M4); updated File List with pnpm-lock.yaml and migration meta files (H2/M3).

### File List

- `apps/api/package.json`
- `apps/api/drizzle.config.ts`
- `apps/api/src/index.ts`
- `apps/api/src/types.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/index.ts`
- `apps/api/src/db/seed.ts`
- `apps/api/src/db/migrations/0000_busy_toad_men.sql`
- `apps/api/src/db/migrations/meta/0000_snapshot.json`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/middleware/admin-auth.ts`
- `apps/api/src/middleware/entry-code.ts`
- `pnpm-lock.yaml`
