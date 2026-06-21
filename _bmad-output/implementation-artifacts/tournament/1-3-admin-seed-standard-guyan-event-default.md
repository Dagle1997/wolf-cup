# Story 1.3: Admin seed "Standard Guyan" + event-wide default (kills the dead card)

Status: done

<!-- F1 Epic 1. Source: epics-f1-rules-games.md#Story-1.3. Builds the seed UI +
the cascade-resolver endpoint on top of Story 1.2's game_config schema +
Story 1.1's engine resolveConfig. Tournament paths only (FD-1/FD-2). -->

## Story

As an organizer,
I want to seed the Standard Guyan rule set as my event's default from a preset,
so that the dead "No rule set seeded" card becomes a working setup and every foursome inherits the game with zero further taps.

## Acceptance Criteria

**The dead card dies (headline signal)**

1. The dead "No rule set seeded yet. Defaults apply until one is created." card on the event admin page (`admin.events.$eventId.index.tsx:177-187`) is replaced by a working **"Set up Rules & Games"** entry: a link to the new setup page when unseeded, and a summary (game + point value + lock state) with an "Edit" link once seeded. [AC1]

**Seed the Standard Guyan preset → event-level `game_config`**

2. Setup is **preset-first** (never blank-slate): the organizer starts from the **Standard Guyan** preset (FR1). **The preset is a single DB-seeded source of truth (resolves the seeded-vs-in-code ambiguity):** a `rule_set` + `rule_set_revision` "Standard Guyan" is seeded **idempotently** (admin seed — find-or-create by a stable key **per tenant**, since `rule_sets` are tenant-scoped; re-run is a no-op, no cross-tenant duplication) whose revision **carries the canonical config** (the engine's `guyan-2v2` base: low-ball + skin + team-total + net-skins — the shape Story 1.1's golden settles). The seed write does NOT hardcode the config inline; it **reads the seeded revision's config** and overlays only the organizer's point value (AC8) to build the event-level row. The literal `guyan-2v2` base object MAY live as a code constant used by the SEED to populate the revision, but the revision row is the source the write reads. [AC2]
3. Seeding writes an **EVENT-LEVEL `game_config` row** (`level='event'`, `ref_id=eventId`) with `config_json` = the resolved Standard Guyan config, `lock_state` defaulting to **`locked`**, `config_version=1`, and `seed_rule_set_revision_id` = the seeded preset's revision id. The columns `lock_state`/`config_version` are derived from `config_json` and asserted equal (Story 1.2 `checkConfigColumnsConsistent`); `config_json` is validated via `parseGameConfig` before write (fail-closed). [AC3]
4. The write commits the `game_config` row + an **audit row** + an **activity row** in **ONE transaction** (NFR-S2/D2). **Emission rule:** the FIRST write for an event (no prior event-level row) emits **`game.config_seeded`**; a subsequent PUT (point-value or lock change) emits **`game.config_updated`**. Both `game.*` types are registered in the existing Zod discriminated union in `lib/activity.ts` (with payload `{eventId}`) — else `emitActivity` rejects them (pattern 12). [AC4]

**Cascade resolver endpoint**

5. A cascade-resolver service loads the `game_config` rows for an `(event, round?, foursome?)` and calls the engine's `resolveConfig` (Story 1.1) to return the resolved config. **Hierarchy validation (security, prevents cross-event leak — both reviewers):** before loading any config, the service MUST verify the supplied `roundId` belongs to `eventId` (its round is for that event) and `foursomeNumber` belongs to that round's pairings — AND all are in the caller's `tenant`. A `roundId`/`foursomeNumber` not under `eventId` is **rejected** (not silently resolved against another event's rows). Only level rows whose `ref_id` matches the validated event/round/foursome are loaded. With a seeded event default and no override, it returns the event default (FR8); a **`locked`** event yields a foursome's config with **0 config taps** (FR11 zero-tap inherit); resolution is most-specific-wins (FR12). [AC5]
6. **Dual-read routing (pattern 14):** an event with an event-level `game_config` row is classified an **F1 event** (a fresh event's row is active — Story 5.1 later adds the `cutover_state ∈ {native, active}` refinement; this story treats row-exists ⇒ F1). An **orphan** round/foursome `game_config` row with **no** event-level row is **rejected** (the engine's `resolveConfig` already returns `no_event_level_config`; the service surfaces it as unsettleable, never silently settles). [AC6]

**Endpoints (organizer-only)**

