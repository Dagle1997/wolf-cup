# Story 2.1: Inline claim capture — `hole_claim_writes` (append-only) + scorer greenie/polie/sandie entry (offline, edit/remove)

Status: ready-for-dev

<!-- F1 Epic 2 (Full Game Vocabulary), first story. Source:
epics-f1-rules-games.md#Story-2.1. Capture + storage + recompute-fanout ONLY —
the resolvers that consume claims (greenie/polie/sandie) are Stories 2.2-2.4.
Recording a claim before its resolver exists is INERT (no money effect), so this
ships independently. Tournament paths only (FD-1/FD-2). -->

## Story

As a scorer,
I want to record (and later edit or remove) each player's greenie/polie/sandie claims inside the score-entry flow,
so that the Guyan modifiers have their inputs without a second screen, and a mistaken claim can be corrected before finalize.

## ⚠️ DESIGN DECISION (Josh-approved 2026-06-21) — supersedes the cell-table/hard-delete ACs below

The dual-model spec review found a **CRITICAL** in the epic's design: hard **delete-to-remove resurrects a deleted claim** when the original "record" mutation replays from the at-least-once offline queue (the dedupe row was deleted, so nothing blocks the re-insert). **Approved fix: an APPEND-ONLY writes-log** (mirrors the shipped `score_corrections` discipline — `hole_scores`/claims are never hard-deleted):

- The table is **`hole_claim_writes`** — append-only, immutable rows: `(id, round_id, player_id, hole_number, claim_type, op ['set'|'remove'], scorer_player_id, client_event_id NOT NULL, created_at, …ecosystemColumns)`.
- **Dedupe UNIQUE on `client_event_id`** (global, NOT NULL) → a replay of any write (set OR remove) is a no-op. There is NO mutable cell row whose `client_event_id` changes, so a stale replay can never slip past the dedupe.
- **Current claim state per cell** `(round, player, hole, claim_type)` = the write with the **highest server-assigned monotonic order key** (an autoincrement `seq` / rowid assigned at INSERT — **NOT** the client `created_at`, which is clock-skew-prone); `op='set'` ⇒ active, `op='remove'` ⇒ absent. Single-writer (`requireScorerForRound`) + the offline queue's FIFO-per-device replay + the server-assigned order make "latest" well-defined; **resurrection is impossible** (a stale `set` replay is deduped by `client_event_id`; a `remove` is just a later write).
- **Edit-in-place** = a new `set` write (same cell, new `client_event_id`). **Remove** = a `remove` write (also queued + dedupe-keyed). **Reassign to another player** = `remove` old cell + `set` new cell.
- `compute-foursome` derives current claims = latest-write-per-cell (`op='set'`), at the service layer (resolvers stay pure). A `compute-foursome` claim-mapping test is required.

**Other review findings to fold on the build pass (all confirmed):** (a) validate `player_id` belongs to the round/foursome (cross-event/foursome guard); (b) **tenant-scope** every `hole_claim_writes` read/write; (c) `client_event_id` NOT NULL (dedupe integrity); (d) claim **removal is a queued offline mutation** too (a `remove` op, not a client-only delete); (e) **inert-vs-fail-closed is testable in 2.1** without the resolvers — feed a recorded claim through `compute-foursome` with a config whose modifier is `enabled:false` (engine already yields 0 edges = inert) vs an unknown modifier `type` (the Story-1.1 `validateResolvedConfig` already fails closed) — assert both via the existing engine, no 2.2-2.4 resolver needed.

> The ACs, Tasks, and Dev Notes below have been **rewritten to this append-only model** and dual-model re-reviewed (gemini clean; codex 0 High). This block remains as the rationale + the at-a-glance model summary.

## Acceptance Criteria

**`hole_claim_writes` schema — APPEND-ONLY log, sibling to `hole_scores` (additive; supersedes the cell-table design — see the DESIGN DECISION block)**

