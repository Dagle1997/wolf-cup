# Epic T1 Retrospective — Tournament Foundation

**Date:** 2026-04-23
**Epic:** T1 — Tournament Foundation (7 stories)
**Status:** complete
**Format:** Written artifact (non-interactive). All observations cite specific commits, codex reports, or story files.

---

## Epic summary

| Metric | Value |
| --- | --- |
| Stories completed | 7 of 7 |
| Local commits in this epic | 18 (tournament prefix), local-only — unpushed |
| First commit | `cc5e650` (T1-1 / T1-2, 2026-04-19) |
| Last commit | `09263af` (T1-7 done flip, 2026-04-23) |
| Tournament-api tests | 0 → 73 (+73 net from scratch) |
| Wolf Cup engine tests | 468/468 maintained throughout (Δ 0) |
| Wolf Cup api tests | 494/494 maintained throughout (Δ 0) |
| SHARED-gate approvals | 5 total (2 docker-compose, 3 pnpm-lock), all explicit |
| Path-allowlist violations | 0 (no FORBIDDEN edits) |

## Stories delivered

| Key | Title | Commit(s) | Notable |
| --- | --- | --- | --- |
| T1-1 | CLAUDE.md disambiguation note | `cc5e650` → retroactive `6597dd0` | Retroactive party-review found 1 Med, resolved via addendum |
| T1-2 | Scaffold tournament-api | `cc5e650` → retroactive `e40320f` | Resolved `resolvePort` parseInt permissiveness via 18 new unit tests; extracted to `src/port.ts` |
| T1-3 | Scaffold tournament-web | `c6fbdcf` | Vite + React + TanStack Router clean scaffold |
| T1-4 | docker-compose + Traefik for tournament.dagle.cloud | `2acc3aa` | First SHARED-gate exercise; tournament_sqlite_data volume established |
| T1-5 | CI dual-run pipeline | `8d68010` | Wolf Cup CI still red pre-existing at `standings.tsx:480` — FORBIDDEN path, fixed later outside Epic T1 |
| T1-6a | Auth schema + middleware + env | `45a056c` | players + oauth_identities + sessions schema + require-session/require-organizer; 38 tests |
| T1-6b | Arctic Google SSO | `7f11dbe` + `7f6a081` | Spec codex 10 rounds converged; impl codex round 1 caught drizzle-wraps-libsql UNIQUE-error bug |
| T1-7 | Structured JSON log sink | `58ca9a4` + `09263af` | pino + pino-roll + request-id middleware; caught spec-drift on pino-roll filename regex |

---

## What went well

### 1. Codex-review-at-every-phase caught real bugs

The per-story codex cadence (spec → impl → party → party-codex) surfaced bugs that would have shipped silently without it. Concrete examples:

- **T1-2 round 2 (Med → Fix):** `resolvePort` used `parseInt` which accepts `'3001abc'` as 3001. Codex flagged; fix was a `/^\d+$/` regex guard + 18 new unit tests. The port.ts extraction is now a stable utility.
- **T1-6b round 1 (High → Fix):** the `isUniqueConstraintError` predicate looked for `err.name === 'LibsqlError'` directly. But drizzle 0.45 wraps libsql errors in `DrizzleQueryError` (`name: 'Error'`) with the real `LibsqlError` on `err.cause`. Every UNIQUE-violation race would have returned 500 instead of retrying. Pinned by a unit test that triggers a real UNIQUE and asserts the exact shape.
- **T1-7 round 1 (Med → Fix + spec correction):** the pino-roll filename-contract test revealed that pino-roll@4 emits `tournament.{date}.{n}.log` with a rotation-number segment, not the spec's assumed `tournament.{date}.log`. Spec AC #3 + #11 + #17 were corrected; the test now codifies the true contract.
- **T1-7 round 1 (High → Fix):** importing `loggerOptions` from `log.ts` triggered the top-level pino-roll await, opening file handles during unit tests. Split into `log-options.ts` (pure) + `log.ts` (side-effectful).

The pattern **"codex flags, you trace the actual behavior, you update the spec if reality differs"** worked repeatedly and is worth carrying forward.

### 2. SHARED-gate discipline

Every SHARED edit (pnpm-lock.yaml, docker-compose.yml) triggered an explicit director gate → user approval → then the edit. No batch approvals across stories. Each approval was scoped to the named file(s) for that story only.

