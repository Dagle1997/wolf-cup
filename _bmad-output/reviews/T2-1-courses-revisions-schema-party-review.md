# T2-1 Party-Mode Review — Courses + Revisions Schema

**Story:** `_bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md`
**Mode:** Single non-interactive written pass — analyst, architect, pm, qa, dev.
**Date:** 2026-04-23
**Implementation status:** All 13 ACs implemented; codex spec 4 rounds PASS, codex impl 2 rounds PASS with zero High/Med remaining. Tests 73 → 85 (+12 new). Wolf Cup engine 468/468 + api 494/494 unchanged. Zero SHARED gates used.

---

## 📊 Mary — Business Analyst

**AC coverage:** all 13 ACs map to concrete artifacts.

| AC | Artifact |
| --- | --- |
| #1 (4 tables + columns + indexes + CHECK) | `src/db/schema/courses.ts` lines 41-152 |
| #2 (index.ts re-exports) | `src/db/schema/index.ts` lines 5-8 |
| #3 (ecosystem cols via factory, context_id insert-stamped) | All 4 tables use `...ecosystemColumns()` spread |
| #4 (MIXED FK delete posture) | `onDelete: 'restrict'` on course_revisions, `'cascade'` on tees/holes |
| #5 (migration 0001 auto-generated) | `0001_cloudy_chronomancer.sql` — drizzle-kit auto-named |
| #6 (fresh-DB migrate applies both 0000 + 0001) | verified via `rm data/tournament.db && db:migrate` |
| #7 (0000 byte-unchanged) | `git diff 0000_medical_typhoid_mary.sql` returns empty |
| #8 (≥12 tests) | `courses.test.ts` — 12 tests, all pass |
| #9 (typecheck + lint clean) | `pnpm -F @tournament/api typecheck lint` both exit 0 |
| #10 (total ≥85 tournament-api tests) | 85/85 passing |
| #11 (Wolf Cup regression) | engine 468/468 + api 494/494 unchanged |
| #12 (schema module has no runtime logic) | pure schema declarations + type exports; no helpers |
| #13 (rating × 10 integer-cents) | `course_tees.rating` is `integer`; test asserts round-trip on 723 = 72.3 × 10 |

**Observation — risk-acceptance sections are load-bearing.** The spec has TWO risk-acceptance sub-decisions:

1. **MIXED FK delete posture** (switched from CASCADE-everywhere per round-1 codex). Defensive against accidental `DELETE FROM courses` wipes.
2. **Two v1 tenant-integrity gaps** acknowledged: cross-tenant mismatch possible (composite-FK not enforced), and `tenant_id DEFAULT 'guyan'` from `ecosystemColumns()` factory enables silent tenant-default. Both will be hardened together in a future story when multi-tenant onboarding or a cross-tenant incident triggers it.

Both are documented in-spec with concrete revisit triggers. The `[v1-gap]` test captures current behavior as a regression-guard assertion-flip point.

**Observation — epic-text mismatch caught mid-spec.** The epic line 612 mentions migration `0002_*.sql`. Reality: T1-6a shipped `0000_medical_typhoid_mary.sql`, so T2-1 is `0001_*.sql`. Spec documented the correction; delivered migration matches spec. Clean catch before impl started.

**Observation — T2-2 and T2-5 inherit the v1-gap class.** The spec notes Epic T2's only inserters are T2-2 (seed script) and T2-5 (admin UI POST handler). Both should stamp `tenantId: 'guyan'` + `contextId: 'library:guyan'` explicitly, even though the default would "save" them. The T2-2 and T2-5 authors must read the spec's risk-acceptance section — flagging here so the next story specs include that reminder.

**Verdict (analyst):** AC coverage complete; risk-acceptance sections are clean; no missed user-flow concerns. Ship.

---

## 🏗️ Winston — Architect

**FD-6 ecosystem pattern extended cleanly.** All 4 new tables use `...ecosystemColumns()` for `tenant_id` + `context_id`. Zero divergence from the T1-6a posture. This means future tables (T3+ events, groups, scores) can use the same factory without schema drift — the pattern is now canonical across 8 tournament tables.

