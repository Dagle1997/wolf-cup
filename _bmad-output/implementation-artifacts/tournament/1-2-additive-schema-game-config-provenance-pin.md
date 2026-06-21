# Story 1.2: Additive schema — `game_config` + provenance-pin storage

Status: done

<!-- F1 "Rules & Games" Epic 1 (The Rule-Set Spine). Source: epics-f1-rules-games.md#Story-1.2.
Additive-only migration (T13-4 gotcha: CREATE TABLE only, no CHECK-driven rebuild). -->

## Story

As an organizer (platform),
I want the additive config + provenance tables,
so that an event can carry a rule set and a scored round can pin exactly the inputs it was computed under.

## Acceptance Criteria

**`game_config` table (D2)**

1. A new `game_config` table is created with: `level` (`event` | `round` | `foursome`), `ref_id` (polymorphic — the event/round/foursome id; **no per-level FK**, validated in code, D2), `config_json` (text/JSON), `seed_rule_set_revision_id` (nullable FK → `rule_set_revisions.id`), `lock_state` (nullable, `locked` | `unlocked`), `config_version` (integer), plus `ecosystemColumns()` (`tenant_id` default `guyan`, `context_id`) and `created_at`/`updated_at`. **Source-of-truth rule (resolves the column-vs-JSON duplication):** `config_json` is the **single canonical** engine-shaped `GameConfig` the engine reads; the `lock_state` and `config_version` **columns are denormalized mirrors** for indexing/routing only. The writer derives the columns FROM `config_json` and asserts equality (`column lock_state === config_json.lockState`, `column config_version === config_json.configVersion`) in the same write — never two independent sources. A unit test asserts a write with mismatched column/JSON values is rejected. [AC1]
2. **UNIQUE (`tenant_id`, `level`, `ref_id`)** — one config row per (tenant, level, ref). [AC2]
3. `config_json` is **Zod-validated on write** against the F1 game shape (the `GameConfig` type from `engine/games/types.ts`): `{ game, pointValueSchedule, modifiers[], cap?, lockState?, configVersion }`. The validator **reuses / agrees with the engine's `validateResolvedConfig`** (registry.ts) — known `game` (`guyan-2v2`), known modifier types only, `config_version ≤ ENGINE_CONFIG_VERSION`, even positive point values. An unknown or too-new config is **rejected at write**. **Fail-closed-at-read is explicit:** a read that encounters a `config_json` failing Zod (unknown game/modifier, too-new `config_version`, invalid point value) returns a typed **unsettleable result** (`{ ok: false, reason }`) — NOT null and NOT a silent default — so the caller surfaces "unsettleable" rather than computing on a bad config (NFR-X1, FR44). **Zod↔engine agreement is operationally defined by a drift test:** a table of configs (valid + each invalid class) is fed through BOTH the Zod schema AND `validateResolvedConfig`, asserting **identical accept/reject verdicts** — that test is the guarantee the two cannot diverge. [AC3]
4. **Modifier correction to the epic:** the epic text said "modifiers constrained to empty `[]` in Epic 1"; that predated the net-skins-as-modifier decision (Story 1.1 ships the `net-skins` modifier). The schema therefore constrains `modifiers` to the **registered set** (currently `{net-skins}`), NOT empty — an unknown modifier type is rejected at write (so an unsupported config can never silently compute). Claim-based modifiers (greenie/polie/sandie) arrive in Epic 2 by registering new types. [AC4]

**Round-pin (provenance) store (D4/D5)**

