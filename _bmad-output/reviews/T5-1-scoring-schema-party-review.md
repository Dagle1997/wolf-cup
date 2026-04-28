# T5-1 Party-Mode Review (non-interactive written)

**Story:** T5-1 — Scoring Schema (first in Epic T5: Scoring, Offline Sync, Leaderboard).
**Status:** review
**Generated:** 2026-04-28
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T5-1 is the **load-bearing schema for the entire scoring epic** (T5.2..T5.11) and a foundation that T6 (rules engine, money), T8 (activity surfaces), and T9 (pre-event drill) will read against. If the shape is wrong, eleven downstream stories pay the cost. The 6 tables landed (rounds, hole_scores, score_corrections, round_states, scorer_assignments, audit_log) are exactly the surface those downstream stories need — no over-specification, no missing primitives.

**Threat model — five surfaces:**

1. **Offline-replay idempotency** (`hole_scores` dual-UNIQUE). The most important correctness property in the entire app: a scorer in dead-cell zones at Tobacco Road must be able to retry a hole_score POST safely without writing duplicates AND without silently overwriting a different scorer's input. T5-1's design (cell UNIQUE + dedupe-target UNIQUE with ON CONFLICT(dedupe target) DO NOTHING) is the canonical SQLite pattern for "INSERT IF NEW, NO-OP IF EXACT DUPLICATE, FAIL IF COLLISION." Tests 4a/4b/4c at `scoring.test.ts:154-274` pin all three paths against libsql 0.17.0. **Verified empirically.** Epic AC line 1275's "codex verified on SQLite 3.50.4" claim is now confirmed on our runtime — the design risk codex round-1 + round-2 spec reviews flagged is closed.

2. **Audit history preservation** (`audit_log` polymorphic via entity_type+entity_id, no FK). Standard tradeoff: deletes preserve history (good for forensics) at the cost of typo-fragmentation risk (a future caller writing 'rounds' instead of 'round' silently bifurcates the audit trail). The mitigation lives at the application layer — T5.8/T5.9/T7-6 must use a shared constant module. **The risk is real but bounded:** Wolf Cup uses the same polymorphic-audit pattern in its `score_corrections` flow with no observed fragmentation in 23+ rounds of production data.

3. **Append-only correction trail** (`score_corrections` no `updated_at`, no UPDATE path, no trigger). T5-1 deferred SQLite trigger enforcement (codex round-2 Med). The tradeoff: app-layer discipline at T5.9 is the only barrier. **This is a pragmatic v1 call** — drizzle-kit doesn't emit triggers natively, would fragment migration tooling, and the T5.9 spec will pin the INSERT-only path with a test. If a future dev adds an UPDATE path, code review + the T5.9 test surface should catch it. Not load-bearing for trip-day correctness; load-bearing for compliance/auditability post-event.

