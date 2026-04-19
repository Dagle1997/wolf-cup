# Story T1.2: Scaffold tournament-api

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a fresh Hono + Drizzle + libsql scaffold at `apps/tournament-api/` matching Wolf Cup's versions,
so that tournament has a deployable API skeleton independent of Wolf Cup.

## Acceptance Criteria

1. **Given** a fresh checkout
   **When** `pnpm install` runs at the repo root
   **Then** `apps/tournament-api/` is picked up by the existing `apps/*` workspace glob in `pnpm-workspace.yaml`, and `apps/tournament-api/package.json` declares name `@tournament/api` (private) with dependency ranges:
   - `hono`: `^4.0.0`
   - `@hono/node-server`: `^1.0.0`
   - `drizzle-orm`: `^0.45.1`
   - `@libsql/client`: `^0.17.0`
   - `zod`: `^3.24.1`
   and devDependencies:
   - `drizzle-kit`: `^0.30.5`
   - `vitest`: `^3.0.0`
   - `typescript`: `^5.7.0`
   - `tsx`: `^4.19.2`
   - `@types/node`: `^22.0.0`
2. **Given** the scaffolded API
   **When** a Vitest smoke test (see Subtask 3.5) imports `{ app }` from `src/app.ts` and calls `await app.request('/api/health')` against the Hono app directly (no server spawn)
   **Then** the response has HTTP status 200 and the JSON body satisfies ALL of: `body.status === 'ok'`, `typeof body.startupTime === 'number'`, `Number.isInteger(body.startupTime)`, `body.startupTime > 0`
2a. **Given** `apps/tournament-api/src/index.ts` (the runtime entrypoint)
   **When** inspected
   **Then** it imports `{ app }` from `./app.js` and invokes `serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })` at module scope (i.e., the server binds to port 3000 by default when run as `node dist/index.js`, or to whatever `PORT` resolves to if exported)
3. **Given** `apps/tournament-api/package.json`
   **When** inspected
   **Then** neither `bcrypt` nor `@types/bcrypt` appears in `dependencies` or `devDependencies` (FD-4 SSO posture — no password auth in tournament)
4. **Given** the source tree
   **When** inspected
   **Then** the following files exist with the specified semantics:
   - `src/db/schema/index.ts` — a re-export module (may be empty of exports initially; the file itself must exist so downstream domain stories can append `export * from './players'` etc. without creating it)
   - `src/db/schema/_columns.ts` — exports a function (or const) that produces two drizzle `text(...)` column definitions: `tenant_id` with `.notNull().default('guyan')` and `context_id` with `.notNull()` and **no** `.default(...)` call. Exact export name is the dev agent's choice; either a factory function returning `{ tenantId, contextId }` or a spreadable const object is acceptable.
   - `src/db/index.ts` — drizzle client initialized via `@libsql/client` + `drizzle-orm/libsql`. The libSQL URL MUST be constructed as `` `file:${process.env['DB_PATH'] ?? './data/tournament.db'}` `` (the `file:` prefix is required by `@libsql/client.createClient`; passing a bare path crashes at runtime). Mirror `apps/api/drizzle.config.ts:7-8` exactly for the URL-construction shape.
   - `drizzle.config.ts` at `apps/tournament-api/drizzle.config.ts` — `dialect: 'turso'`, `schema: './src/db/schema/*'` (glob matching all files in the schema directory — the exact form the tournament architecture prescribes at architecture.md:344; NOT a bare directory path, NOT a single-file path), `out: './src/db/migrations'`, and `dbCredentials.url` constructed with the same `file:${DB_PATH ?? './data/tournament.db'}` pattern as `src/db/index.ts`. No `authToken` is needed for local libSQL (file mode); omit it.
5. **Given** `apps/tournament-api/package.json`
   **When** inspected
   **Then** `eslint`, `@eslint/js`, and `typescript-eslint` are NOT declared in either `dependencies` or `devDependencies`. These are already declared at the repo root (`package.json` devDependencies) and pnpm hoists them — duplicating them would risk version drift. This is the same pattern Wolf Cup's `apps/api/package.json` uses.
