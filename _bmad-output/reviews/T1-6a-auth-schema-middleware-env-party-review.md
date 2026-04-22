# Party Review — T1-6a Auth Schema + Middleware + Env

**Story:** `T1-6a-auth-schema-middleware-env`
**Epic:** T1 (Tournament Foundation)
**Status at review:** `review` (all 20 ACs ticked; tests + regression green; impl-codex rounds 1–3 converged to PASS with 2 Lows noted)
**Test counts:** tournament-api 19 → 38 (+19). Wolf Cup engine 468 + api 494 unchanged.

This is a consolidated, non-interactive written review across five perspectives. No open questions to the user; all reviewers converge on a ship-as-is verdict. A small number of non-blocking followups are listed in each section for the backlog — those are tracked items, not ship blockers.

---

## 📊 Mary — Business Analyst

**Verdict: meets the epic's foundational-auth goal. No AC drift.**

The story was framed as "ecosystem-neutral infrastructure that T1-6b SSO + future magic-link drop into cleanly." That's what shipped. The `players` slice is minimal per epic AC #1 (no `google_sub` column — provider identifiers live in `oauth_identities` via Fork 2b). The `sessions` table is server-side storage only; the cookie carries an opaque 256-bit base64url token, no HMAC signing. `magic_link_tokens` is deliberately absent (Fork 1c — deferred to T3.x once `players.email` lands).

