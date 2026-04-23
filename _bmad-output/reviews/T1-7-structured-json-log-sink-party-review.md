# T1-7 Party-Mode Review — Structured JSON Log Sink

**Story:** `_bmad-output/implementation-artifacts/tournament/T1-7-structured-json-log-sink.md`
**Mode:** Single non-interactive written pass — analyst, architect, pm, qa, dev.
**Date:** 2026-04-23
**Implementation status:** All 18 ACs implemented; codex spec round 5 PASS; codex impl round 3 PASS with 1 Low addressed; tournament-api 63 → 73 tests (+10 net), workspace typecheck + lint clean, Wolf Cup engine 468/468 + api 494/494 unchanged.

---

## 📊 Mary — Business Analyst

*Hunting for missed ACs and user-flow gaps — this story closes Epic T1.*

**AC coverage:** every one of the 18 ACs maps to a concrete artifact.

| AC band | Artifact |
| --- | --- |
| #1 (pino + pino-roll deps) | `apps/tournament-api/package.json` lines 18-19. ✅ |
| #2 (log.ts singleton + loggerOptions split) | `src/lib/log.ts` + `src/lib/log-options.ts`. ✅ |
| #3 (canonical filename regex) | `/^tournament\.\d{4}-\d{2}-\d{2}\.\d+\.log$/` — codified in the pino-roll contract test. ✅ |
| #4 (env.ts LOG_LEVEL + LOG_DIR transform) | env.ts lines 82-102. ✅ |
| #5 (requestIdMiddleware) | `src/middleware/request-id.ts` — reads/generates, sets ctx + child logger, emits outbound. ✅ |
| #6 (hono.d.ts augmentation) | `src/types/hono.d.ts` lines 1, 22-23. ✅ |
| #7 (app.ts mount BEFORE csrf) | app.ts line 15. ✅ |
| #8 (index.ts startup log) | `logger.info({ port, msg: 'Tournament API listening' })`. ✅ |
| #9 (auth.ts 4 helpers → inline logger calls) | `auth.ts` — helpers dropped, 4 inline `c.get('logger').*` calls. ✅ |
| #10 (require-session + require-organizer) | Both read `requestId` from ctx; require-organizer has a module-logger fallback for middleware-chain misuse. ✅ |
| #11 (≥8 tests across log + request-id) | 5 in log.test.ts + 5 in request-id.test.ts = 10 new tests. ✅ |
| #12 (ESLint no-console + file overrides) | eslint.config.js lines 20-32. ✅ |
| #13 (≥71 tournament-api total) | 73 tests. ✅ |
| #14 (workspace typecheck + lint) | Both exit 0. ✅ |
| #15 (Wolf Cup regression) | 468/468 + 494/494 unchanged. ✅ |
| #16 (deploy fail-fast on missing LOG_DIR) | post-parse transform resolves to `/app/data/logs` in prod — no missing-value scenario. ✅ |
| #17 (post-deploy smoke) | Documented; operator-facing. ✅ |
| #18 (T1-6b spy re-target) | `vi.spyOn(process.stdout, 'write')` on the sonic-boom write path. ✅ |

**Observation — the pino-roll filename discovery was a spec-drift catch.** The original spec AC #3 said `/^tournament\.\d{4}-\d{2}-\d{2}\.log$/`, but the actual pino-roll@4 output includes a rotation-number segment: `tournament.2026-04-23.1.log`. The filename-contract test caught this during impl round 2 — a real library-behavior contract that the spec had assumed wrongly. Spec + test + AC #17 all updated to the true pattern. Good catch.

**Observation — log-format compatibility with external aggregators.** The emitted JSON shape — `{ts, level, msg, requestId, ...context}` — is grok-parseable by every mainstream log aggregator (Loki, Papertrail, Datadog, ELK). If Josh ever ships tournament logs to an external service, the parser config is one `json` parser line. No format migration needed.

**Observation — `requestId` in the error response body.** D3-6 mentions requestId should be on error responses. Currently tournament-api's middleware error responses (401 session_missing, etc.) already include `requestId` in the JSON body — that was done in T1-6a. T1-7 doesn't break that contract; it just changes WHERE the UUID originates (ctx-set by middleware vs. locally generated). Good.

**Gap flagged for a future story (NOT blocking):** the `X-Request-Id` response header emits the requestId to the client, but the client (tournament-web) doesn't yet display it in error surfaces. When tournament-web adds error toasts (part of T8 activity spine), including the requestId in the user-facing "something went wrong" banner would let Josh correlate a user report to a specific log line instantly. Not in scope for T1-7 — noted here for T8 backlog.