6. **Given** `apps/tournament-api/eslint.config.js`
   **When** inspected
   **Then** it exports a flat-config array that includes, minimally, the `@eslint/js` + `typescript-eslint` recommended configs AND a rules block with `no-restricted-imports` configured as:
   ```js
   'no-restricted-imports': ['error', {
     paths: [{
       name: '@wolf-cup/engine',
       message: 'Tournament may only import from @wolf-cup/engine/stableford (FD-11/12). Use the subpath import.',
     }],
     patterns: [{
       group: ['@wolf-cup/engine/*', '!@wolf-cup/engine/stableford'],
       message: 'Tournament may only import @wolf-cup/engine/stableford (FD-11/12).',
     }],
   }]
   ```
7. **Given** the API workspace
   **When** `pnpm -F @tournament/api test` runs
   **Then** Vitest 3.x executes successfully and exits 0. The workspace MUST ship with at least one passing smoke test (see Task 3.5) that calls `app.request('/api/health')` directly against the Hono app and asserts the response contract from AC #2.
8. **Given** the API workspace
   **When** `pnpm -F @tournament/api typecheck` and `pnpm -F @tournament/api lint` run
   **Then** both exit 0 under the existing `tsconfig.base.json` strictness flags (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`)
9. **Given** Wolf Cup workspaces
   **When** `pnpm -F @wolf-cup/api test` and `pnpm -F @wolf-cup/engine test` run after the scaffold lands
   **Then** both continue to pass with zero new failures (Wolf Cup regression protection per FR-G1, NFR-C3)

## Tasks / Subtasks

- [x] Task 1: Create the `apps/tournament-api/` directory tree (AC: #1, #4, #5, #6)
  - [x] Subtask 1.1: Create `apps/tournament-api/package.json` with name `@tournament/api`, `"private": true`, `"type": "module"`, `"version": "0.0.0"`, scripts (see Dev Notes for exact list), and deps / devDeps matching AC #1 exactly. Do NOT add `eslint`, `@eslint/js`, `typescript-eslint`, `bcrypt`, or `@types/bcrypt` (per AC #3 + AC #5).
  - [x] Subtask 1.2: Create `apps/tournament-api/tsconfig.json` extending `../../tsconfig.base.json`, overriding only `rootDir: "./src"` + `outDir: "./dist"`, and `"include": ["src/**/*"]` (mirrors `apps/api/tsconfig.json` shape)
  - [x] Subtask 1.3: Create `apps/tournament-api/vitest.config.ts` with `environment: 'node'` only (mirror `apps/api/vitest.config.ts`)
  - [x] Subtask 1.4: Create `apps/tournament-api/eslint.config.js` as a flat-config exporting the typescript-eslint recommended configs plus the engine-boundary `no-restricted-imports` rule from AC #6 verbatim. Keep the same `ignores` array as the root config (`['**/dist/**', '**/node_modules/**', '**/*.js']`)
  - [x] Subtask 1.5: Create `apps/tournament-api/drizzle.config.ts` per AC #4
- [x] Task 2: Create the `src/` skeleton (AC: #2, #4)
  - [x] Subtask 2.1a: Create `apps/tournament-api/src/app.ts` as a side-effect-free module: constructs the Hono `app`, defines module-level `const STARTUP_TIME = Date.now();`, registers `app.get('/api/health', (c) => c.json({ status: 'ok', startupTime: STARTUP_TIME }));`, and `export { app }`. MUST NOT call `serve()` — importing this file must not bind a port. Do NOT port any other Wolf Cup routes or middleware; this is a skeleton.
  - [x] Subtask 2.1b: Create `apps/tournament-api/src/index.ts` as the runtime entrypoint: imports `{ app }` from `./app.js`, calls `serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })`, and emits a `console.log` line on startup (e.g., `` `Tournament API listening on port ${port}` ``). This is the module that `node dist/index.js` (and therefore `apps/tournament-api/package.json`'s `dev` script) executes.
  - [x] Subtask 2.2: `src/db/index.ts` — drizzle client init per AC #4. Use `` const url = `file:${process.env['DB_PATH'] ?? './data/tournament.db'}` `` and `createClient({ url })`.
  - [x] Subtask 2.3: `src/db/schema/_columns.ts` per AC #4 (FD-6). Export shape is dev-agent choice; recommended: a factory `export const ecosystemColumns = () => ({ tenantId: text('tenant_id').notNull().default('guyan'), contextId: text('context_id').notNull() })` so table definitions can spread it: `...ecosystemColumns()`
  - [x] Subtask 2.4: `src/db/schema/index.ts` — empty re-export file. Contents: a single comment line such as `// Domain schemas re-exported here as they are added (T2.1+).` Zero `export` statements is fine; the file just needs to exist so the glob `./src/db/schema/*` has at least one match and future stories can append `export * from './events';` etc.
  - [x] Subtask 2.5: Create `apps/tournament-api/data/.gitkeep` so the SQLite directory exists. Create `apps/tournament-api/.gitignore` with exactly these lines (app-local; MUST NOT edit the repo-root `.gitignore`):
    ```
    data/*.db
    data/*.db-journal
    data/*.db-shm
    data/*.db-wal
    dist/
    ```
