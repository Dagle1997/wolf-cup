# T3-4 Party-Mode Review (non-interactive written)

**Story:** T3-4 — GHIN Client Port. Pure port from Wolf Cup with two new HTTP endpoints.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-4 is the bridge between two ecosystems: tournament-api gets read access to Wolf Cup's proven GHIN integration without touching the source. Strategic value: T3-3 (Group CRUD) can now ship its full epic AC instead of a manual-only fallback, and T3-10 (optional GHIN profile enrichment) is unblocked too. Two future T3 stories pulled forward by one port.

**Threat model — five surfaces worth flagging:**

1. **GHIN credential exposure.** The ENV vars (`GHIN_USERNAME`, `GHIN_PASSWORD`) live on the VPS in `/opt/wolf-cup/.env`. Same exposure as Wolf Cup has had since 2025. The credentials are the GHINcom golfer login (Josh's account) — a leak gives an attacker access to view-only GHIN data via that account, NOT to modify any tournament-api state. **Acceptable v1; same posture as Wolf Cup.**

2. **GHIN number brute-force enumeration via `/lookup`.** Any authenticated player can call `GET /api/players/lookup?ghin=<num>` and learn whether the number exists + the bound handicap. With ~3M active GHIN holders and 8-digit numbers, brute-forcing is impractical — but the endpoint is unauthenticated-rate-limit-free. **Mitigation in production: organizer is the ONLY authenticated player at v1 (single-tenant single-event posture).** When T3-6's invite-claim flow ships, the player pool grows to the 8-player Pinehurst crew; brute-force is still impractical at 8 attackers. **Future hardening if multi-tenant lands: rate-limit per-session.**

3. **GHIN search privacy.** `GET /api/players/search?name=<lastname>` returns first/last name + handicap + club + state (WV-only via the hardcoded delta). Same data Wolf Cup has been exposing since 2025. The `/search` endpoint requires authentication (not anonymous), which is the meaningful gate. **Acceptable v1.**

4. **Token cache TTL (20 min) preserved.** A short-lived cache means an exposed token has limited useful window. The token is server-side-only; never returned in API responses. **Solid.**

5. **CSRF posture.** Both endpoints are GET — exempt from the CSRF middleware by design (CSRF only fires on unsafe methods). No CSRF token plumbing needed. **Correct.**

**One v1 limitation worth flagging:** PORTS.md's `Last-checked-for-updates` column says 2026-04-27 (today). When Wolf Cup updates its ghin-client.ts (rare but possible — auth flow changes, GHIN API breakage), the column doesn't auto-refresh. **Process hygiene:** the next time Josh updates Wolf Cup's ghin-client.ts, he should manually update PORTS.md's Last-checked column AND review whether the port needs a fresh delta. Documented in PORTS.md but easy to forget. Consider a future automation story (e.g., a CI check that warns when Wolf Cup's source changes but PORTS.md last-checked hasn't been updated within 30 days).

**Recommendation: ship.** Threat surface is essentially identical to Wolf Cup's (which has been in production for a year+); the port doesn't introduce new risk vectors.

---

## 🏗️ Winston (Architect) — System Design Perspective

Clean port. Six observations:

1. **The provenance header + PORTS.md combination is the right pattern for this codebase.** The header is local context (a developer reading the file sees its origin immediately); PORTS.md is the central audit log (someone scanning for "what came from Wolf Cup" finds everything in one table). Both are needed; one alone is insufficient. **Promote this pattern to all future ports** — T7's photo-gallery port, any utility ports, etc. The pattern is now established.

2. **The optional-vs-required env-var split** is internally consistent: AUTH_COOKIE_DOMAIN / PUBLIC_APP_URL / GOOGLE_OAUTH_* / ANTHROPIC_API_KEY are REQUIRED (no defaults; Zod fails-fast at boot). GHIN_USERNAME / GHIN_PASSWORD are OPTIONAL (`z.string().optional()`; client falls back to null). The split aligns with "load-bearing for app function" vs "graceful-degradation feature." When future env vars are added, this is the question to ask first. **Sound architectural pattern.**

3. **The `ghinClient` singleton at module-load** is the simplest expression of the truthy-check. Wolf Cup's source uses the same pattern (`process.env['X'] && process.env['Y'] ? new ... : null`). Tournament-api's port preserves the shape; the only delta is the env source. A more "modern" pattern would be DI (the route accepts a client instance via the Hono context) — that's a refactor for a future story when DI is broadly desirable, NOT now. **Hold the singleton; revisit when 3rd consumer needs different env source.**

4. **vi.mock with the mutable getter** (test pattern) is novel in this codebase but the right shape for the use case: the same module needs to evaluate as "has client" in some tests and "is null" in others. A non-getter approach would either need two test files (overkill for 14 tests) or `vi.doMock + vi.resetModules` (which has subtle hoisting issues). The getter pattern works because vi.mock factories support arbitrary code, including `Object.defineProperty`-like getters. **Idiomatic for this scenario.**

5. **The two-router pattern for /api/admin** has now grown to THREE routers under that prefix (adminCoursesRouter, adminEventsRouter, T3-3 next will add adminGroupsRouter). Promote umbrella pattern at ~5 mounts; we're at 3. **Hold for now**; track in follow-up notes.

6. **The state='WV' hardcoding preserved** is the correct call for v1 (pure port, byte-for-byte upstream behavior). The PORTS.md "KNOWN LIMITATION" column makes this immediately visible. Future enhancement is a 2-line client change + a "Deltas" PORTS.md update. **Future-readers won't be surprised.**

**Architectural concerns: zero blockers.** Ship.

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-4 satisfy organizer-facing value?** Indirectly — it doesn't ship a UI surface; it unblocks T3-3 (Group CRUD with GHIN search) and T3-10 (optional GHIN profile enrichment). The user-value capture happens at T3-3 ship-time when an organizer can search for "Stoll, WV" and pick a player from a list of GHIN matches.

**Connection to product:**
- T3-3 wizard's "Add Player" flow now has a GHIN-search path → handicap auto-fills → fewer typos than manual entry.
- T3-10 future story: a player views their own profile and clicks "Refresh from GHIN" → handicap updates from upstream without re-entering.
- Both consumer stories unblocked by T3-4. **Strategic value at the epic level.**

**Scope discipline: tight.**
- Pure port — no logic invented.
- ONE SHARED gate (docker-compose.yml +2 env lines + comment), pre-announced + pre-approved.
- 14 backend tests using vi.mock'd singleton (no real network calls in CI).
- Risk Acceptance §1's prediction held — the SHARED edit was the ONLY one needed.

**Production VPS env-var setup:**
- T3-4 ships TODAY without GHIN_USERNAME / GHIN_PASSWORD set on VPS → endpoints return 503 service_unavailable. **Acceptable for ship**; T3-3 will work in manual-entry-only mode until Josh adds the creds.
- Josh adds `GHIN_USERNAME=...` + `GHIN_PASSWORD=...` to `/opt/wolf-cup/.env` whenever ready. No re-deploy needed for env-only changes (compose re-reads `.env` on container restart).

**Concerns / observations:**

1. **The GHIN search currently hardcoded to WV** is acknowledged in PORTS.md but not yet a v1 user-visible limitation (T3-3 will surface it when an organizer tries to add an out-of-state player). Future polish: promote `?state=` to flow through. **Documented; future story.**

2. **No /api/players/me or self-lookup endpoint.** A player can search for OTHER players but not look up themselves by id. v1 use case (organizer adding crew) doesn't need this; T3-10 may add a self-action. **Out of T3-4 scope.**

3. **Manual smoke against real GHIN** is required before T3-3 ships. Verify:
   - `GET /api/players/search?name=Stoll` (Josh's last name) returns at least one result with valid shape.
   - `GET /api/players/lookup?ghin=<josh's number>` returns his current handicap.
   - Both endpoints 503 when env vars unset.
   - Anonymous → 401 session_missing.
   This is AC #13's manual smoke, acknowledged pending VPS env setup.

**Recommendation: ship.** AC #13 manual smoke is the final gate (post-VPS env setup).

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis.** Test deltas:
- @tournament/api: 277 → 291 (+14 backend tests; 40% over AC #11 minimum of +10).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 505 (unchanged-or-positive — pairing-history feature commit added 6 tests separately).
- Wolf Cup `apps/api/src/lib/ghin-client.ts`: BYTE-UNCHANGED (verified via empty `git diff`).

**Test inventory** (players.test.ts):

| # | Test | Coverage |
|---|---|---|
| 1 | Search happy path: 200 with results array; client called with `name` only | Persistence + payload shape |
| 2 | Search no upstream matches: 200 `{ results: [] }` (NOT 404) | Empty-result correctness |
| 3 | Search Zod miss: empty `name` → 400 `invalid_query` | Schema validation |
| 4 | Search anonymous: 401 `session_missing` | requireSession middleware |
| 5 | Search null client: 503 `ghin_unavailable` | Singleton-null branch |
| 6 | Search upstream throws GHIN_UNAVAILABLE: 503 `ghin_unavailable` | Error mapping |
| 7 | Search `?state=NY` IGNORED — client called with name only | KNOWN LIMITATION regression guard |
| 8 | Lookup happy path: 200 `{ ghinNumber, handicapIndex }` | Payload shape |
| 9 | Lookup NOT_FOUND from upstream: 404 `ghin_not_found` | Error type → HTTP code mapping |
| 10 | Lookup null client: 503 `ghin_unavailable` | Singleton-null branch |
| 11 | Lookup Zod miss: missing `ghin` query param → 400 `invalid_query` | Schema validation |
| 12 | Lookup Zod miss: `ghin=abc` (non-numeric) → 400 `invalid_query` | z.coerce.number() coverage |
| 13 | Lookup anonymous: 401 `session_missing` | requireSession middleware |
| 14 | Lookup upstream throws GHIN_AUTH_FAILED: 503 `ghin_unavailable` | Generic error mapping |

**Failure modes well-covered:**
- ✅ Both endpoints have happy-path + Zod miss + auth + null-client + upstream-throw tests
- ✅ Empty-search-result (NOT 404) explicitly distinguished
- ✅ NOT_FOUND → 404 distinct from other errors → 503
- ✅ z.coerce.number() rejects non-numeric input
- ✅ KNOWN LIMITATION (state ignored) pinned by regression test — future change must update
- ✅ vi.mock mutable wrapper + afterEach reset prevents test bleed

**Failure modes NOT covered (acceptable Lows / inherited polish):**

- **Token cache expiry race.** If two concurrent requests both find `tokenExpiry < Date.now()`, both will re-authenticate. Wolf Cup's source has the same race. Inherited; not a new bug. Production-rare.
- **Network-timeout / abort during fetch.** The client's `fetch` has no timeout configuration; a hung GHIN response would hang the route. Inherited from Wolf Cup. Production-rare; the GHINcom auth flow is fast in practice.
- **Token caching across server restarts.** No persistence — a container restart means re-auth on first request. Acceptable; the cache is a perf optimization not a correctness invariant.
- **Concurrent /search and /lookup hitting expired token.** Both will independently re-auth; both will succeed; the cache simply gets written twice. No correctness issue; minor perf inefficiency.
- **Real-network smoke.** Mocked tests don't catch upstream API breakage. AC #13 manual smoke covers this once GHIN env vars are set on VPS.
- **Per-session rate limiting.** Anyone authenticated can call /lookup repeatedly. Not in T3-4 scope. Future hardening if multi-tenant arrives.

**Integration risks that surface at T3-3 / T3-10 time:**

- **T3-3's UI must display state='WV' to the organizer** so they're not confused why "Stoll, OH" doesn't appear. The PORTS.md limitation needs to surface in the wizard's GHIN-search empty-state message.
- **T3-10 must handle 503 gracefully** (a player viewing their profile without GHIN env vars set should see "GHIN unavailable" — not crash).

**Residual risk: low.** The test pyramid covers every load-bearing failure mode for the CLIENT and the routes. The 5 untested edges are inherited from Wolf Cup's source (same posture in production for 1+ year), production-rare, or downstream-spec problems.

**Recommendation: ship.** AC #13 manual smoke is the final gate (post-VPS env setup).

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Six observations:

1. **The provenance header is information-dense but reads well.** Lists the source SHA (full 40 chars), the date, the scope (lookup-by-GHIN + search-by-name), AND the deltas. A future reader sees "what was changed and why" without needing PORTS.md OR a side-by-side diff. **Set the bar for all future port headers.**

2. **The mutable wrapper for vi.mock** is non-obvious code. The `let mockGhinClient` + `vi.mock(... { get ghinClient() { return mockGhinClient; } })` pattern relies on the getter being evaluated at every property access — meaning a `mockGhinClient = null` reassignment is visible to subsequent route handler calls. Verified empirically by tests that flip the value mid-test. **Pin a comment** (currently 4 lines of comment in players.test.ts) so future test-writers don't naively replace this with a static factory.

3. **Co-locating the CLIENT + the singleton in one file** (ghin-client.ts:118-121) is the same shape as Wolf Cup's source. Alternative: split into `class GhinDirectClient` in one file + `singleton.ts` for the env-conditional instantiation. The current shape is simpler for v1; revisit if a 3rd consumer arrives that wants the class without the singleton.

4. **No `// eslint-disable`, no `as any`, no implicit any.** Casts are limited to:
   - `as { cause?: unknown }` in error narrowing — standard Node Error union narrowing.
   - `as { golfers?: GhinGolfer[]; ... }` in fetch JSON parsing — narrowing untyped JSON to the expected upstream shape. Same as Wolf Cup.
   - The vi.mock factory's `get ghinClient() { return mockGhinClient; }` — TypeScript permits this without explicit return-type annotation; vitest's mock module typing flows through.

5. **`.env.example` is comprehensive** — documents EVERY env var the tournament-api uses, not just the new GHIN ones. A new developer cloning the repo can copy `.env.example` to `.env` and have a working starting point. **Quietly valuable for onboarding.**

6. **Two minor cleanup items (Lows):**
   - The route handler's structured log emits `event: 'ghin_call_failed'` with `endpoint` + `reason`/`message`. The `endpoint` value is hardcoded ('search' or 'lookup'). Could be extracted to a constant. Trivial; future polish.
   - The Zod schema for `lookupQuerySchema` uses `z.coerce.number().int().positive()`. The `.int()` coerces "1.5" to error AND "1.0" to error — actually no, `.int()` rejects 1.5 but accepts 1 (after `.coerce.number()` truncates "1.0" → 1.0 → passes int() check). Subtle but correct. **Acceptable.**

**Mid-impl observations worth noting:**

- **Wolf Cup ghin-client.ts is byte-unchanged** (verified via empty `git diff`). The port READS the source, never modifies it. This is the load-bearing FD-1 / FD-2 invariant; future ports should verify the same.
- **The path classification audit** (T3-4 has 8 ALLOWED + 1 SHARED pre-approved) was clean. Mid-cycle, the user committed an unrelated Wolf Cup pairing-history feature in a separate commit (commit `201b00d`) so that work didn't bleed into T3-4's commit. **Good co-development hygiene.**

**No blockers.** Ship.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T3-4 as-is** (after AC #13 manual smoke once VPS env vars are set).

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Mary | PORTS.md "Last-checked-for-updates" requires manual hygiene | Future automation story |
| Mary | GHIN brute-force enumeration via /lookup | v1 acceptable; rate-limit if multi-tenant lands |
| Winston | 3rd /api/admin mount + future /api/players router | Promote umbrella pattern at ~5 mounts |
| Winston | Singleton vs DI pattern | Revisit when 3rd consumer needs different env source |
| John | WV hardcoding affects T3-3 UX | T3-3 must surface in empty-state message |
| John | No /api/players/me self-lookup | Future T3-10 polish |
| Quinn | Token cache expiry race | Inherited from Wolf Cup; production-rare |
| Quinn | No fetch timeout configuration | Inherited; production-rare |
| Quinn | No per-session rate limiting | Future hardening if multi-tenant |
| Amelia | Endpoint constant in log emission | Trivial future polish |
| Amelia | vi.mock mutable wrapper non-obvious | Comment in test file documents it |

**No agent has open questions for the user.** No proposed code changes warrant another impl iteration. **Director may proceed to step 9 (codex-on-party-review).**

Epic T3 progress: 2/10 done (T3-1, T3-2). T3-4 commit pending. T3-3 (Group CRUD UI) is up next, now unblocked from full-AC ship.