5. A round-pin store records, for a scored round, the **fully-RESOLVED config snapshot** (the merged Event→Round→Foursome result the engine settles from) + the `seed_rule_set_revision_id` + the **effective-handicap snapshot** + the `course_revision_id` (FK → `course_revisions.id`, which **exists** — verified) / tee. **Keying:** `round_id` (FK → `rounds.id`) is the **UNIQUE** key — one pin per round (`rounds.id` is already globally unique, so tenant is NOT part of the key). `tenant_id` (from `ecosystemColumns()`) is **copied from the round** for FD-6 consistency and MUST equal the round's tenant (asserted on write), but is denormalization, not a uniqueness dimension. [AC5]
6. The pin stores, **per player on that round, BOTH the Handicap Index (HI) AND the computed Course Handicap (CH)** played off that day (durable provenance, NFR-T1). **Storage shape (decided): a single JSON column `per_player_handicaps_json`** on the round-pin row — an **object keyed by `playerId`**: `{ [playerId]: { hi: number, ch: number } }` (Zod-validated on write). Rationale: the pin is an **immutable snapshot read whole** at recompute, so a JSON column (not a child table) matches the access pattern, keeps the pin atomic (one row written in one statement), and needs no extra FK/join. Recompute reads the pinned CH from this column, never re-derives it from a live HI. [AC6]
7. The **effective HI is whatever was in effect at round-start** — the locked-as-of-date HI if the organizer locked handicaps (the shipped H1 path, `event_handicaps`), else the most-recent GHIN HI (default) — pinned at round-start either way. [AC7]
8. `pairings` remain **append-only** (existing — no change). The **global-team-composition snapshot seam** is a **nullable JSON column `team_composition_json`** on the round-pin row, left **NULL** in Epic 1 (no global teams until Epic 3); its future shape is documented as `{ teamKey: string, playerIds: string[] }[]` so Epic 3 populates it with no migration. A test asserts it defaults NULL. [AC8]

**Scope + additive discipline**