Five SHARED approvals across T1:
- T1-4: docker-compose.yml (tournament-api service + volume).
- T1-6a: docker-compose.yml (+2 env vars: `AUTH_COOKIE_DOMAIN`, `PUBLIC_APP_URL`).
- T1-6b: pnpm-lock.yaml + docker-compose.yml (+2 env vars: Google OAuth).
- T1-7: pnpm-lock.yaml (pino + pino-roll deps).

### 3. Wolf Cup boundary held absolutely

Across 7 stories and 18 commits, **zero writes** to `apps/api/**`, `apps/web/**`, `packages/engine/**`, or `_bmad-output/implementation-artifacts/sprint-status.yaml`. FD-1/FD-2 isolation is honored by the toolchain + workflow forks.

Wolf Cup's pre-existing CI failure at `standings.tsx:480` (TS2322 under `noUncheckedIndexedAccess`) remained red for 5 consecutive GHA runs; the tournament director flagged it in the story file's followups rather than cross-working. It was later fixed outside Epic T1 (as part of the CTP per-par-3 work that shipped in parallel to Wolf Cup).

### 4. Test-pattern stabilization

Three reusable patterns emerged and are now idiomatic in tournament-api:

1. **DB-touching tests:** `vi.mock('../db/index.js', ...)` with a shared in-memory libsql client + `migrate(db, { migrationsFolder })` in `beforeAll`. First established in T1-6a's `session.test.ts`; reused in every DB-touching test since.
2. **Prod-env branch testing:** `vi.resetModules()` + `vi.doMock('./env.js', ...)` + re-import. Used in `session.test.ts`, `oauth-cookies.test.ts`, `auth.test.ts` (prod cookie attributes).
3. **Middleware-wrapped router tests:** when a handler reads from `c.get('requestId')` or `c.get('logger')`, tests wrap the handler under a Hono app that mounts `requestIdMiddleware`. Established in T1-7 when adapting T1-6a's middleware tests.

### 5. Explicit risk acceptance on RS256

T1-6b's spec documented a thorough threat model for SKIPPING signature verification on Google id_tokens. The argument: signature verification via dynamically-fetched JWKS is theater under sustained TLS-trust compromise and a cache-timing lottery under transient compromise; only preloaded/pinned JWKS provides full defense, and Google discourages pinning. Narrow consume-and-derive-sub flow + 8-player private event makes the marginal benefit not worth the cost. Revisit triggers are concrete and testable.

This is the kind of honest risk-accepted-with-evidence decision that prior architectural reviews tend to bury or punt on. Keeping it in the spec itself rather than a separate ADR means the decision is co-located with the code that implements it.

### 6. Sibling-app build/deploy tooling just worked

Docker-compose brought up both Wolf Cup and Tournament containers cleanly. Traefik routes `wolf.dagle.cloud` and `tournament.dagle.cloud` to separate services with matching TLS certs. Build stage mirrors Wolf Cup's shape. No custom glue required.

---

## What was painful or recurring

### 1. Pino + sonic-boom: stdout-write spies don't work

First attempt at log.test.ts (T1-7) used `vi.spyOn(process.stdout, 'write')` to capture log output. Pino's sonic-boom writes directly to fd 1, bypassing the spy. Also the module-caching interaction with top-level await produced multiple log.ts initializations with drift.

**Resolution:** split log.ts into a pure `log-options.ts` (exports config only) + side-effectful `log.ts` (awaits pino-roll). Tests build their own logger against a controlled Writable stream using the same options. File-sink verification uses a dedicated pino-roll probe test.

**Carry-forward:** sonic-boom-backed transports can't be observed via stdout spies. Tests should inject their own writable stream against the exported options. Or, for integration-style file verification, use a tmpdir + bounded readback.

### 2. Drizzle error-wrapping depth

Drizzle 0.45 wraps driver errors in `DrizzleQueryError`, putting the real `LibsqlError` on `err.cause`. Any predicate that checks `err.name === 'LibsqlError'` directly misses it.

**Resolution:** `isUniqueConstraintError` unwraps one level. Covered by a dedicated test that triggers a real UNIQUE and asserts the exact shape (code/extendedCode/rawCode).

**Carry-forward:** any future code that branches on libsql error shape should unwrap `.cause` first. A future utility helper (`unwrapDriverError(err)`) may be worth extracting if a third call-site appears.

### 3. Windows file-handle release on SonicBoom streams

Tests that open a pino-roll stream and then `rmSync` the tmpdir can fail on NTFS with EBUSY because SonicBoom holds the fd open. Need to explicitly end the stream + await `close`/`finish` before rm.

