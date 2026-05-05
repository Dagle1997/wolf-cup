# T7-5 Party-Mode Review — Raw-State JSON Export (Organizer-Only)

**Format:** single-pass written review covering analyst, architect, pm, qa, dev, and ux-designer perspectives. Non-interactive; no questions for the user. The director ran party-mode after impl-codex round 2 (PASS, no findings) on a clean tree.

**Test status at review time:** tournament-api 848+2 → 864+2 (Δ +16); Wolf Cup engine 472 unchanged; Wolf Cup api 516 unchanged; tournament-web 172 unchanged. Typecheck + lint clean across all 6 workspaces.

---

## Analyst (Mary)

**AC compliance scan (AC-1 → AC-10):**

- **AC-1 — Endpoint shape.** PASS. Route at `apps/tournament-api/src/routes/export.ts` returns `Content-Type: application/json` + `Content-Disposition: attachment; filename="{slug}-{YYYYMMDD}.raw.json"`; integration test asserts the filename header matches the regex `pinehurst-2026-\d{8}\.raw\.json`. YMD computed in event timezone via `exportYmd`.
- **AC-2 — Body shape.** PASS. The integration happy-path test enumerates 36 top-level keys and asserts each is present. `schemaVersion: 1` constant. `warnings: []` for nominal events.
- **AC-3 — Type discipline.** PASS. Money cells / totals checked via `Number.isInteger`; ISO-8601 timestamps validated via regex; JSON-blob columns parsed via `tryParseJson` with raw-string fallback for malformed legacy rows; booleans retained.
- **AC-4 — FK referential integrity (closure invariant).** PASS. `players` is the explicit superset of every player_id referenced (organizer + members + uploaders + scorers + actors + invite creators + rule-set creators + result creators + press firers + pairing slots + audit actors). The round-trip helper inserts the dependency-closed subset needed for `computeMoneyMatrix` and the recomputed matrix deep-equals the exported one.
- **AC-5 — moneyMatrix verification parity.** PASS. The integration test's "round-trip — re-insert export into a fresh DB and recompute money matrix" case re-inserts player/course/event/round/group/rule-set/hole-score/bet rows into a fresh in-memory libsql instance with `PRAGMA foreign_keys = ON`, then asserts `matrixAfter.matrix === matrixBefore` (deep equal).
- **AC-6 — Auth chain.** PASS. 401 anonymous, 403 non-organizer, 404 unknown event for an authenticated organizer. Resolution order matches the spec's "401 < 403 < 404" claim.
- **AC-7 — Empty event.** PASS. The "empty event" test seeds an event with no rounds and asserts every collection is `[]`. `moneyMatrix.matrix` is non-null (computeMoneyMatrix returns the all-zeros structure for groups with no scores).
- **AC-8 — Filename slug edge cases.** PASS. Unit test covers `'Pinehurst 2026'` → `pinehurst-2026`, whitespace-only → `event`, `'!@#$%^'` → `event`, and length-overflow truncates at ≤60 chars. Trailing hyphen is stripped after truncation.
- **AC-9 — Test coverage.** PASS. 16 new tests (10 unit + 6 integration). The audit-log scope test seeds an unrelated event's audit row and asserts it does NOT appear in the target event's export.
- **AC-10 — Route mount + Wolf Cup unmodified.** PASS. Single line added to `app.ts`. `git diff master -- apps/api apps/web packages/engine` is empty.

**Verdict:** All 10 ACs are satisfied with concrete evidence.

---

## Architect (Winston)

**Boundary review (FD-1 / FD-2):**

Tournament-only, zero SHARED, zero FORBIDDEN. No new dependencies, no schema changes, no migration. The story is read-only at the storage layer — only SELECTs.

**Service layer split:**

`buildEventExport` lives in `services/export.ts` and is orthogonal to HTTP — the route is a thin try/catch wrapper. This separation lets the unit test exercise the helper directly (16 unit tests for the slug/ymd/filename helpers + the not-found case) and the integration test exercise the route. Same pattern as `services/money.ts`.

**Tenant scoping:**

After codex impl round 1, every query in the service carries `eq(<table>.tenantId, tenantId)`. v1 single-tenant means it's a no-op, but the structural posture is correct — when v1.5+ adds multi-tenant deployments, this code is already safe. Matches the require-event-participant middleware's tenant-scoped JOIN posture.