**Verdict (analyst):** No AC missed. Spec-drift was caught and corrected mid-cycle. Ship.

---

## 🏗️ Winston — Architect

*Calm pragmatism on the logging architecture.*

**NFR-O1 compliance:** the story closes the "structured JSON log sink" requirement exactly as the PRD specified — daily-rotated append-only file + stdout mirror, JSON lines, request correlation. No remote observability dependency (explicit non-goal per architecture §Monitoring).

**Module-layer structure:** clean separation.
- `log-options.ts` (pure, no side effects) — pino config only.
- `log.ts` (side-effectful) — awaits pino-roll at top level, exports singleton.
- `middleware/request-id.ts` — per-request id generation + child logger.

The split between `log-options.ts` and `log.ts` was driven by a codex round-1 HIGH finding: tests importing `loggerOptions` from `log.ts` triggered the top-level pino-roll await, which opened files on the real filesystem. By moving the pure config to its own module, test imports stay side-effect-free. This is a textbook application of "separate pure from impure" module design.

**Request-id flow:** middleware mounts FIRST on the Hono chain, guaranteeing every downstream middleware and handler has `c.get('requestId')` and `c.get('logger')` available. The child-logger pattern (`logger.child({ requestId })`) is pino-idiomatic and binds requestId to every subsequent log call without per-site threading. Handlers can't forget to include requestId — the binding is automatic.

**Dependency on Wolf Cup:** ZERO. tournament-api's logger is its own singleton; Wolf Cup has its own logging (currently `console.log`) that T1-7 does not touch. FD-1/FD-2 boundary preserved.

**Failure modes:**

- **`env.LOG_DIR` unwritable at boot:** pino-roll's await rejects → module load fails → container crash at boot. Fail-fast, exactly the desired behavior.
- **File sink fills (100m cap):** pino-roll rotates with a new numeric suffix. Daily rotation + size cap = hard upper bound on single-file growth. Disk-exhaustion mitigation: operator's job; no in-app cleanup.
- **stdout sink backpressure:** docker's log driver handles this. If docker log driver fills, pino's multistream drops writes silently on the stdout path. File sink is still written (defense-in-depth).
- **Request-id middleware unavailable (chain misuse):** require-organizer has an explicit `c.get('logger') ?? moduleLogger` + `c.get('requestId') ?? randomUUID()` fallback. Logs still emit, response still carries a correlation id. Failure is loud but recoverable.

**Integration with future T1 exit criteria:** epic exit includes "at least one log line with `level: 'info'` produced at startup" — satisfied by the `logger.info({...msg: 'Tournament API listening'})` at index.ts boot. Also satisfies the "Structured JSON log file present" clause — pino-roll creates the file on first write.

**Minor architectural nit (not blocking):** the `@ts-expect-error — pino-roll ships no types` suppression in `log.ts` is a maintenance debt. When pino-roll eventually ships types (or we upgrade to a version that does), the suppression can be removed. Acceptable for now — ambient-module declarations or local `.d.ts` shims would be architectural overhead for one import site.

**Verdict (architect):** No layering errors, no boundary violations, fails-fast correctly, forward-compatible with future log-aggregation stories. Ship.

---

## 📋 John — Product Manager

*Scope + schedule detective work.*

**Scope discipline:** T1-7 stayed clean. Zero reaches into T2 (course library) or T3 (events). The only "stretch" item — replacing Wolf Cup's `console.*` calls — was explicitly NOT done (FORBIDDEN boundary). That's the right call.

**SHARED gate count:** 1 (pnpm-lock.yaml). Under budget; the spec's "no docker-compose.yml change" decision held because LOG_DIR's default lives in env.ts.

**Epic T1 exit status:** T1-7 was the LAST story. After commit, Epic T1 is **7-of-7 done**. Epic T1 exit criteria from the PRD:

- ✅ Root path of `tournament.dagle.cloud` loads sign-in surface over HTTPS (T1-4 + T1-6a + T1-6b)
- ✅ Wolf Cup test suite passes unchanged (regression-verified every story)
- ✅ CI dual-run pipeline exists (T1-5)
- ✅ Structured JSON log file present at the expected path with at least one `level: 'info'` line at startup (T1-7 — this story)

All met. Epic T1 is closeable.

**Pinehurst schedule impact:** Josh's target is 2026-05-07 (14 days from today, 2026-04-23). Remaining critical-path to a functional tournament app:

