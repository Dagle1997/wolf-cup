---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-starter', 'step-04-decisions', 'step-05-patterns', 'step-06-structure', 'step-07-validation', 'step-08-complete']
lastStep: 8
completedAt: '2026-06-21'
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md
  - _bmad-output/planning-artifacts/tournament/architecture-betting-action.md
  - _bmad-output/planning-artifacts/tournament/architecture.md
  - _bmad-output/planning-artifacts/tournament/event-setup-ux-backlog.md
  - _bmad-output/brainstorming/brainstorming-session-2026-06-16.md
workflowType: 'architecture'
project_name: 'Wolf-Cup'
user_name: 'Josh'
date: '2026-06-21'
scope: 'F1 — Rules & Games configuration + Guyan real-money settlement engine (Tournament app)'
status: 'complete — 8/8. Decisions D1-D7 + 18 patterns + structure + validation; all 45 FRs + NFRs covered; 3 Codex criticals caught + fixed (producer-disjointness, full net-input pinning, resolved-config-snapshot). READY FOR IMPLEMENTATION. Hard gate = golden hand-calc fixtures first. Open item: presses OFF for F1 events in MVP (Josh to confirm).'
---

# Architecture Decision Document — Tournament F1: Rules & Games Engine

_Builds collaboratively through step-by-step discovery. Sections appended as each decision is made. Drives the implementation of the completed F1 PRD (`prd-f1-rules-games.md`, 45 FRs + NFRs)._

## Project Context Analysis

### Requirements Overview