1. A new **append-only** `hole_claim_writes(id, seq [server-assigned monotonic order — autoincrement integer or the rowid], round_id, player_id, hole_number, claim_type, op, scorer_player_id, client_event_id, created_at, …ecosystemColumns)` table is created **as a sibling to `hole_scores`** — `CREATE TABLE` only (no CHECK-driven rebuild, T13-4), `--> statement-breakpoint`, drizzle-kit generated + renumbered (`0020`). Rows are **immutable** (never updated or hard-deleted). [AC1]
2. `claim_type` (`greenie | polie | sandie`) and `op` (`set | remove`) are **Zod-validated** (NOT DB CHECK). `client_event_id` is **NOT NULL**. The table carries ONE **dedupe UNIQUE on `client_event_id`** (global) — a replay of ANY write (set or remove) is a no-op. There is **no mutable cell row** whose identity changes, so a stale offline replay can never slip past the dedupe and resurrect a removed claim (the CRITICAL fix). [AC2]
3. A write **APPENDS a row** via **`INSERT … ON CONFLICT(client_event_id) DO NOTHING`**: an identical `client_event_id` retry de-dupes (no-op). The **current claim** for a cell `(round_id, player_id, hole_number, claim_type)` = the write with the **highest server-assigned monotonic order key** (an autoincrement `seq` / rowid assigned at INSERT time — **NOT** the client `created_at`, which is clock-skew-prone); `op='set'` ⇒ active, `op='remove'` ⇒ absent. Single-writer (`requireScorerForRound`) + the offline queue's FIFO-per-device replay + the server-assigned order make "latest" well-defined and resurrection-proof; a second-writer race is not an MVP concern (player self-report is Epic 6). `player_id` is validated to belong to the round/foursome, and every read/write is **tenant-scoped**. [AC3]
4. **Single-writer** (the foursome's designated scorer — the `hole_scores` contract, enforced at the route by `requireScorerForRound`): so there is no second concurrent writer to reconcile. Combined with the append-only log + `client_event_id` dedupe (same-device retry = no-op) + the server-assigned order (defines "latest"), this needs no LWW conflict-resolution. Player self-report (a genuine second writer) is Epic 6 with its own rule. [AC4]
5. Existing tables (`rounds`, `hole_scores`, `pairings`, …) untouched; tournament + wolf-cup suites stay green (NFR-X2). [AC5]

**Offline-queue + server route (claim flows through the SAME path as a score)**

6. A claim writes through the **same score-entry mutation + offline queue** as `hole_score`, as a new **`claim` `MutationKind`**: the explicit two-place change behind `isValidKind()` — add `claim` to the `MutationKind` union **and** the runtime `VALID_KINDS_INTERNAL` set in `apps/tournament-web/src/lib/offline-queue.ts` — plus its `url`+`body` dispatch + terminal-error registration. [AC6]
7. A **new server route `routes/claims.ts`** (NOT a piggyback on `routes/scores.ts`) reusing the scorer single-writer gate (`requireScorerForRound`); the write commits in **one tx** with `writeAudit` + `emitActivity`, using a **new `game.claim_recorded`-style activity type** registered in the existing Zod discriminated union (`engine/types/activity-events.ts`, else `emitActivity` rejects it — pattern 12) and a new **`GAME_*` audit type** (never a reused name). [AC7]
8. The claim is **accepted as entered** — v1 does **not** validate eligibility (e.g. greenie-only-on-par-3); correctness is the group's (trust + audit) (FR16). [AC8]
9. Entry (set AND remove) works **fully offline** — each is a queued mutation — and reconciles deterministically on reconnect, **idempotent via `client_event_id`** (FR19, NFR-R1): a PWA retry replays the same `client_event_id` → `ON CONFLICT DO NOTHING` no-op. (`requireScorerForRound` gates by the designated-scorer USER, so a DIFFERENT user is blocked; the SAME scorer's second device is not "blocked" but is harmless — its writes carry different `client_event_id`s and append, and the server-assigned-order latest-write-per-cell wins with no resurrection. The DB is NOT relied on to dedupe across distinct `client_event_id`s.) [AC9]

**Engine `holeState.claims` (claims feed the pure engine as inputs)**

10. **Story 2.1 owns** adding a **`claims` field** (the per-player claim set for the hole) to the Epic-1 `holeState` type (`engine/games/types.ts`) — `holeNumber` already exists (Story 1.1). `compute-foursome` populates `holeState.claims` at the **service layer** by deriving the **current claims = the latest `set` write per cell** from `hole_claim_writes` (the append-only log, ordered by the server seq; `remove`-latest cells are absent), keeping resolvers pure (Stories 2.2-2.4 consume this field, so it must exist first). The engine still never reads the DB. A `compute-foursome` claim-mapping test is required. [AC10]

**Edit / remove (non-finalized) + recompute fanout + finalized-check**

11. On a **non-finalized** round (append-only model): editing a claim in place = **appending a new `set` write** (same cell, new `client_event_id`); removing it = **appending a `remove` write** (NOT a hard delete); **reassigning to a different player** = a `remove` on the old cell + a `set` on the new cell. All three are queued + dedupe-keyed offline mutations; the current claim is always the latest write per cell, so a stale replay can never resurrect a removed claim. [AC11]
12. Money is **recompute-on-read** (Story 1.4): a claim write/edit/remove (each an **appended row**) just needs **durable persistence** so the next money read (deriving current-claims = latest-write-per-cell) reflects it — it does NOT "fire a recompute" (there is none). [AC12]
13. A claim write/edit/remove on a **finalized** round is **rejected with an explanation** — an **interim local finalized-check** ships here (explicitly testable: a claim write to a finalized round returns a refusal, asserted by test); Epic 4 routes this through the canonical frozen-boundary check (a deliberate seam). [AC13]
14. **Inert-vs-fail-closed (testable AC, not prose):** a recorded claim whose modifier is **`enabled:false`** in the resolved config produces **ZERO edges** (inert — safe default before its resolver ships); an **unknown modifier `type`** in config **fails closed** (unsettleable + surfaced, FR44). [AC14]

**On-course UI (in the score-entry flow, never a second screen)**

15. The claim control renders **within the existing per-hole score-entry route/component** (the `scores`/score-entry view) — **no new route, modal, or full-screen overlay** (verified by a web test asserting the control is in the score-entry render tree) — built from the shipped primitives, dark-mode tokens, full NFR-A1 floor (≥44–48px targets, 16px inputs, AA contrast, one-handed). [AC15]
16. At **375px** with up to **4 players × 3 claim types**, claims surface via **progressive disclosure inside the score view** (e.g. claim chips under the active player's row; only the player being scored shows claim controls), **no horizontal overflow**, no sub-44px targets (T12-2 precedent). [AC16]
17. **Lock state gates *config*, never *claim capture*** — a scorer in a **locked** foursome still records claims (a claim is scoring input, not a config tap; NFR-A2 zero-config-taps preserved). [AC17]
18. All work is `apps/tournament-api` + `apps/tournament-web` (FD-1/FD-2). [AC18]

## Tasks / Subtasks

- [ ] **Task 1 — `hole_claim_writes` append-only schema (AC: 1,2,5)** — `db/schema/hole-claim-writes.ts` sibling to `hole_scores`: immutable rows (id, round/player/hole, claim_type, `op`, scorer, `client_event_id`, created_at, eco) + a **server-assigned monotonic order key** (an autoincrement integer `seq`, or rely on the rowid — NOT the client `created_at`); **ONE dedupe UNIQUE on `client_event_id`** (NOT NULL, collision-resistant UUID). NO cell unique, NO DB CHECK (claim_type/op Zod-validated). Export from index; drizzle-kit generate + renumber (`0020`).
- [ ] **Task 2 — claim write service + `routes/claims.ts` (AC: 3,7,8,11,13)** — **APPEND** a row (`set`/`remove`) via `INSERT … ON CONFLICT(client_event_id) DO NOTHING` (idempotent; no cell-upsert, no 409 — there is no mutable cell); edit = new `set`, remove = `remove` write, reassign = `remove` old cell + `set` new cell; one-tx audit + activity; interim finalized-check (refuse a write on a finalized round); organizer/scorer gate via `requireScorerForRound`; validate `player_id ∈ round/foursome`; tenant-scope all reads/writes.
- [ ] **Task 3 — activity + audit types (AC: 7)** — register `game.claim_recorded` (+ removed?) in `engine/types/activity-events.ts` Zod union (payload incl. round/player/hole/claim_type); add a `GAME_*` audit type in `lib/audit-log.ts`. Test `emitActivity` accepts it.
- [ ] **Task 4 — offline-queue `claim` kind (AC: 6,9)** — add `claim` to `MutationKind` + `VALID_KINDS_INTERNAL` (the two-place change behind `isValidKind()`), `url`+`body` dispatch, terminal-error registration. Idempotency test (retry/2nd-device no double-insert).
- [ ] **Task 5 — engine `holeState.claims` + service population (AC: 10,12,14)** — add `claims` to `engine/games/types.ts` `HoleState`; `compute-foursome` (service layer) derives current claims = **latest-`set`-write-per-cell from `hole_claim_writes`**; resolvers stay pure. Inert (enabled:false → 0 edges) + fail-closed (unknown type → unsettleable) are asserted tests.
- [ ] **Task 6 — score-entry UI (AC: 15,16,17)** — claim chips/controls in the score-entry component (no new route/modal); progressive disclosure at 375px; NFR-A1 floor; locked foursome still captures.
- [ ] **Task 7 — tests (front-loaded fail-closed/edge — Epic 1 retro lesson) (AC: 3,9,11,13,14)** — `client_event_id` dedupe no-op; append `set` then `remove` ⇒ current = absent; **stale-replay-no-resurrect** (record `set` A, then `remove` B, then replay A → claim stays REMOVED, not resurrected — the core CRITICAL guard); reassign = `remove` old cell + `set` new cell; latest-set-per-cell derivation; finalized-refusal; inert-vs-fail-closed; offline idempotency (set + remove); web in-flow render + 375px no-overflow.
- [ ] **Task 8 — regression gate** — api + web tests + `pnpm -r typecheck` + lint green; engine + wolf-cup unchanged.

## Dev Notes

### Reuse the shipped seams (verified)
- **`hole_scores`** (`db/schema/scoring.ts`) — the precedent for `clientEventId` + INSERT ON CONFLICT DO NOTHING dedupe + the append-only `score_corrections` discipline (scores are NEVER hard-deleted — corrections append). `hole_claim_writes` follows that discipline: append-only, ONE dedupe UNIQUE on `client_event_id`, current state = latest write per cell (NOT a mutable cell row — that's what the CRITICAL fix removed).
- **Offline queue** (`apps/tournament-web/src/lib/offline-queue.ts`) — `MutationKind` union (line 23), `VALID_KINDS_INTERNAL` (line 35), `isValidKind()` (line 43), `terminalErrorRegistry` (line 125). The two-place change is union + set, both behind `isValidKind()`.
- **Scorer gate** (`routes/scores.ts` + `middleware/require-scorer-for-round.ts`) — `requireScorerForRound` is the single-writer gate `routes/claims.ts` reuses. Mirror the chain `requireSession → requireScorerForRound → handler`, do NOT piggyback on scores.ts.
- **Engine** (`engine/games/types.ts` `HoleState`, `compute-foursome.ts`) — add `claims`; populate at the service layer (resolvers pure). `holeNumber` already present.
- **Activity/audit** (`engine/types/activity-events.ts` Zod union, `lib/audit-log.ts`) — register a new `game.claim_recorded` type + `GAME_*` audit (the Story 1.3 precedent added `game.config_seeded` here).
- **Score-entry UI** (the `scores`/score-entry web route/component) + the shipped Button/Card/FormField + `ScrollableTable` + dark-mode tokens (T11/T12).

### Retro lesson applied (Epic 1)
The recurring Epic-1 miss was happy-path code passing while fail-closed/edge paths hid the bugs. Task 7 **front-loads** the edge tests: dedupe / append-set-then-remove / **stale-replay-no-resurrect** / reassign / finalized-refusal / inert-vs-fail-closed / offline-idempotency are written as part of the story, not after review. The stale-replay-no-resurrect test is the CRITICAL guard; AC14 (inert-vs-fail-closed) and AC13 (finalized-refusal) are the money-adjacent guards.

### Out of scope
The resolvers that CONSUME claims (greenie 2.2 / polie 2.3 / sandie 2.4 — each behind its golden); birdie variants (2.5); cap (2.6); template picker (2.7); player self-report / second-writer concurrency (Epic 6); the canonical frozen-boundary check (Epic 4 — this story ships the interim local check).

### Project Structure Notes
- New: `db/schema/hole-claim-writes.ts`, `routes/claims.ts`, a claim write service, a migration (`0020_*`). Edits: schema index, `offline-queue.ts`, `engine/games/types.ts` + `compute-foursome.ts`, `activity-events.ts`, `audit-log.ts`, the score-entry component, app router. All `apps/tournament-api/**` + `apps/tournament-web/**` (ALLOWED).

### Testing standards
- Vitest (+ web component test for in-flow render + 375px). Per-pid temp-file DB. The must-have tests: append-only `ON CONFLICT(client_event_id)` dedupe + latest-write-per-cell derivation + **stale-replay-no-resurrect** + offline idempotency (set+remove) + finalized-refusal + inert-vs-fail-closed. No new deps.

### References
- [Source: epics-f1-rules-games.md#Story-2.1] · [Source: architecture-f1-rules-games.md] (pattern 12 activity, pattern 15 in-flow capture, FR16/FR19/FR39/FR44, NFR-A1/A2/A3/R1/R3)
- [Source: apps/tournament-api/src/db/schema/scoring.ts] (hole_scores clientEventId ON CONFLICT dedupe + score_corrections append-only discipline — verified)
- [Source: apps/tournament-web/src/lib/offline-queue.ts] (MutationKind/VALID_KINDS_INTERNAL/isValidKind — verified)
- [Source: apps/tournament-api/src/routes/scores.ts] + [middleware/require-scorer-for-round.ts] (scorer single-writer gate — verified)
- [Source: apps/tournament-api/src/engine/games/types.ts] (HoleState — verified) · [Source: …/engine/games/compute-foursome.ts]
- [Source: apps/tournament-api/src/engine/types/activity-events.ts] + [lib/audit-log.ts] (Story 1.3 added game.config_seeded here)

## Files this story will edit

- apps/tournament-api/src/db/schema/hole-claim-writes.ts
- apps/tournament-api/src/db/schema/index.ts
- apps/tournament-api/src/routes/claims.ts
- apps/tournament-api/src/services/claim-write.ts
- apps/tournament-api/src/engine/games/types.ts
- apps/tournament-api/src/engine/games/compute-foursome.ts
- apps/tournament-api/src/engine/types/activity-events.ts
- apps/tournament-api/src/lib/audit-log.ts
- apps/tournament-api/src/app.ts
- apps/tournament-api/src/db/migrations/0020_<drizzle-generated>.sql
- apps/tournament-api/src/db/migrations/meta/_journal.json
- apps/tournament-api/src/db/migrations/meta/0020_snapshot.json
- apps/tournament-api/src/routes/claims.test.ts
- apps/tournament-api/src/services/claim-write.test.ts
- apps/tournament-api/src/db/schema/hole-claim-writes.test.ts
- apps/tournament-web/src/lib/offline-queue.ts
- apps/tournament-web/src/lib/offline-queue.test.ts
- apps/tournament-web/src/routes/<score-entry-component>.tsx (the per-hole score-entry view — exact path confirmed at implementation)
- _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context).

### Debug Log References

- Full api suite: 1254 pass / 2 skipped; the only red was the two documented
  load-induced `file::memory:?cache=shared` cross-file flakes
  (`round-lifecycle.integration.test.ts`, `lifecycle-full.e2e.test.ts`) — BOTH
  pass in isolation (24/24 and 1/1). Not regressions.
- Full web suite: 370 pass.
- `tsc --noEmit` clean (api + web); eslint clean on all changed files.

### Completion Notes List

- APPEND-ONLY model implemented exactly: `hole_claim_writes` with a server-
  assigned monotonic `seq` (MAX(seq)+1 in-tx), ONE global dedupe UNIQUE on
  `client_event_id`, NO cell-unique, NO 409, NO hard delete. Migration `0020`
  is additive CREATE TABLE only (no CHECK, no rebuild).
- STALE-REPLAY-NO-RESURRECT guard is airtight and tested at BOTH the service
  layer (`claim-write.test.ts`) and end-to-end through the route
  (`claims.test.ts`): set A → remove B → replay A ⇒ claim stays REMOVED, replay
  appends no row (deduped).
- Inert-vs-fail-closed (AC14) asserted via the EXISTING engine: disabled
  modifier ⇒ 0 edges (inert); unknown modifier type ⇒ `validateResolvedConfig`
  fails closed (unsettleable throw). No 2.2-2.4 resolver needed.
- JUDGMENT CALL (scorer gate): `requireScorerForRound` middleware is hard-coupled
  to `:holeNumber` + a SCORE-shaped body (`scorePostBodySchema` requires
  grossStrokes), so it cannot be mounted on the claims route without rejecting
  the claim body. Rather than duplicate the gate logic (the presses-route
  precedent uses a handler-internal check), I extracted the gate's decision into
  a shared pure helper `resolveScorerGate(txOrDb, …)` exported from the
  middleware; the middleware now DELEGATES to it (behavior-identical, verified by
  its 11 existing tests still green) and `routes/claims.ts` reuses the same
  per-USER single-writer logic in-handler. Zero score-path regression risk, no
  duplication.
- Engine: added `claims?: Record<playerId, HoleClaims>` to `HoleState`;
  `settleFoursome` (service layer) populates it from the append-only log
  (latest-`set`-write-per-cell, scoped to the foursome's players). Resolvers stay
  pure; the engine never reads the DB.
- The score-entry GET (`/api/rounds/:roundId`) now ALSO returns the current
  claims (additive; `[]` when none) so the UI chips reflect server truth across
  reloads. This was not in the spec's edit list but is additive and low-risk;
  flagged for review.

### File List

Created:
- apps/tournament-api/src/db/schema/hole-claim-writes.ts
- apps/tournament-api/src/db/schema/hole-claim-writes.test.ts
- apps/tournament-api/src/routes/claims.ts
- apps/tournament-api/src/routes/claims.test.ts
- apps/tournament-api/src/services/claim-write.ts
- apps/tournament-api/src/services/claim-write.test.ts
- apps/tournament-api/src/db/migrations/0020_eager_human_cannonball.sql
- apps/tournament-api/src/db/migrations/meta/0020_snapshot.json

### Impl-review fixes (dual-model ensemble, codex gpt-5.2 + gemini-pro-latest, high)

First pass (union): codex 1 Critical / 1 High / 2 Med / 1 Low; gemini 1 High / 1 Med — **converged** (zero material disagreement). Every finding grounded against source by the director before fixing. Applied:

1. **CRITICAL/HIGH (both) — `seq` order key.** Was a plain `integer` filled by application-side `MAX(seq)+1` — not concurrency-safe (two in-flight same-cell writes could tie → non-deterministic "latest" → the exact resurrection the design forbids) AND a full table scan per write. **Fix:** `seq` is now `integer('seq').primaryKey({ autoIncrement: true })` — the SQLite INTEGER PRIMARY KEY AUTOINCREMENT rowid alias (DB-assigns under the write lock: monotonic, never-reused, collision-free, index-served). `appendClaimWrite` omits `seq` from VALUES + reads it via RETURNING (deduped no-op → 0 rows → `inserted:false`). `id` demoted to a unique text column (`uniq_hole_claim_writes_id`). Migration **0020 regenerated** (`0020_eager_human_cannonball.sql`, single CREATE TABLE — no rebuild).
2. **HIGH (codex) — literal NUL-byte Map-key delimiter** (build/tooling/encoding hazard, 3 NUL bytes confirmed via raw-byte scan) → replaced with printable `|` (UUIDs/ints/enum tokens never contain `|`); also dropped the now-unused `sql` import.
3. **MEDIUM (both) — missing `holes_to_play` enforcement.** Claims route now loads `event_rounds.holes_to_play` (tenant-scoped) and returns 400 `hole_out_of_play` when `holeNumber > holesToPlay`; new test asserts hole 14 on a 9-hole round → 400 + nothing appended, hole 9 → 201.

Consciously deferred (not fixed): **`games-money` `claims:{}`** (codex Med #4) — verified benign: the engine reads `claims?.[playerId]` structurally, so an empty `{}` is behaviorally identical to `undefined` (0 edges); the 23 green `games-money` tests (incl. fail-closed/disjointness) prove the money path is unchanged. Did not churn the money chokepoint late. **FK cascade on round delete** (codex Low #5) — by-design, mirrors the shipped `hole_scores` cascade (round teardown is admin/test, not per-claim hard-delete).

**Re-review (parallel both, post-fix): codex CLEAN ("all three fully resolved, no new High regression"), gemini CLEAN ("all resolved, no new issues or regressions").**

Process note (deviation): the formal 5-step debate (critique + synthesize) prescribed for impl review was not run — there was zero material disagreement (both models converged on the same root cause from two angles) and every finding was verified by the director directly against source (observation > model inference); the mandated post-fix parallel-both re-review served as the confirming gate.

Tests after fixes: tournament-api 1255 ✓ + 2 skipped (the only red is the documented `lifecycle-full.e2e` full-suite-load flake — passes in isolation 1.10s); claims route 11 ✓ (was 10 + the new hole_out_of_play edge); typecheck clean. Web untouched by the fixes (agent's 370 ✓ stand).

Modified:
- apps/tournament-api/src/db/schema/index.ts
- apps/tournament-api/src/db/migrations/meta/_journal.json
- apps/tournament-api/src/engine/games/types.ts
- apps/tournament-api/src/services/games-money.ts
- apps/tournament-api/src/engine/types/activity-events.ts
- apps/tournament-api/src/lib/audit-log.ts
- apps/tournament-api/src/lib/activity.test.ts
- apps/tournament-api/src/middleware/require-scorer-for-round.ts
- apps/tournament-api/src/routes/scores.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/lib/offline-queue.ts
- apps/tournament-web/src/lib/offline-queue.test.ts
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml
