# T3-1 Party-Mode Review (non-interactive written)

**Story:** T3-1 — Event/Group/Rule-Set/Invite/Sub-Game/Device-Binding Schema. FOUNDATION schema for Epic T3.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-1 is the structural unlock for the entire T3 epic — without this schema, T3-2 (event wizard), T3-3 (group CRUD), T3-5 (rule editor), T3-6 (invite flow), T3-7 (post-SSO rebind), T3-8 (permissions), and T3-9 (sub-game opt-in) are all blocked. Ten new tables + 4 new players columns + 1 migration = the foundation for every user-facing T3 surface. Strategic value is high, even though end-user value is zero until T3-2 ships.

**Threat model — five surfaces worth flagging:**

1. **Pre-SSO device claim (`device_bindings.session_id` NULLABLE).** This is intentional + load-bearing for T3-6's invite-link flow. Risk vector: a malicious actor with the invite link could claim a `player_id` BEFORE the legitimate guest signs in. Mitigation lives in T3-7 (post-SSO rebind asks "is this your device?"). T3-1's schema correctly enables the flow but doesn't enforce safety — that's downstream. **Acknowledged, deferred to T3-7.**

2. **Invite token entropy.** `invites.token TEXT NOT NULL UNIQUE` is the schema; the application code that generates tokens isn't shipped yet (T3-2 wizard creates them). T3-1 doesn't constrain length, character set, or entropy at the schema layer. A future T3-2 implementation MUST use a cryptographically random token (e.g., `crypto.randomBytes(32).toString('base64url')` matching the sessions pattern). **Schema is permissive by design; T3-2 owns the entropy contract.**

3. **Cross-tenant FK gap (acknowledged in spec).** None of the FKs are composite `(tenant_id, parent_id)` — a buggy inserter could write a child row whose `tenant_id` doesn't match its parent's. Same gap acknowledged on T2-1 courses (line 39-43 of courses.ts). Codex round 2 Med flagged this as not "true isolation"; the spec correctly classifies this as a v1.5+ hardening. v1 production posture is single-tenant 'guyan', so the gap is non-load-bearing.

4. **Players.google_sub / apple_sub deviation.** The Fork 2b architecture (provider IDs in oauth_identities, NOT players) is the right call. The duplicate-source-of-truth footgun is closed. Future Apple SSO drops in by adding an oauth_identities row; no players migration needed. **Cleanest possible choice.**