**Functional (45 FRs, 7 areas)** — architecturally-shaping clusters:
- **(A) Rule-set authoring + preset library** — existing tenant `rule_sets` / `rule_set_revisions` become the seed/preset library (ADR-F1-1); revision `config` JSON extended to the game shape `{scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[]}`.
- **(B) Config cascade + lock** — Event→Round→Foursome resolver, most-specific-wins, gated by `lock_state`.
- **(C) Score + claim capture** — greenie/polie/sandie as first-class per-player-per-hole inputs (inherits v1's single-writer scorer model, offline, editable; trust-based, no eligibility validation v1).
- **(D) Teams** — formation methods (manual/random/high-low A/B) + late-bound composition + provenance pinning.
- **(E) Money settlement** — foursome-internal `computeFoursome(itsOwnConfig, itsOwnScores+claims) → foursomeLedger`; **team-game config at event + round level** (FR5: intra-foursome 2v2 + event pot); cross-group via the reused betting `SettlementEdge` IR (Product B).
- **(F) Edit/recompute + provenance** — correction (non-finalized) / forward-effective / finalized-frozen; a scored round pins config revision **and** team composition.
- **(G) Standings/visibility + migration** — leaderboard money/scores mode; per-hole breakdown; additive dual-read migration.

**Non-Functional (drivers):** money-correctness dominates — golden fixtures + integer-cents purity + property invariants (isolation, loss-less, cap, **order-independence**) + atomicity + durability + auditability + fail-closed. Secondary: offline/concurrency, performance (<2s warm, no input lag), audience-bounded privacy, registry extensibility, accessibility.

### Scale & Complexity
- Primary domain: **brownfield feature — PWA (`tournament-web`) + Hono/SQLite/Drizzle API (`tournament-api`); golf money engine.**
- Complexity: **High** (real-money correctness + brownfield migration); small private user base.
- **Phasing (don't over-build the first cut):** architect the **Product A spine first** — engine + seed → cascade + lock → additive dual-read migration → leaderboard mode. Product B (per-foursome unlock + cross-group) is additive on top; keep its seams open without building them now.
- Estimated components: config schema (event/round/foursome game-config + teams + preset revisions) · pure engine (cascade resolver + modifier/game registry + `computeFoursome` + stateful modifiers) · settlement (foursome ledger + `SettlementEdge` bridge) · recompute pipeline (reuse) · dual-read migration + golden-comparison harness · API endpoints · web UI (rules setup, claim capture, team formation, per-hole breakdown).

### Technical Constraints & Dependencies
- **Preserve:** FD-8 immutable `rule_set_revisions`; reconcile FD-13/FR-H1 forward-effective edits; do not regress the H1 locked-handicap overlay or Wolf Cup.
- **Reuse, don't reinvent:** the betting `SettlementEdge` IR (`architecture-betting-action.md`); slope-aware allocation (`services/handicap.ts` / `engine/handicap-strokes.ts` / `services/per-player-tee.ts`); the post-score-commit recompute path (press-orchestrator / money); `writeAudit` / `emitActivity` tx helpers; the offline queue; design-system primitives.
- **Coexist with existing schema (brownfield integration points):** `pairings` / `pairing_members` (teams read from slot order today), `rounds` / `round_states` (lifecycle + finalize gate), `hole_scores` (claims attach per player+hole alongside it), `event_handicaps` (H1 locked-HI overlay), `sub_games` (shipped skins). New config / claims / teams tables are additive and must not disturb these.
- **Engine location (recommended, confirm at step 3):** `apps/tournament-api/src/engine/` — pure, golden-tested, mirroring the shipped betting engine.
- **Golden-fixture format reuse:** the betting `engine/bets/__fixtures__/*.json` + runner pattern (four mechanics: Guyan / Wolf Cup variant / "345" cap / segmented; + adversarial). The **migration byte-identical money comparison is a SEPARATE harness** from the unit goldens.
- **Migration:** additive dual-read; new config tables only; existing events fall back to today's tenant-`rule_sets` behavior; CI-runnable byte-identical money comparison before any backfill.

### Cross-Cutting Concerns
Money correctness (golden + `fast-check` property tests) · structural foursome isolation (by signature) · provenance pinning (config + teams) · **atomic money-affecting writes** (single tx) · audit/activity on every money mutation · money-visibility (audience-bounded) · offline/idempotent capture · fail-closed/unsettleable surfacing · **recompute trigger fans out on CLAIM changes too, not just scores** (a sandie tap must recompute).

### Key Architecture Decisions To Resolve (step 4)
1. **Settlement spine** — keep MVP foursome-ledger→`money.ts` + Product-B `SettlementEdge`s as two paths, OR unify on **`SettlementEdge`-everywhere** with one consumer.
2. **Override-table shape** — `round_game_config` + `foursome_game_config` as separate tables vs one `(level, ref_id, config)` override table.
3. **Teams storage** — a dedicated `team`/`team_member` store vs derive + pin from `pairing_members` slot order (how teams are read today).
4. **Provenance pinning — physical model** — how a scored round records the config revision **and** team composition it used: FK columns on the round vs an immutable snapshot row (mirrors how rounds pin `course_revision_id` today).
5. **Recompute trigger + idempotency** — what fires recompute on score **and** claim edits, extending the post-score-commit path, and how it stays idempotent + deterministic.
6. **`sub_games` (skins) seam** — skins is the only shipped sub-game (CTP/sandies/putting are stubs); decide whether the F1 game model subsumes skins later or they coexist as separate paths.

## Starter Template Evaluation

### Primary Technology Domain
**Brownfield feature on shipped Tournament v1 — no new starter template.** F1 is additive code in the existing apps. A greenfield starter would orphan the shipped v1, the betting `SettlementEdge` IR, the slope-aware allocation, and the offline/auth/recompute machinery F1 depends on. **No init command — F1 is the first implementation story extending the existing monorepo.**

### Foundation (existing, pinned)
- **API (`apps/tournament-api`):** Hono ^4 (`@hono/node-server` ^1) · libsql `@libsql/client` ^0.17 + **Drizzle ORM ^0.45** (drizzle-kit ^0.30) · Zod ^3.24 · Vitest ^3 · **fast-check ^4.8** (added for the betting engine — reused for F1 property tests).
- **Web (`apps/tournament-web`):** React 19 · TanStack Router ^1.163 + Query ^5.90 · Vite ^6 + vite-plugin-pwa · Tailwind v4 + the recently-added design-system primitives (Button/Card/FormField) · Vitest ^3 + Testing Library.

### Established patterns to reuse (not re-decide)
- **Pure engine** at `apps/tournament-api/src/engine/games/` (sibling of `engine/bets/`) — the F1 game/modifier engine, with JSON golden `__fixtures__/*.json` + the betting-engine runner pattern. Confirms the step-2 engine-location recommendation.
- **Schema:** Drizzle table modules in `src/db/schema/`; additive migrations only (`ADD COLUMN`/`CREATE TABLE`, no CHECK-driven rebuilds — the T13-4 gotcha); `ecosystemColumns()` (tenant_id/context_id).
- **Services + routes:** Hono routers (`src/routes/`), services (`src/services/`), `writeAudit`/`emitActivity` tx helpers, `requireSession`/`requireOrganizer` + event-scoped gates.
- **Recompute:** the post-score-commit path (press-orchestrator / money).
- **Web:** file-route PWA, design tokens + primitives, offline queue.

### Selected "starter": the existing monorepo
- **Rationale:** brownfield correctness + reuse > greenfield. F1 is additive code in the shipped apps; no init command.
- **Zero new dependencies (a deliberate constraint)** — F1 reuses the pinned stack entirely (fast-check/drizzle/zod/Vitest already cover schema, tests, and property testing), matching the betting engine's "fast-check was the only new dep" discipline. Optional niceties (e.g. a JSON-diff/pretty-compare output for the migration harness, seed tooling) are *allowed if they earn their place* — not required.
- **No new infrastructure** — same VPS / Traefik / single SQLite; F1 is code-only.
- **Pinned-stack risk to verify at build:** the atomicity NFR (NFR-D2) relies on `@libsql/client` + Drizzle **single-transaction semantics** — confirm BEGIN/commit (and any locking) behavior holds for multi-row money writes; confirm drizzle-kit's additive dual-read migration capabilities and the pinned `fast-check` suits the intended invariants.
- **One new test artifact (not a dependency):** the migration byte-identical money-comparison harness (a script/test, distinct from the unit goldens).

## Core Architectural Decisions

### Decision Priority Analysis
- **Critical (block implementation):** D1 settlement spine · D2 config model · D4 provenance pinning · D5 recompute model · D6 claims storage.
- **Important (shape architecture):** D3 teams storage · D7 skins seam.
- **Deferred (Product B, seams kept open):** cross-group edges (reuse D1 IR) · per-foursome unlock.

### D1 — Settlement spine: SettlementEdge is the single IR
`computeFoursome(config, scores+claims) → foursome ledger` that **lowers to `SettlementEdge`s**; cross-group games (B) emit edges directly; the pairwise settle-up is the one consumer (reuse the shipped betting chokepoint). **Per-event the dual-read routes to EITHER legacy `money.ts` OR the F1 edge engine — never both** (no double-count): non-F1 events stay on `money.ts`; F1-config events route entirely through the new engine. Ledger ↔ edges reconcile (loss-less, NFR-C3).

**Settlement composition (no double-count) — the settle-up sums DISJOINT producers, each owning exactly one slice:**
- (i) **The Action betting edges** — player bets (own domain, shipped); always on.
- (ii) **F1 game engine** — Guyan 2v2 + team games + claims; **F1-config events only**.
- (iii) **Legacy `money.ts`** — 2v2 best-ball + presses; **non-F1 events only** (for an F1 event, `money.ts`'s 2v2 is OFF — F1 owns it).
- (iv) **`sub_games` / skins** — own path, both kinds of event.
- **Open item (presses):** presses today ride the legacy 2v2; for an F1 event the 2v2 is F1's → **MVP: presses OFF for F1 events**, re-home in Product B if a group wants them. Flagged for Josh.

### D1a — Settlement producer ownership matrix (the double-count guard)
A money slice is computed by **exactly one** producer; the settle-up is their disjoint sum. Tested by an invariant: for any event, no (debtor,creditor,reason) edge is emitted by two producers.

### D2 — Config model: one polymorphic table
`game_config(level: event|round|foursome, ref_id, config_json, seed_rule_set_revision_id?, lock_state?, …ecosystem)`. The cascade resolver reads one table, **most-specific-wins (Foursome→Round→Event), gated by `lock_state`**. No per-level FK (ref_id is polymorphic) → **validate ref-by-level in code**; DB **unique `(tenant, level, ref_id)`**; `config_json` **Zod-validated on write**. The resolver + lock gate are golden-tested (R6). `rule_sets`/`rule_set_revisions` remain the immutable preset library (ADR-F1-1).
- **Cascade merge = deep-merge** — a round/foursome override changes only the fields/modifiers it specifies; unspecified inherit from the parent level. (Not whole-object replace.)
- **Modifier application is deterministically ordered** (stable registry order), independent of storage/iteration order (NFR-C6).
- **Edit semantics (ADR-F1-2) are represented in the model:** *forward-effective* = a round override carrying `effective_from_hole` (the existing FD-13 mechanism); *correction* = re-point the round's pinned config-rev + recompute (non-finalized only); *finalized* = reject the edit.

### D3 — Teams: TWO distinct concepts
- **(a) Intra-foursome 2v2** — derived from pairing slots (1&2 vs 3&4), per-round; drives the Guyan game; unchanged from today.
- **(b) Persistent / global teams** — a dedicated **event-level `teams` + `team_members` store** (formation: manual / random / high-low HI A/B, FR20–21); for member-guest, event standings, and cross-group (B). A global teammate **can be** a foursome-2v2 opponent (Josh's caveat). UI labels the two distinctly.
- **Money mapping (which team drives which path):** intra-foursome 2v2 (slot teams) → the **Guyan 2v2 money**; global teams → the **event pot** (FR5 best-ball-vs-par) **and** cross-group head-to-head (Product B). The two never settle the same dollars.

### D4 — Provenance pinning (physical model)
- **Config:** pin the **fully-RESOLVED config snapshot** (the merged Event→Round→Foursome result) on the scored round, **plus** the seed `rule_set_revision_id` FK for provenance. *(Pinning only the seed revision is insufficient — the cascade `game_config` overrides are mutable; the snapshot is what recompute reads, so finalized money can't drift when an override is later edited.)*
- **Teams:** pin **pairings** (slot teams — already append-only) **+ a global-team-composition snapshot** captured on the scored round.
- **Net inputs pinned too (the Codex catch):** the **H1 locked-HI snapshot** (`event_handicaps`, immutable once locked) **+ the round's tee / `course_revision_id`** (already pinned). Net money can't be deterministic without these.
- A scored round's deterministic inputs = **scores + claims + config-rev + teams (pairings + global snapshot) + locked-HI + course-rev/tee** — all frozen.

### D5 — Recompute: on-read over pinned inputs
**Recompute-on-read** (pure derivation from scores + claims + config), like the betting engine — no stored money to drift (NFR-D3 reconstructable). **Finalized-frozen = input immutability:** a finalized round recomputes to the same number because its inputs (pinned config rev + frozen scores/claims) are immutable; a later rule-set edit creates a *new* revision the finalized round doesn't point to. **Finalize freezes scores/claims** (and the inputs in D4: config-rev, teams, locked-HI, course-rev are already immutable). Edit semantics (ADR-F1-2) enforced via D2's representation — **correction** re-pins + recomputes (non-finalized); **forward-effective** applies from `effective_from_hole`; a **finalized** round **rejects** edits (NFR-C5). Because finalized inputs are all immutable, recompute-on-read provably cannot change finalized money. Perf: fine at this scale; add a derived cache only if NFR-P2 demands it.

### D6 — Claims storage: `hole_claims` table
`hole_claims(round_id, player_id, hole_number, claim_type, scorer_player_id, client_event_id, …ecosystem)` — sibling to `hole_scores`; **upsert by (round, player, hole, claim_type)**; delete to remove (FR39); `client_event_id` for offline dedup; single-writer scorer (inherits v1). **Out-of-order replay:** each claim row carries `updated_at` / a client sequence; **last-write-wins** by that order. Single-writer scorer + ordered offline queue makes cross-device conflicts rare; LWW is the deterministic tiebreak.

### D7 — `sub_games` (skins) seam: coexist
Skins keeps its shipped path; the F1 game model is the new spine; folding skins in is a future option. F1 does not touch skins.

### Inherited (not re-decided)
SQLite/Drizzle additive migrations · existing auth (session/CSRF/role + event-scope; H1 device-binding for participants) · Hono REST `{error,code,requestId}` · TanStack PWA + offline queue + design primitives · VPS/Traefik · integer-cents pure money · golden + `fast-check` tests.

### Decision Impact Analysis
**Implementation sequence (risk-sequenced, Product A):**
1. Engine `src/engine/games/` — game shape `{scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[]}` + modifier registry + `computeFoursome` + cascade resolver; **golden-fixture-gated** (no live-data risk).
2. Schema — `game_config` + `hole_claims` + `teams`/`team_members` + pinning (config-rev FK, pairings append-only, global-team snapshot).
3. Admin seed + lock (kills the dead "No rule set" card).
4. Score + claim capture UI + recompute-on-read.
5. Additive dual-read migration + byte-identical comparison harness.
6. Leaderboard mode + per-hole breakdown.
7. Team-formation UI.
   Product B (per-foursome unlock + cross-group edges) after.

**Cross-component dependencies:** D1 IR ← D5 recompute; D4 pinning ← D2 config + D3 teams; D6 claims → D1 (inputs); resolver (D2) gated by `lock_state`; finalize (D5) freezes D6 claims + scores.

## Implementation Patterns & Consistency Rules

### Inherited conventions (match the existing codebase — do NOT invent new)
- **Naming:** snake_case DB; Drizzle modules `src/db/schema/<name>.ts`; services `src/services/`; flat routers `src/routes/<area>.ts` (e.g. `admin-event-bets.ts`); web file-routes `*.tsx`; co-located `*.test.ts(x)`.
- **API:** Hono routers; error `{ error, code, requestId, fields? }`; `requireSession` + `requireOrganizer` + event-scoped gate; bodyLimit + Zod `safeParse`; consistent `code` strings for new F1 endpoints (`unsupported_*`, `config_locked`, `round_finalized`, …).
- **Schema:** `ecosystemColumns()` (tenant_id 'guyan' + context_id); additive migrations only (statement-breakpoints, **no CHECK-driven rebuilds** — T13-4); drizzle-kit generate + renumber.
- **Web:** design tokens + Button/Card/FormField primitives; ≥44–48px targets; offline queue; per-resource Query keys.

### F1-specific patterns (where agents WILL diverge — pin them)
1. **Pure engine, deps-in:** `src/engine/games/` has NO db/I/O; callers pass scores/claims/config/handicaps in (mirrors `engine/bets/`).
2. **Money = integer cents, no floats, deterministic + order-independent** (stable sorts; no Map-iteration-order) — NFR-C2/C6.
3. **Golden fixtures:** JSON in `engine/games/__fixtures__/*.json` with hand-calc outputs; one per mechanic (Guyan/Wolf/"345"/segmented) + adversarial; **no settlement code merges without its fixture** (hard gate).
4. **SettlementEdge construction:** reuse `{fromPlayerId,toPlayerId,cents,sourceType,sourceId}` (`from` PAYS `to`); `sourceType` is the **producer namespace** (`f1_game`|`betting`|`legacy_2v2`|`skins`) and `sourceId` the specific game/bet id, so D1a producer-disjointness is **mechanically checkable** (no two producers emit the same logical slice). Ledger→edges lowering is loss-less.
5. **Recompute-on-read:** never store derived money; computed each read from pinned inputs **within one consistent read snapshot** (single read tx — inputs read atomically, never mixing a half-written update); no cache without NFR-P2 justification.
6. **Modifier/game registry:** `register(type, resolver)`; resolvers pure `(holeState, config) → contribution`; add a rule = data + one resolver (never a code branch); stable application order. **Config carries a `config_version`; an unknown modifier type or a config_version newer than the engine supports → FAIL-CLOSED** (unsettleable + surfaced, FR44) — never silent-ignore (silent-ignore mis-settles money).
7. **Cascade resolve = deep-merge, most-specific-wins, lock-gated** — the single place precedence is computed.
8. **Claim/score writes:** one tx with `writeAudit` + `emitActivity` (P9); **idempotency = UNIQUE (round,player,hole,claim_type,client_event_id)** (a retried write is a no-op); single-writer scorer; claims upsert by (round,player,hole,claim_type); **LWW tiebreak = server-assigned monotonic seq (createdAt,id)**, deterministic.
9. **Provenance pinning:** a scored round pins the **resolved-config snapshot** (merged cascade) + seed-rev FK + pairings (append-only) + global-team snapshot + locked-HI + course-rev; recompute reads ONLY these pinned snapshots, **never live `game_config` rows** (else finalized money drifts).
10. **Net reuse:** import `getHandicapStrokes`/`allocateNetThroughHole`/`calcCourseHandicap`/`buildTeeByPlayer` — zero new allocation math.
11. **Producer disjointness:** F1 emits edges only for its owned slice (D1a matrix); never double-emit with money.ts/betting/skins.
12. **New activity/audit types:** distinct `game.*` names in activity-events.ts (Zod union) + audit-log.ts — never reuse a taken name (P14).
13. **Pin-at-round-start:** the resolved-config snapshot + locked-HI + teams snapshot pin at the **round lifecycle transition to `in_progress`** (the existing start-round path); only a *correction* re-pins.
14. **Dual-read switch:** an event is **F1 iff it has an EVENT-LEVEL `game_config` row** — the sole routing check. Guardrails: **reject orphan lower-level (round/foursome) config without an event-level row**; once F1, **all rounds use the F1 engine** (inherit when no override) — never mix legacy `money.ts` per-round within an F1 event.
15. **Claim capture = score path:** claims write through the **score-entry mutation + offline queue** (a `claim` kind beside `hole_score`), inheriting single-writer + idempotency; never a separate screen.
16. **Recompute consumer = one chokepoint:** leaderboard/money/settle-up call the engine via a **single service entry point** (F1's P8-style chokepoint), never inline.
17. **Test homes:** `engine/games/*.property.test.ts` (`fast-check`: isolation, loss-less, cap, order-independence) + a **producer-disjointness** integration test for the D1a matrix.
18. **Story unit:** **one modifier/game type = one pure resolver + one golden fixture + one story** (clean decomposition).

### Enforcement
- **All agents MUST:** golden-fixture before settlement code · integer cents · recompute-on-read · pure engine · reuse net allocation + SettlementEdge · one-tx audit+activity · pin-at-round-start · route via the dual-read switch + the single recompute chokepoint.
- **Anti-patterns:** storing computed money · float math · iteration-order in settlement · reimplementing handicap · a rule as a code branch · cross-producer double-emit · a separate claims screen · pinning at inconsistent moments · reading live `game_config` for a scored round · silent-ignoring an unknown modifier type.
- **Checkable gates (not aspirational):** golden-fixture CI gate (settlement code without a fixture fails CI) · `engine/games/*.property.test.ts` (the 4 invariants) · producer-disjointness integration test (D1a) · the existing eslint `no-restricted-syntax`/imports guarding direct `activity` writes · `pnpm -r typecheck` + lint + the green-suites CI gate.

## Project Structure & Boundaries

Brownfield — additive files in the existing monorepo. New (＋) and touched (~):

```
apps/tournament-api/src/
  engine/games/                         ＋ pure F1 engine (no I/O)
    types.ts                            ＋ game shape, modifier, holeState, ledger, contribution
    registry.ts                         ＋ register(type, resolver); stable order
    resolver.ts                         ＋ cascade deep-merge, most-specific-wins, lock-gated (D2)
    compute-foursome.ts                 ＋ computeFoursome(config, scores+claims) → foursomeLedger (D1/D5)
    ledger-to-edges.ts                  ＋ ledger → SettlementEdge[] lowering (D1, namespaced sourceType)
    modifiers/{greenie,polie,sandie,net-birdie}.ts  ＋ pure resolvers (one rule = one file + fixture)
    games/{guyan-2v2,team-pot}.ts       ＋ game resolvers
    __fixtures__/*.json                 ＋ golden: guyan/wolf/"345"/segmented + adversarial
    *.test.ts, *.property.test.ts       ＋ goldens + fast-check invariants + producer-disjointness
  db/schema/
    game-config.ts                      ＋ game_config(level, ref_id, config_json, seed_rev, lock_state)
    hole-claims.ts                      ＋ hole_claims (D6)
    teams.ts                            ＋ teams + team_members (D3b persistent/global)
    round-pins.ts                       ＋ resolved-config snapshot + team snapshot per scored round (D4/D9)
  db/migrations/00NN_*.sql              ＋ additive (CREATE TABLE only; no CHECK rebuild)
  services/
    games-config.ts                     ＋ seed/lock/override CRUD + cascade read
    games-money.ts                      ＋ THE P8 chokepoint: event → edges (consumed by money/leaderboard/settle-up)
    claims-write.ts                     ＋ claim upsert tx (+ audit/activity); or fold into scores.ts
    teams.ts                            ＋ formation: manual/random/high-low A/B (FR20)
    migration-compare.ts                ＋ byte-identical old-vs-new money harness
    money.ts / money-detail.ts          ~ consume F1 edges for F1 events (dual-read switch)
    scores.ts                           ~ accept claim writes on the score path (pattern 15)
  routes/
    admin-event-game-config.ts          ＋ seed / lock / round override (organizer)
    admin-event-teams.ts                ＋ team formation (organizer)
    scores.ts                           ~ claim capture endpoint (same path as scores)
  engine/types/activity-events.ts       ~ + game.* activity types (Zod union)
  lib/audit-log.ts                      ~ + GAME_* audit types
  app.ts                                ~ mount the new routers

apps/tournament-web/src/
  routes/
    admin.events.$eventId.game-config.tsx   ＋ "Rules & Games" setup (kills the dead card)
    admin.events.$eventId.teams.tsx         ＋ team formation UI
    rounds.$roundId.score-entry.tsx         ~ inline greenie/polie/sandie capture (pattern 15)
    events.$eventId.leaderboard.tsx         ~ click player → per-hole breakdown (FR41 / W2)
    admin.events.$eventId.index.tsx         ~ Rules & Games link replaces "No rule set" card
  components/
    rules-summary.tsx                       ＋ plain-language active-rules line (FR35/NFR-A3)
    claim-controls.tsx                      ＋ inline claim toggles
    hole-breakdown.tsx                      ＋ per-hole money/points panel (FR41)
```

### Architectural Boundaries
- **Engine (pure, deps-in) ↔ services (I/O) ↔ routes (HTTP) ↔ web.** The engine never touches the db.
- **`services/games-money.ts` is the SINGLE F1 settlement chokepoint** (P8): money/leaderboard/settle-up read F1 money only through it; it emits namespaced `SettlementEdge`s.
- **Producer-disjointness boundary (D1a):** edges carry `sourceType` ∈ {f1_game, betting, legacy_2v2, skins}; settle-up sums disjoint producers.
- **Dual-read boundary:** event has an event-level `game_config` row → F1 engine; else legacy `money.ts` (pattern 14).

### Requirements → Structure mapping
- **Authoring (FR1–7) →** `services/games-config.ts` + `routes/admin-event-game-config.ts` + `web …/game-config.tsx`.
- **Cascade + lock (FR8–14) →** `engine/games/resolver.ts` + `game_config` schema.
- **Score + claim capture (FR15–19, 39) →** `hole-claims.ts` + `scores.ts`/`claims-write.ts` + score-entry UI.
- **Teams (FR20–22) →** `teams.ts` schema + service + `web …/teams.tsx`.
- **Settlement (FR23–28, 40, 42, 44) →** `engine/games/` + `services/games-money.ts`.
- **Edit/recompute + provenance (FR29–33, 43) →** `round-pins.ts` + resolver edit-semantics + finalize path.
- **Standings/visibility + migration (FR34–38, 41) →** leaderboard/money/settle-up `~` + `hole-breakdown.tsx` + `migration-compare.ts`.

## Architecture Validation Results

### Coherence Validation ✅
- **Decisions compatible:** D1 (SettlementEdge IR) ← D5 (recompute-on-read) ← D4 (pinned resolved-config snapshot) — together they give finalized-frozen for free (Codex-confirmed). D2 (polymorphic config) is read only by the D-cascade resolver. D3's two team concepts map to disjoint money paths (D1a). No contradictions.
- **Patterns support decisions:** the 18 patterns + enforcement gates directly encode D1–D7 (pure engine, integer cents, golden fixtures, recompute-on-read, pinning, producer-disjointness, dual-read switch).
- **Structure aligns:** the file tree places each decision/pattern in a concrete module; `services/games-money.ts` is the single settlement chokepoint.

### Requirements Coverage ✅
- **All 45 FRs** map to a structure location (see Requirements → Structure mapping). Authoring (FR1–7), cascade+lock (FR8–14), score+claim capture (FR15–19,39), teams (FR20–22), settlement (FR23–28,40,42,44), edit/recompute+provenance (FR29–33,43), standings/visibility/migration (FR34–38,41). Product-B FRs (13,14,22,25) have open seams, not built.
- **NFRs addressed:** correctness (golden+property tests, integer-cents pure engine, order-independence, fail-closed) · auditability (T1 per-hole breakdown reconciles) · durability/atomicity (D2-tx, recompute-from-pinned-inputs) · migration (compare harness) · perf (recompute-on-read, cache deferred) · privacy (chokepoint + audience-bounded) · concurrency (single-writer + LWW) · accessibility (inherited primitives).

### Implementation Readiness ✅
- Decisions documented with rationale; patterns enforceable via named CI gates; structure complete + specific; the four-mechanic golden coverage is the engine definition-of-done.

### Gap Analysis
- **Critical:** none open (the 3 Codex criticals were resolved: producer-disjointness, full net-input pinning, resolved-config-snapshot).
- **Important (build-time verifications, not blockers):** confirm `@libsql/client` + Drizzle single-transaction atomicity for multi-row money writes (NFR-D2); confirm drizzle-kit additive dual-read migration shape.
- **Open product item:** **presses OFF for F1 events in MVP** (re-home in Product B) — Josh to confirm.
- **Nice-to-have:** a derived money cache only if NFR-P2 needs it.

### Architecture Completeness Checklist
- [x] Context analyzed · scale/complexity assessed · constraints + cross-cutting mapped
- [x] Core decisions (D1–D7) documented + Codex-hardened
- [x] Implementation patterns (1–18) + enforcement gates
- [x] Complete file structure + boundaries + FR→structure mapping

### Architecture Readiness Assessment
- **Overall:** READY FOR IMPLEMENTATION.
- **Confidence:** HIGH — load-bearing money-safety decisions were adversarially reviewed (3 criticals caught + fixed); reuse-heavy brownfield lowers risk.
- **Strengths:** one settlement IR + disjoint producers (no double-count); finalized-frozen via pinned inputs; pure golden-gated engine; zero new deps.
- **Future enhancement:** Product B (per-foursome unlock + cross-group edges), money cache if needed, folding skins into the game model.

### Implementation Handoff
- **Agents MUST:** follow D1–D7 + the 18 patterns + enforcement gates exactly; route all F1 money through `services/games-money.ts`; reuse the net allocation + SettlementEdge IR.
- **First implementation priority (hard gate):** author the **golden hand-calc fixtures** (Guyan / Wolf / "345" / segmented + adversarial) BEFORE any settlement code — then `engine/games/` to match them, then schema, then the risk-sequenced build order (D-Impact Analysis).