| Item | Stories | Estimate |
| --- | --- | --- |
| Epic T2 — course library | T2-1 (schema), T2-2 (Pinehurst seed + API), T2-5 (admin UI) | ~2-2.5 work days |
| Epic T3 core — events + groups + permissions + invites | T3-1 (schema), T3-2 (creation wizard), T3-3 (group CRUD), T3-6 (invite flow), T3-8 (permissions middleware) | ~3-4 work days |
| Epic T4 — pairings suggest + UI | T4-1 (engine), T4-2 (UI) | ~1-1.5 work days |
| Epic T5 core — scoring + offline queue + leaderboard | T5-1 (schema), T5-2 (scorer UI), T5-3 (offline queue), T5-5 (leaderboard), T5-6 (single-writer) | ~2-3 work days |
| Buffer + integration + smoke | — | ~2 days |

Total ~10-13 work days. Against a 14-day window that includes weekends, this is **tight but feasible** IF the no-shortcuts cadence holds and T2.3 (PDF parser) is deferred per spec.

**Deferred items now documented:**

- T2.3 PDF vision parser — target-miss-tolerable (manual-entry path via T2.5 covers the gap).
- T3-4 GHIN client — useful but not blocking for Pinehurst scoring.
- T3-9 / T3-10 — sub-game opt-in + GHIN enrichment, nice-to-have.
- T6 full money/bets engine — needed for Friday league (Guyan) but not Pinehurst.
- T7 player-experience polish — event home, photo gallery, etc.
- T8 activity spine — nice for UX but not blocking.
- T9 pre-event validation — 9-hole live drill before the trip.

**PM-level risk callout (NOT blocking T1-7, relevant to schedule):** the optional epic-T1 retrospective (`epic-T1-retrospective: optional` in sprint-status) is still flagged. Running it adds time but would capture lessons learned across the 7 stories (including the codex-catches-real-bugs pattern seen in T1-6b and T1-7). Recommend deferring unless Josh explicitly wants the retrospective artifact — the lessons are already preserved in the per-story codex reports.

**Verdict (PM):** Scope clean, schedule tracking, Epic T1 closeable. Ship + gate on epic-completion.

---

## 🧪 Quinn — QA Engineer

*Pragmatic coverage check.*

**New tests added by T1-7:**

| File | Tests | What's exercised |
| --- | --- | --- |
| `log.test.ts` | 5 | JSON shape (ISO ts, string level, no pid/host), child-logger binding, custom context passthrough, pino-roll filename regex, level filter |
| `request-id.test.ts` | 5 | UUID generation on absent header, valid-header reuse, malformed-header rejection, outbound header emission, child-logger ctx binding |

Total net: +10 new tests (was 63 → 73).

**Coverage per AC #11 contract:**