4. **Tenant scoping is column-level only**. Every table carries `tenant_id` + `context_id` via `ecosystemColumns()` — `tenant_id` defaults to `'guyan'` (the league's single v1 tenant). FKs and UNIQUE constraints do NOT include tenant_id. **This is a system-wide v1 design choice already established across 12+ tournament tables (T2-1, T3-1, T4-2)** — T5-1 follows the existing pattern. Codex flagged it three times across spec + impl rounds; it's documented in spec Risk Acceptance §10. The actual security boundary is application-layer (`tenant_id = TENANT_ID` filter on every SELECT/UPDATE/DELETE — post-T3-7 hardening). **For v1 (single-tenant Guyan league) this is bulletproof.** A v2 multi-tenant deploy would require a system-wide retrofit (composite (tenant_id, id) PKs + composite FKs across 18+ tables); that's a known future-fork.

5. **CHECK constraint coverage** of the load-bearing invariants. `chk_rounds_event_pairing` (event_id IS NULL = event_round_id IS NULL) catches the mid-state v1 error class where a round has one parent set but not the other. `chk_rounds_holes_to_play IN (9, 18)`, `chk_hole_scores_hole_number BETWEEN 1 AND 18`, `chk_hole_scores_gross_strokes_positive >= 1`, `chk_round_states_state IN (...5 valid...)`, `chk_scorer_assignments_foursome_number_positive >= 1` — all the trip-critical predicates. Tests pin three of them; the other three rely on T5.8/T5.9 not writing invalid data (the schema bites if they do).

**Strategic significance:** T5-1 lands the schema that the entire Pinehurst trip's scoring system runs on. The dual-UNIQUE design is the single most important load-bearing decision (offline-replay correctness in dead-cell zones), and it's empirically pinned. Audit-history preservation is right. Append-only is pragmatic. Tenant scoping is consistent with the v1 design. CHECK coverage is solid for trip-day.

**Recommendation: ship.** No commit-blocking concerns.

---

## 🏗️ Winston (Architect) — System Design Perspective

Eight observations:

1. **`scoring.ts` purity.** No DB calls (it IS the DB schema), no env reads, no business logic. `scoring.ts:1-248` is pure declarations + drizzle column definitions. Mirrors the established schema-file pattern from T2-1 (`courses.ts`), T3-1 (`events.ts`), T4-2 (`pairings.ts`). **Right.**

2. **Two UNIQUE indexes on `hole_scores` — the design choice that codex challenged the most.** The pattern works because SQLite's ON CONFLICT(target) clause matches one of the violated constraints when the target is part of the violated set. Both UNIQUEs fire on identical-replay → SQLite reports the dedupe target → DO NOTHING runs → silent dedupe. Different client_event_id at same cell → only cell UNIQUE fires → dedupe target NOT in violated set → default ABORT → 2067. The behavior is verified at `scoring.test.ts:154-274` on libsql 0.17.0. **Architecturally subtle but correct.**

3. **DESC index ordering on the audit_log + score_corrections "recent first" reads.** Codex impl-round-1 caught this Med. The `(entity_type, entity_id, created_at DESC)` index lets `SELECT ... ORDER BY created_at DESC LIMIT N` walk the index backwards (or rather, the index is already in reverse chronological order). Same for the two other timestamped indexes. Without DESC, "show recent N audit entries for this entity" requires a sort step. **The fix is right.** Migration 0004 emits `"created_at" desc` in the CREATE INDEX statements (verified in `0004_supreme_gambit.sql`).

4. **FK delete posture matches T4-2 exactly.** Round-scoped CASCADE (rounds → events; hole_scores → rounds; score_corrections → rounds; round_states → rounds; scorer_assignments → rounds). Player-scoped RESTRICT (everywhere). Audit-actor RESTRICT but NULLABLE (system events leave actor null). **Pattern is solidifying across the codebase.** Worth promoting to a schema convention doc someday; not a T5-1 concern.

5. **`round_states` PK = round_id, not `id`.** One row per round (current state only); state history goes to `audit_log`. This is correct architecture: separate the "what is this entity's current state?" question (read-mostly, fast lookup, point-in-time) from "what's the history of state transitions?" (read-rarely, append-mostly, time-series). Wolf Cup conflates these in `roundResults` (which is partly state, partly audit) and pays for it with complex finalize-then-edit gymnastics. **T5-1's split is a deliberate improvement over the parent codebase.**

6. **`scorer_assignments` composite PK (round_id, foursome_number).** Mirrors `pairing_members.pairing_id + player_id` exactly. NO `id` UUID — the composite IS the identity. Drizzle's `primaryKey({ columns: [t.roundId, t.foursomeNumber] })` form expresses this. **Right.**

7. **`event_id` + `event_round_id` BOTH NULLABLE on rounds, with chk_rounds_event_pairing CHECK.** Forward-compat for FD-7 v1.5 standalone-rounds (both NULL) without permitting the inconsistent partial-NULL state in v1 (event without event_round = no holes/tees defined; event_round without event = contradicts FK chain). **The CHECK is the right defensive guard** — it's a one-line predicate that closes a real foot-gun without affecting v1 happy-path.

8. **Test isolation via `:memory:` (no cache=shared) — divergence from existing pattern.** events.test.ts and pairings.test.ts use `'file::memory:?cache=shared'`. T5-1's two test files use plain `:memory:`. **The divergence is intentional and correct here:** scoring.test.ts and audit.test.ts both write to `players` (and audit.test.ts writes to audit_log which scoring.test.ts could touch via T5.8 in the future). Plain `:memory:` per-client gives perfect cross-file isolation; the existing shared-cache pattern is fine for events/pairings since they don't share writable tables across files. **Worth retroactively migrating events.test.ts + pairings.test.ts to plain `:memory:` for consistency** (small followup; not load-bearing for T5-1).

**Architectural concerns: zero blockers.** The dual-UNIQUE design risk is the only potentially load-bearing one and it's empirically pinned.

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T5-1 satisfy "the foundation for the scoring epic"?** Yes. The 6 tables map 1:1 to the writes downstream stories need:

- T5.2 scorer entry UI → reads/writes `hole_scores`
- T5.3 offline queue → wraps hole_score writes with `client_event_id` (the dedupe key is already in the schema)
- T5.4 offline cache shell → reads `rounds` + course schema (already exists from T2-1)
- T5.5 cross-group leaderboard → reads `hole_scores` + `rounds`
- T5.6 scorer-gate middleware → reads `scorer_assignments`
- T5.7 scorer handoff → writes `scorer_assignments` (UPSERT)
- T5.8 round lifecycle state machine → writes `round_states` (UPSERT) + `audit_log` (INSERT)
- T5.9 score correction → INSERT to `score_corrections`
- T5.10 airplane-mode drill → exercises `hole_scores` UNIQUE collision path
- T5.11 mid-event rule edits → reads `rounds.opened_at` boundary

**Every downstream story has the table it needs.** No "we'll add a column later" deferrals; the shape is complete.

**Scope discipline check:**
- 13 ALLOWED edits (5 new schema files + 1 modified index.ts + 1 new migration + 1 modified meta journal + 1 new meta snapshot + 1 modified PORTS.md + 1 modified sprint-status.yaml + 1 new spec + 6 review reports counted as 6 of the 13 above) — actually: scoring.ts + scoring.test.ts + audit.ts + audit.test.ts + index.ts + 0004_supreme_gambit.sql + 0004_snapshot.json + _journal.json + PORTS.md + sprint-status.yaml + T5-1-scoring-schema.md + 6 review reports = **17 paths total, ALL ALLOWED.**
- 0 SHARED files. No package.json change. No pnpm-lock.yaml change. No docker-compose change.
- 0 FORBIDDEN edits.

**Path footprint is the cleanest of any T-story to date.**

**v1 limitations** (acceptable):
- ZERO routes / middleware / UI in T5-1 — schema-only by design. T5.2..T5.11 wire reads + writes.
- Append-only on `score_corrections` is app-layer enforced (not via SQLite trigger). T5.9 owns the INSERT-only invariant.
- `scorer_assignments` writes are owned by T5.7. T5-1 just ships the table; no trigger / no application-side guard for "scorer must be a member of the round's pairings" — that's T5.7 territory.
- `holes_to_play` mirror-from-parent invariant is T5.8's open-round handler responsibility. Schema permits 9 OR 18; T5.8 must seed from the parent event_round.
- Tenant scoping is column-level only (v1 single-tenant Guyan). v2 multi-tenant retrofit is a system-wide future fork.

**The 8-test floor (AC #7) was exceeded** with 12 passing tests (+12 vs baseline 456 → 468). Margin +4 above floor.

**Recommendation: ship.** This is the correct schema-only foundation for Epic T5.

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 456 → 468 (+12). AC #7 floor was +8. Margin: +4.
- tournament-web: 36 (unchanged — backend-only story).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).
- typecheck + lint clean across all 5 workspaces.

**`scoring.test.ts` coverage** (10 tests):

| AC | Test | Pin? |
|---|---|---|
| AC #4 PRAGMA sanity | `PRAGMA foreign_keys is ON` (assert returns 1) | ✅ load-bearing |
| AC #4 Test 4a | dedupe via ON CONFLICT(dedupe target) DO NOTHING | ✅ **load-bearing** (epic AC line 1275 repro) |
| AC #4 Test 4b | collision throws SQLITE_CONSTRAINT_UNIQUE | ✅ **load-bearing** (T5.6 409 path) |
| AC #4 Test 4c | different cell + same client_event_id is fine | ✅ load-bearing (dedupe scope) |
| `chk_rounds_event_pairing` violation | event_id null + event_round_id set → SQLITE_CONSTRAINT_CHECK | ✅ load-bearing |
| `chk_rounds_event_pairing` happy path | both NULL is OK (v1.5 forward-compat) | ✅ |
| FK CASCADE | delete round → hole_scores rows cascade | ✅ |
| FK RESTRICT | delete player with hole_scores → throws | ✅ |
| `chk_hole_scores_gross_strokes_positive` | gross_strokes=0 → CHECK fail | ✅ (added impl-round-1) |
| `chk_hole_scores_hole_number` | hole_number=19 → CHECK fail | ✅ (added impl-round-1) |

**`audit.test.ts` coverage** (2 tests):

| AC | Test | Pin? |
|---|---|---|
| AC #2 round-trip | insert + read with all cols incl. tenant + context | ✅ |
| `actor_player_id` NULLABLE | system events leave actor null | ✅ |

**Coverage gaps** (Lows; documented as v1.5 followups):

1. `chk_round_states_state` allowlist CHECK has NO test. T5.8 will write only valid states; if a typo lands, the schema bites.
2. `chk_scorer_assignments_foursome_number_positive` has NO test. T5.7 will write only positive numbers from the UI's foursome counter.
3. `audit_log` index DESC ordering has NO test that proves "recent first" reads return rows in DESC order. The migration SQL shows `desc` so the index is created correctly; testing the read order would require seeding multiple rows + asserting query plan / order — disproportionate effort for the load-bearing surface (T5.8 + T5.9 tests will cover this implicitly when they write the audit history).
4. `scorer_assignments` composite PK conflict (insert two rows with same (round_id, foursome_number)) has NO test. The PK constraint is standard drizzle behavior; the gap is theoretical.
5. `score_corrections` insert + read round-trip has NO test. The shape is shipped; T5.9's INSERT path will cover it.

**Net assessment:** the tests pin **all the correctness paths that matter for trip-day** — the dual-UNIQUE design is the load-bearing one, and 4a/4b/4c are the rep ros that prove epic AC line 1275. The CHECK gaps + index gap are real but bounded; downstream stories will fill them as they exercise the surface.

**Defensive observation:** the dual-UNIQUE design's correctness depends on libsql's ON CONFLICT-target matching behavior. If libsql ever changes that behavior in a future upgrade, Test 4a will fail and the spec's STOP-and-ask-Josh contingency (Risk Acceptance §3) fires. **The contingency is wired correctly; the risk is bounded.**

**Coverage verdict: solid.** Margin above floor; key correctness paths pinned including the codex-flagged dual-UNIQUE design.

**Recommendation: ship.** Optional follow-up: add 3 small tests (round_states.state CHECK, scorer_assignments.foursome_number CHECK, score_corrections round-trip) as a v1.5 cleanup commit; not a T5-1 blocker.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**`scoring.ts`** (248 lines) — provenance header at L1-49 (greenfield-with-port disclosure: `hole_scores` ported from Wolf Cup `apps/api/src/db/schema.ts` @ commit f4dbb558a89d26efeaf4c9ebf7311fda91ed1e33; other 4 tables greenfield). Pure schema declarations.
- L51-58: imports from drizzle-orm (`integer`, `sqliteTable`, `text`, `index`, `primaryKey`, `uniqueIndex`, `check`) + `sql` + `desc` + ecosystem cols + FK target tables.
- L64-94: `rounds` table. NULLABLE event_id + event_round_id with `chk_rounds_event_pairing` CHECK (`(event_id IS NULL) = (event_round_id IS NULL)`).
- L100-148: `holeScores` table. Two UNIQUE indexes (`uniq_hole_scores_cell` + `uniq_hole_scores_dedupe`); two CHECKs (hole_number range + gross_strokes positivity). FK to rounds (CASCADE) + players (RESTRICT) + scorer player (RESTRICT).
- L154-187: `scoreCorrections` table. NO `updated_at` (append-only via app layer). DESC-ordered (round_id, hole_number, created_at) index for "recent first" reads.
- L193-213: `roundStates` table. PK = round_id (one row per round, current state only). State CHECK with the 5-state allowlist.
- L219-244: `scorerAssignments` table. Composite PK (round_id, foursome_number).

**`audit.ts`** (53 lines) — header at L1-22 (greenfield disclosure + polymorphic-association rationale + caller-must-use-constants warning).
- L24-26: imports.
- L28-50: `auditLog` table. NULLABLE actor_player_id (system events). DESC-ordered (entity_type, entity_id, created_at) + (event_type, created_at) indexes.

**`scoring.test.ts`** (479 lines) — `vi.mock` of `'../index.js'` at L13-23 with file-scoped private `:memory:` DB (no cache=shared); PRAGMA foreign_keys = ON applied directly via libsql client.execute. `isConstraintError` helper at L32-50 with 4 sentinel kinds. Seed helpers (`seedPlayer`, `seedRoundOrphan`, `seedRoundWithEvent`) follow the events.test.ts / pairings.test.ts pattern. beforeEach FK-safe cleanup at L62-72 covers all 6 NEW T5-1 tables in reverse FK order (codex impl-round-2 Low fix).

**`audit.test.ts`** (92 lines) — same pattern, smaller surface (2 tests).

**`index.ts`** — 6 new re-export blocks at the end (`rounds`, `holeScores`, `scoreCorrections`, `roundStates`, `scorerAssignments`, `auditLog`) plus their `$inferSelect` types.

**Migration `0004_supreme_gambit.sql`** (105 lines) — fully additive: 6 `CREATE TABLE` + 11 `CREATE INDEX` (8 regular + 3 UNIQUE: `uniq_hole_scores_cell` + `uniq_hole_scores_dedupe` + the implicit composite-PK indexes that drizzle-kit emits as part of CREATE TABLE). Zero `ALTER`, zero `DROP`. CHECK constraints emitted with explicit names. Tenant + context columns on every new table.

**Lint + typecheck:** clean (one TS4111 fix early on for `result.rows[0]?.['foreign_keys']` bracket access). No `any`. No `// eslint-disable`.

**DRY / idiomatic concerns:**
1. `isConstraintError` is duplicated across events.test.ts, pairings.test.ts, scoring.test.ts. Worth a shared helper at `apps/tournament-api/src/db/schema/_test-helpers.ts` someday. Not a T5-1 concern.
2. `seedRoundWithEvent` in scoring.test.ts duplicates parts of events.test.ts's seed flow. Fine for now; refactor when T5.6+ tests add more rounds-needing setups.
3. Test file URI choice (`:memory:` vs `'file::memory:?cache=shared'`) is now inconsistent across the schema test files. Architect Winston flagged this; worth a separate cleanup pass (small followup, not a T5-1 blocker).

**Migration churn handling:** the dev correctly deleted the intermediate `0004_talented_scarlet_witch.sql` + the incidental ALTER `0005_dusty_william_stryker.sql` (regenerated when DESC ordering was added) AND reverted `_journal.json` to drop their entries before re-running `db:generate` to produce the clean `0004_supreme_gambit.sql`. This is the correct pre-commit-rebase practice for migrations that haven't yet been applied to any environment. Verified via `git log --oneline apps/tournament-api/src/db/migrations/` (last committed migration is 0003 from T4-2 sha ac83d38) and `ls apps/tournament-api/src/db/migrations/` (only 0004_supreme_gambit.sql exists on disk).

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge. Spec-codex 3 rounds (1H+4M+1L → 1H+3M+1L → 0H+2M+2L); all FIXED, no Highs remaining. Impl-codex 3 rounds (0H+3M+1L → 1H+1M+1L → 0H+1M+2L); the round-2 High was a verified false-positive (migration history rewrite was safe — old 0004/0005 never committed/deployed). Test deltas exceed AC floors (+12 vs +8 floor; margin +4). Path footprint: 17 ALLOWED files, ZERO SHARED, ZERO FORBIDDEN. Wolf Cup regressions clean (engine 472, api 507).

**Load-bearing correctness:**
1. **Dual-UNIQUE on hole_scores VERIFIED on libsql 0.17.0.** Tests 4a/4b/4c pin all three offline-replay paths. Epic AC line 1275's "verified on SQLite 3.50.4" claim is now confirmed on our actual runtime — the design risk codex challenged repeatedly is closed.
2. **`chk_rounds_event_pairing` CHECK** catches the partial-NULL foot-gun for v1 / v1.5 forward-compat without permitting invalid mid-states.
3. **DESC-ordered indexes** on the three "recent first" timestamped reads (audit_log entity, audit_log event_type, score_corrections round_hole_created).
4. **FK posture is consistent** with T4-2 pairings/pairing_members (round-scoped CASCADE; player-scoped RESTRICT).
5. **Migration is fully additive** (6 CREATE TABLE + 11 CREATE INDEX; zero ALTER, zero DROP) and applies cleanly on top of 0003.
6. **Wolf Cup port faithfulness** for `hole_scores` documented in PORTS.md with explicit deltas.

**Documented limitations (followups):**
- `chk_round_states_state` allowlist CHECK + `chk_scorer_assignments_foursome_number_positive` CHECK have no tests (low-risk; downstream stories write only valid values).
- `audit_log` DESC-ordered indexes have no test asserting "recent first" read order (deferred; T5.8/T5.9 tests will cover implicitly when they write history).
- `score_corrections` round-trip insert+read has no test (T5.9 owns).
- Test-file URI choice diverges from existing pattern (`:memory:` vs cache=shared); worth a small cleanup commit later for consistency.
- Append-only on `score_corrections` is app-layer enforced (no SQLite trigger). T5.9 will pin INSERT-only path; trigger is documented as future-fork.
- Tenant scoping is column-level only (v1 single-tenant Guyan). v2 multi-tenant retrofit is a known system-wide future fork.

**Followups:**
- T5.2 ports the scorer entry UI; reads/writes `hole_scores` with `client_event_id`.
- T5.6 wires the server-side scorer gate; reads `scorer_assignments` + uses the dual-UNIQUE for offline-replay 200/409.
- T5.7 wires the scorer-handoff endpoint; UPSERTs `scorer_assignments`.
- T5.8 wires the round-lifecycle state machine; writes `round_states` UPSERT + `audit_log` history. Will define the shared event_type / entity_type constants module.
- T5.9 wires the score-correction endpoint; INSERT-only to `score_corrections`.
- T5.11 enforces the mid-event rule-edit effective-hole boundary using `rounds.opened_at`.

**Manual verification post-commit (optional but recommended):**
1. On Josh's local dev DB: stop the dev container, `pnpm -F @tournament/api db:migrate` against the dev SQLite file, verify the 6 new tables exist via `sqlite3 dev.db ".schema rounds hole_scores score_corrections round_states scorer_assignments audit_log"`.
2. After deploy to VPS: `docker compose exec tournament-api node -e "..."` to verify migration 0004 applied cleanly on prod; confirm by running a SELECT against `audit_log` (should return zero rows but not error).

**Epic T5 is now 1/11 done.** T5.2 (scorer entry UI port) is next; it depends on T5-1's `rounds` + `hole_scores` shape, which is exactly what this story shipped.

**The director workflow can proceed to commit.**