Every AC (#1–#20) has a traceable implementation anchor. AC #14's "zero new deps" posture survived — the drizzle-kit compatibility workaround was solved with a 24-line pure-Node wrapper using `tsx` (already a devDep) rather than installing `cross-env` or similar. That preserves the "no `pnpm-lock.yaml` gate in T1-6a" promise that made this slice shippable without a second SHARED approval.

**Coverage gaps that could bite T1-6b or T2:**

- **OAuth provider-sub collision handling.** The spec locks the UNIQUE composite index order as `(tenant_id, provider, provider_sub)` for FD-6 correctness. The migration 0000 SQL emits it in exactly that order. T1-6b's OAuth-callback INSERT path needs to handle the 2291 conflict on this index cleanly — treating it as "existing player, create a new session" rather than surfacing an error. Worth surfacing in the T1-6b spec.
- **Session rotation on sign-in.** Nothing in T1-6a establishes whether T1-6b should create a fresh session row per sign-in or reuse an existing one. The current code supports both models; the decision is T1-6b's to make but should be noted in its spec for consistency.
- **Device_info observability.** The 128-char truncated device_info is stored but nothing reads it. When T1-6b + T1-7 are done there should be an admin surface that lets an organizer revoke a specific session by device. Not in T1-6a scope, just flagging for the T1-7 / admin-tools backlog.

These are observations for forward planning, not defects in T1-6a.

---

## 🏗️ Winston — Architect

**Verdict: schema shape correctly expresses FD-4, FD-6, and D2-4. No layering errors.**

### FD-4 (identity shape) — correctly separated

Evidence:
- `apps/tournament-api/src/db/schema/players.ts:18-22` — `players` has `id`, `isOrganizer`, `createdAt`, ecosystem columns; NO `google_sub`, NO `email`, NO provider column.
- `apps/tournament-api/src/db/schema/oauth_identities.ts:23-34` — `oauth_identities` carries `provider`, `providerSub`, `playerId` FK → `players.id` with `onDelete: 'cascade'`.
- `oauth_identities.ts:26` — provider typed `$type<'google' | 'apple'>()` (TS narrowing, no SQL CHECK).

The `players ↔ oauth_identities` split is the right factoring. A single `players.google_sub` column would have forced a schema migration when Apple SSO arrives (v1.5+); the current shape grows by INSERTing rows into `oauth_identities`, not by ALTERing `players`. The small JOIN cost at 8 players is unmeasurable. TypeScript narrowing at `$type<...>()` is the right level for SQLite's type flexibility — the runtime accepts any text, the narrowing constrains code paths that create identities.

### FD-6 (ecosystem tenant/context) — clean propagation

Evidence:
- `apps/tournament-api/src/db/schema/_columns.ts:8-11` — `tenantId` has SQL-level `.default('guyan')`; `contextId` is `notNull()` with **no** SQL default (callers must supply).
- `apps/tournament-api/src/db/schema/oauth_identities.ts:38-42` — composite UNIQUE index is built as `.on(t.tenantId, t.provider, t.providerSub)` — tenant_id leftmost.
- Generated SQL at `apps/tournament-api/src/db/migrations/0000_medical_typhoid_mary.sql:12` matches: `CREATE UNIQUE INDEX 'uniq_oauth_identities_tenant_provider_sub' ON 'oauth_identities' ('tenant_id','provider','provider_sub');`.
- `apps/tournament-api/src/lib/session.ts:31-32` — `DEFAULT_TENANT_ID = 'guyan'` and `DEFAULT_CONTEXT_ID = 'league:guyan-wolf-cup-friday'` constants; passed explicitly on every `createSession` insert because `contextId` has no SQL default.

`ecosystemColumns()` is invoked as a factory (not reused as a frozen const) so each table gets fresh column instances — correct per Drizzle's per-table identity model (`_columns.ts:8` comment). Composite index's tenant-first column order preserves the admin query-by-tenant pattern the spec called out (`T1-6a` story, AC #2 query patterns section). Every insert supplies `contextId` explicitly in application code since the schema does not default it.

### D2-4 (session lifetime) — rolling 7-day + 30-day hard cap

Evidence:
- `apps/tournament-api/src/lib/session.ts:23` — `SESSION_ROLLING_MS = 7 * 24 * 60 * 60 * 1000`.
- `session.ts:27` — `SESSION_HARD_CAP_MS = 30 * 24 * 60 * 60 * 1000`.
- `session.ts:112-116` — `validateSession` computes `hardCapDeadline = row.createdAt + SESSION_HARD_CAP_MS` and returns `null` if `row.expiresAt <= t || hardCapDeadline <= t`.
- `session.ts:120-126` — on valid, UPDATE sets `lastSeenAt = t, expiresAt = t + SESSION_ROLLING_MS`. `createdAt` is NOT in the SET clause, so the hard cap's anchor never moves.
- `session.test.ts:112-128` — test seeds at T0, rolls at T0+5d, T0+15d, T0+25d, then asserts `validateSession(sessionId, T0 + 30d + 1ms)` returns null.

A valid session rolls `lastSeenAt` + `expiresAt` forward but never moves `createdAt`, so the hard cap's timer keeps counting from the original grant. The test locks the exact behavior — three `validateSession` calls inside the 30-day window keep rolling; one call past day 30 returns null.

### Middleware chain invariant
`requireSession` sets `c.set('session', ...)` + `c.set('player', ...)`. `requireOrganizer` reads `c.get('player')` and explicitly returns **500 middleware_misuse** if undefined, not a silent 403. That loud-failure on misuse is the right call — silent 403 would hide a real developer bug behind a plausibly-looking response. The JSDoc on `requireOrganizer` documents the mount order (`app.use('/admin/*', requireSession, requireOrganizer)`), and the Variables augmentation lives in a dedicated `src/types/hono.d.ts` file so TS picks it up project-wide without fragile import-graph dependencies.

### Dependency on Wolf Cup — none

Evidence: `git diff --name-only origin/master..HEAD` for this story shows changes only under `apps/tournament-api/**`, `_bmad-output/**`, and `docker-compose.yml`. Grep confirms: `grep -r "from '@wolf-cup" apps/tournament-api/src` returns zero hits; `grep -r "apps/api\|apps/web\|packages/engine" apps/tournament-api/src` returns zero hits. The migrate runner shape (`apps/tournament-api/src/db/migrate.ts`) echoes Wolf Cup's `apps/api/src/db/migrate.ts` idiom but via independently-authored code. Dockerfile CMD pattern and seed.ts structure match conventions; both were written fresh against the spec, not imported. Only shared surface is `docker-compose.yml` (the one approved SHARED edit this story).

### One forward-looking note
The `SESSION_ROLLING_MS` + `SESSION_HARD_CAP_MS` + `DEVICE_INFO_MAX_LEN` constants are extracted and named in `src/lib/session.ts`. When T1-7 (log sink) or a future admin-tools story wants to expose session settings (e.g., adjusting lifetime for an event weekend), these constants become the natural adjustment points. No refactor needed — just a good default shape.

---

## 📋 John — Product Manager

**Verdict: stays in the T1-6a slice. No scope creep. Unblocks T2 in parallel with T1-6b. Good schedule impact for Pinehurst 2026-05-07.**

### Scope-creep check — clean
The spec explicitly carved T1-6 into T1-6a (infra) + T1-6b (Google SSO) + deferred magic-link. The implementation holds that line:

- NO `arctic` dependency (T1-6b's concern).
- NO OAuth sign-in/callback handlers — `src/routes/auth.ts` is a 1-route stub returning `{ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' }`.
- NO `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` in env.ts.
- NO magic-link table.
- NO Resend dep.

The story stays exactly in the spec's defined slice.

### T2 parallelization — unblocked
The epic amendment on 2026-04-18 specifically set up T1-6a → T2 parallelism. `requireSession` + `requireOrganizer` are exported but not yet mounted on any route, so T2.3 / T2.5 (admin endpoints in T2's course-library work) can import and mount them the moment T1-6a lands. T2 doesn't block on T1-6b's OAuth wiring — it only needs the middleware primitives, which this story ships.

### Pinehurst schedule implication (2026-05-07, 15 days from commit date)
T1 foundation is now **6/7 stories done** after this commit lands. T1-6b (Google SSO) + T1-7 (log sink) remain. T1-6b is the smaller of the two — it's handler-additive onto an existing stub file plus adds one dep (`arctic`) and one SHARED gate on the lock file. T1-7 is structural but non-blocking for scoring.

The realistic Pinehurst path per the tech spec's FD-15 is still: ship-when-solid, with June trip as fallback. This story doesn't change that arithmetic — it lands us on time for foundation completion, which was always the precondition for T2+ starting. If T2 + T3 basics land in the next 10 days and T5 scoring is tight, Pinehurst becomes "possible, not required" — the spec was honest about that from day one.

### The one observation
The **portable drizzle-kit.mjs wrapper** is arguably scope-creep: the spec didn't call out a cross-platform db:generate script. BUT the context is that the story's ACs couldn't pass without it (drizzle-kit's CJS loader breaks NodeNext .js-extension imports, and we need AC #4's migration generation to work on Windows too). Labeling this "scope-creep" would be pedantic — it's infrastructure that let the declared ACs ship. Flagged for awareness, not correction.

---

## 🧪 Quinn — QA Engineer

**Verdict: test coverage is solid on the critical paths. A few edge-case gaps noted for followup but nothing ship-blocking.**

### What's well-covered on the critical paths (38 tests, 19 new)

- **7-day rolling window** — `validateSession` test exercises "skip ahead 7 days + 1ms" boundary.
- **30-day hard cap** — test rolls the session forward at days 5, 15, 25, then checks day 30 + 1ms returns null. Critically: validates that continuous rolling does NOT bypass the hard cap.
- **Device_info truncation** — seed a 300-char UA, assert stored value is exactly 128 chars. Codex round-1 called this out; it's locked.
- **Middleware misuse path** — `requireOrganizer` without `requireSession` → 500 `middleware_misuse`. Exercises the "loud failure on developer misuse" contract.
- **Production cookie attributes** — the late-added test that mocks `env.js` with NODE_ENV=production + asserts Secure + Domain appear in Set-Cookie. Wrapped in try/finally so cleanup survives mid-test assertion failures (round-2 fix).
- **Header-injection guard** — explicit test that `sessionCookieHeader('abc; Path=/evil')` THROWS. Locks down the defense-in-depth added in round 2.
- **Out-of-shape cookie rejection** — `requireSession` cheap-rejects length <16, length >128, non-base64url characters before hitting the DB.
- **Typing contract** — `c.get('session').sessionId` compiles as `string` without `as any`. Runtime assertion mirrors the compile-time check.

### Edge cases I'd add in a follow-up (not blocking)

- **Concurrent validateSession calls for the same session_id.** Two simultaneous requests both see "valid" and both UPDATE `expiresAt`. SQLite serializes writes, so the second wins cleanly — but no test locks that behavior. Low-risk; the UPDATE is idempotent-ish and the value always moves forward.
- **Deleted player with live session.** FK ON DELETE CASCADE means deleting a player row also deletes their sessions. Covered by the FK, not by a dedicated test. Low-risk.
- **Expires_at edge: exactly equal to now().** Current code uses `expiresAt <= t` (strict past OR equal → invalid). Matches the spirit of "past the expiration" but worth a unit test that hits `t === expiresAt` exactly.
- **Cookie string parsing robustness.** `extractCookie` handles whitespace tolerance but isn't tested against quoted values, `%` encoding, or malformed headers. In practice the browser always sends well-formed cookies and the cheap-shape check catches malformed values, but explicit tests would be good hygiene.

### Brittleness check — low
The one mock of `env.js` in `session.test.ts` uses `vi.resetModules()` + `try/finally` + dynamic import. That's the right pattern for module-load-time parse semantics. No process.env mutation from test bodies. No shared state between tests.

### No flakes observed across 10 local runs.

---

## 💻 Amelia — Developer Agent

**Verdict: solid code. Two notes worth capturing. Nothing that blocks ship.**

### The drizzle-kit.mjs wrapper — right long-term solution

The wrapper at `apps/tournament-api/scripts/drizzle-kit.mjs` injects `tsx` via `NODE_OPTIONS='--import tsx'` before spawning drizzle-kit. 24 lines, zero deps, pure Node, cross-platform. Root cause of the need: drizzle-kit 0.30.6's CJS loader calls `require('./players.js')` against `.ts` source under NodeNext — the CJS path doesn't rewrite `.js` → `.ts` the way tsx does.

This is not a short-term hack. It'll remain needed until either (a) drizzle-kit ships an ESM loader that handles NodeNext directly, or (b) the project moves to a different module resolution (unlikely — NodeNext is the right choice). Removing the wrapper would require one of those prerequisites. The comment at the top of `scripts/drizzle-kit.mjs` documents the why — future devs will understand it.

### env.ts module-load parse — idiomatic

The pattern is: top-level `envSchema.parse(process.env)` runs at import time, and `env` is exported as a typed object. Any module that reads env touches `env.VAR` not `process.env.VAR`. This is the canonical pattern for Zod + Node ESM projects — Hono, Next.js, SvelteKit, tRPC all do variants of this. The fail-fast-at-boot behavior is what Josh wants per AC #7.

The `src/test-setup.ts` seed-before-import pattern is likewise canonical. The only subtle point is that `vi.stubEnv` can't be used in test bodies to change env after the module has loaded — tests that need different env values use `vi.doMock('./env.js')` + dynamic import (the production-cookie test does this).

### Readability / maintainability

- Named constants in `src/lib/session.ts` are clean: `SESSION_ROLLING_MS`, `SESSION_HARD_CAP_MS`, `DEVICE_INFO_MAX_LEN`, `DEFAULT_TENANT_ID`, `DEFAULT_CONTEXT_ID`. Self-documenting.
- `validateSession` returns `{ playerId, isOrganizer } | null` — narrow, no overloading. Caller destructures cleanly.
- `extractCookie` is a local helper function, not exported — right visibility.
- `requireSession` + `requireOrganizer` have full JSDoc explaining the chain order and the 500 misuse semantic. Future devs won't misuse them.

### Two notes for followups (not blocking)

1. **`AUTH_COOKIE_DOMAIN` regex is permissive** (round-3 codex Low). It accepts `.example`, `-leading`, `trailing-`, consecutive `..` — invalid hostnames that browsers will reject silently. Practical impact: zero (operator-controlled env var, they'd notice on first deploy). Cost of a stricter regex: a few more bytes + one bad-hostname test case. Worth picking up when next convenient.
2. **`sessionCookieHeader`'s empty-string throw is un-tested** (round-3 codex Low). The header-injection guard test covers semicolons, spaces, newlines. Adding one `expect(() => sessionCookieHeader('')).toThrow()` would lock the contract. Same "pick up next convenient" bucket.

Nothing else stands out. Code-to-comment ratio is good. File shapes match the story spec's Project Structure Notes verbatim.

---

## Verdict

**Ship as-is.** 20/20 ACs satisfied. Test suite grew 19 → 38 (+19). Wolf Cup regression clean (468 + 494 unchanged). Impl-codex rounds 1–3 converged to PASS. FD-1/FD-2 path isolation preserved. The one SHARED edit (docker-compose.yml) had explicit approval and is minimal. Forward-looking gaps noted by analyst/qa/dev are all followup-quality, not ship-blocking.

T1-6a is done. T1-6b (Google SSO) + T1-7 (log sink) are the remaining Epic T1 work; T2 can begin in parallel with T1-6b the moment this story's commit lands.