- Log config shape asserted against a controlled Writable stream ✅ (sonic-boom's fd-1 write bypasses `process.stdout.write`, so direct stdout spying wasn't reliable; the stream-injection approach is the right workaround).
- Child logger bindings verified via `logger.bindings()` (pino's own API for reading bound fields) ✅.
- pino-roll filename contract tested against a real pino-roll invocation in a tmpdir ✅ — the `.{n}.log` rotation-number discovery happened here.
- Level filter asserted via `trace`/`debug`/`info` calls ✅.
- Middleware chain: request-id + require-session/require-organizer tests wrap the middleware under a Hono app that includes `requestIdMiddleware` — matches production flow ✅.

**Test quality callouts:**

- **Deterministic flush pattern:** the pino-roll filename-contract test uses bounded timeout + event-based wait rather than `setTimeout(N)` as a flush mechanism. Codex round 1's MED finding on flakiness is properly addressed.
- **Windows file-handle release:** the filename-contract test closes the SonicBoom stream via `'close'`/`'finish'` events (with a 500ms bounded timer) before `rmSync` so NTFS doesn't throw EBUSY. Addresses codex round 2 MED.
- **Flush indefinite-hang safety:** `stream.flush(cb)` wrapped with a 500ms timer fallback — covers pino-roll/SonicBoom version drift where the callback may not fire. Addresses codex round 3 LOW.
- **Test isolation:** each log.test.ts test uses a per-test Writable stream captured by closure. No cross-test contamination.

**Edge cases NOT tested but acceptable:**

- Log rotation on size cap (100m). Size-based rotation is pino-roll's contract; exercising it would require generating 100MB of log lines in a test. Out of scope.
- Log rotation across midnight boundary. Same reasoning — library contract, not our responsibility.
- File-sink unwritable at boot. The spec's failure-mode documentation + pino-roll's `mkdir: true` cover this; an explicit test would require mocking fs permissions.

**Regression guard:**

- Wolf Cup engine: 468/468 (Δ=0) ✅
- Wolf Cup api: 494/494 (Δ=0) ✅
- Tournament-api started this story at 63 (from T1-6b); now 73 (+10).

No flakiness observed across local runs. CI pipeline will confirm on push.

**Verdict (QA):** Coverage matches the AC #11 contract. Spec-drift catch (filename regex) is now codified in a contract test. Ship.

---

## 💻 Amelia — Developer Agent

*File paths + AC IDs, terse.*

**`log.ts` + `log-options.ts` split:** clean separation. The side-effect module (`log.ts`) awaits pino-roll once at module boot; the pure module (`log-options.ts`) carries only the config object. Tests that need the config shape import from `log-options.ts` — no tmpdir dance, no fs writes.

**`requestIdMiddleware` (`request-id.ts:26-39`):** 14 lines total. Reads inbound header → validates against `/^[A-Za-z0-9_.-]{1,128}$/` → falls back to `randomUUID()` on miss-or-malformed. Sets `requestId` + `logger.child({ requestId })` on ctx. Emits outbound `X-Request-Id`. No branches beyond the validation regex.

**Callsite migration (auth.ts, require-session.ts, require-organizer.ts, index.ts):**

- `auth.ts` — dropped 4 named log helpers; replaced with 4 inline `c.get('logger').error({event, ...})` / `.warn({...})` calls. Each call site is now 5-10 lines of local context rather than a function call + function definition at the bottom of the file. More readable.
- `require-session.ts` — dropped `randomUUID()` import + local generation; reads `c.get('requestId')`. Existing `sessionCookieHeader(null)` clears on auth failure unchanged.
- `require-organizer.ts` — swapped `console.error` → `c.get('logger').error`, added graceful fallback to module logger + local UUID for the middleware-chain-misuse case (double-misuse: both request-id and require-session missing).
- `index.ts` — startup `console.log` → `logger.info({port, msg: 'Tournament API listening'})`. Emits one `level: 'info'` line at boot as epic AC #1 requires.

**ESLint no-console + overrides (`eslint.config.js:33-42`):** the rule prevents regression. Overrides exempt `port.ts` (pre-env parse), `migrate.ts` + `seed.ts` (short-lived CLI entrypoints). Test files are NOT exempt — `vi.spyOn(console, 'error')` is a plain identifier-plus-argument expression and doesn't trigger the rule.

**Typing:**

- `hono.d.ts` imports `Logger` from pino (line 1) and augments `ContextVariableMap` with `requestId: string` + `logger: Logger` (lines 22-23). Any `c.get('logger')` call is type-correct without `as any`.
- `env.ts` uses `.transform()` to resolve LOG_DIR to a guaranteed string; `Env` type is inferred from the transformed schema.
- `log.ts` has one `@ts-expect-error` for pino-roll's missing types. Documented inline with rationale.

**Logging shape consistency:** every `logger.*()` call uses the pattern `{msg, event, ...context}`. Future log aggregator parsing is uniform. The T1-6b log-helper shape is preserved (`event`, `requestId`, contextual fields) even though the helpers themselves are gone.

**Minor dev notes:**

- The `extractCookie` helper in auth.ts is still duplicated from require-session.ts per the "no refactor beyond task" rule. T1-7 didn't touch it — that promotion remains a future-story concern.
- The unknown-error-branch log in auth.ts still destructures the error with manual type narrowing (`e?.message ?? null`, etc.) — pino would serialize `Error` instances directly via its `err` serializer, but the inline object shape matches T1-6b's original log format. Correct choice for log-format stability.
- Tests added use the same `vi.stubEnv` + `vi.resetModules` + re-import pattern from `oauth-cookies.test.ts` — consistent with the codebase's established test patterns.

**Maintenance debt introduced:**

- `@ts-expect-error` for pino-roll (1 site, commented).
- 500ms bounded-timer fallbacks in the test file for SonicBoom stream close + flush — library-version resilience, not a real concern.

**Verdict (dev):** Readable, idiomatic, forward-compatible. No anti-patterns. Ship.

---

## 🎯 Verdict

**Ship as-is.** All 18 ACs implemented. Codex spec 5 rounds + codex impl 3 rounds both PASS. The spec-drift catch on pino-roll's filename regex was corrected via a dedicated contract test that will prevent future regressions. The module-split (`log.ts` + `log-options.ts`) resolves the test-isolation concern cleanly. Wolf Cup regression-clean, workspace-wide typecheck + lint clean. **Epic T1 is now 7-of-7 done — all structural foundations for the tournament app are in place**; Pinehurst path unblocks Epic T2 course library work immediately.