**Resolution:** event-based wait with bounded timer fallback.

**Carry-forward:** any test that opens a pino-roll/SonicBoom stream MUST close it explicitly before cleanup on Windows CI. Cross-platform hygiene.

### 4. Spec-drift discovery lag

Two instances where the spec's stated behavior didn't match library reality:

- T1-2: `resolvePort` spec AC wording was too literal; revised to behavioral + robustness form per `feedback_tournament_ac_literal_vs_behavioral.md`.
- T1-7: spec AC #3 assumed pino-roll filename was `tournament.{date}.log`; actual is `tournament.{date}.{n}.log`. Corrected mid-cycle via a contract test.

**Carry-forward:** when a spec AC hinges on library behavior, write the test FIRST (or at least early) to pin the real contract. Don't let the spec's assumed behavior become canonical without verification. The T1-7 filename-contract test is a template worth copying.

### 5. Multiple codex rounds on spec-phase

T1-6b spec took 10 codex rounds to converge; T1-7 took 5. The pattern is that each round finds a finer issue (High → Med → Med → Low → cadence-related Low), and the user eventually approves with residual Lows acceptable.

This is not a failure — each round genuinely improved the spec. But it's worth noting that spec codex has diminishing returns past ~4 rounds; the last few rounds mostly surface wordsmithing rather than substantive issues.

**Carry-forward:** for future stories, consider capping spec codex at 4 rounds OR at zero-High-zero-Med, whichever comes first. Lows get reported in the final summary rather than driving additional rounds.

---

## Previous retro follow-through

**No previous retrospective exists** — Epic T1 is the first tournament epic. No action-items to track forward from an earlier cycle. Lessons here establish the baseline for Epic T2's retrospective to compare against.

(Wolf Cup retrospectives, if any, are not tournament-scoped and do not feed this flow.)

---

## Next epic preview — Epic T2: Course Library

### Scope

5 stories: T2-1 (courses + revisions schema), T2-2 (Pinehurst seed + course list API), T2-3 (PDF vision parser — target-miss-tolerable), T2-4 (course validator), T2-5 (course admin UI: manual + PDF upload review).

### Dependencies on Epic T1

- **Schema foundation:** T1-6a's ecosystem columns (`tenant_id`, `context_id`) → T2-1 will use the same factory via `_columns.ts`.
- **Migrations tooling:** `scripts/drizzle-kit.mjs` portable wrapper established in T1-6a → T2-1 will use it for migration 0002.
- **Test patterns:** T1-6a/T1-6b/T1-7's mock-db + migrate pattern → T2 tests follow the same shape.
- **Env system:** T1-6a's Zod schema → T2 extends for course-library-specific config (seed file path, if any PDF parser API keys arrive later).
- **Logger:** T1-7's `c.get('logger')` child-logger pattern → T2 route handlers use it for all logging.

### Prerequisites all in place

- ✅ DB + migrations runnable (T1-6a)
- ✅ Auth middleware available for admin-only routes (T1-6a)
- ✅ Session issuance works (T1-6b)
- ✅ Structured logger + request-id middleware (T1-7)
- ✅ docker-compose deployment path (T1-4)
- ✅ CI dual-run validates changes (T1-5)

No blocking prep work needed. T2-1 can start directly.

### No significant discoveries that invalidate T2 plan

Reviewing Epic T1's outcomes against Epic T2's stated plan: no architectural assumptions proven wrong, no layering errors uncovered, no scope changes to T2 required.

The one caveat: T2-3 (PDF vision parser) is marked target-miss-tolerable in the PRD. If PDF-parsing turns out to need credentials (OpenAI or similar), that's a deferred SHARED-gate conversation for that specific story — not an Epic T2 blocker.

---

## Action items

These are specific, owned, and carry forward into future stories. Given the director workflow's single-agent nature, "owner" here is the director workflow itself; Josh approves at gates.

### Process

- **AI-1 (director):** Cap spec codex at 4 rounds OR zero-High-zero-Med, whichever comes first. Lows go to the final summary without a round of their own. Applies to Epic T2+.
- **AI-2 (director):** For future SHARED gates, announce the exact lines / env-var names / dep versions BEFORE running the edit. Already doing this; formalize as director step 4.5.
- **AI-3 (director):** When a spec AC hinges on library behavior (filename formats, error shapes, etc.), write the contract test FIRST and verify before the spec codex phase. Template: the T1-7 pino-roll filename-contract test + the T1-6b UNIQUE-violation-shape test.

