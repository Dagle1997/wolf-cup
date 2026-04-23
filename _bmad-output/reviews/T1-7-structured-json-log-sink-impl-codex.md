# Codex Review

- Generated: 2026-04-23T15:54:47.594Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/package.json, apps/tournament-api/eslint.config.js, apps/tournament-api/src/app.ts, apps/tournament-api/src/index.ts, apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/lib/log.ts, apps/tournament-api/src/lib/log.test.ts, apps/tournament-api/src/middleware/request-id.ts, apps/tournament-api/src/middleware/request-id.test.ts, apps/tournament-api/src/middleware/require-organizer.ts, apps/tournament-api/src/middleware/require-organizer.test.ts, apps/tournament-api/src/middleware/require-session.ts

## Summary

Core wiring (pino deps, env defaults, request-id middleware mounted before CSRF, console→logger in index.ts, middleware updated to read ctx requestId) looks directionally correct. The biggest concrete risk in the provided code is that `src/lib/log.ts` has top-level side effects (top-level `await pinoRoll(...)`) in the same module that exports `loggerOptions`; importing `loggerOptions` in tests still initializes the real file sink, undermining the stated test strategy and potentially making tests/environment setup flaky. Some acceptance-criteria aspects (canonical filename regex, pino-roll integration) aren’t actually exercised by the shown tests.

Overall risk: medium

## Findings

1. [high] Importing `loggerOptions` still triggers real pino-roll file sink initialization (top-level await side effect), undermining test isolation and can cause flakiness/FS writes in unit tests
   - File: apps/tournament-api/src/lib/log.ts:31-67
   - Confidence: high
   - Why it matters: The tests import `loggerOptions` from `./log.js` (see `src/lib/log.test.ts:4`), but `log.ts` performs `await pinoRoll(...)` at module top level (lines 53-60) and constructs the multistream/logger (lines 62-67). This means any import of `loggerOptions` (even if you never use the exported `logger`) will still: (1) attempt to create/mkdir `env.LOG_DIR`, (2) open a rotating file stream, and (3) potentially fail module evaluation if the directory is unwritable. That directly contradicts the test commentary claiming it avoids file-sink integration and avoids timing/flakiness. It also reintroduces the earlier “module caching writes to ./data/logs” class of problems because the real sink is still created.
   - Suggested fix: Split configuration from side effects: move `loggerOptions` into a separate module (e.g., `log-options.ts`) with no top-level await; have `log.ts` import options and lazily/conditionally create the pino-roll stream only when `logger` is needed. Alternatively export a `createLogger({ destination })` factory for tests and keep the singleton creation in a module that tests don’t import.

2. [medium] Middleware now assumes request-id middleware always ran; calling `c.get('logger').error(...)` can throw if used without the global mount
   - File: apps/tournament-api/src/middleware/require-organizer.ts:23-30
   - Confidence: medium
   - Why it matters: `requireOrganizer` logs via `c.get('logger').error(...)` (line 28) and returns JSON including `requestId` read from ctx (line 24). If a developer mounts `requireOrganizer` in a context that doesn’t include `requestIdMiddleware` (or during isolated testing/other entrypoints), `c.get('logger')` may be undefined and this will throw, turning a controlled 500 into an unhandled exception (and potentially losing the intended JSON error shape). Your unit tests were updated to mount `requestIdMiddleware`, but the code itself is now brittle when reused outside the main app chain.
   - Suggested fix: Consider a defensive fallback: `const log = c.get('logger') ?? logger.child({ requestId })` (importing the singleton) and `const requestId = c.get('requestId') ?? randomUUID()` if absent. If you want to keep the hard requirement, add an explicit guard that returns a deterministic error without throwing when `logger` is missing.

3. [medium] Acceptance criteria around canonical log filename regex/pino-roll integration isn’t verified by shown tests; risk of separator mismatch (dot vs hyphen) going unnoticed
   - File: apps/tournament-api/src/lib/log.ts:53-60
   - Confidence: medium
   - Why it matters: AC #3 requires a canonical regex `/^tournament\.\d{4}-\d{2}-\d{2}\.log$/`. The configuration intends to produce that (`file: .../tournament`, `dateFormat: 'yyyy-MM-dd'`, `extension: '.log'`), but the provided tests never assert the actual file naming behavior or that pino-roll is wired as expected (they only validate `loggerOptions` shape). If pino-roll uses a different separator (e.g., `tournament-YYYY-MM-DD.log`) or changes behavior across versions, you’d fail an explicit AC without detection until deployment.
   - Suggested fix: Add a focused integration test that stubs LOG_DIR to a temp dir, imports the real singleton logger, writes one line, flushes, and asserts exactly one file matching the regex exists and contains the line. If module-caching is the issue, isolate via `vi.isolateModules()` (or a dedicated node subprocess test) so each test gets a fresh module graph.

4. [low] LOG_DIR accepts whitespace-only strings; can create confusing paths/directories
   - File: apps/tournament-api/src/lib/env.ts:87-100
   - Confidence: high
   - Why it matters: `LOG_DIR` is `z.string().min(1).optional()` (line 90) but doesn’t reject whitespace-only values like `'   '`. If set accidentally (e.g., compose env mishap), it will be treated as a real directory name and `pino-roll` with `mkdir: true` will attempt to create it. This is more of an operational footgun than a security issue.
   - Suggested fix: Mirror the `DB_PATH` refinement: `.refine((v) => v.trim().length > 0, 'LOG_DIR must not be whitespace-only')` (and possibly `.transform((v) => v.trim())` if you want to allow surrounding whitespace).

## Strengths

- Request-id middleware is mounted before CSRF in `app.ts` (apps/tournament-api/src/app.ts:11-23), matching the requirement that all downstream middleware/handlers can access `requestId` and the request-scoped logger.
- Request-id input validation uses a strict allowlist (`/^[A-Za-z0-9_.-]{1,128}$/`) and tests cover multiple malformed cases (apps/tournament-api/src/middleware/request-id.ts:29-37; request-id.test.ts:43-69).
- Logger output shaping requirements are explicitly asserted in tests: ISO timestamp format, string level, and `base: null` removing pid/hostname (apps/tournament-api/src/lib/log.test.ts:44-60).
- The middleware changes to thread `requestId` via ctx (no per-call-site UUIDs) are consistent in the provided files (`require-session.ts` and `require-organizer.ts`).

## Warnings

None.