7. Endpoints `GET`/`PUT /api/admin/events/:eventId/game-config` and `GET /api/admin/events/:eventId/resolved-config`, each gated by `requireSession` + `requireOrganizer` + the event-scoped `isEventOrganizerByEventId` (mirroring `admin-event-handicaps.ts`). **Contract (explicit):** unauthenticated → 401; non-organizer / not-this-event's-organizer → 403; unknown event → 404. **`GET game-config`** → 200 `{ config: GameConfigRow | null }` (null = unseeded). **`PUT game-config`** body `{ pointValueSchedule?: {kind:'flat',cents} | {kind:'front-back',frontCents,backCents}, lockState?: 'locked'|'unlocked' }` (Zod-validated; **both optional — a lock-only edit omits `pointValueSchedule` and PRESERVES the existing schedule, never overwriting it with a default**; the first seed requires `pointValueSchedule`). config_json is built from preset + the existing row + this delta, then `parseGameConfig` → 200 `{ config }`, or 400 `{ error, reason }` on invalid config (fail-closed). **`GET resolved-config`** query `?roundId=<id>&foursomeNumber=<n>` — both optional, BUT `foursomeNumber` requires `roundId` (foursomeNumber alone → 400); validated per AC5. → 200 `{ ok: true, config }` when resolvable, 200 `{ ok: false, reason }` when unsettleable/orphan/unseeded (engine reason surfaced — NOT a 500), **404 if `roundId` is not under the event OR `foursomeNumber` is not a foursome of that round**. Money/config is organizer-only here (no public exposure). [AC7]

**Point value (FR3)**