9. ONLY `game_config` + the round-pin store are created. `hole_claims` (Epic 2) and `teams`/`team_members` (Epic 3) are **NOT** created here ("create tables only when needed"). [AC9]
10. The migration is **`CREATE TABLE` only** (no CHECK-driven table rebuild — T13-4), with `--> statement-breakpoint` between statements, **generated via drizzle-kit** (`db:generate`) and renumbered to the next sequence (`0019_*` — latest is `0018_sharp_warstar.sql`). Enums (`level`, `lock_state`) are validated in **Zod**, not DB CHECK constraints. [AC10]
11. The pin write at the lifecycle transition to `in_progress` is **atomic and idempotent** under the unique `round_id` — the resolved-config snapshot + per-player HI + CH + course-rev are written in **one transaction**, so a PWA retry or a second device cannot split-brain or partially backfill the snapshot (NFR-D2/R3). **Idempotency semantics (explicit):** the pin is **immutable provenance** — a second `pinRound` call for a `round_id` that is already pinned is a **no-op that returns the existing pin unchanged**, and the second call's data is **ignored** (it does NOT overwrite — even if the new data differs). The ONLY legitimate re-pin (with different data) is an **Epic 4 correction**, which is out of scope here; this story's writer never overwrites. A test asserts: pin → re-pin with different data → row is unchanged (the first pin wins). *(This story builds the store + the pin-writer function and unit-tests its atomicity/idempotency; wiring it into the actual round-start lifecycle endpoint is Story 1.4's settlement path.)* [AC11]
12. **Additive guarantee:** against the existing prod schema shape, existing tables (`rounds`, `hole_scores`, `pairings`, `event_handicaps`, `sub_games`, …) are **untouched**; table + Zod round-trip + unique-constraint tests pass; the tournament + wolf-cup suites stay green (NFR-X2). [AC12]
13. All work is confined to `apps/tournament-api` (Tournament paths only; FD-1/FD-2). [AC13]

## Tasks / Subtasks

- [ ] **Task 1 — `game_config` schema (AC: 1,2)** — `src/db/schema/game-config.ts`: drizzle `sqliteTable('game_config', …)` with the columns above, `ecosystemColumns()`, UNIQUE(tenant_id, level, ref_id). Export from `src/db/schema/index.ts`.
- [ ] **Task 2 — config Zod validator (AC: 3,4)** — a Zod schema for the `GameConfig` shape that agrees with `engine/games/registry.ts validateResolvedConfig` (known game + registered modifiers + version ≤ engine + even positive point value). Place near the engine config types (pure; reused on every `game_config` write). Reject unknown/too-new fail-closed.
- [ ] **Task 3 — round-pin store schema (AC: 5,6,7,8)** — `src/db/schema/round-pins.ts`: a `round_pin` table keyed **UNIQUE on `round_id`** (FK → `rounds.id`) holding the resolved-config snapshot (JSON), `seed_rule_set_revision_id`, `course_revision_id`/tee, the **`per_player_handicaps_json`** JSON column (AC6 — object keyed by `playerId`, NOT a child table), and the **nullable `team_composition_json`** seam (AC8, NULL in E1). `ecosystemColumns()` (tenant copied from the round, AC5). Export from index.
- [ ] **Task 4 — pin-writer function (AC: 11)** — a pure-ish service `pinRound(tx, { roundId, resolvedConfig, perPlayerHiCh, courseRevisionId, tee, seedRuleSetRevisionId })` that writes the pin in ONE tx, idempotent on the unique `round_id` (re-call = no-op / returns existing). Takes the caller's `tx` (see [[feedback_tx_scoped_helpers_take_caller_db]]).
- [ ] **Task 5 — migration (AC: 10)** — run drizzle-kit `db:generate`; rename the generated file to `0019_*`; confirm CREATE TABLE only, statement-breakpoints, no rebuild of existing tables.
- [ ] **Task 6 — tests (AC: 1,3,8,11,12)** — Zod round-trip (valid passes; unknown game/modifier, too-new version, odd point value rejected); **Zod↔engine drift test** (same configs through Zod AND `validateResolvedConfig` → identical accept/reject verdicts, AC3); **column/JSON consistency** (write with `lock_state`/`config_version` ≠ `config_json` rejected, AC1); unique-constraint (duplicate (tenant,level,ref) rejected); **pin immutability** (pin → re-pin with DIFFERENT data → first pin wins, row unchanged, AC11); `team_composition_json` defaults NULL (AC8); additive-guarantee (existing tables untouched, AC12).
- [ ] **Task 7 — regression gate (AC: 12,13)** — `pnpm --filter @tournament/api test` + `pnpm -r typecheck` + `pnpm -r lint` green; engine + wolf-cup suites unchanged.

## Dev Notes

### Reuse the shipped seams (verified)
- **`ecosystemColumns()`** — `src/db/schema/_columns.ts` (`tenant_id` default `guyan`, `context_id`; FD-6). Call as a factory per table.
- **`rule_set_revisions`** — `src/db/schema/rules.ts` (`ruleSetRevisions`) — the FK target for `seed_rule_set_revision_id`.
- **`rounds` / `round_states`** — `src/db/schema/scoring.ts` — the pin's `round_id` FK + the `in_progress` transition this pin is written at (wiring in Story 1.4).
- **`event_handicaps`** — the shipped H1 lock store (`events.ts` / migration `0017`) — the source of the locked-as-of-date HI when present (else most-recent GHIN).
- **`GameConfig` type + `validateResolvedConfig`** — `src/engine/games/{types,registry}.ts` (Story 1.1) — the config shape + fail-closed rules the Zod validator must agree with. Do NOT diverge; a drift test should assert the Zod schema and `validateResolvedConfig` reject the same configs.
- **Migrations** — `src/db/migrations/` (drizzle-kit), latest `0018_sharp_warstar.sql` → this story = `0019_*`. The renumber-after-generate pattern (per the H1 `0017` precedent) avoids hand-merging.

### T13-4 gotcha (do NOT repeat)
A CHECK constraint forces drizzle into a table-REBUILD (DROP+RENAME) — needless risk near the FK-referencing `rounds` table. Use plain `ADD COLUMN`/`CREATE TABLE`; validate `level`/`lock_state` enums in Zod + an `isLevel()`/`isLockState()` guard, NOT DB CHECK. **Gotcha (codex):** drizzle's `text({ enum: [...] })` helper EMITS a CHECK constraint in the generated SQL — do NOT use it for `level`/`lock_state`; declare them as plain `text(...)` columns and enforce the allowed values in Zod only. After `db:generate`, grep the `0019_*.sql` for `CHECK` and `PRAGMA`/table-rebuild and confirm there are none.

### JSON key/value typing (codex low)
`per_player_handicaps_json` is keyed by `playerId` (a string id from `players.id`); the Zod schema validates it as `z.record(z.string(), z.object({ hi: z.number(), ch: z.number() }))`. `config_json`, `per_player_handicaps_json`, and `team_composition_json` are all stored as text and parsed/validated through Zod on read+write (no raw `JSON.parse` trust).

### Out of scope (explicit)
The pure engine (Story 1.1, done). Seed UI + the cascade-resolver endpoint + point-value control = Story 1.3. The live settlement chokepoint + actually pinning at round-start + recompute-on-read = Story 1.4. `hole_claims` = Epic 2; `teams`/`team_members` + populating the global-team seam = Epic 3.

### Project Structure Notes
- New schema files under `src/db/schema/**`, one new migration under `src/db/migrations/**`, one pin-writer service, one Zod validator — all additive; no edits to existing tables. `src/db/schema/index.ts` gets two new exports (existing file, ALLOWED).
- **Variance from epic (with rationale):** epic said `modifiers: []` in Epic 1; corrected to "registered modifiers only" because Story 1.1 ships `net-skins` as a modifier (AC4).

### Testing standards
- Vitest; per-pid temp-file DB isolation if the test touches the shared cache (T14 lesson). Zod round-trip + unique + atomicity/idempotency + additive-guarantee. No new external deps (`zod`, `drizzle` already present).

### References
- [Source: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md#Story-1.2]
- [Source: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md] (D2 polymorphic ref_id; D4/D5 recompute-on-read + pin; additive migration discipline)
- [Source: apps/tournament-api/src/db/schema/_columns.ts] (ecosystemColumns — verified)
- [Source: apps/tournament-api/src/db/schema/rules.ts] (ruleSetRevisions — verified)
- [Source: apps/tournament-api/src/db/schema/scoring.ts] (rounds/roundStates — verified)
- [Source: apps/tournament-api/src/engine/games/registry.ts] (validateResolvedConfig — the fail-closed rules to mirror)

## Files this story will edit

- apps/tournament-api/src/db/schema/game-config.ts
- apps/tournament-api/src/db/schema/round-pins.ts
- apps/tournament-api/src/db/schema/index.ts
- apps/tournament-api/src/engine/games/config-schema.ts
- apps/tournament-api/src/services/pin-round.ts
- apps/tournament-api/src/db/schema/game-config.test.ts
- apps/tournament-api/src/services/pin-round.test.ts
- apps/tournament-api/src/db/migrations/0019_<drizzle-generated-name>.sql (new migration — exact suffix assigned by drizzle-kit at db:generate, renumbered to 0019)
- apps/tournament-api/src/db/migrations/meta/_journal.json (updated by drizzle-kit db:generate)
- apps/tournament-api/src/db/migrations/meta/0019_snapshot.json (new, by drizzle-kit db:generate)
- _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

> Note: all paths above are under `apps/tournament-api/**` (ALLOWED) plus the two BMAD tracking artifacts. The drizzle-kit-generated migration filename suffix is not known until `db:generate` runs; it lands under `src/db/migrations/**` (ALLOWED) and is staged at commit time per the change-set enumeration.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Tournament Director, dual-model ensemble, 2026-06-21)

### Debug Log References

- `pnpm --filter @tournament/api test` → 1173 passing (+26 story tests), 2 skipped; typecheck + lint clean.
- migration `0019_true_king_cobra.sql` generated via `pnpm run db:generate` (drizzle-kit + tsx loader).

### Completion Notes List

- Reviews: spec codex FIXED (3H+5M, 2 passes) + gemini FIXED (1H+1M); impl codex FIXED (2H+3M→0H) + gemini FIXED (1H→clean); synthesis SHIP.
- Impl Highs fixed: persist CANONICAL parsed config (+ `.strict()` Zod rejecting unknown keys); validate per-player handicaps (finite); derive tenant/context FROM the round (AC5, no caller-trust); existing-row guard; createdAt finite-int guard. Each turned into a regression test.
- Migration 0019 = two CREATE TABLEs (`game_config`, `round_pin`) + indexes only — additive, no CHECK, no existing-table rebuild. Enums (level/lock_state) validated in Zod, not DB CHECK.
- Epic correction folded: `modifiers` = registered set (net-skins), not `[]` (Story 1.1 ships net-skins).
- Known trade: pin-round test disables FKs for synthetic course_revision_id (writer-logic focus); real FK path is Story 1.4.

### File List

- apps/tournament-api/src/db/schema/game-config.ts (new)
- apps/tournament-api/src/db/schema/round-pins.ts (new)
- apps/tournament-api/src/db/schema/index.ts (modified — 2 exports)
- apps/tournament-api/src/engine/games/config-schema.ts (new)
- apps/tournament-api/src/services/pin-round.ts (new)
- apps/tournament-api/src/db/migrations/0019_true_king_cobra.sql (new)
- apps/tournament-api/src/db/migrations/meta/{_journal.json (modified), 0019_snapshot.json (new)}
- apps/tournament-api/src/db/schema/game-config.test.ts (new)
- apps/tournament-api/src/services/pin-round.test.ts (new)