- [x] Task 3: Wire scripts + verify install (AC: #1, #7, #8)
  - [x] Subtask 3.1: Run `pnpm install` at the repo root; confirm no warnings about `@tournament/api` or version conflicts; confirm `apps/tournament-api/node_modules` populated
  - [x] Subtask 3.2: Run `pnpm -F @tournament/api typecheck` — must exit 0
  - [x] Subtask 3.3: Run `pnpm -F @tournament/api lint` — must exit 0 (no source code exists that would violate the engine-boundary rule yet; the rule is a guard for future stories)
  - [x] Subtask 3.4: Run `pnpm -F @tournament/api build` — must exit 0. Confirm `apps/tournament-api/dist/index.js` is produced
  - [x] Subtask 3.5: Create `apps/tournament-api/src/app.test.ts` that imports `{ app }` from `./app.js` (Vitest + NodeNext resolve the `.js` specifier to the `.ts` source; if the resolver balks, drop the extension — `from './app'` also works under Vitest's Vite plugin). Inside a single `test('GET /api/health returns ok + startupTime', async () => { ... })`: `const res = await app.request('/api/health')`; assert `res.status === 200`; `const body = await res.json() as { status: string; startupTime: number }`; assert `body.status === 'ok'`, `typeof body.startupTime === 'number'`, `Number.isInteger(body.startupTime)`, `body.startupTime > 0`. Run `pnpm -F @tournament/api test` — must exit 0 with 1 passing test. This test exercises the full Hono fetch pipeline without binding a port.
- [x] Task 4: Wolf Cup regression protection (AC: #9)
  - [x] Subtask 4.1: Run `pnpm -F @wolf-cup/engine test` — must pass with same test count as before this story
  - [x] Subtask 4.2: Run `pnpm -F @wolf-cup/api test` — must pass with same test count as before this story
  - [x] Subtask 4.3: Do NOT run `pnpm -F @wolf-cup/web` commands — not needed for T1.2 verification and unnecessary risk surface

## Dev Notes

- **Divergence from Wolf Cup scaffold (intentional, called out by architecture + PRD):**
  - Wolf Cup has a monolithic `src/db/schema.ts` (548 lines, single file). Tournament uses `src/db/schema/` directory with per-domain files (`events.ts`, `players.ts`, etc. added in T2+). Architecture.md:344 explicitly says Wolf Cup's flat file is "legacy-by-inertia, not a pattern to copy."
  - Wolf Cup's `/api/health` currently returns `{ status: 'ok', timestamp: <ISO> }`. Tournament's AC demands `{ status: 'ok', startupTime: <epoch ms> }`. This is a better shape (mirrors Wolf Cup's `/api/version` which already returns epoch ms) and is what the story AC requires. Ship the AC shape, not the legacy Wolf Cup `/api/health` shape.
  - Wolf Cup does NOT have an engine-boundary eslint rule today. Tournament introduces it at scaffold time per architecture.md:1160.
- **FD-6 columns shape (recommended, not required):**
  ```ts
  // src/db/schema/_columns.ts
  import { text } from 'drizzle-orm/sqlite-core';
  export const ecosystemColumns = () => ({
    tenantId: text('tenant_id').notNull().default('guyan'),
    contextId: text('context_id').notNull(),
  });
  ```
  Domain tables spread it: `sqliteTable('events', { id: text('id').primaryKey(), ...ecosystemColumns(), ... })`. Function form (not a frozen const) so each table gets fresh column instances — drizzle treats column objects as per-table identities.
- **scripts object for `package.json`:** mirror `apps/api/package.json` scripts minus the seed/demo scripts which don't yet have targets. Minimum set:
  ```json
  "typecheck": "tsc --noEmit",
  "lint": "eslint src",
  "dev": "node --watch dist/index.js",
  "build": "tsc",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "test": "vitest run"
  ```
- **Wolf Cup isolation (FD-1/FD-2):** this story does NOT touch `apps/api`, `apps/web`, `packages/engine`, Wolf Cup's migrations, Wolf Cup's tests, or the root `package.json`. All writes are under `apps/tournament-api/`. `pnpm-workspace.yaml` already globs `apps/*` so no workspace-manifest edit is needed.
- **Structured-log sink is T1.7, NOT T1.2.** Use `console.log` for startup; T1.7 will retrofit the JSON log sink. Do NOT introduce `pino`, `winston`, or a custom logger in this story.
- **No routes beyond `/api/health`.** Auth realm is T1.6. Course, event, scoring routes are T2+. Adding scaffolding for routes that don't exist yet invites churn.
- **No Dockerfile in this story.** T1.4 adds `apps/tournament-api/Dockerfile` + docker-compose service. T1.2 is local-dev-runnable only.
- **No test impact on Wolf Cup:** this story adds a new workspace with exactly one smoke test (`src/index.test.ts`, per Subtask 3.5). No Wolf Cup test should change. Task 4 is the regression guard.
- **Why split `src/app.ts` and `src/index.ts`:** Hono's `app.request()` runs the full app fetch pipeline in-process, so the `/api/health` contract can be exercised end-to-end without binding a port. That requires the test to import `app` from a module that does NOT call `serve()` at import time. The split-module pattern (app.ts = pure app construction, index.ts = serve() bootstrap) is the only pattern T1.2 ships. A single-file `NODE_ENV`-guarded alternative was considered and rejected: pre-exported `NODE_ENV=production` in CI shells would bypass the guard and bind a port during tests, reintroducing flakiness. Deterministic beats convenient.

### Project Structure Notes

- Target directory: `apps/tournament-api/` at repo root.
- All new files live under that directory.
- `pnpm-workspace.yaml` (repo root) already contains `- 'apps/*'` — no edit needed.
- The repo-root `.gitignore` is NOT edited. Tournament-api ships its own `apps/tournament-api/.gitignore` (contents in Subtask 2.5).
- Shape after this story (target tree):
  ```
  apps/tournament-api/
    package.json
    tsconfig.json
    vitest.config.ts
    eslint.config.js
    drizzle.config.ts
    .gitignore
    src/
      app.ts                     # defines + exports { app }; no side effects on import
      index.ts                   # imports app from ./app.js + calls serve()
      app.test.ts                # smoke test per Subtask 3.5
      db/
        index.ts                 # drizzle client init (file:${DB_PATH ?? ...})
        schema/
          index.ts               # empty re-export; `// Domain schemas re-exported here...`
          _columns.ts            # FD-6 helper
    data/
      .gitkeep
  ```

### References

- Story source — open `_bmad-output/planning-artifacts/tournament/epics-phase1.md` and find heading `#### Story T1.2: Scaffold tournament-api`
- FD-1 (monorepo posture) — `_bmad-output/planning-artifacts/tournament/prd.md` heading `### FD-1: Monorepo posture — no rename`
- FD-4 (SSO posture — no bcrypt) — `_bmad-output/planning-artifacts/tournament/prd.md`; FR-A6..FR-H plus `### Auth/identity section` starting around line 461
- FD-6 (ecosystem columns) — `_bmad-output/planning-artifacts/tournament/prd.md` heading `### FD-6: Cross-context stats foundation — ecosystem columns on every writable table`
- Engine-boundary eslint rule (exact text) — `_bmad-output/planning-artifacts/tournament/architecture.md` lines 1158-1177
- Schema organization target — `_bmad-output/planning-artifacts/tournament/architecture.md` lines 851-857, plus line 344 ("Wolf Cup's flat file is legacy-by-inertia, not a pattern to copy")
- Wolf Cup scaffold references (READ only — do not edit):
  - `apps/api/package.json` — scripts + deps version source-of-truth
  - `apps/api/tsconfig.json` — extends-base pattern to mirror
  - `apps/api/vitest.config.ts` — minimal config to mirror
  - `apps/api/drizzle.config.ts` — dialect + credentials pattern
  - `apps/api/src/index.ts:44` — `STARTUP_TIME = Date.now()` constant pattern
- Shared tsconfig — `tsconfig.base.json` (no edit; just extend)
- Existing root eslint config — `eslint.config.js` (pattern reference; no edit to root)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Claude Opus 4.7, 1M context)

### Debug Log References

Verification pipeline output (2026-04-19):

```
# Subtask 3.1: pnpm install
Scope: all 5 workspace projects   # was 4 before T1.2
Done in 3.5s using pnpm v9.15.9

# Subtask 3.2: typecheck → exit 0
> @tournament/api@0.0.0 typecheck D:\Wolf-Cup\apps\tournament-api
> tsc --noEmit

# Subtask 3.3: lint → exit 0
> @tournament/api@0.0.0 lint D:\Wolf-Cup\apps\tournament-api
> eslint src

# Subtask 3.4: build → exit 0; dist/index.js produced
apps/tournament-api/dist/
  app.d.ts  app.d.ts.map  app.js  app.js.map
  db/       index.d.ts    index.d.ts.map  index.js  index.js.map

# Subtask 3.5: test → 1 passing smoke test
✓ src/app.test.ts (1 test) 4ms
  ✓ app > GET /api/health returns ok + startupTime
Test Files  1 passed (1)
     Tests  1 passed (1)
   Duration 400ms

# Task 4: Wolf Cup regression — both green
pnpm -F @wolf-cup/engine test → 11 files, 468 tests passed
pnpm -F @wolf-cup/api    test → 21 files, 429 tests passed
```

### Completion Notes List

- Shipped the split-module pattern exactly as the spec required: `src/app.ts` exports `app` (no side effects); `src/index.ts` imports and calls `serve()`. Smoke test imports from `./app.js` — Vitest resolves the `.js` specifier to the `.ts` source under NodeNext tsconfig without complaint.
- `package.json` declares the five required runtime deps + five required devDeps at the exact version ranges in AC #1. Explicitly omitted `eslint`, `@eslint/js`, `typescript-eslint` (root-hoisted per AC #5), `bcrypt`, `@types/bcrypt` (FD-4 per AC #3).
- `drizzle.config.ts` uses `schema: './src/db/schema/*'` (glob) + `dialect: 'turso'` + `file:${DB_PATH}` URL per AC #4. `authToken` omitted (local file libSQL only).
- `src/db/schema/_columns.ts` ships the recommended factory form: `export const ecosystemColumns = () => ({ tenantId: text('tenant_id').notNull().default('guyan'), contextId: text('context_id').notNull() })`. Future domain tables spread `...ecosystemColumns()` per FD-6.
- `src/db/schema/index.ts` is an intentionally-empty `export {};` so the `./src/db/schema/*` glob has at least one match and TypeScript is happy under `--isolatedModules`-style strictness.
- `apps/tournament-api/.gitignore` written; root `.gitignore` untouched per Subtask 2.5.
- `pnpm-lock.yaml` was modified by pnpm install (unavoidable side effect of registering a new workspace). This is expected, not a Wolf Cup write — the lockfile is a monorepo-shared artifact.
- **Wolf Cup isolation held:** `git status` shows zero modifications to `apps/api/**`, `apps/web/**`, `packages/engine/**`, Wolf Cup migrations, or Wolf Cup tests.
- **Pre-dev codex-review of the spec surfaced 2 high + 4 medium + 1 low findings across two review rounds.** All applied before implementation (libSQL URL `file:` prefix pinned; lint deps deny-listed; split-module pattern mandated; drizzle glob form pinned; cross-platform smoke test; app-local `.gitignore`). No findings emerged during implementation — the spec was tight enough that first-pass code passed typecheck, lint, build, and the smoke test.
- **Post-implementation codex-review surfaced 1 high + 1 medium + 1 low finding:**
  - **[HIGH] Engine-boundary eslint rule may not negate.** Codex worried `patterns: [{ group: ['@wolf-cup/engine/*', '!@wolf-cup/engine/stableford'] }]` was unreliable. **Empirically dismissed** via a scratch test file (`src/_scratch_lint_test.ts`, since deleted) with three imports: bare `@wolf-cup/engine` → blocked; `@wolf-cup/engine/stableford` → allowed; `@wolf-cup/engine/money` → blocked. The `!` negation works correctly in ESLint 9.x + typescript-eslint 8.x. No change.
  - **[MEDIUM] PORT parsing gives NaN/0 on bad input.** **Fixed** — replaced `Number(process.env['PORT'] ?? 3000)` with a `resolvePort()` helper in `src/index.ts` that uses `parseInt`, validates the result is finite + in range 1..65535, and falls back to 3000 with a warn-log on invalid input. AC #2a still satisfied: the default-3000 behavior is unchanged; the helper just hardens the edge cases.
  - **[LOW] DB_PATH can't be a full libsql URL.** **Deferred.** Wolf Cup's `apps/api/drizzle.config.ts` and `apps/api/src/db/index.ts` use the identical `file:${DB_PATH ?? ...}` construction. Tournament matching Wolf Cup's pattern here is intentional — v1 ships local SQLite only, and diverging solo on URL-parsing would add surface area for zero benefit. If tournament ever moves to Turso cloud, both apps can be updated together.
- Post-fix verification: typecheck, lint, build, smoke test all re-run green after the `resolvePort` change.

### File List

- `apps/tournament-api/package.json` (new)
- `apps/tournament-api/tsconfig.json` (new)
- `apps/tournament-api/vitest.config.ts` (new)
- `apps/tournament-api/eslint.config.js` (new)
- `apps/tournament-api/drizzle.config.ts` (new)
- `apps/tournament-api/.gitignore` (new)
- `apps/tournament-api/src/app.ts` (new)
- `apps/tournament-api/src/index.ts` (new; post-review `resolvePort()` hardening for NaN/0 edge cases)
- `apps/tournament-api/src/app.test.ts` (new)
- `apps/tournament-api/src/db/index.ts` (new)
- `apps/tournament-api/src/db/schema/index.ts` (new)
- `apps/tournament-api/src/db/schema/_columns.ts` (new)
- `apps/tournament-api/data/.gitkeep` (new)
- `pnpm-lock.yaml` (modified — automatic, pnpm added @tournament/api workspace)