**FD-8 revisioning correctly expressed.** `courses` is the logical identity; `course_revisions` is the versioned child. Per-revision `tees` + `holes` are revision-exclusive (CASCADE on delete). Re-import pattern (AC #8 test case 11) confirms new revisions coexist with old ones on the same course — no data loss, no overwriting.

**Integer-cents discipline honored.** `course_tees.rating` stored as `integer` with units "rating × 10". Matches the engine's money/bets discipline from Wolf Cup. T2-5's form layer will handle the display transform. No floating-point creep into the DB.

**MIXED FK posture is architecturally sound.** The tradeoff: CASCADE-everywhere is simpler but data-loss-fraught; RESTRICT-everywhere requires multi-step deletes for every workflow. MIXED is the middle ground — revisions own tees/holes exclusively (CASCADE makes sense), but courses don't own revisions exclusively (future events will reference specific revisions, so RESTRICT is defensive).

**Layering check:** the schema file depends only on `drizzle-orm/sqlite-core` + the ecosystem factory. No forward dependencies on app-layer modules. No circular imports. Clean.

**Schema evolution posture for T2+:** the auto-generated migration ordinal `0001` + meta-journal handshake means T2-2 adds no new schema (just seed data), T2-5 adds no new schema (just CRUD against existing), T3-1 will generate `0002_*.sql` for the event/group schema. The migration pipeline is now proven end-to-end.

**Minor architectural note:** the `index.ts` file now has 7 re-exports (3 existing + 4 new). Still readable at a glance. If it grows to >15, consider sharding into `auth.ts`, `courses.ts`, etc. re-export barrels. Deferred decision.

**Verdict (architect):** FD-6 + FD-8 correctly expressed, no layering errors, no boundary violations (zero writes to Wolf Cup paths). Ship.

---

## 📋 John — Product Manager

**Scope discipline:** T2-1 stayed strictly in schema+test territory. Zero reaches into T2-2 (seed), T2-3 (parser), T2-4 (validator), T2-5 (UI). The T2-1 commit set is pure DB plumbing.

**SHARED gate count: zero.** No `pnpm-lock.yaml` updates, no `docker-compose.yml` changes, no env additions. Entirely within `apps/tournament-api/src/db/**` + existing test patterns. This is the first T2 story and it proves that schema-only stories don't need SHARED gates.

**Pinehurst schedule impact:** T2-1 took one cycle to close. Remaining T2 stories (T2-2, T2-3, T2-4, T2-5) are all unblocked:

- T2-2 (Pinehurst seed + course list API) depends on T2-1's schema — now available.
- T2-3 (PDF parser) is target-miss-tolerable per PRD; T2-1 doesn't affect its timing.
- T2-4 (validator) is pure-function engine work; depends on T2-1's data shape but not its schema directly.
- T2-5 (admin UI) depends on T2-2's `/api/courses` route and T2-1's schema.

All T2 stories are now in the "next backlog" queue. Director can pick up T2-2 next.

**Risk-acceptance framing held.** Spec picked up the T1 retro's action item AI-1 (cap spec codex at 4 rounds OR zero-High-zero-Med, whichever first) and it worked — round 4 returned PASS/no findings after 3 earlier rounds of legit Meds. No excessive wordsmithing.

**Two documented risk acceptances both defensible:**
1. MIXED FK delete posture — standard defensive pattern, matches codex's round-1 recommendation.
2. Two v1 tenant-integrity gaps — acknowledged, symmetric with T1-6a, future-hardening triggers concrete.

**Verdict (PM):** Scope clean, zero budget spent on SHARED gates, risk acceptances defensible, unblocks the rest of Epic T2. Ship.

---

## 🧪 Quinn — QA Engineer

**Test coverage:** 12 tests in `courses.test.ts` + 1 PRAGMA assertion in `beforeAll`. Pattern matches the established mock-db + migrate + in-memory libsql shape from `session.test.ts` + `auth.test.ts`.

**Coverage per AC #8 contract:**

| Test | What's exercised |
| --- | --- |
| round-trip insert courses | Ecosystem cols persist, nullable fields behave |
| round-trip insert course_revisions | All 10+ fields including nullable sourceUrl/extractionDate, verified boolean, 3 totals |
| UNIQUE (course_id, revision_number) | Prevents duplicate revisions |
| UNIQUE (tenant_id, club_name, name) | Prevents duplicate courses — round-1 codex MED fix |
| UNIQUE (course_revision_id, tee_color) + rating round-trip | 723 = 72.3 × 10 integer-cents |
| 18 course_holes insert + JSON round-trip | Per-tee yardages survive round-trip via `JSON.parse` |
| UNIQUE (course_revision_id, hole_number) | Prevents duplicate hole rows |
| CHECK on hole_number + si (0/19 rejected) | DB-level range enforcement — round-1 codex LOW fix |
| FK RESTRICT on courses (delete fails with revisions) | Defensive posture — round-1 codex MED fix |
| FK CASCADE on revisions (tees + holes wiped) | Revision-exclusive ownership |
| Re-import pattern (new revision on same course) | Old revision preserved, NFR-D2 contract |
| [v1-gap] cross-tenant mismatch possible | Regression-guard assertion-flip point — round-1 codex HIGH acknowledgment |

Every AC #8 item has a dedicated test. All 12 pass.

**Notable test-infrastructure improvements:**
- `PRAGMA foreign_keys = ON` is explicitly enabled in the mock DB setup (SQLite's default is OFF). Round-1 codex MED flagged this as load-bearing; the `beforeAll` PRAGMA-state assertion is a regression guard.
- `isUniqueConstraintError` / `isConstraintError` helpers reuse the T1-6b drizzle-`.cause`-unwrap pattern. Pinned contract; any drizzle shape-drift fails loudly.
- PRAGMA assertion tolerates numeric/string/boolean return types from libsql (round-2 codex LOW fix — defensive against version-drift in the libsql driver).

**Edge cases NOT tested but acceptable:**
- Inserting a `course_revisions` row with `revisionNumber = 0` or negative. The validator (T2-4) enforces ≥1; schema allows any integer. Known-limitation, documented.
- Inserting `course_tees.rating < 50` or `> 100`. Out-of-USGA-range values are a validator concern (T2-4), not a schema concern.
- Very long JSON yardagePerTeeJson (e.g. 10KB). SQLite has no practical limit; app-level Zod would reject. Not blocked here.
- Foreign-key constraint on a non-existent `course_id` in `course_revisions`. SQLite rejects with FK violation; covered implicitly by the CASCADE and RESTRICT tests.

**Verdict (QA):** Every AC #8 path exercised; test-infrastructure hardening (PRAGMA assertion) catches future regressions. No missing critical paths. Ship.

---

## 💻 Amelia — Developer Agent

**`courses.ts` shape match:** spec AC #1 column names, types, indexes, CHECK constraints, and onDelete actions all match the implementation line-for-line. No drift. 4 table-config `(t) => ({...})` blocks with explicit named indexes — readable.

**Migration `0001_cloudy_chronomancer.sql`:** auto-generated by drizzle-kit, not hand-edited. Contents inspected:
- `CREATE TABLE` statements in dependency order (course_holes + course_tees + course_revisions reference course_id/course_revision_id which are FK'd).
- FK clauses: `ON DELETE cascade` on tees + holes (lines 10, 43), `ON DELETE restrict` on course_revisions → courses (line 30).
- CHECK constraints inline in CREATE TABLE for course_holes (lines 11-12).
- UNIQUE indexes as CREATE UNIQUE INDEX after each table.

**`index.ts` re-exports:** 4 new lines added at the bottom in one block. Ordering: existing (players, oauth_identities, sessions) first, then course library. Matches project convention.

**Test patterns honored:**
- `vi.mock('../index.js', async () => {...})` with in-memory shared-cache libsql.
- `migrate(db, { migrationsFolder })` in `beforeAll`.
- `beforeEach` clears all 4 tables in dependency order.
- Helper fixtures (`insertCourse`, `insertRevision`) reduce test-file line count.
- `isUniqueConstraintError` + `isConstraintError` helpers for robust error-shape assertions.

**Integer-cents comment:** annotated inline at `course_tees.rating` (`// 72.3 × 10 → 723`). T2-5's form-layer transform is cross-referenced in the file-level docstring.

**`[v1-gap]` test naming convention:** explicit marker makes it easy for a future dev to grep for all such assertions when hardening lands.

**Minor code-quality notes:**
- `isConstraintError` with `kind: 'FOREIGNKEY' | 'CHECK'` is a small enum-dispatch helper. Could be split into two functions but the branching is trivial.
- The PRAGMA assertion uses a dynamic import of `../index.js` inside `beforeAll`. Could cache the module at top level, but the dynamic shape avoids circular-mock-ordering issues with the `vi.mock` hoist.

**Docstring in courses.ts** is substantial (35 lines) — covers table purpose, FD-6 + FD-8 references, FK delete posture, tenant scoping, integer-cents, and both v1 gaps. Future devs reading this file get the full context in one read.

**Verdict (dev):** Clean, idiomatic, well-documented. No refactor debts introduced. Ship.

---

## 🎯 Verdict

**Ship as-is.** All 13 ACs implemented; codex spec 4 rounds + codex impl 2 rounds both PASS; 12/12 tests green; Wolf Cup regression-clean; zero SHARED gates consumed; three documented risk acceptances all defensible with concrete revisit triggers. Epic T2 is unblocked for T2-2 (Pinehurst seed + course list API) immediately.
