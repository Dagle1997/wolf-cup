# Story T1.7: Structured JSON Log Sink

Status: ready-for-dev

## Story

As a developer,
I want tournament-api to emit structured JSON log lines to both stdout and an append-only daily log file via a single centralized logger, with a request-id middleware that assigns a UUID per request and threads it through every log line emitted while handling that request,
So that production failures can be diagnosed without external observability infrastructure (NFR-O1), and so the `console.error(JSON.stringify(...))` pattern shipped in T1-6b's auth handlers gets replaced by a real structured logger before T2+ spreads the pattern further.

**Scope context:** this is the last T1 story — Epic T1 exits when this lands. T1-6b shipped 4 `console.error(JSON.stringify(...))` helpers in `auth.ts`; T1-7 replaces them with pino calls and installs an ESLint rule that prevents the next developer from re-introducing the pattern. T2+ can then assume a working `logger.*` API across the codebase.

## Explicit Risk Acceptance (spec-gate decision)

**File-log persistence vs. new volume mount — choosing the existing `tournament_sqlite_data` volume.**

The epic AC states "logs go to `/app/logs/tournament-{YYYY-MM-DD}.log`." Taken literally, `/app/logs/` is NOT covered by any volume in `docker-compose.yml`, meaning on container restart the file is lost. Either:

1. **Option A:** add a new named volume `tournament_logs_data:/app/logs` → requires a SHARED docker-compose.yml edit.
2. **Option B:** use `/app/data/logs/tournament-{YYYY-MM-DD}.log` under the existing `tournament_sqlite_data` mount → no new SHARED gate, logs persist across restarts alongside the DB.