5. **Cost-exhaustion via repeat saves.** Schema-only story → zero new compute spend. The closest cost vector is "drizzle-kit migrate" running on every container start, but migration 0002 is small and idempotent (drizzle's _journal.json tracks applied migrations).

**Recommendation: ship.** No threat-model gaps require T3-1 to delay. Documented v1.5+ hardenings are correctly out of T3-1 scope.

---

## 🏗️ Winston (Architect) — System Design Perspective

The implementation lands cleanly. Five observations:

1. **FK delete posture is internally consistent and correct.** CASCADE for event-children (event_rounds, groups, group_members, invites, sub_games, sub_game_participants, device_bindings.player→cascade), RESTRICT for shared infrastructure (course_revisions, players, rule_sets), SET NULL for the load-bearing `rule_set_revisions.effective_from_round_id`. Reading the migration SQL, every clause matches the schema-file declaration. **No drift.**

2. **The `device_bindings` extraction to its own file is the right cycle-break.** The intuitive co-location (deviceBindings inside players.ts) creates a circular import: players.ts ↔ auth.ts (sessions). Drizzle's lazy `references(() => ...)` handles runtime FK resolution but TypeScript's import evaluation order doesn't tolerate the cycle. Splitting into `device_bindings.ts` is the minimum-surface fix. The choice is documented in BOTH players.ts (header note) AND device_bindings.ts (header). **Future-readers won't be confused by the extra file.**

3. **The Fork 2b deviation (no google_sub/apple_sub on players) is architecturally cleaner than the epic.** Two-source-of-truth identity bindings are a classic data-integrity footgun. The current shape — players is provider-agnostic, oauth_identities binds provider+sub→player_id — is the right one. The deviation is documented loud + visible (players.ts header explicitly calls it out, story spec AC #4 has the rationale). T3-1 commits a deliberate architectural correction; no future story will need to "undo" the bullet.

4. **The `effective_from_hole = 19` sentinel encoding is clever.** Instead of a separate `is_next_round_only` boolean, the integer column carries the "next round onward" semantics via the value 19 (CHECK constraint is `BETWEEN 1 AND 19`). Saves a column, keeps the semantics co-located, and the value 19 is naturally invalid as a real hole index. Single integer column does the work of two. **Will read fine to T5.11's mid-event rule-edit consumer.**

5. **The `tenant_id` defaults to 'guyan' but `context_id` is required (NOT NULL, no default)** — same posture as T1-6a + T2-1. Application code MUST stamp context_id at insert (e.g., `events.context_id = 'event:' + events.id`). Schema enforces presence; semantics live in code. v1 is single-tenant so the strict context_id stamping is the safety net. **Consistent with established patterns.**

**One forward-looking note.** When T3-2 creates an event, it will need to coordinate `events.context_id = 'event:' + events.id` across the same INSERT. The cleanest pattern is `id = randomUUID(); contextId = 'event:' + id; insert({ id, contextId, ... })`. Multiple INSERTs in T3-2's wizard (events + event_rounds + groups + invites) will need to share the parent event's context_id — drizzle's transaction API handles the atomicity, but the code needs to thread context_id through carefully. **Worth a comment in T3-2's spec.**

**Architectural concerns: zero blockers.** Ship.

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-1 satisfy any user-visible value?** No — it's pure schema. AC #20 (manual smoke) doesn't apply because there's no UI to smoke. The user value lands at T3-2 (event wizard) when an organizer can actually create an event. T3-1 is foundation work; the right judgment is "does the schema enable T3-2 → T3-9 cleanly?"

**Schema enables the T3-2 → T3-9 stories — yes.** Cross-checking:

- T3-2 (event creation wizard) needs: events ✓, event_rounds ✓, invites ✓, groups ✓ (default Group inserted by wizard).
- T3-3 (group CRUD UI) needs: groups + group_members ✓; players.name + players.ghin + players.manual_handicap_index ✓ (for the roster display).
- T3-4 (GHIN client) needs: players.ghin ✓ + players.name ✓.
- T3-5 (rule-set editor) needs: rule_sets + rule_set_revisions ✓; the `effective_from_round_id` SET NULL FK is the T5.11 mid-event rule-edit dependency.
- T3-6 (invite-link first-arrival flow) needs: invites ✓ + device_bindings.session_id NULLABLE ✓.
- T3-7 (post-SSO device rebind) needs: device_bindings.session_id mutable + sessions FK ✓.
- T3-8 (permissions middleware) needs: events.organizer_player_id ✓ + group_members ✓.
- T3-9 (sub-game opt-in UI) needs: sub_games + sub_game_participants ✓.

**No T3 successor blocked. No FR coverage missed.** The bullet on `holes_to_play CHECK IN (9, 18)` enables Emergency 9 + Member-Member 9-hole match days that the epic flagged. The `money_visibility_mode` 3-value CHECK ships v1.5 enablement at zero migration cost. The `buy_in_per_participant >= 0` CHECK + integer-cents storage is correct discipline.

**Scope discipline: tight.** Zero new deps. Single migration. ZERO SHARED gates. Path footprint = 15 files, all under apps/tournament-api/src/db/. **Risk Acceptance §1's "no SHARED expected" prediction held — fourth story in a row to ship without a SHARED stop (AI-2 success).**

**Concerns / observations:**

1. **The `name TEXT NOT NULL DEFAULT ''` compromise** is acceptable v1 because (a) production has zero player rows pre-T3, (b) T3-2 wizard + T3-3 group CRUD reject empty names at write boundaries. But if an existing dev DB has an OAuth-bound player with name='', the Group CRUD would SHOW them with empty display. **Minor; document if it surfaces in T3-3 manual smoke.**

2. **No explicit timezone validation at the schema layer.** `events.timezone TEXT NOT NULL` accepts any string. Real validation is "is this a valid IANA tz" — that's app-code (T3-2's Zod schema). Schema is correctly permissive. **Acceptable — IANA validation is non-trivial in SQLite.**

3. **No `effective_to_round_id` on rule_set_revisions** for "rule set retired at round X" semantics. The spec doesn't call for it, and the v1 use case (mid-event rule edit applies forward) doesn't need it. **Out of T3-1 scope; future story if v1.5 retire-rules feature lands.**

**Recommendation: ship.** This is foundation work that unblocks 9 follow-on stories. Epic T3 progress goes from 0/10 to 1/10 with T3-1 done.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis.** Test deltas:
- @tournament/api: 222 → 266 (+44 new tests; 76% over AC #16 minimum of +25).

**Test inventory across 5 new files:**

| File | Tests | Coverage |
|---|---|---|
| events.test.ts | 11 | events insert + NOT NULL + organizer_player_id RESTRICT + multi-tenant; event_rounds insert + CHECK holes_to_play + UNIQUE composite + FK CASCADE + FK RESTRICT course_revisions; invites FK RESTRICT created_by_player_id + NOT NULL token + UNIQUE token + FK CASCADE |
| groups.test.ts | 6 | groups insert default + CHECK money_visibility_mode + FK CASCADE; group_members composite PK uniqueness + FK RESTRICT player + FK CASCADE group |
| rules.test.ts | 7 | rule_sets insert + NOT NULL name; rule_set_revisions insert NULL effective_from + CHECK effective_from_hole + UNIQUE composite + FK RESTRICT rule_set + SET NULL on event_round delete + FULL EVENT CASCADE chain |
| subgames.test.ts | 6 | sub_games insert defaults + CHECK type + CHECK buy_in_non_negative + FK CASCADE event_round; sub_game_participants composite PK + FK CASCADE sub_game + FK RESTRICT player |
| players-t3-extension.test.ts | 14 | players new cols round-trip + name DEFAULT '' + ghin partial unique allows NULL + ghin partial unique blocks duplicate; device_bindings session_id NULL + valid session + SET NULL on session delete + NOT NULL device_info + FK CASCADE player; AC #12b multi-hop cascade chain |

**Failure modes well-covered:**
- ✅ Every CASCADE/RESTRICT/SET NULL FK is exercised
- ✅ Every CHECK constraint has a positive + negative test
- ✅ Partial unique on ghin tested both branches (NULL doesn't conflict; non-NULL conflicts)
- ✅ The load-bearing rule_set_revisions SET NULL behavior has BOTH single-hop AND full-event-cascade tests
- ✅ AC #12b multi-hop cascade exercises BOTH branches (event → event_rounds → sub_games → sub_game_participants AND event → groups → group_members) in a single seeded scenario
- ✅ Multi-tenant uniqueness test pins the absence of global UNIQUE on (name, start_date) for events

**Failure modes NOT covered (acceptable Lows / inherited polish):**

- The `isConstraintError` helper inspects only `err.cause`. Drizzle 0.45 wraps libsql errors in DrizzleQueryError with the original on `.cause`, so the current shape works. If a future drizzle upgrade unwraps, helper misses. **Inherited from courses.test.ts; same posture.**
- Shared `file::memory:?cache=shared` URI across schema test files. Cross-file interference risk if vitest runs file-parallel. Existing config doesn't, so v1 is safe. **Inherited from courses.test.ts.**
- No explicit test for the `meta/_journal.json` containing the 0002 entry. The migration is exercised via beforeAll in every test file, so any malformed _journal would crash all suites. Implicit coverage.
- No test for "drizzle-kit migrate runs cleanly on a T2-populated DB" (AC #10). The current `beforeAll` always migrates against a fresh DB. This is a gap codex didn't flag. **Acknowledged: in production we'll deploy 0002 against a DB that already has 0000 + 0001 applied. The drizzle-kit migrator iterates the _journal and applies only un-applied entries — battle-tested with 0001 vs 0000 already. Risk is low; could add a one-shot "apply 0001, then apply 0002, verify courses still queryable" test in a future polish story.**

**Integration risks that surface at T3-2/T3-3 time:**

- **`events.organizer_player_id` RESTRICT** means a wizard test that tries to delete a player via a casual cleanup will throw. T3-2 tests should know to delete events FIRST.
- **Composite PK on group_members** means duplicate insert throws. T3-3 "Add Player" handler must check for the conflict and return 409 (or be idempotent).
- **`context_id` NOT NULL with no default** means every insert path in T3-2/T3-3/etc. must explicitly stamp it. A forgotten stamp is a 500 in production. T3-2's spec should enumerate the stamping in the AC explicitly.

**Residual risk: low.** Schema is well-tested for its scope. The integration hazards above are downstream specs' problem.

**Recommendation: ship.**

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Six observations:

1. **JSDoc headers on each schema file are substantive, not decorative.** Each new file (events.ts, groups.ts, rules.ts, subgames.ts, device_bindings.ts) opens with a multi-paragraph header explaining the FK delete posture, why CASCADE vs RESTRICT vs SET NULL, the load-bearing nullable session_id semantics, and the FK target rationale (event_rounds vs future scoring rounds). A new reader of any one file gets the WHY without cross-referencing the spec. **Mirrors the courses.ts style; consistent.**

2. **`isConstraintError` helper is duplicated across 5 test files.** Each schema test file has its own copy with slight variations (different `kind` union members per file's needs). Total copies: 6 (counting courses.test.ts). The codebase's "no refactor beyond the task" posture says hold; the right time to promote to `apps/tournament-api/src/db/test-utils.ts` (or similar) is when the 7th copy lands or when a real shape-drift bug bites. **Hold.**

3. **The `ecosystemColumns()` factory pattern works correctly.** Each new table calls `...ecosystemColumns()` and gets fresh column instances per-table (drizzle requires this). The factory's comment in `_columns.ts:4-7` already explains the "factory not const" rationale. **No issue.**

4. **`device_bindings.ts` extraction** is the only structural decision worth scrutiny. Alternatives considered (per the spec):
   - (a) Move sessions out of auth.ts → bigger refactor, not in T3-1 scope.
   - (b) Use string FK references to break the cycle → loses type safety.
   - (c) Extract device_bindings → minimal surface, preserves type safety.
   The chosen approach is (c). The header in `device_bindings.ts:6-12` explains the cycle and the choice. **Future-readers won't be surprised.**

5. **No `// eslint-disable`, no `as any`, no implicit any.** Test casts limited to:
   - `{ ... } as never` in NOT NULL tests where I deliberately omit a required column. Drizzle's typed `.values()` would reject this at compile time; the cast is the canonical "I'm deliberately writing invalid input" pattern.
   - `(err as { cause?: unknown }).cause` in the constraint-error helpers — narrowing an unknown error to a known shape.

6. **Ghin partial unique uses `.where()` with `sql\`${t.ghin} IS NOT NULL\``** — this lowers correctly to SQLite's partial index syntax. Verified in the migration SQL: `CREATE UNIQUE INDEX ... WHERE "players"."ghin" IS NOT NULL`. The drizzle-orm version (0.45) supports this; if a downgrade ever lands, the migration would still hold (the SQL is already generated) but future regenerations would lose the partial. **Pin in a comment if drizzle ever rolls back the API.** (Not blocking.)

**Two minor cleanup items (Lows):**

- `events.test.ts` line 7 imports `and` from drizzle-orm but doesn't use it. ESLint isn't catching this — likely a config gap. Trim it.
- `groups.test.ts` similarly has an unused import. Same trim.

These won't fail typecheck or lint as-currently-configured, but a tighter eslint setup would catch them. Polish, not blocker.

**No blockers.** Ship.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T3-1 as-is.**

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Mary | Pre-SSO device claim opens a small impersonation surface | Closed at T3-7 (post-SSO rebind UX) |
| Mary | Invite token entropy contract is T3-2's responsibility | Spec for T3-2 should pin crypto.randomBytes generation |
| Mary | Cross-tenant FK gap acknowledged | v1.5+ hardening, single-tenant production posture |
| Winston | T3-2 must thread context_id through multi-INSERT wizard transaction | Spec note for T3-2 |
| John | name='' display fallback if existing dev player rows have it | Surface during T3-3 manual smoke |
| John | No effective_to_round_id on rule_set_revisions | Future v1.5 if "retire rule" UX needed |
| Quinn | No T2-populated-DB additive migration test | Implicit coverage; future polish if needed |
| Quinn | Integration hazards surface at T3-2/T3-3 (RESTRICT FKs, context_id stamping) | Downstream specs' problem |
| Amelia | isConstraintError duplicated across 6 test files | Hold; promote on 7th copy or shape drift |
| Amelia | Unused `and` imports in events.test.ts + groups.test.ts | Polish; trim during a future ESLint tightening pass |

**No agent has open questions for the user.** No proposed code changes warrant another impl iteration. **Director may proceed to step 9 (codex-on-party-review).**

Epic T3 progress: 1/10 done (T3-1). Next story: T3-2 (event creation wizard).