**Audit-log filter design:**

The OR-composed per-(entity_type, entity_id-list) predicate construction is the right architectural choice. The empty-IN-list short-circuit (filter empty pairs out, return `[]` if zero predicates remain) avoids both Drizzle's empty-IN footgun (`WHERE 1=0` on every row) and `or(...[])` undefined behavior. The `SCOPED_AUDIT_ENTITY_TYPES` type alias serves as the canonical allowlist; future entity_type additions to `AUDIT_ENTITY_TYPES` will fail the integration test that seeds one row per known type.

**Resolution order (auth vs existence):**

`requireSession` checks cookie → `requireOrganizer` checks `player.isOrganizer` → handler queries `events`. 401 < 403 < 404. An anonymous caller asking for a fake event id sees 401, not 404. A non-organizer participant sees 403. Only an authenticated organizer asking for a non-existent event sees 404 — which is acceptable for organizer-only endpoints.

**Memory profile:**

Single-shot `JSON.stringify` allocates the entire payload. v1 trip-scale (≤4 rounds × ~720 hole_scores + ~6 audit rows per round + tens of bets/sub-game rows) is in the low MB. Followup T7-5c (streaming) is captured if season-scale exports become a real demand. Acceptable v1 posture.

**Round-trip helper coverage gap (deliberate, scoped):**

The integration test's round-trip helper inserts the subset of tables needed by `computeMoneyMatrix` (players, courses+revisions+tees+holes, events, event_rounds, rounds, groups, group_members, rule_sets, rule_set_revisions, hole_scores, individual_bets, individual_bet_rounds). It does NOT re-insert round_states, scorer_assignments, score_corrections, pairings, pairing_members, sub_games, sub_game_participants, sub_game_results, team_press_log, individual_bet_presses, gallery_photos, audit_log. **This is by design:** AC-5 requires moneyMatrix parity, which only depends on the inserted subset. AC-4 (FK closure) is verified by the export builder enumerating all FK targets into `players[]` etc.; the helper's selective replay is a test-scope decision, not an architectural deficiency. **Architect note:** if a future story needs full-table replay (e.g., for a forensic-restore flow), the helper should be promoted to a shared `services/export-replay.ts` and exhaustively cover every table — followup T7-5f.

**Concerns:**
- **None blocking.** One forward-looking note: schemaVersion is `1` today; bumping to `2` for column-add stories should be paired with a migration helper that translates v1 exports into v2 shape. Out of scope for this story.

---

## PM (John)

**Scope discipline:**

The spec trimmed the settle-up "transfer suggestion graph" (X owes Y $Z) to followup T7-5b — the AC asks only for `perPlayerNetCents` (= money totals), and the web view computes the graph client-side. Holding the line on v1 minimalism while preserving the third-party-verification path (NFR-C1) is the right call.

**Operational readiness:**

- No new dependencies, no migration, no env changes. Deploys cleanly.
- The export endpoint is organizer-only — no privacy disclosure for a participant exporting their own data (separate followup if needed).
- Filename includes the YMD in the EVENT timezone, not server-local — Pinehurst-trip exports get the right date from anywhere.

**Followups captured:**

Spec's Followups section enumerates T7-5a (auth-audit endpoint), T7-5b (transfer graph), T7-5c (streaming), T7-5d (CSV per-table), T7-5e (R2 export hand-off), and T7-5f (full-table replay helper, added by architect note above). All clean handoffs to future stories.

**Concerns:**
- **None blocking.**

---

## QA (Murat)

**Test inventory:**

| Suite | New | Detail |
|---|---|---|
| `services/export.test.ts` | 10 | slug ASCII / non-alphanumerics / leading-trailing strip / 60-char cap / fallback; YMD timezone-honoring; YMD New York vs Auckland boundary day; filename happy + edge cases; null-on-unknown-event |
| `routes/export.integration.test.ts` | 6 | happy path (all 36 keys + type invariants), empty event, auth chain (401/403/404), audit-log scoping, round-trip parity, filename edge cases |

**Coverage strengths:**
- Round-trip parity test inserts into a TRULY fresh DB (separate `:memory:` libsql instance, fresh migrations). Catches FK violations on the actual SQLite engine, not mock.
- Audit-log scope test seeds rows in BOTH the target event AND an unrelated event, asserts cross-contamination is impossible.
- Filename edge cases include length-overflow + non-ASCII fallback.