### Technical

- **AI-4 (T3+ author):** When a third call-site needs the private `extractCookie` helper, promote it to `src/lib/cookies.ts`. Currently duplicated in `require-session.ts` + `auth.ts`. Acceptable per "no refactor beyond the task" rule for now.
- **AI-5 (T3+ author):** If a second drizzle-error catch-predicate appears, extract `unwrapDriverError(err)` to a shared helper. Currently only used in `auth.ts#isUniqueConstraintError`.
- **AI-6 (T2-1 author):** Reuse `ecosystemColumns()` factory + the `drizzle-kit.mjs` wrapper; do not reinvent migration plumbing. First cross-story dependency on T1-6a internals.

### Documentation

- **AI-7 (retro-author, this document):** record the pino-roll filename pattern discovery + drizzle wrapping + sonic-boom-bypasses-stdout-spy as explicit "library-behavior quirks" in a future tournament CLAUDE.md section. Not this story; flagged for a doc pass later.

### Team agreements

None applicable in a single-agent workflow. Director cadence (announce + gate + verify + codex + party + commit) is the process artifact.

---

## Readiness assessment — is Epic T1 really done?

| Dimension | Status | Notes |
| --- | --- | --- |
| Stories complete | ✅ 7/7 done | sprint-status.yaml reflects |
| Tests green | ✅ | Tournament-api 73/73, Wolf Cup engine 468/468, Wolf Cup api 494/494 |
| Typecheck | ✅ | Workspace `pnpm -r typecheck` exits 0 |
| Lint | ✅ | Workspace `pnpm -r lint` exits 0 |
| Deployed to prod | ❌ NO | 18 commits are LOCAL, unpushed. Josh has not authorized a tournament-app deploy yet |
| Stakeholder acceptance | N/A | Private project; Josh is organizer + stakeholder |
| Unresolved blockers | ✅ None | 2 low-severity test-flakiness notes carried forward as acceptable |
| Epic exit criteria (PRD) | ✅ All met | Sign-in surface at `tournament.dagle.cloud`, Wolf Cup regression clean, CI dual-run pipeline, structured JSON log line at startup |

**Important deploy callout:** Epic T1 is code-complete and LOCAL-commit-complete. Production deployment of the tournament stack has NOT been performed in this epic. A deploy would require:

1. Pushing the ~18 local tournament commits to origin.
2. `./deploy.sh` execution against `wolf.dagle.cloud` (which serves both Wolf Cup and Tournament containers).
3. `.env.production` on the VPS must contain: `AUTH_COOKIE_DOMAIN`, `PUBLIC_APP_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and optionally `LOG_LEVEL` + `LOG_DIR` (LOG_DIR defaults to `/app/data/logs` under prod).
4. Google OAuth console registration for `tournament.dagle.cloud/api/auth/google/callback` as an authorized redirect URI.

If any of these are missing at deploy time, the tournament-api container will crash-loop at boot (intended fail-fast behavior). The operator receives an immediate signal.

**Per project policy (user's global instructions), deployment is always a Josh-initiated action** — the director workflow is correctly behaving here.

---

## Commitments

Given the single-agent workflow, "commitments" map to the action items above. All are process-level (how the director works) or deferred-until-triggered (what future stories should do when specific conditions arise).

## Next steps

1. User decision: proceed to Epic T2 now, or pause.
2. If proceeding: T2-1 (courses + revisions schema) is the first story. No prep sprint needed — prerequisites are all in place.
3. Deploy to production can happen anytime user authorizes it; deploy is not in the Epic T2 critical path unless user wants the VPS live for mid-epic smoke testing.

---

## Key takeaways (the 3-things version)

1. **Codex catches real bugs when you treat it as a layer of unit tests against the spec, not a wordsmithing pass.** The drizzle-wraps-libsql discovery and the pino-roll filename discovery would have shipped silently otherwise. Keep the per-phase cadence.
2. **Explicit risk acceptance is better than unstated assumption.** T1-6b's RS256-skip decision is defensible because the threat model is documented with concrete revisit triggers. Apply the same posture to future deferrals.
3. **The tournament-app's test + module-isolation patterns are now established.** T2+ authors should copy the in-memory-DB mock pattern, the env-mock + resetModules pattern, and the middleware-wrapped-router test pattern rather than reinvent.
