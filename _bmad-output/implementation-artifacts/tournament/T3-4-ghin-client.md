# T3-4: [port] GHIN Client

## Status

Done

## Story

As a developer,
I want Wolf Cup's GHIN client ported into tournament-api with a provenance header + PORTS.md entry, plus two new HTTP endpoints (`GET /api/players/search`, `GET /api/players/lookup`),
So that GHIN lookup + search works in tournament-api without touching Wolf Cup source and without violating the engine-boundary rule.

T3-4 unblocks T3-3 (Group CRUD UI's "Add Player" GHIN search path) and T3-10 (optional GHIN profile enrichment). It's a clean port story — minimal new logic, mostly file copy + adapt.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**ONE expected SHARED gate: `docker-compose.yml`** — adding `GHIN_USERNAME=${GHIN_USERNAME:-}` and `GHIN_PASSWORD=${GHIN_PASSWORD:-}` to the `tournament-api` service's `environment` block (matching the Wolf Cup `api` service's existing GHIN env wiring at lines 16-17).

**Env-var nullability semantics** (one consistent contract across compose + Zod + client):
- Compose's `${VAR:-}` substitutes empty string when the host env is unset → the env var IS always passed into the container, possibly as empty string.
- Zod schema uses `z.string().optional()` to ALSO accept undefined (which happens in dev/test where compose doesn't run).
- The client treats BOTH undefined AND empty string as "credentials missing" — `ghinClient` is null in both cases.
- Mirrors Wolf Cup's `process.env['GHIN_USERNAME'] && process.env['GHIN_PASSWORD']` truthy-check at line 105-106 of source — which evaluates `undefined` and `''` identically (both falsy).

**Why this is unavoidable in T3-4:** the env vars MUST be passed into the tournament-api container at runtime; the only place that wiring lives is docker-compose.yml. Alternatives (mounting an env file, using docker secrets) are heavier and inconsistent with the existing T1-6a/T2-3 pattern that adds env vars directly in compose.

**STOP at this SHARED gate at impl time.** Pre-approval is requested at the spec gate so the dev agent can proceed without re-pausing.

**Other expected files (all ALLOWED):**
- `apps/tournament-api/src/lib/ghin-client.ts` — NEW (the ported client)
- `apps/tournament-api/src/lib/env.ts` — MODIFIED (add GHIN_USERNAME + GHIN_PASSWORD as `z.string().optional()` Zod entries — NO Zod-side default; runtime sees `undefined` or empty string, both treated as "credentials missing" by the client per the §1 nullability semantics block)
- `apps/tournament-api/src/routes/players.ts` — NEW (GET /api/players/search + /api/players/lookup)
- `apps/tournament-api/src/routes/players.test.ts` — NEW (tests)
- `apps/tournament-api/src/app.ts` — MODIFIED (register playersRouter)
- `apps/tournament-api/PORTS.md` — NEW (port-tracking table)
- `apps/tournament-api/.env.example` — NEW (or extend if exists; document GHIN vars + the existing tournament env vars)
- Story + codex review files in `_bmad-output/`

### 2. Port provenance protocol (epic AC #1 + #2)

The ported file MUST begin with this exact header format:
```
/**
 * PORTED from apps/api/src/lib/ghin-client.ts @ commit
 * 3a38700303bd71a86c6de3621088fe161469d8b0 (dated 2026-03-02).
 *
 * Scope: lookup-by-GHIN-number + search-by-name-state.
 * Known deltas from source:
 *   - process.env reads replaced with imports from src/lib/env.ts
 *     (per tournament-api's centralized env access posture).
 *   - Optional env vars: when GHIN_USERNAME/PASSWORD are empty, the
 *     `ghinClient` export is null (matches Wolf Cup posture).
 */
```

The `3a38700303bd71a86c6de3621088fe161469d8b0` SHA is the verified last-touched commit of Wolf Cup's `apps/api/src/lib/ghin-client.ts` (verified at spec time via `git log -1 -- apps/api/src/lib/ghin-client.ts`).

`apps/tournament-api/PORTS.md` MUST contain a table with columns: `Target file | Source file | Source commit | Ported-on date | Deltas | Last-checked-for-updates`. The first row is the ghin-client port. Future ports append rows.

### 3. Adaptations from Wolf Cup source (deliberate deltas)

The ported file is NOT a byte-for-byte copy. Deltas:

1. **`process.env` reads → `env` module imports.** Wolf Cup's source uses `process.env['GHIN_USERNAME']` directly. Tournament-api's posture (per `env.ts:1-50`) is that all `process.env` reads go through the centralized Zod-validated `env` module. So the port:
   - Adds `GHIN_USERNAME` + `GHIN_PASSWORD` to `envSchema` as OPTIONAL strings (`z.string().optional()`) — matches the compose `:-` empty-string fallback.
   - Replaces `process.env[...]` with `env.GHIN_USERNAME` + `env.GHIN_PASSWORD` checks.

2. **Same `ghinClient = ... || null` singleton pattern.** When BOTH env vars are non-empty, the singleton instance is created. Otherwise, `null`. Routes that depend on it (T3-4's two new GET endpoints) check for null → return 503 `service_unavailable`.

3. **Logger integration.** Wolf Cup's source has NO logging — it just throws typed Error objects (`Error('GHIN_AUTH_FAILED')`, `Error('GHIN_UNAVAILABLE')`, `Error('NOT_FOUND')`). The port preserves this: the CLIENT stays log-free. Logging happens at the ROUTE handler layer, where each catch maps the error type to an HTTP response AND emits a structured Pino log line via `c.get('logger')` (`event: 'ghin_call_failed'`, includes endpoint + error message + cause). Same separation-of-concerns Wolf Cup's API routes already use.

4. **No type changes** — the `GhinSearchResult` shape is byte-identical to Wolf Cup's. Future rule-engine consumers in T6+ will join against this exact shape.

### 4. Endpoint design (epic AC #3 + #4)

**`GET /api/players/search?name=&state=`**
- Auth: `requireSession` only (any authenticated player can search; not organizer-only).
- Query params: `name` (required, min 1 char trimmed); `state` (optional, accepted but **currently ignored** — see §6 below for the WV-hardcoded v1 limitation).
- Handler: calls `ghinClient.searchByName(name, undefined)` (Wolf Cup's source treats `name` as last_name; tournament-api preserves that semantics for v1 since this is what the existing client does). The client unconditionally hits `state=WV` upstream regardless of the query param's value.
- Response shape: `{ results: GhinSearchResult[] }` (the `res.results` pattern flagged in the epic AC). Empty array on no matches (NOT 404 — search-with-no-results is a normal outcome).
- Errors:
  - 400 `{ error: 'bad_request', code: 'invalid_query', requestId, issues }` on Zod miss.
  - 503 `{ error: 'service_unavailable', code: 'ghin_unavailable', requestId }` if ghinClient is null OR the upstream throws.

**`GET /api/players/lookup?ghin=<number>`**
- Auth: `requireSession` only.
- Query param: `ghin` (required, positive integer parseable from query string).
- Handler: calls `ghinClient.getHandicap(ghinNumber)`.
- Response shape: `{ ghinNumber, handicapIndex }` on success.
- Errors:
  - 400 `{ error: 'bad_request', code: 'invalid_query', requestId, issues }` on Zod miss.
  - 404 `{ error: 'not_found', code: 'ghin_not_found', requestId }` if the GHIN client throws `NOT_FOUND`.
  - 503 `{ error: 'service_unavailable', code: 'ghin_unavailable', requestId }` if ghinClient is null OR throws `GHIN_UNAVAILABLE` / `GHIN_AUTH_FAILED`.

Both endpoints use the existing `csrf` global middleware (only effective on unsafe methods; GET is exempt — no CSRF concern here).

### 5. Test coverage targets (mandatory)

**Backend tests** (`apps/tournament-api/src/routes/players.test.ts`, NEW):
- Happy path search: mocked `ghinClient.searchByName` returns 2 results → 200 `{ results: [...] }` with shape verified.
- Search with no results: mocked client returns `[]` → 200 `{ results: [] }` (NOT 404).
- Search Zod miss: `name` empty → 400 `invalid_query`.
- Search auth: anonymous → 401 `session_missing`.
- Search service-down: ghinClient is null (env vars empty) → 503 `ghin_unavailable`.
- Search upstream throw: mocked client throws `Error('GHIN_UNAVAILABLE')` → 503 `ghin_unavailable`.
- Lookup happy path: mocked `getHandicap` returns `{ handicapIndex: 8.4 }` → 200 with shape.
- Lookup not found: mocked throws `Error('NOT_FOUND')` → 404 `ghin_not_found`.
- Lookup service-down: 503.
- Lookup Zod miss: missing `ghin` query param → 400.

**Mocking strategy:** the existing test pattern uses `vi.mock` to swap modules. For ghin-client testing:
- TOP of the test file: `vi.mock('../lib/ghin-client.js', () => ({ ghinClient: { searchByName: vi.fn(), getHandicap: vi.fn() } }))` — declares a default mock with the two methods as `vi.fn()` so per-test `mockResolvedValueOnce` / `mockRejectedValueOnce` calls control behavior. Tests that need the singleton to be `null` (the "no env vars" case) use `vi.doMock` + `vi.resetModules()` BEFORE re-importing the route under test, OR use a module-level `let mockClient` variable that the per-test `vi.mocked(ghinClient).XXX` accesses.
- **No real network calls in tests.** A test that accidentally calls the real GHIN API would hit upstream auth + likely fail noisily; the vi.mock guarantees this can't happen.

**Add a test for the WV-ignored-state behavior** (codex round-1 Low #4): supply `?state=NY` to the search endpoint, mock `searchByName` and assert it was called with WHATEVER args it gets — verify the route doesn't pass the state through. Pins the v1 limitation as a regression guard so a future "promote state param" change has to update this test.

**Test count target:** ≥ 10 backend route tests. Final count documented in completion notes.

### 6. Hardcoded `state: 'WV'` in Wolf Cup source

Wolf Cup's `searchByName` hardcodes `state: 'WV'` in the URL params (line 60 of source). The epic AC says the endpoint should accept `?state=` as a query param. T3-4's first iteration **preserves the hardcoded WV behavior** to match Wolf Cup byte-for-byte and keep this as a pure port. The endpoint's `state` query param is accepted (Zod permits it) but currently ignored at the client layer — the WV hardcoding is a known v1 limitation documented in PORTS.md as a future enhancement (T3-4 followup).

If Josh wants the state param to actually flow through, that's a deliberate delta from the Wolf Cup source — would mean a 2-line client change AND require a "Deltas" entry in PORTS.md. **For T3-4 v1, preserve the WV hardcoding.**

**Visibility:** PORTS.md MUST list this WV hardcoding as a "Known limitation" entry in the Deltas column (NOT just buried in a paragraph). Format like: `Deltas: env reads via env.ts (was process.env). KNOWN LIMITATION: state='WV' hardcoded upstream regardless of ?state= query param value.` This way a future maintainer reading PORTS.md sees the limitation immediately without deep-reading the spec or source.

### 7. Env var posture (epic AC #5)

Both `GHIN_USERNAME` and `GHIN_PASSWORD` are added to tournament-api's env schema as OPTIONAL with no default (i.e., `z.string().optional()`). Wolf Cup's compose passes `${GHIN_USERNAME:-}` (empty fallback) so the var IS always set — but tournament-api's Zod schema treats it as optional so the dev agent can run tests without setting them.

`.env.example` MUST document:
```
# GHIN API credentials (T3-4). Optional — when both are missing or
# empty, the /api/players/search and /api/players/lookup endpoints
# return 503 service_unavailable. Set both to enable GHIN lookups.
GHIN_USERNAME=
GHIN_PASSWORD=
```

VPS production deployment: Josh must add `GHIN_USERNAME=...` + `GHIN_PASSWORD=...` to `/opt/wolf-cup/.env` before T3-3's GHIN search path becomes useful. Until then, Add Player → manual entry only. **Pin in completion notes.**

### 8. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/lib/ghin-client.ts` — NEW
- `apps/tournament-api/src/lib/env.ts` — MODIFIED
- `apps/tournament-api/src/routes/players.ts` — NEW
- `apps/tournament-api/src/routes/players.test.ts` — NEW
- `apps/tournament-api/src/app.ts` — MODIFIED
- `apps/tournament-api/PORTS.md` — NEW
- `apps/tournament-api/.env.example` — NEW (or modified if exists)
- Story file + codex review files in `_bmad-output/`

SHARED edits expected (PRE-APPROVED at spec gate):
- `docker-compose.yml` — add 2 lines to tournament-api env block (`GHIN_USERNAME=${GHIN_USERNAME:-}` + `GHIN_PASSWORD=${GHIN_PASSWORD:-}`)

NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/lib/ghin-client.ts` (NEW)
   **When** inspected
   **Then** the file begins with the provenance header (per Risk Acceptance §2 verbatim) including the SHA `3a38700303bd71a86c6de3621088fe161469d8b0` and date 2026-03-02. The file exports a `ghinClient` const that is either an instance of `GhinDirectClient` (when both `env.GHIN_USERNAME` and `env.GHIN_PASSWORD` are non-empty) or `null`.

2. **Given** the ported `GhinDirectClient` class
   **When** inspected
   **Then** it has the same method signatures as Wolf Cup's source: `searchByName(lastName: string, firstName?: string): Promise<GhinSearchResult[]>` and `getHandicap(ghinNumber: number): Promise<{ handicapIndex: number | null }>`. The `GhinSearchResult` type is byte-identical to Wolf Cup's. Token caching (20-minute TTL) is preserved. Error messages thrown match Wolf Cup's: `GHIN_AUTH_FAILED`, `GHIN_UNAVAILABLE`, `NOT_FOUND`.

3. **Given** `apps/tournament-api/src/lib/env.ts` (modified)
   **When** inspected
   **Then** the `envSchema` has `GHIN_USERNAME: z.string().optional()` and `GHIN_PASSWORD: z.string().optional()` added (both OPTIONAL — empty/missing must NOT fail-fast at boot, since GHIN is a non-essential integration). A clarifying comment notes that empty values cause `ghinClient` to be `null`.

4. **Given** `apps/tournament-api/PORTS.md` (NEW)
   **When** inspected
   **Then** it contains a markdown table with columns: `Target file | Source file | Source commit | Ported-on date | Deltas | Last-checked-for-updates`. The first row is the ghin-client port:
   - Target: `apps/tournament-api/src/lib/ghin-client.ts`
   - Source: `apps/api/src/lib/ghin-client.ts`
   - Source commit: `3a38700303bd71a86c6de3621088fe161469d8b0`
   - Ported-on: `2026-04-27`
   - Deltas: env reads via `src/lib/env.ts` (was process.env); state='WV' still hardcoded (future delta)
   - Last-checked-for-updates: `2026-04-27`

5. **Given** `apps/tournament-api/.env.example` (NEW or modified)
   **When** inspected
   **Then** it documents (at minimum) `GHIN_USERNAME=` and `GHIN_PASSWORD=` with a one-line comment block explaining their purpose + the empty-fallback behavior (per Risk Acceptance §7 verbatim).

6. **Given** `apps/tournament-api/src/routes/players.ts` (NEW)
   **When** inspected
   **Then** it exports a `playersRouter` (Hono instance) with two routes:
   - `GET /search` (mounted at /api/players in app.ts): middleware `requireSession`; query parsed via Zod (`{ name: z.string().trim().min(1), state: z.string().trim().optional() }`); handler delegates to `ghinClient.searchByName(name)`; response `{ results: GhinSearchResult[] }`.
   - `GET /lookup` (mounted at /api/players in app.ts): middleware `requireSession`; query parsed via Zod (`{ ghin: z.coerce.number().int().positive() }`); handler delegates to `ghinClient.getHandicap(ghinNumber)`; response `{ ghinNumber, handicapIndex }`.
   Both endpoints handle null `ghinClient` → 503 `ghin_unavailable`. The `lookup` endpoint maps `Error('NOT_FOUND')` → 404 `ghin_not_found`. Other errors (`GHIN_AUTH_FAILED`, `GHIN_UNAVAILABLE`, generic) → 503 `ghin_unavailable` with structured log (`event: 'ghin_call_failed'`, includes endpoint + error message).

7. **Given** `apps/tournament-api/src/app.ts` (modified)
   **When** inspected
   **Then** `app.route('/api/players', playersRouter)` is mounted alongside the existing routers.

8. **Given** `docker-compose.yml` (SHARED — pre-approved at spec gate)
   **When** inspected
   **Then** the `tournament-api` service's `environment` block has 2 new lines:
   ```yaml
       - GHIN_USERNAME=${GHIN_USERNAME:-}
       - GHIN_PASSWORD=${GHIN_PASSWORD:-}
   ```
   placed adjacent to the existing T1-6a auth env vars. The `:-` empty fallback ensures the container boots even if Josh hasn't set the vars yet on the VPS.

9. **Given** `apps/tournament-api/src/routes/players.test.ts` (NEW)
   **When** the suite runs post-T3-4
   **Then** at least 10 new tests exist (per Risk Acceptance §5 list). Tests use `vi.mock('../lib/ghin-client.js', ...)` to swap the singleton per-test (real client returning real network calls is forbidden in tests). Each test seeds an authenticated session via the existing T1-6a in-memory DB pattern.

10. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint` + `pnpm -F @tournament/api build`
    **When** run post-T3-4
    **Then** all three exit 0. No new `any` types. No new `// eslint-disable` comments.

11. **Given** `pnpm -F @tournament/api test`
    **When** run post-T3-4
    **Then** total tests ≥ baseline + 10 (per AC #9). T3-4 baseline at story start: 277 (post-T3-2). Final count documented in completion notes.

12. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-4
    **Then** both continue to pass with zero net-negative test count change. **Critically: Wolf Cup's `apps/api/src/lib/ghin-client.ts` is byte-unchanged** (port READS the source, never modifies it).

13. **Given** the deployed app post-T3-4
    **When** Josh manually exercises `GET /api/players/search?name=Stoll` against `tournament.dagle.cloud` (with GHIN env vars set on VPS) as an authenticated user
    **Then**:
    - Response 200 `{ results: [...] }` if a player named "Stoll" is found in WV.
    - Response 503 if VPS env vars are unset or GHIN service is down.
    - Anonymous browser → 401 session_missing.
    Manual smoke results documented in completion notes.

14. **Given** SHARED-file approval at spec gate
    **When** the dev agent classifies its planned edits at impl time
    **Then** the only SHARED file touched is `docker-compose.yml` (the 2-line GHIN env addition pre-approved per Risk Acceptance §1). All other edits fall under ALLOWED.

15. **Given** Wolf Cup isolation (FD-1 / FD-2)
    **When** the dev agent classifies its planned edits at impl time
    **Then** zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`. The Wolf Cup ghin-client.ts source is READ for the port but NOT modified.

## Tasks / Subtasks

- [ ] Task 1: Capture baseline. (AC #11)
  - [ ] Subtask 1.1: tournament-api baseline = 277 (post-T3-2).

- [ ] Task 2: Port the GHIN client. (AC #1, #2)
  - [ ] Subtask 2.1: Copy `apps/api/src/lib/ghin-client.ts` to `apps/tournament-api/src/lib/ghin-client.ts`.
  - [ ] Subtask 2.2: Add provenance header per Risk Acceptance §2 (verbatim — including SHA + date).
  - [ ] Subtask 2.3: Replace `process.env['GHIN_USERNAME']` / `process.env['GHIN_PASSWORD']` with `env.GHIN_USERNAME` / `env.GHIN_PASSWORD` reads.

- [ ] Task 3: Extend env schema. (AC #3)
  - [ ] Subtask 3.1: Add `GHIN_USERNAME: z.string().optional()` + `GHIN_PASSWORD: z.string().optional()` to `apps/tournament-api/src/lib/env.ts`'s envSchema.
  - [ ] Subtask 3.2: Add a clarifying comment block (≥3 lines) explaining the optional posture + null-singleton consequence.

- [ ] Task 4: Create PORTS.md. (AC #4)

- [ ] Task 5: Create or extend .env.example. (AC #5)

- [ ] Task 6: Create players router. (AC #6, #7)
  - [ ] Subtask 6.1: Define `searchQuerySchema` and `lookupQuerySchema` Zod schemas.
  - [ ] Subtask 6.2: Implement `GET /search` handler with null-client + Zod-miss + upstream-throw branches.
  - [ ] Subtask 6.3: Implement `GET /lookup` handler with same branches plus NOT_FOUND → 404.
  - [ ] Subtask 6.4: Register `app.route('/api/players', playersRouter)` in app.ts.

- [ ] Task 7: SHARED — modify docker-compose.yml. (AC #8) **PRE-APPROVED at spec gate.**

- [ ] Task 8: Write 10+ route tests. (AC #9)
  - [ ] Subtask 8.1: vi.mock the ghin-client module per-test for null vs stub.
  - [ ] Subtask 8.2: Reuse seedSession + cookie helpers from existing pattern.
  - [ ] Subtask 8.3: Cover all 10 cases per Risk Acceptance §5.

- [ ] Task 9: Run regressions. (AC #10, #11, #12)
  - [ ] Subtask 9.1: tournament-api typecheck + lint + test + build.
  - [ ] Subtask 9.2: Wolf Cup engine + api unchanged.
  - [ ] Subtask 9.3: Verify `git diff apps/api/src/lib/ghin-client.ts` is EMPTY (Wolf Cup source untouched).

- [ ] Task 10: Manual post-deploy smoke per AC #13. Document in completion notes.

- [ ] Task 11: Document in story completion notes — final test deltas, manual smoke results, the WV-hardcoding limitation, the VPS env-var setup followup.

## Dev Notes

- **Why a port not a re-implementation:** Wolf Cup's GHIN client is battle-tested through every season of Wolf Cup play. The login/token-cache flow, the URL params, the response shape mapping — all proven. Re-implementing introduces risk for zero benefit. The port preserves byte-for-byte behavior; the adapter layer is just env-source + logging integration.

- **Why `env.GHIN_USERNAME` instead of `process.env`:** tournament-api's centralized env access posture (env.ts:1-50) explicitly states "all process.env reads go through this module". The port adapts to this rule. The cost is 2 schema entries + 2 read-site changes; the gain is consistency with the rest of tournament-api.

- **Why optional env vars (Zod `.optional()`):** GHIN is a non-essential integration for tournament-api's MVP. The container should boot in dev/test/CI without GHIN creds and gracefully 503 when the endpoints are hit. Mirrors Wolf Cup's `ghinClient = ... || null` posture. Differs from `AUTH_COOKIE_DOMAIN` / `PUBLIC_APP_URL` / `ANTHROPIC_API_KEY` which are REQUIRED (no fallback) because they're load-bearing.

- **Why Zod `z.coerce.number()` on the lookup `ghin` param:** query strings are always strings; `z.coerce.number()` parses + validates in one step. Matches the URL-query-string-to-typed-number pattern used elsewhere.

- **Why preserve the WV hardcoding (Risk Acceptance §6):** keeps T3-4 a pure port. A future story (T3-4.1 or post-Pinehurst feedback) can promote the `?state=` param to actually pass through to the upstream client. Documented in PORTS.md so the next reader sees the limitation immediately.

- **Why GET endpoints (not POST):** GHIN search + lookup are read-only operations. GET is correct REST; also avoids the CSRF middleware (which only applies to unsafe methods) — no CSRF token needed for these reads.

- **Why `requireSession` (not `requireOrganizer`):** the epic AC #3 explicitly says "any authenticated player can search" — a player-self-onboarding flow needs to look up their own GHIN. Future tightening (rate limits, etc.) is out of T3-4 scope.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-4 reads `apps/api/src/lib/ghin-client.ts` as a source for the port; does NOT modify it. The Wolf Cup test suite runs unchanged post-T3-4 to verify zero side effects.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** ONE SHARED file (docker-compose.yml) pre-announced in §1. No SHARED gate during impl (pre-approved at spec gate).

### Project Structure Notes

Shape after T3-4:

```
apps/tournament-api/
  PORTS.md                               # NEW: port-tracking table
  .env.example                           # NEW or MODIFIED: GHIN vars docs
  src/
    app.ts                               # MODIFIED: +playersRouter mount
    lib/
      env.ts                             # MODIFIED: +GHIN_USERNAME/PASSWORD optional
      ghin-client.ts                     # NEW: ported from Wolf Cup
    routes/
      players.ts                         # NEW: GET /search + /lookup
      players.test.ts                    # NEW: 10+ tests

docker-compose.yml                       # SHARED (PRE-APPROVED): +2 GHIN env lines
```

**Explicitly NOT in T3-4 (reserved for future stories):**
- T3-3 wiring of the GHIN search into the Add Player UI (the consumer story).
- T3-10 optional GHIN profile enrichment (player-action that fetches their own GHIN data).
- State-param flow-through (preserved hardcoded WV per §6).
- Rate limiting on the search endpoint.
- GHIN result caching beyond the 20-minute auth-token cache.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.4 (line 914-940).
- Wolf Cup source: `apps/api/src/lib/ghin-client.ts` (108 lines, last touched at SHA `3a38700303bd71a86c6de3621088fe161469d8b0` on 2026-03-02).
- Wolf Cup compose env: `docker-compose.yml:16-17`.
- Tournament env module: `apps/tournament-api/src/lib/env.ts`.
- Auth middleware: `apps/tournament-api/src/middleware/require-session.ts`.
- Existing route patterns: `apps/tournament-api/src/routes/courses.ts` (GET pattern), `apps/tournament-api/src/routes/admin-courses.ts` (Zod query param pattern).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Tournament Director skill, single-cycle invocation 2026-04-27).

### Debug Log References

- Spec codex: 3 rounds. R1: 0H+2M+3L (env-var nullability semantics, false console.error claim, state-param wording, missing state-ignored test, vi.mock fragility, PORTS.md visibility) — all fixed. R2: 0H+1M+2L (residual env-var-defaults wording at one line) — fixed. R3: 0H+0M+0L (terminal clean per AI-1).
- Impl codex: 1 round. R1: 0H+1M (false positive — codex miscounted my prompt's listed paths)+1L (test description wording — fixed). Effectively terminal clean.
- Mid-cycle: working tree had unrelated Wolf Cup pairing-history feature in progress (Josh's work, not mine). Stopped, asked Josh to commit Wolf Cup work separately. Josh committed as `201b00d`. T3-4 cycle resumed cleanly.
- Party-mode: single non-interactive written review. All 5 agents converged on "ship". Zero open questions. 11 non-blocking flags all defer/polish/inherited/production-rare.
- Party-codex: 0H+0M+2L (minor wording overconfidence in the review TEXT only).

### Completion Notes List

**Test deltas:**
- tournament-api: 277 → 291 (+14 new tests; 40% over AC #11 +10 minimum)
- Wolf Cup engine: 472 (unchanged ✓ AC #12)
- Wolf Cup api: 505 (unchanged or +6 from a separate Wolf Cup commit `201b00d`; either way no NET-NEGATIVE change ✓ AC #12)
- Wolf Cup `apps/api/src/lib/ghin-client.ts`: BYTE-UNCHANGED (verified via empty `git diff` ✓ AC #15)

**All checks green:** typecheck (api), lint (api), build (api).

**SHARED-gate footprint:** ONE pre-approved (docker-compose.yml +6 lines: 2 GHIN env vars + 4 lines of comment). No additional SHARED edits.

**Path footprint (8 ALLOWED + 1 SHARED pre-approved):**
- `apps/tournament-api/src/lib/ghin-client.ts` (NEW, 121 lines — ported from Wolf Cup SHA `3a38700303bd71a86c6de3621088fe161469d8b0`)
- `apps/tournament-api/src/lib/env.ts` (modified — +14 lines: GHIN_USERNAME + GHIN_PASSWORD as `z.string().optional()` + comment block)
- `apps/tournament-api/src/routes/players.ts` (NEW, 122 lines — 2 GET endpoints)
- `apps/tournament-api/src/routes/players.test.ts` (NEW, 256 lines, 14 tests)
- `apps/tournament-api/src/app.ts` (modified — 4 lines: import + mount playersRouter at /api/players)
- `apps/tournament-api/PORTS.md` (NEW — port-tracking table, 1 row)
- `apps/tournament-api/.env.example` (NEW — documents all tournament-api env vars)
- `docker-compose.yml` (SHARED pre-approved — +2 GHIN env vars + 4 lines comment under tournament-api.environment)

**Deviations from spec / Wolf Cup source (all approved at spec gate):**
- Provenance header lists deltas: env reads via `src/lib/env.ts` (was `process.env`); KNOWN LIMITATION state='WV' hardcoded (preserved from source).
- Optional env vars: `z.string().optional()` (NOT REQUIRED) — non-essential integration; container boots without GHIN creds; routes return 503 when null.
- requireSession (NOT requireOrganizer) — per epic AC #3, any authenticated player can search.
- vi.mock with mutable wrapper (lazy getter) — novel test pattern documented in players.test.ts:21-32.

**Manual post-deploy smoke (AC #13):** PENDING.
- Required after Josh sets GHIN_USERNAME + GHIN_PASSWORD in `/opt/wolf-cup/.env` and restarts the tournament-api container.
- Verify: `GET /api/players/search?name=Stoll` returns at least one result with the right shape; `GET /api/players/lookup?ghin=<josh's number>` returns Josh's current handicap; both return 503 when env vars unset; anonymous → 401.
- Until VPS env vars are set, T3-3's GHIN search path is gracefully unavailable (organizer falls back to manual-entry-only).

**Followups for future stories:**
- T3-3 wizard's "Add Player" UI must display state='WV' constraint in empty-state messaging (per Quinn's integration-risk note).
- T3-10 player profile view's "Refresh from GHIN" action must handle 503 gracefully.
- Future automation: CI check that warns when Wolf Cup's `apps/api/src/lib/ghin-client.ts` changes but PORTS.md `Last-checked-for-updates` hasn't been updated within 30 days (per Mary's process-hygiene note).
- Future hardening when multi-tenant lands: per-session rate-limit on /search and /lookup (per Mary's threat-model note).
- Future enhancement: promote `?state=` query param to flow through to upstream (currently hardcoded WV; PORTS.md lists this as KNOWN LIMITATION).
- Future polish: extract `endpoint` constant for log emissions in players.ts (per Amelia's Low note).
- Future refactor: promote umbrella `adminRouter` at ~5 mounts under `/api/admin` (per Winston's note; currently 3).

### File List

- `apps/tournament-api/src/lib/ghin-client.ts` — new
- `apps/tournament-api/src/lib/env.ts` — modified
- `apps/tournament-api/src/routes/players.ts` — new
- `apps/tournament-api/src/routes/players.test.ts` — new
- `apps/tournament-api/src/app.ts` — modified
- `apps/tournament-api/PORTS.md` — new
- `apps/tournament-api/.env.example` — new
- `docker-compose.yml` — modified (SHARED, pre-approved)