**Coverage gaps (acknowledged + scoped):**
- The round-trip helper doesn't replay round_states / scorer_assignments / score_corrections / pairings / sub_games / team_press_log / individual_bet_presses / gallery_photos / audit_log into the fresh DB. This is acceptable per AC-5's narrow money-matrix-only parity; full-table replay is followup T7-5f.
- No test for the case "event has a self_only visibility group → warnings array populated". The service does emit the warning (lines ~177-181 of export.ts), but no integration test exercises it. **Recommendation:** add a Med-priority test in a polish pass; not blocking since the warning is a defensive future-proofing signal, not a load-bearing user-facing feature.
- No test for "event timezone is malformed → 500 with structured error code". The route correctly catches it (codex impl-round-1 High #1 fix), but no integration test seeds a malformed timezone string. Acceptable since the schema validates timezone at insert time.

**Concerns:**
- **None blocking.** The two coverage gaps above are non-blocking polish.

---

## Dev (Amelia)

**Code shape:**

`buildEventExport` is a long but linear function — 15 numbered query phases, each commented with its purpose, dependency-ordered (events → eventRounds → rounds → ... → audit → players closure). No magic, no clever abstractions. Adding a new schema column is a 2-line change (one in the SELECT, one in the row mapper).

**Type discipline:**

The `ExportPayload` type is `Record<string, unknown>` arrays per table — pragmatic given Drizzle's row type widening across the joins. The integration test's `Record<string, unknown>` casts mirror this; no `any` shortcuts.

**Error handling:**

The route's single try/catch wraps everything: payload build, filename construction, response body. Any exception bubbles up to `log.error` + structured 500. The empty-IN-list short-circuits in the service prevent malformed SQL on empty events. The `tryParseJson` helper tolerates malformed legacy JSON (returns the raw string rather than throwing).

**Reusability:**

`eventNameSlug`, `exportYmd`, and `exportFilename` are exported as standalone helpers. If a future story needs them (e.g., the followup CSV export T7-5d), they're already factored.

**Concerns:**
- **None blocking.** Nit: the export shape's nested `events: [{...}]` (single-element array for table-style consistency) plus `event: {...}` (single-object convenience) is mild duplication. But it's intentional per AC-2 — the array is for round-trip replay (insert as a row in `events` table), the object is for direct consumer access. Documented in the type comment.

---

## UX Designer (Sally)

**Surface area:**

This is a backend-only story — no UI, no web route, no user-facing surface. The export is consumed by:
- Organizers downloading the file via direct GET (browser shows the download dialog because of the Content-Disposition header).
- Third-party verifiers who receive the file and re-run the money matrix calculation.

**Filename UX:**

`pinehurst-2026-20260508.raw.json` is human-readable, sortable by date, and self-describing. The `.raw.json` suffix signals "this is the raw export, not a digested report". Good.

**Operator UX:**

When the organizer hits the URL, they get either:
- A JSON download (200 happy path) — works.
- A 401 redirect-to-login (anonymous) — handled by frontend in followup if needed.
- A 403 (non-organizer trying the URL directly) — JSON error body with `code: 'not_organizer'`.
- A 404 (unknown event) — JSON error body with `error: 'event_not_found'`.

There's no "loading" affordance for very large exports — single-shot JSON.stringify means the browser blocks until the full payload is ready. v1 trip-scale: imperceptible (low MB downloads in <1s on broadband). Future season-scale: T7-5c streaming.

**Concerns:**
- **None blocking.** No UI to review.

---

## Cross-cutting verdict

**Pass.** All 10 ACs are satisfied with concrete evidence. Codex impl review converged in 2 rounds (1 H + 3 M → 0 H + 0 M; round 2 PASS with no findings). Two non-blocking polish recommendations from QA (self_only visibility test, malformed timezone test) are captured as gravy for a future polish pass.

**Recommended next steps (none gate this commit):**
1. Add a self_only-visibility integration test to exercise the warnings-array path (Med priority).
2. Bump `services/export.ts`'s `tryParseJson` fallback to log a metric when malformed JSON is encountered, so the operator can see if any legacy rows have data quality issues.
3. Followups T7-5a..T7-5f remain captured in the spec; none are urgent for v1.

**Implemented changes from this party review:** none required. All recommendations are non-blocking polish or already-captured followups.