**This spec picks Option B.** The epic text is an illustrative path, not a hard constraint — what matters is that a persistent file log exists alongside stdout. Option B satisfies the intent without a SHARED gate budget hit. Revisit if log volume ever threatens to contend with DB I/O on the same volume (no near-term concern — tournament-api's request volume is ~8 users × ~5 req/sec peak during live scoring).

**Documented here so codex review surfaces this as an intentional deviation, not drift.**

## Acceptance Criteria

1. **Given** `apps/tournament-api/package.json`
   **When** inspected post-T1-7
   **Then** two new `dependencies` are added at caret-ranged current stable versions:
   - `pino` at `^10.3.0` (or whatever `pnpm view pino version` reports at impl time — current stable is 10.3.1)
   - `pino-roll` at `^4.0.0` (or whatever `pnpm view pino-roll version` reports at impl time — current stable is 4.0.0)
   No other dep fields change. `devDependencies` is byte-unchanged. `pnpm-lock.yaml` is updated by `pnpm install` — **this is a SHARED gate**. Explicit disallow: `"pino": "latest"` or unpinned shapes.

2. **Given** `apps/tournament-api/src/lib/log.ts` (new file)
   **When** inspected
   **Then** it exports a single configured `pino` logger instance (`logger`) with the following posture:
   - `level` from `env.LOG_LEVEL`.
   - `timestamp: () => \`,"ts":"${new Date().toISOString()}"\`` — replaces pino's default unix-ms timestamp with an ISO-8601 string, matching epic AC #1's `{ ts: <ISO> }` shape.
   - `formatters.level: (label) => ({ level: label })` — pino's default emits a numeric level; override to string so consumers can grep/filter on level name without a lookup table.
   - `base: null` — pino by default adds `pid` and `hostname`; these are noise at our scale. Drop them. (Pino's type is `{[key:string]: any} | null`; `null` is the documented sentinel to suppress base fields. `undefined` is NOT accepted under strict type-checking.)
   - Transport target (pino multistream via `pino.multistream([...])`): two destinations simultaneously:
     - **stdout** (captured by docker log driver) — use `process.stdout` as the writable stream.
     - **file** via `pino-roll` with the EXACT options:
       ```ts
       await pinoRoll({
         file: path.join(env.LOG_DIR, 'tournament'),
         frequency: 'daily',
         size: '100m',
         mkdir: true,
         extension: '.log',
         dateFormat: 'yyyy-MM-dd',
       })
       ```
       These exact options are the canonical source — any deviation is drift. The resulting filenames MUST match `/^tournament\.\d{4}-\d{2}-\d{2}\.\d+\.log$/` (e.g. `tournament.2026-05-07.1.log`). The `\d+` segment is pino-roll's rotation number — it starts at 1 for a fresh directory and increments on size/day rollover. AC #11 asserts the regex against a real pino-roll invocation.
   - Export shape: `export const logger: Logger` with `Logger` imported from `pino`.
   - No side effects at import time OTHER than the transport initialization. Because `pino-roll` is async (returns a Promise), the module initialization awaits it at top-level via `top-level await` (tsconfig NodeNext + ESM supports this; `tsc` emits compatible output). **The top-level-await singleton is the mandated shape** — a `createLogger()` factory alternative is explicitly out of scope because the AC #11 test uses `vi.resetModules()` + re-import to reinitialize, which requires module-level side effects.

3. **Given** the production file-log filename on 2026-05-07
   **When** inspected
   **Then** a file at `/app/data/logs/tournament.2026-05-07.1.log` (or the next rotation number if restarts happened) exists AND contains JSON lines matching the AC #11 shape. The canonical filename regex is `/^tournament\.\d{4}-\d{2}-\d{2}\.\d+\.log$/` — codified in AC #11's file-sink probe test and referenced in AC #17's smoke-verification step. No other filename shape is acceptable.

4. **Given** `apps/tournament-api/src/lib/env.ts`
   **When** inspected post-T1-7
   **Then** the Zod schema is EXTENDED with two new keys:
   - `LOG_LEVEL: z.enum(['trace','debug','info','warn','error','fatal']).default('info')`
   - `LOG_DIR: z.string().min(1).optional()` at the raw schema level. A post-parse transform (`.transform()` applied to the object schema, or equivalent) RESOLVES `LOG_DIR` to a non-optional string so the exported `Env` type has `LOG_DIR: string`:
     - `NODE_ENV === 'production'` AND caller didn't provide LOG_DIR → `'/app/data/logs'` (persisted via the existing `tournament_sqlite_data` volume).
     - Otherwise (dev / test, or production with explicit LOG_DIR) → caller's value OR `'./data/logs'` (relative to the API cwd) as the dev/test fallback.

   The resolution happens at schema-parse time so every downstream consumer (log.ts in particular) reads `env.LOG_DIR` as a guaranteed string with no `undefined` branch. Passing `env.LOG_DIR` into `path.join(...)` is safe.

   This **eliminates the round-1 HIGH finding**: if the operator forgets to set `LOG_DIR` in `.env.production`, logs STILL land on the persisted volume rather than a non-mounted relative path. No SHARED docker-compose.yml change needed — the production default lives in env.ts.

   Tests (AC #11) override `LOG_DIR` explicitly to a tmpdir via `vi.stubEnv` or `vi.doMock('./env.js', ...)` + `vi.resetModules()` + re-import. **`src/test-setup.ts` does NOT set a persistent `LOG_DIR`** — the NODE_ENV=test case falls to the `./data/logs` default. Tests that write log lines (AC #11's file-sink probe) redirect to `os.tmpdir()` locally so they don't pollute the repo, then clean up. Tests that don't exercise file sinks (most of the suite) simply accept that `./data/logs` may be created during the test run — this is acceptable because the dir ends up in `.gitignore`'s `data/` rule (already present) OR the tests don't trigger any actual log writes past `level: 'fatal'`.

5. **Given** `apps/tournament-api/src/middleware/request-id.ts` (new file)
   **When** inspected
   **Then** it exports a Hono `MiddlewareHandler` named `requestIdMiddleware` that:
   - Reads `X-Request-Id` from the incoming request header. If present AND matches `/^[A-Za-z0-9_.-]{1,128}$/` (safe ID charset, cap at 128 chars to prevent header-stuffing), reuses it. Otherwise generates `crypto.randomUUID()`.
   - Sets the raw value on Hono's context via `c.set('requestId', id)`.
   - **Creates a request-scoped child logger** via `logger.child({ requestId: id })` and stores it on context via `c.set('logger', childLogger)`. This is load-bearing: every downstream call-site that uses `c.get('logger')` automatically emits the requestId on every log line without having to remember to pass it. This closes the round-1 MEDIUM finding about "requestId through every log line."
   - Adds `X-Request-Id: <id>` to the OUTBOUND response header via `c.header('X-Request-Id', id)` so clients can correlate their request to our logs.
   - `await next()`. No side effects in the finally path.

   **Input-validation rationale:** the regex accepts UUIDs (which include hyphens), ULIDs, and arbitrary client-supplied base64url-ish strings. Rejecting an incoming malformed header and regenerating our own is safer than threading attacker-controlled strings into log files — otherwise a malicious client could inject `"; level: error; inject}` into a JSON structured log line. Pino's JSON escaping handles this correctly, but defense-in-depth at the ingress boundary is cheap.

6. **Given** `apps/tournament-api/src/types/hono.d.ts`
   **When** inspected post-T1-7
   **Then** the `ContextVariableMap` interface gains TWO new REQUIRED keys:
   - `requestId: string`
   - `logger: Logger` (imported from `pino` via `import type { Logger } from 'pino'` at the top of the file)

   Existing keys (`session`, `player`) byte-unchanged.

7. **Given** `apps/tournament-api/src/app.ts`
   **When** inspected post-T1-7
   **Then** `requestIdMiddleware` is mounted BEFORE the existing `csrf` middleware via `app.use('*', requestIdMiddleware)`. Placement MUST be first so every downstream middleware — including CSRF, auth, and route handlers — can read `c.get('requestId')` and include it in their log context. No other changes to `app.ts`.

8. **Given** `apps/tournament-api/src/index.ts`
   **When** inspected post-T1-7
   **Then** the startup log line `console.log(\`Tournament API listening on port ${port}\`)` is REPLACED with `logger.info({ port, msg: 'Tournament API listening' })`. This emits one `level: 'info'` line to both stdout + file on startup, satisfying epic AC #1 "at least one log line is emitted to stdout with `{ ts: <ISO>, level: 'info', msg: <string>, requestId: null }`." Note: `requestId` is NOT threaded at the startup callsite because no request is in flight — pino emits the line without a requestId field, which matches the "or omitted requestId at boot" wording in the epic AC.

9. **Given** `apps/tournament-api/src/routes/auth.ts`
   **When** inspected post-T1-7
   **Then** the four `console.error(JSON.stringify(...))` helpers (`logOAuthProviderError`, `logUnknownOAuthError`, `logInvalidIdToken`, `logOAuthBindError`) are REPLACED with equivalent `c.get('logger').error(...)` / `.warn(...)` calls. The request-scoped child logger from AC #5 already has `requestId` bound, so call-sites DO NOT pass it again — they pass only the event-specific context (`event`, `providerErr`, etc.). The log shape stays the same but emission routes through pino so both stdout + file sinks receive the lines. The four named helper functions can be dropped entirely and replaced with inline `c.get('logger').error({...})` calls — no stable API here to preserve.

10. **Given** `apps/tournament-api/src/middleware/require-session.ts` + `apps/tournament-api/src/middleware/require-organizer.ts`
    **When** inspected post-T1-7
    **Then** both middlewares read `requestId` from `c.get('requestId')` (set by the new `requestIdMiddleware` earlier in the chain) INSTEAD of generating their own `randomUUID()`. The `require-session.ts` currently generates a fresh UUID at the top of the handler; T1-7 removes that line and reads from ctx. The `require-organizer.ts` middleware-misuse `console.error` line gets replaced with `c.get('logger').error({ msg: 'requireOrganizer invoked without requireSession ahead of it' })` — the child logger already carries `requestId`.

11. **Given** `apps/tournament-api/src/lib/log.test.ts` (new file) + `apps/tournament-api/src/middleware/request-id.test.ts` (new file)
    **When** inspected
    **Then** collectively ≥8 tests exist covering:

    `log.test.ts` (≥4):
    - `logger.info(...)` produces a parseable JSON line with `ts` (ISO-8601 format — match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`), `level: 'info'`, `msg`, and NOT `pid` / `hostname`.
    - `logger.child({ requestId: 'X' }).error(...)` emits `requestId: 'X'` without the caller having to pass it explicitly. This pins the child-logger contract from AC #5.
    - Custom fields (`event`, `sub`, etc.) pass through unmodified.
    - **File sink probe** (deterministic, not timing-based — codex round-1 MED fix): inside the test, set `LOG_DIR` to an `os.tmpdir()` + `mkdtempSync` path, `vi.resetModules()`, re-import the log module, write one probe line via `logger.info({msg: 'file-sink-probe'})`. Then await pino's flush via its callback API (pino@10 `logger.flush(cb)` takes an optional callback and does NOT return a Promise — wrap it: `await new Promise<void>((resolve) => logger.flush(() => resolve()))`) AND `await new Promise(r => setImmediate(r))` to drain any microtask-queued writes. Then `fs.readdirSync(tmpdir)` and assert at least ONE filename matches `/^tournament\.\d{4}-\d{2}-\d{2}\.\d+\.log$/`. Read that file's contents via `fs.readFileSync(path, 'utf-8')` and assert it contains the string `'file-sink-probe'`. `afterEach` cleans the tmpdir via `fs.rmSync(dir, { recursive: true, force: true })`. Do NOT use `setTimeout(resolve, N)` as the flush mechanism — it's flaky under CI load. If the callback-flush + setImmediate drain still doesn't catch pino-roll's writable-stream buffering (unlikely at the single-line scale), the test bounds a retry loop with `deadline = Date.now() + 2000` and reads every 50ms until either the assertion passes or the deadline fires. The retry-with-deadline is the explicit fallback; single `sleep` is forbidden.

    `request-id.test.ts` (≥4):
    - Middleware generates a UUID when no `X-Request-Id` header is present; the generated id matches `/^[0-9a-f-]{36}$/` (UUIDv4 shape).
    - Middleware reuses a valid incoming `X-Request-Id`.
    - Middleware REJECTS a malformed `X-Request-Id` (e.g. contains `;`, `\n`, or is >128 chars) by generating a fresh UUID rather than propagating the bad value.
    - Response carries `X-Request-Id` header that matches the one set on `c.get('requestId')`.
    - Middleware sets a request-scoped `logger` on ctx (via `c.set('logger', logger.child({ requestId: id }))`) — assert by calling `c.get('logger')` in a downstream test handler and confirming it emits the requestId on the next log call.

12. **Given** `apps/tournament-api/eslint.config.js`
    **When** inspected post-T1-7
    **Then** a new rule `'no-console': ['error', { allow: [] }]` is added to the existing `rules` block, forbidding any `console.*` call in tournament-api production code. The following file-level overrides are ADDED in the same config (codex round-1 LOW finding — "dev judgment" removed, overrides are concrete):

    ```js
    {
      files: ['src/port.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
      rules: { 'no-console': 'off' },
    }
    ```

    Rationale for each:
    - `src/port.ts`: two `console.warn` calls at PORT-env parse time run BEFORE env.ts (and therefore the logger) is loaded. Must stay.
    - `src/db/migrate.ts`: separate entrypoint invoked by `node dist/db/migrate.js` — short-lived CLI, no request context, no benefit from pino transport overhead.
    - `src/db/seed.ts`: same reasoning as migrate.ts.

    Test files are NOT exempt from the rule. Note specifically: `vi.spyOn(console, 'error').mockImplementation(...)` does NOT trigger the `no-console` rule. The rule's AST handler flags `CallExpression` nodes whose callee is a `MemberExpression` with `object.name === 'console'` (i.e. a literal `console.error(...)` or `console.log(...)` call). Passing `console` as an ARGUMENT to `vi.spyOn` is a plain identifier reference and does not match the pattern. T1-6b's existing `vi.spyOn(console, 'error')` in `auth.test.ts` is therefore lint-safe as written, AND per AC #18 it will be re-targeted to the logger module anyway.

13. **Given** `pnpm -F @tournament/api test`
    **When** run
    **Then** total tests ≥71 (63 at start of T1-7 + ≥8 new from AC #11). Existing T1-6a/T1-6b tests continue to pass with no count loss. The auth.test.ts tests that spy on `console.error` (the unknown-error-branch test added in T1-6b impl codex round 1) MUST continue to pass — T1-7's change means those helpers now call `logger.error` instead of `console.error`. Update the spy target accordingly.

14. **Given** `pnpm -r typecheck` + `pnpm -r lint`
    **When** run post-T1-7
    **Then** both exit 0 across all 6 workspace projects. Wolf Cup workspaces unchanged in either check.

15. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T1-7
    **Then** both continue to pass with zero net-negative test count change. Same regression guard as every prior Epic T1 story.

16. **Given** the first-deploy of T1-7 to production
    **When** the tournament-api container starts
    **Then** the `/app/data/logs/` directory is created by pino-roll's `mkdir: true` option on first use. No manual mkdir in the Dockerfile CMD required. The existing `tournament_sqlite_data` volume covers the path, so logs persist across restarts.

17. **Given** a live tournament-api container
    **When** 10+ requests are served
    **Then** `docker logs tournament-api` shows 10+ JSON lines with `ts`, `level`, `requestId` fields, AND a file matching `/app/data/logs/tournament.YYYY-MM-DD.*.log` contains the same lines (give or take pino-roll's sync/flush buffering at read-time). This is a post-deploy smoke verification step, not a test — documented here so the operator knows what "working" looks like.

18. **Given** the T1-6b `console.error` spy in `auth.test.ts`
    **When** updated post-T1-7
    **Then** the spy re-targets the pino logger's error method instead of `console.error`. The test assertion that "unknown-error branch fires + logs" stays intact — the behavior is unchanged; the transport is what's different.

## Tasks / Subtasks

- [ ] Task 1: Add `pino` + `pino-roll` deps (AC #1) — **SHARED HARD STOP** on pnpm-lock.yaml
  - [ ] Subtask 1.1: Announce intent; wait for approval.
  - [ ] Subtask 1.2: Add to dependencies; run `pnpm install`.

- [ ] Task 2: Extend env.ts (AC #4)
  - [ ] Subtask 2.1: Add `LOG_LEVEL` + `LOG_DIR` with safe defaults.
  - [ ] Subtask 2.2: No test-setup.ts change needed (defaults handle it).

- [ ] Task 3: Create `src/lib/log.ts` + tests (AC #2, #3, #11)
  - [ ] Subtask 3.1: Configure pino with ISO timestamp + string-level formatter + dropped base.
  - [ ] Subtask 3.2: Multistream to stdout + pino-roll file destination.
  - [ ] Subtask 3.3: Write 4+ tests including file-sink probe via tmpdir.

- [ ] Task 4: Create `src/middleware/request-id.ts` + tests (AC #5, #11)
  - [ ] Subtask 4.1: Implement middleware with input validation + UUID fallback.
  - [ ] Subtask 4.2: Set on ctx + emit outbound `X-Request-Id` header.
  - [ ] Subtask 4.3: Write 4+ tests.

- [ ] Task 5: Augment `types/hono.d.ts` (AC #6)
  - [ ] Subtask 5.1: Add `requestId: string` to ContextVariableMap.

- [ ] Task 6: Mount middleware in `src/app.ts` (AC #7)
  - [ ] Subtask 6.1: Insert `app.use('*', requestIdMiddleware)` BEFORE the CSRF mount.

- [ ] Task 7: Migrate callsites (AC #8, #9, #10)
  - [ ] Subtask 7.1: `index.ts` startup log → `logger.info` (the module-level singleton; NO request context at boot).
  - [ ] Subtask 7.2: `auth.ts` 4 helpers → inline `c.get('logger').error(...)` / `.warn(...)` calls. The child logger on ctx already carries `requestId`; do NOT pass it again.
  - [ ] Subtask 7.3: `require-session.ts` — drop local `randomUUID()`; read `requestId` from `c.get('requestId')` (set by the new middleware).
  - [ ] Subtask 7.4: `require-organizer.ts` middleware-misuse → `c.get('logger').error({ msg: '...' })`.

- [ ] Task 8: ESLint rule (AC #12)
  - [ ] Subtask 8.1: Add `no-console` rule to `apps/tournament-api/eslint.config.js`.
  - [ ] Subtask 8.2: Add the exact file-override block from AC #12 covering `src/port.ts` + `src/db/migrate.ts` + `src/db/seed.ts`. No dev-judgment decision remains; AC #12 specifies all three paths as overrides.

- [ ] Task 9: Update T1-6b `console.error` spy (AC #18)
  - [ ] Subtask 9.1: Re-target the unknown-error-branch spy from `console.error` to `logger.error`.

- [ ] Task 10: Run regressions (AC #13, #14, #15)
  - [ ] Subtask 10.1: `pnpm -F @tournament/api test` → ≥71.
  - [ ] Subtask 10.2: `pnpm -r typecheck` + `pnpm -r lint` → 0.
  - [ ] Subtask 10.3: Wolf Cup engine/api tests → counts unchanged.

## Dev Notes

- **Why pino, not bunyan / winston / a custom logger.** pino is the default JSON logger for Node.js server code as of 2024+. It's faster than bunyan/winston by 5-10x on thenched benchmarks, and its JSON output format is already what docker log aggregators expect. Bunyan is unmaintained. Winston's transports pattern is flexible but heavier than we need for the 8-player Pinehurst event. Hand-rolling a logger over `console` would duplicate pino's escaping + levels + transports for no benefit. Architecture §Monitoring already names pino as the candidate.

- **Why pino-roll, not logrotate.** `logrotate` is a system-level tool; inside a docker container that's ephemeral per restart, relying on it means a second moving part (either crontab inside the container or a sidecar). pino-roll handles rotation in-process — simple, one dep, zero system config. For our scale (daily log files, low write volume) this is overkill-proof: rollover timing is exact and survives container restarts because filename pattern includes the date.

- **Startup log ordering risk.** The `logger.info` at server boot (`index.ts` line 9 replacement) is the first thing that writes to the log file sink. pino-roll's `mkdir: true` handles the `/app/data/logs/` directory creation on that first write. If the volume isn't mounted or permissions are wrong, pino-roll will throw (EACCES or similar) at the first write — which is the correct fail-loud behavior. The container won't start, operator gets an immediate signal.

- **Why no new volume mount.** Spec risk-acceptance section covers this. Choosing `/app/data/logs/` under the existing `tournament_sqlite_data` volume saves a SHARED gate.

- **File log vs. stdout priority.** stdout is the primary audit surface (captured by docker log driver + any centralized logging the VPS runs). The file log is defense-in-depth for cases where docker stdout is truncated, rotated, or the operator wants a local grep target. Both destinations receive the SAME JSON lines — no divergence, no priority.

- **Request-id format.** UUIDv4 via `crypto.randomUUID()` is the default. We accept inbound `X-Request-Id` from clients (for end-to-end tracing across web → api) but validate shape before passing through to logs — the regex `/^[A-Za-z0-9_.-]{1,128}$/` is a safe superset that accepts UUID, ULID, and common opaque-id shapes while rejecting control characters and separator delimiters.

- **ESLint `no-console` vs. the existing code.** The tournament-api currently has 6 `console.*` call-sites outside auth.ts: `require-organizer.ts:26`, `port.ts:25,30`, `migrate.ts:14`, `index.ts:9`, `seed.ts:11`. AC #12 covers them all. Three files — `port.ts`, `migrate.ts`, `seed.ts` — are file-exempted via the override block in AC #12: `port.ts` because its `console.warn` runs before env.ts (logger unavailable); `migrate.ts` and `seed.ts` because they are short-lived CLI entrypoints where pino transport overhead adds no value. `require-organizer.ts` and `index.ts` are NOT exempted — they migrate to `logger.*` per AC #7 and AC #10.

- **Test isolation for file sinks.** The file-sink probe in `log.test.ts` needs a writable tmpdir different from any real-world path. Use node's `os.tmpdir()` + a random subfolder created via `mkdtempSync()` in `beforeEach`, set `LOG_DIR` to that, and `vi.resetModules()` + re-import `log.ts`. After the test, `rmSync(dir, { recursive: true, force: true })`. This mirrors the prod-env test in `oauth-cookies.test.ts`.

- **Wolf Cup isolation (FD-1/FD-2).** T1-7 writes under `apps/tournament-api/**` only, plus ONE SHARED edit — pnpm-lock.yaml via `pnpm install`. Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, and notably **no docker-compose.yml change** (the file-log path falls under the existing volume mount).

- **Post-T1-7 Epic T1 status.** This story closes Epic T1. After commit, sprint-status.yaml should show 7-of-7 T1 stories `done`. The optional epic retrospective (`epic-T1-retrospective: optional`) is the only T1 item left; choosing to run it or skip is a separate user decision after this story lands.

### Project Structure Notes

Shape after T1-7:
```
apps/tournament-api/
  package.json            # MODIFIED: +pino, +pino-roll deps
  eslint.config.js        # MODIFIED: +no-console rule + file override
  src/
    app.ts                # MODIFIED: +requestIdMiddleware mount
    index.ts              # MODIFIED: startup console.log → logger.info
    lib/
      env.ts              # MODIFIED: +LOG_LEVEL + LOG_DIR keys
      log.ts              # NEW (pino singleton)
      log.test.ts         # NEW (4+ tests incl. file-sink probe)
    middleware/
      request-id.ts       # NEW (requestIdMiddleware)
      request-id.test.ts  # NEW (4+ tests)
      require-session.ts  # MODIFIED: drop randomUUID, read ctx.requestId
      require-organizer.ts # MODIFIED: replace console.error
    routes/
      auth.ts             # MODIFIED: 4 helpers replaced with logger.*
      auth.test.ts        # MODIFIED: spy re-targeted to logger.error
    types/
      hono.d.ts           # MODIFIED: ContextVariableMap + requestId
pnpm-lock.yaml            # MODIFIED (SHARED, +pino/pino-roll + transitives)
```

**Explicitly NOT in T1-7 (reserved for future):**
- Remote log shipping (OpenTelemetry, Datadog, Papertrail) — out of scope per epic "no external monitoring service v1."
- Log sampling / rate limiting — premature optimization at 8-player scale.
- Log retention / archival cleanup — pino-roll's size cap prevents unbounded growth; manual cleanup is operator's job until proven otherwise.
- Log correlation with Wolf Cup's API — tournament and Wolf Cup are separate processes with separate log streams. Cross-process correlation comes later if needed.

### References

- T1-6a shipped: env.ts (extended here), app.ts CSRF (req-id middleware mounts BEFORE csrf).
- T1-6b shipped: `console.error(JSON.stringify(...))` helpers in auth.ts that T1-7 replaces.
- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 546-568 (4 ACs).
- NFR-O1: structured JSON logs, append-only daily file + console.
- D3-6: requestId in response body's error payload (already honored in T1-6a middleware error responses; T1-7 centralizes the generation).
- Architecture §Monitoring: `_bmad-output/planning-artifacts/tournament/architecture.md` lines 189-192 (pino candidate).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