8. During setup the organizer chooses **a single point value** (e.g. $5) **or a front/back split** (e.g. $5 front / $10 back); the choice writes the event-level `config_json.pointValueSchedule` (`{kind:'flat'}` or `{kind:'front-back'}`) — the schedule the Story 1.1 fixtures already cover. Whole-dollar values only (even cents — the engine's validator enforces it). **Presses remain OFF** for F1 events. [AC8]

**Lock/unlock toggle (FR10)**

9. A **single toggle** sets the lock state between `locked` (default) and `unlocked`, audited in one tx (a `game.config_updated` activity). **Source-of-truth consistency (resolves the derived-vs-toggle tension):** the toggle writes `config_json.lockState`; the `lock_state` COLUMN is then **re-derived from `config_json`** (Story 1.2 `deriveConfigColumns` + `checkConfigColumnsConsistent`), so the column and JSON never diverge — the toggle is not a second independent source. In Product A, `unlocked` changes only the **leaderboard mode** (wired in Story 1.4) — the foursome self-serve edit it will eventually enable is Epic 6; the toggle ships now so the state exists from Epic 1. [AC9]

**UI floor (NFR-A1)**

10. `admin.events.$eventId.game-config.tsx` is **preset-first**, exposes the point-value control (single or front/back) + the lock toggle, is built from the shipped **Button / Card / FormField** primitives with dark-mode tokens and **≥44–48px** tap targets; `admin.events.$eventId.index.tsx` replaces the dead card with the link/summary (AC1). [AC10]

**Scope/boundary**

11. Out of scope (deferred): the modifier set + variants (greenie/polie/sandie) and the payout cap + the Wolf-Cup/"345" presets (Epic 2); the *functional* unlock self-serve edit (Epic 6); the handicap-lock reminder (Epic 4). All work is `apps/tournament-api` + `apps/tournament-web` (FD-1/FD-2). [AC11]

## Tasks / Subtasks

- [ ] **Task 1 — Standard Guyan preset seed (AC: 2)** — an idempotent seed (admin script or seed module) creating the `rule_set` + `rule_set_revision` "Standard Guyan" carrying the `guyan-2v2` base config; re-run = no-op (find-or-create by a stable key).
- [ ] **Task 2 — activity types (AC: 4)** — register `game.config_seeded` + `game.config_updated` in the `lib/activity.ts` Zod discriminated union (+ payload shape); a test asserts `emitActivity` accepts them and rejects an unknown `game.*`.
- [ ] **Task 3 — game-config write service (AC: 3,4,8,9)** — `services/game-config-write.ts` `seedOrUpdateEventGameConfig(tx, {...})`: build the event-level config (preset + organizer point-value + lock_state), `parseGameConfig` validate, derive+assert columns, upsert the `game_config` row + audit + activity in ONE tx. Reuses Story 1.2 helpers.
- [ ] **Task 4 — cascade-resolver service (AC: 5,6)** — `services/resolve-game-config.ts` `resolveEventGameConfig(db, {eventId, roundId?, foursomeNumber?, tenantId})`: FIRST validate the hierarchy (roundId belongs to eventId, foursomeNumber to that round, all in tenant — reject otherwise, AC5); then load only the matching level rows → engine `resolveConfig` → `{ok, config | reason}`; F1-event classification (event-level row exists) + orphan rejection surfaced. A test asserts a cross-event roundId is rejected (no leak).
- [ ] **Task 5 — routes (AC: 7)** — `routes/admin-event-game-config.ts`: GET/PUT game-config + GET resolved-config, organizer-gated (mirror `admin-event-handicaps.ts`); register in the app router. Zod-validate the PUT body (preset choice + point-value + lock).
- [ ] **Task 6 — web setup page (AC: 1,10)** — `admin.events.$eventId.game-config.tsx`: preset-first, point-value control (single/front-back), lock toggle, Save → PUT; Button/Card/FormField, dark-mode, ≥44–48px. Wire a route load for the current config.
- [ ] **Task 7 — kill the dead card (AC: 1)** — edit `admin.events.$eventId.index.tsx` to replace the "No rule set seeded yet" block with the "Set up Rules & Games" link/summary.
- [ ] **Task 8 — tests (AC: 3,4,5,6,7)** — service: seed→event row + audit + activity in one tx; resolver returns event default (0-tap), most-specific-wins, orphan rejected; route: organizer-gated (401/403 paths), PUT seeds, GET resolved-config; web: render + Save calls PUT (component test).
- [ ] **Task 9 — regression gate** — `pnpm --filter @tournament/api test` + `@tournament/web test` + `pnpm -r typecheck` + `pnpm -r lint` green; engine + wolf-cup unchanged.

## Dev Notes

### Reuse the shipped seams (verified)
- **Story 1.2 schema + helpers** — `game_config`/`round_pin` tables; `parseGameConfig`, `checkConfigColumnsConsistent`, `deriveConfigColumns` (`engine/games/config-schema.ts`).
- **Story 1.1 engine** — `resolveConfig` (`engine/games/resolver.js`) is the cascade merge + lock gate + fail-closed; the service is a thin loader around it. The Standard Guyan config = the `guyan-2v2` base the golden settles.
- **Organizer gate** — `routes/admin-event-handicaps.ts` (and `admin-event-rounds.ts`) — the exact `requireSession` + `requireOrganizer` + `isEventOrganizerByEventId` shape to mirror.
- **Activity** — `lib/activity.ts` (the Zod discriminated union + `emitActivity`); add `game.config_seeded`/`game.config_updated`. Audit via the existing `writeAudit` (`lib/audit-log.ts`).
- **Dead card** — `admin.events.$eventId.index.tsx:177-187` (`ctx.ruleSet === null` → "No rule set seeded yet").
- **UI primitives** — Button / Card / FormField (T11) + dark-mode tokens + `ScrollableTable` family.
- **rule_set / rule_set_revision** — `db/schema/rules.ts` (the preset provenance the seed writes).

### Key decisions
- **F1-event classification** in this story = "an event-level `game_config` row exists" (Story 5.1 adds `cutover_state`). The resolver service is the single place that decides F1-vs-legacy for an event (pattern 14) — Story 1.4 consumes it.
- **Preset config** is the DB-seeded `rule_set_revision` (Task 1, single source); the write READS that revision's config and overlays the organizer's point value. `seed_rule_set_revision_id` on the event row records provenance (which preset revision). A code constant may seed the revision, but is not read at write time (AC2).
- **No new engine math** — resolution + validation are Story 1.1; this story is schema-write + routing + UI.

### Out of scope
Modifiers/variants + cap + Wolf-Cup/"345" presets (Epic 2); functional unlock self-serve (Epic 6); handicap-lock reminder (Epic 4); the actual round-start pin + settlement (Story 1.4).

### Project Structure Notes
- New: 1 seed module, 2 services, 1 route file, 1 web page; edits: `lib/activity.ts` (add types), `admin.events.$eventId.index.tsx` (dead card), the app router (register route). All `apps/tournament-api/**` + `apps/tournament-web/**` (ALLOWED).

### Testing standards
- Vitest; per-pid temp-file DB isolation where needed (T14). Real-auth not required (organizer gate tested via the existing middleware-test pattern). Web component test for the page render + Save. No new external deps.

### References
- [Source: epics-f1-rules-games.md#Story-1.3] · [Source: architecture-f1-rules-games.md] (pattern 12 activity, pattern 14 dual-read, FR1/FR3/FR8/FR11/FR12)
- [Source: apps/tournament-api/src/engine/games/resolver.ts] (resolveConfig — verified, Story 1.1)
- [Source: apps/tournament-api/src/engine/games/config-schema.ts] (parseGameConfig etc — Story 1.2)
- [Source: apps/tournament-api/src/routes/admin-event-handicaps.ts] (organizer-gate mirror — verified)
- [Source: apps/tournament-api/src/lib/activity.ts] (activity union — verified)
- [Source: apps/tournament-web/src/routes/admin.events.$eventId.index.tsx:177-187] (dead card — verified)

## Files this story will edit

- apps/tournament-api/src/services/game-config-write.ts
- apps/tournament-api/src/services/resolve-game-config.ts
- apps/tournament-api/src/routes/admin-event-game-config.ts
- apps/tournament-api/src/lib/activity.ts
- apps/tournament-api/src/services/standard-guyan-seed.ts
- apps/tournament-api/src/services/game-config-write.test.ts
- apps/tournament-api/src/services/resolve-game-config.test.ts
- apps/tournament-api/src/routes/admin-event-game-config.test.ts
- apps/tournament-web/src/routes/admin.events.$eventId.game-config.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.game-config.test.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.index.tsx
- apps/tournament-api/src/app.ts
- _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

> Note: `apps/tournament-api/src/app.ts` is the app-router registration file (mounts the new route); under `apps/tournament-api/**` (ALLOWED). If route mounting lives in a different file, that file (also under apps/tournament-api/**) is edited instead — confirmed at implementation.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m].

### Debug Log References

- Per-pid temp-FILE DB isolation for the two service tests (`file:${tmpdir()}/gc*-${pid}.db` + rmSync of stale `.db/-wal/-shm` in the mock factory) — the libsql build rejects `mode=memory` URL params, so a real temp file is used; the route test reuses the established `file::memory:?cache=shared` shared-cache pattern.
- `db.delete(activity)` in test teardown trips the T8-1 `no-restricted-syntax` lint; suppressed with the established `eslint-disable-next-line ... -- test-cleanup truncate only` comment (matches lifecycle-full/onboarding E2E teardown).
- Full-suite run: tournament-api 1201 passing + 2 skipped (one PRE-EXISTING load-induced timeout flake in `lifecycle-full.e2e.test.ts` — passes deterministically in isolation, untouched by this story); tournament-web 362 passing.

### Completion Notes List

- DEVIATION (justified): the activity discriminated union + Zod schemas live in `engine/types/activity-events.ts` (re-exported via `lib/activity.ts`, which only holds `emitActivity`). The two new `game.config_seeded` / `game.config_updated` types were registered in `engine/types/activity-events.ts` (under `apps/tournament-api/**`, ALLOWED) since that is the single source of truth; `lib/activity.ts` needed no change. Payload is just `{ eventId }` (base field) — the before/after config diff is in the audit row. The exhaustive `activity.test.ts` fixture map required the two new fixtures (added).
- Added audit constants `GAME_CONFIG_SEEDED` / `GAME_CONFIG_UPDATED` event types + `GAME_CONFIG` entity type to `lib/audit-log.ts` (the audit-log lib had no game-config types).
- AC1 (dead card): the index page now fetches `GET .../game-config` directly to drive the link-vs-summary (rather than threading it through `admin-context`, which would have edited `admin-events.ts`, outside the file list). The removed branch read `ctx.ruleSet`; that field remains on the response type but is no longer rendered.
- Preset idempotency caveat: `rule_sets` has no UNIQUE(tenant, name), so find-or-create is within the caller's tx (admin-only, single-organizer-per-event flow) — a true concurrent double-seed is not constraint-blocked. Not an issue for this flow; flagged for review.
- No new migration (uses existing `rule_sets` / `rule_set_revisions` + Story 1.2's `game_config`).

### File List

Created (apps/tournament-api):
- src/services/standard-guyan-seed.ts
- src/services/game-config-write.ts
- src/services/resolve-game-config.ts
- src/routes/admin-event-game-config.ts
- src/services/game-config-write.test.ts
- src/services/resolve-game-config.test.ts
- src/routes/admin-event-game-config.test.ts

Created (apps/tournament-web):
- src/routes/admin.events.$eventId.game-config.tsx
- src/routes/admin.events.$eventId.game-config.test.tsx

Modified (apps/tournament-api):
- src/engine/types/activity-events.ts (new activity types + schemas)
- src/lib/audit-log.ts (new audit event/entity constants)
- src/lib/activity.test.ts (two new fixtures for the exhaustive map)
- src/app.ts (mount adminEventGameConfigRouter)

Modified (apps/tournament-web):
- src/routes/admin.events.$eventId.index.tsx (kill the dead card → Rules & Games link/summary)
- src/routeTree.gen.ts (auto-generated route registration)
