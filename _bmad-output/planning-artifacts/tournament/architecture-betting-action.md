---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-starter', 'step-04-decisions', 'step-05-patterns', 'step-06-structure', 'step-07-validation', 'step-08-complete']
lastStep: 8
status: 'COMPLETE (2026-06-20) — all 8 steps done. READY FOR IMPLEMENTATION (HIGH confidence). Verified favorable: hole_scores.putts exists, per-hole net exists (netForSegment is exposure), money-detail.ts already pairwise+per-game. First build artifact = golden hand-calc fixtures.'
completedAt: '2026-06-20'
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/prd-betting-action-line.md
  - _bmad-output/planning-artifacts/tournament/architecture.md
  - _bmad-output/planning-artifacts/tournament/prd.md
  - _bmad-output/planning-artifacts/tournament/implementation-readiness-report-betting-2026-06-20.md
  - _bmad-output/planning-artifacts/tournament/product-brief.md
workflowType: 'architecture'
project_name: 'Tournament — "The Action" betting'
user_name: 'Josh'
date: '2026-06-20'
scope: 'Solution design for the Tournament betting feature (FR1–FR54). BROWNFIELD on shipped Tournament v1; conforms to tournament/architecture.md. Tournament paths only (apps/tournament-api, apps/tournament-web).'
outputFolder: '_bmad-output/planning-artifacts/tournament/'
primaryPrd: '_bmad-output/planning-artifacts/tournament/prd-betting-action-line.md'
conformsTo: '_bmad-output/planning-artifacts/tournament/architecture.md (Tournament v1 — inherited decisions, NOT to be re-litigated)'
keyDeliverables:
  - 'Settlement state machine (draft/live/provisional/settled/void/unsettleable/finalized)'
  - 'Net-by-segment/by-hole contract from the leaderboard service (settlement never re-derives net)'
  - 'Net-calc versioning (a future leaderboard fix cannot silently re-settle old bets)'
  - 'Golden hand-calc fixtures per bet type incl. every Snake edge (HARD GATE — NFR-C1/C3/C4)'
  - 'Audit payload schema'
  - 'Snake as a distinct N-participant settlement type + completeness gate + pairwise expansion'
  - 'Conditional putts entry (port Wolf Cup "least putts"; verify hole_scores.putts exists)'
  - 'Score-correction-after-payment / finalization handling'
notes: |
  Output path overridden to architecture-betting-action.md (feature-scoped) — the
  existing architecture.md files (root = Wolf Cup, tournament/ = Tournament v1) are
  COMPLETE and must NOT be continued or clobbered. This doc conforms to the
  Tournament v1 architecture (services-layer query/transaction split, recompute-on-read
  no-cache money, activity spine, money_visibility, join-code identity) and reuses the
  existing individual_bets engine + leaderboard net (never re-derive net). Wolf Cup is
  read-only port-pattern reference only (FD-1/FD-2).
---

# Architecture Decision Document — Tournament "The Action" Betting

**Author:** Josh
**Date:** 2026-06-20
**Scope:** Solution design for the betting feature (PRD `prd-betting-action-line.md`, FR1–FR54). Brownfield on the shipped Tournament app; conforms to `tournament/architecture.md`.

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Core Architectural Pattern (the framing everything hangs off)

Settlement is a **pure function over `(durable bet definitions + scores + a minimal set of durable organizer overrides)`**. Almost all bet state is **derived** (recompute-on-read, no cache; a score correction re-settles automatically). Only four things are **durable state** beyond the bet definition and the scores:
1. **void** status,
2. organizer **resolution of an unsettleable bet** (fixed value / manual settle / void),
3. the Snake **"last-in" designation** (per round+hole, only when ≥2 tie on putt count),
4. a **finalized / paid** marker (for "changed since paid" handling).

Naming this resolves the bulk of the adversarial findings: the recompute-purity vs. durable-state tension is explicit, and the durable surface is deliberately tiny and auditable.

### Requirements Overview

**Functional Requirements (54, 9 capability areas)** cluster into five components:
1. **Bet persistence & lifecycle** (FR1–FR20, FR48–FR53) — schema carrying subjects-vs-stakeholders, scope (round + explicit hole set), type/basis/stake, segments (parent + linked children), explicit **lifecycle state**; two write paths (player self-serve + admin) with placement-cutoff + authority rules.
2. **Settlement engine** (FR21–FR26) — pure recompute-on-read functions per bet type (h2h net/gross, per-hole match, putts-total, segmented). Reuses the **leaderboard net**; the critical new contract is **net-by-segment/by-hole** so Nassau front-net is consumed, never re-derived.
3. **Snake / putting subsystem** (FR27–FR32, FR54) — a **distinct N-participant settlement type** (not the 2-stakeholder model), conditional **putts entry** (port Wolf Cup "least putts"), a completeness gate, play-sequence ordering, and the worst-putt/last-in same-hole tiebreak (a new scorer input).
4. **Action board + settle-up** (FR33–FR41) — recompute-on-read read models; pairwise netting plus Snake's holder→each-other expansion; `money_visibility` on every read path.
5. **Identity, audit & integrity** (FR42–FR47) — join-code identity, roster constraints, audit row per mutation in the same transaction, deterministic reproducibility.

**NFRs that shape the design:** **Correctness is primary** — pure engine + **golden hand-calc fixtures** (the hard release gate), determinism, recompute-on-read (no cache to invalidate). Net **reused + versioned**. `money_visibility` enforced. Audit in-transaction. **Bet placing is online-only** (no offline queue v1). Integer money.

### Scale & Complexity
- **Primary domain:** full-stack PWA + Hono/SQLite, brownfield feature.
- **Complexity:** medium — small data scale (~12 players × 2 rounds), but a **correctness-sensitive settlement core** with one genuinely novel shape (Snake's N-party one-pays-all).
- **Estimated new components:** ~5 (bet schema, settlement engine modules, Snake/putts subsystem, board/settle-up read services, admin + player routes/UI) — all inside the existing Tournament shells.

### Technical Constraints & Dependencies
- **Must conform to Tournament v1 architecture** (`tournament/architecture.md`): services-layer split (query services read-only / transaction helpers write via `tx`), recompute-on-read no-cache money, activity spine, `money_visibility` posture, join-code identity. Inherited locks, not re-litigated.
- **Schema decision (locked now):** a **new `bets` schema** (additive) — **NOT** an extension of `individual_bets`. The two-player shape of `individual_bets` can't hold subjects≠stakeholders, segments, or Snake's N parties; the existing match-play path stays untouched and can migrate in later.
- **Reuse, don't rebuild:** the `individual_bets` engine (per-hole match + auto-press) as a pattern, the **leaderboard net** (slope-aware, locked-HI aware — never re-derive), the money/settle-up services.
- **Tournament paths only** (`apps/tournament-api`, `apps/tournament-web`); Wolf Cup is **read-only port-pattern** reference (FD-1/FD-2).
- **Two verification spikes — RESOLVED 2026-06-20 (both favorable):**
  - (a) **`hole_scores.putts` EXISTS** — `apps/tournament-api/src/db/schema/scoring.ts:121` (`putts: integer('putts')`, nullable). Snake/putting is a **UI/entry concern, NOT a schema migration.** Nullable → completeness gate must treat `null` putts as "not entered."
  - (b) **Per-hole net ALREADY EXISTS** — `apps/tournament-api/src/services/leaderboard.ts` has `netThroughHole` + `allocateNetThroughHole()` (per-hole stroke allocation from `handicap.js`). The **net-by-segment contract is exposure of existing math, not new math** — front/back/segment net derives from the per-hole allocation already in the service.

### Cross-Cutting Concerns Identified
1. **Net-data contract** (by-segment/by-hole + trust flag + **calc version**) — the linchpin; settlement consumes it, never re-derives; a future leaderboard fix must not silently re-settle banked bets.
2. **Recompute-on-read determinism** — no cache; a score correction re-settles automatically.
3. **`money_visibility` on every read path** (board, settle-up, detail, export) — stakeholder/organizer based.
4. **Audit + single-transaction boundary** on every mutation.
5. **Settlement state machine** — esp. `provisional`, `unsettleable` (→ organizer resolve), and a `finalized`/"changed since paid" notion (the durable-override surface above).
6. **Putts data lifecycle** — conditional entry + completeness gate for putt-dependent bets.
7. **Dual-writer authority + placement cutoff** (player vs admin; no betting on a known result).
8. **Snake's N-party settlement** reconciled with the 2-stakeholder model via deterministic pairwise expansion.
9. **Golden fixtures are the FIRST build artifact** — hand-authored + Josh-approved before any settlement code (Snake-heavy: first-4-putt=$6, worst-putt-same-hole, last-in tie, no-event, holder re-4-putts, DNF/incomplete=provisional) + a **void/adjust ledger-invariant property test** (NFR-C4).

## Starter Template Evaluation

### Primary Technology Domain
Full-stack TypeScript PWA + Hono/SQLite API — **already scaffolded**. This feature adds files inside the existing `apps/tournament-api` and `apps/tournament-web`; it stands up no new project.

### Decision: No new starter — inherit the Tournament app's existing scaffold
A starter template is not applicable to a brownfield feature. Foundation, conventions, and versions are fixed by the shipped app and are **inherited locks** (re-deriving or upgrading them is out of scope and would risk the live app).

**Inherited stack (locked):** TypeScript 5.7 strict, Node 22, ESM · Hono 4 + Drizzle 0.45 + `@libsql/client` · React 19, Vite 6, TanStack Router + Query, Tailwind v4, vite-plugin-pwa · Zod · Vitest 3 + golden-file fixtures · ESLint 9 flat config.

**Version posture (locked):** match the existing Tournament app's pinned versions exactly — **do not** pull "latest from npm" (per the Tournament v1 version-alignment rule). Web-version research is intentionally skipped.

**Architectural patterns inherited (not re-litigated):** services-layer split (query services read-only / transaction helpers write via `tx`); recompute-on-read no-cache money; `activity` spine (FD-5, no push); `money_visibility` on every read path; join-code/device identity (B0); Hono routes by resource + `/admin/*`; Drizzle domain-grouped schema files + Tournament's own migration ordinal; named exports only; kebab-case files; integer-money discipline.

### Feature Module Boundaries (the concrete shape of "inherit") — party-mode 2026-06-20
- `apps/tournament-api/src/engine/bets/` — **pure settlement functions + golden fixtures** (no DB, no I/O).
- `apps/tournament-api/src/services/bets-query.ts` — query service (read + compute, never write).
- `apps/tournament-api/src/services/bets-write.ts` — transaction helper (writes only via a passed `tx`).
- `apps/tournament-api/src/db/schema/bets.ts` — **new** domain file (additive; does NOT extend `individual_bets`).
- `apps/tournament-api/src/routes/bets.ts` + `src/routes/admin/bets.ts` — player + organizer routes.
- `apps/tournament-web/` — new player betting + Action board routes; **admin/bets console**.

### Dependencies
- **One new dependency only: `fast-check`** (dev-only) — for the NFR-C4 ledger-invariant property test (zero-sum pairs net to zero; Snake holder-out = sum of receipts). Everything else is inherited.
- **`PORTS.md` provenance entry required** for the conditional putts-entry port from Wolf Cup's "least putts" flow (Port Provenance Protocol).

### Single Non-Additive Integration Point (handle with care)
Everything in this feature is net-new files **except** the conditional **putts entry**, which **edits the existing score-entry surface** — the most sensitive shared UI in the app. It gets careful handling + a dedicated test, not a casual edit.

### Initialization
None. The **first implementation story is NOT a scaffold** — it is the **bet schema + golden-fixture authoring** (fixtures are the first build artifact per the context analysis).

## Core Architectural Decisions

_No web version-search: all stack versions are locked to the running Tournament app (Step 3). Generic categories (DB, auth stack, API stack, frontend state, infra) are inherited and not re-decided. Refinements 1–6 from the 2026-06-20 party-mode review are integrated._

### Decision Priority Analysis
- **Critical (block implementation):** bet schema (D1); settlement = pure recompute-on-read (D2); net-by-segment contract + reversible finalize-snapshot (D3); Snake as a distinct N-party type (D4); putts data lifecycle (D5).
- **Important:** authority + placement cutoff (D7); route surface + audit (D8/D9).
- **Deferred (PRD Growth):** over/under, multi-round, verified-accept handshake, event ledger, in-app toast/banner surfaces, FR48 arbitrary-hole-set generality.
- **Inherited (NOT re-decided):** SQLite/Drizzle, Hono, recompute-on-read no-cache, services-layer split, join-code/SSO identity, `money_visibility`, polling cadence, docker/CI/deploy, React state model.

### Data Architecture
- **D1 — New `bets` schema (additive; does not touch `individual_bets`):**
  - `bets`: `id, event_id, round_id, hole_scope, parent_bet_id?, bet_type (h2h|per_hole_match|putting), basis (net|gross|putts), stake_cents, state, created_by_player_id, voided_at/by, resolution_json?, finalized_outcome_json?` + ecosystem cols.
  - **`state` (enum) is the single source of truth** — `live | provisional | settled | push | void | unsettleable | finalized`; transitions in code; `resolution_json` / `finalized_outcome_json` / `voided_at` are **payload validated against `state`**, never an independent truth.
  - **`hole_scope` = 4-value enum** `front | back | total | full18` (v1; arbitrary hole sets per FR48 deferred).
  - `bet_sides`: `bet_id, side (A|B), stakeholder_player_id, subject_player_id` — encodes **subjects ≠ stakeholders** (FR8/FR50); two rows per 2-party bet.
  - **Segmented (Nassau / putting front-back-total):** a **parent + 3 child bets** via `parent_bet_id`; each child its own `hole_scope`, settling independently; **the parent is a non-settling container** (carries no outcome — children only); create/edit/void act on the parent (FR6/FR15).
  - **Snake** is **not** in `bets`/`bet_sides` (N-party) — separate tables (D4).
- **D2 — Settlement = pure engine, recompute-on-read.** `engine/bets/` pure fns; `services/bets-query.ts` loads scores + net + bet defs and computes outcomes on every read. **No stored outcomes** while live (mirrors `money.ts`); a score correction re-settles for free (FR22/NFR-C1).
- **D3 — Net contract + reversible finalize-snapshot (MVP):**
  - Expose **`netForSegment(roundId, playerId, holeRange)`** from the leaderboard/money service, reusing the existing `allocateNetThroughHole`/`netThroughHole` — settlement **never re-derives net** (FR23).
  - **Live phase:** outcomes recompute on read. **Finalize:** each bet's outcome freezes into `finalized_outcome_json` (durable) → later net-calc changes can't move settled money (resolves codex M5/H18). **Finalize is REVERSIBLE:** organizer **un-finalize → correct → re-finalize**, audited — so a legitimate late correction can still flow.
- **D6 — Validation/migrations:** Zod schemas shared with the API (inherited); one Drizzle migration at Tournament's next ordinal.

### Snake (D4 — its own settlement type)
- Tables: **`snake_games`** (`event_round_id, group_id, starting_cents, increment_cents`), **`snake_participants`** (`snake_game_id, player_id`), **`snake_holder_overrides`** (`snake_game_id, hole_number, player_id`) — the scorer-set "last-in" tiebreak, written only on a same-hole **putt-count tie** (FR29).
- Engine computes holder + value from `hole_scores.putts` in **play sequence**, **worst-putt-takes-it** then override-tiebreak; **completeness gate**. **No qualifying event → no payout.**
- **State semantics (sharpened):** `provisional` = round in progress, missing putts/scores is normal; `unsettleable` = round complete but data missing or net untrustworthy → organizer resolves.
- **Settle-up expansion:** Snake settles to **holder → each-other-participant** directional debts (FR40), folded into the same pairwise ledger.

### Putts Data Lifecycle (D5)
- Reuse **`hole_scores.putts`** (verified exists, nullable). **Conditional entry** on the existing score-entry surface: putts asked **only when a putting game (Snake or putts bet) is active for that group/round, only for its participants** (FR28). Port Wolf Cup's "least putts" UI pattern (PORTS.md entry). `null` putts = not-entered → feeds the completeness gate.

### Authentication & Security
- **D7 — Authority + cutoff.** Inherit join-code/SSO identity. **Player create** gated to event participants (`requireSession` device-or-Google bridge); **admin routes** gated to organizer. **Placement cutoff enforced server-side** — reject create once any in-scope score/putt exists, except audited organizer override (FR49). **`money_visibility` enforced in the query service on every read path** (FR34/NFR-S1); a subject-only player isn't shown the stake (FR53).

### API & Communication Patterns
- **D8 — Routes:** player `GET/POST /api/events/:eventId/bets`; organizer `POST/PATCH/DELETE /api/admin/events/:eventId/bets` + Snake config; read models `GET …/action` (board) and `…/settle-up`. Inherited error shape. **Every mutation in `db.transaction`** with an **audit row + `activity` emit in the same tx** (FR45/NFR-S3). Activity events (`bet.created/settled/voided`) feed future in-app surfaces — **no push** (FD-5).
- **D9 — Audit payload:** `actor_player_id, role, action, bet_id, before_json, after_json, reason?, request_id, created_at`.

### Frontend Architecture
- Inherit (useState + TanStack Query + URL params; polling at leaderboard cadence). New routes: **player bet-create + Action board**, **admin bets console**. **Putts entry integrated into the existing score-entry route** — the single careful integration point. Mobile-first create; ≥44px targets.

### Infrastructure & Deployment
- **Fully inherited** — same docker service, Traefik route, CI suites, `deploy.sh`. Adds one Drizzle migration + `fast-check` (devDep). No new infra.

### Required Tests (correctness gate)
- **Golden hand-calc fixtures FIRST**, hand-approved, per bet type incl. every Snake edge (NFR-C1/C3).
- **Net reconciliation:** `netForSegment(front)` == sum of per-hole net (holes 1–9) == hand-calc — proves the exposure never drifts from the leaderboard.
- **Finalize freeze/reflow:** post-finalize a net-calc change does NOT move a frozen outcome; un-finalize→re-finalize DOES reflow a correction.
- **Ledger invariant (property test, `fast-check`):** zero-sum pairs net to zero; Snake holder-out == sum of others' receipts (NFR-C4).

### Decision Impact Analysis
- **Implementation sequence:** (1) **golden fixtures + `bets` schema** → (2) **settlement engine + `netForSegment` exposure** → (3) **admin console + routes** (the floor) → (4) **player self-serve + Action board** → (5) **putts + Snake + score-entry integration** → (6) **settle-up + reversible finalize-snapshot**.
- **Cross-component dependencies:** `netForSegment` underpins all net/segment settlement; `state` enum drives every read model; `finalized_outcome_json` is the freeze boundary; `snake_holder_overrides` is the only new scorer input; the `activity` spine feeds future surfaces.

## Implementation Patterns & Consistency Rules

**Inheritance:** all generic conventions (snake_case tables / camelCase Drizzle exports / `{table_singular}_id` FKs / kebab-case files / named exports / `dot.separated` activity types / `{ error, code?, requestId, fields? }` shape / `db.transaction` on every mutation / services-layer query-vs-tx-helper split) are **inherited from `tournament/architecture.md` verbatim.** Below are only the rules unique to betting.

### Settlement Engine (highest-divergence-risk area)
- **P1 — Engine purity:** `engine/bets/` functions are **pure** — inputs passed explicitly (scores, net, bet defs, putts, hole sequence); **no `db`, no `Date.now()`/`Math.random()`**.
- **P2 — NEVER re-derive net.** Settlement obtains net **only** from `netForSegment()` / the leaderboard net service. Re-implementing `getHandicapStrokes` or `Math.round(HI)` is a **hard violation** (recurring money-bug family). Gross/putts read from `hole_scores`; net is never local math.
- **P3 — No stored outcomes while live.** Outcomes recompute on read; the only durable outcome is `finalized_outcome_json` after explicit finalize.
- **P4 — `state` is truth.** Decide settled/void/etc. from `bets.state`; never infer from a json/timestamp column's presence.
- **P14 — Engine ownership (closes codex H11):** `engine/bets/` owns **all** new-schema settlement math, **including per-hole match**. The shipped `individual_bets` engine stays bound to its existing path and is **never cross-wired** into the new `bets` schema. One formula per concept; fixtures live with the new engine.
- **P16 — Ordering is an explicit input:** Snake/segment **hole play-sequence** (front/back/shotgun) is passed into the engine, never inferred from hole numbers — preserves determinism for shotgun starts.

### Settlement Output (canonical IR)
- **P15 — `SettlementEdge` IR:** every settlement source — h2h, per-hole match, putting, each Nassau/putting segment, and the Snake expander — emits `{ fromPlayerId, toPlayerId, cents, sourceBetId, sourceType }`. The settle-up service nets a **flat, bet-type-blind edge list** (FR37 pairwise + FR40 Snake expansion both reduce to this). The NFR-C4 invariant = "sum edges per ordered pair." Snake is **never** special-cased downstream of its expander.

### Money & Types
- **P5 — Integer cents only.** Amount columns end `_cents`; all math in integer cents; format to dollars only at the UI boundary.
- **P6 — Additive types, fail-loud.** `bet_type`/`basis` are open enums (FR20), but an **unknown** value is **rejected at creation** and, if ever hit at settlement, returns a typed `unsupported` outcome — **never a silent push or $0**.

### Access & Integrity
- **P8 — Visibility at one chokepoint.** `money_visibility` enforced **inside `bets-query.ts`** (single read service), not routes/components. Every money read path (board, settle-up, detail, export) goes through it. A subject-only player is never shown a stake.
- **P9 — Writes only via helpers.** Audit + activity emission only through the inherited `writeAudit(tx, …)` / `emitActivity(tx, …)` helpers, in the same `tx` — never inline inserts.
- **P10 — Placement cutoff + authority server-side** (in `bets-write.ts`); client may hint, server is the gate.

### Naming (feature-specific)
- **P11 — Tables:** `bets`, `bet_sides`, `snake_games`, `snake_participants`, `snake_holder_overrides`. **Activity events:** `bet.created`, `bet.settled`, `bet.voided`, `bet.finalized`. **Routes:** player `/api/events/:eventId/bets*`; organizer `/api/admin/events/:eventId/bets*`; action verbs as POST (`…/bets/:id/void`, `…/finalize`).

### Putts Integration (shared-surface rule)
- **P12 — Single write path.** Putts written through the **existing score-commit path** (extended), never a parallel writer; entry gated by "is this player in an active putting game for this round" (FR28).

### Tests
- **P13 — Fixtures + discipline:** `engine/bets/__fixtures__/*.json`, one per bet type + each Snake edge, authored + Josh-approved **before** engine code. Unit `*.test.ts` co-located; HTTP `*.integration.test.ts`. Ledger-invariant property test uses **`fast-check`**.

### Enforcement
All agents MUST: obtain net via `netForSegment` (P2); keep the engine pure (P1/P16); read `state` for status (P4); route every settlement source through the `SettlementEdge` IR (P15); keep `engine/bets/` the sole owner of new-schema math (P14); enforce visibility in the query service (P8); write money as integer cents (P5); emit audit/activity via tx helpers (P9). Violations of **P2, P8, P14, P15** are correctness/privacy bugs, not style nits.

## Project Structure & Boundaries

Brownfield delta — new/modified files within the existing Tournament tree. **Verified 2026-06-20:** `events.$eventId.{settle-up,money,my-money,bets}.tsx` and `services/money-detail.ts` already exist → the feature **extends** them, it does not spawn parallel surfaces.

### New / Modified Files

```
apps/tournament-api/
├── src/
│   ├── db/
│   │   ├── schema/bets.ts               ★NEW  bets, bet_sides, snake_games,
│   │   │                                       snake_participants, snake_holder_overrides (D1/D4)
│   │   └── migrations/00NN_bets.sql     ★NEW  (Tournament's next ordinal)
│   ├── engine/bets/                     ★NEW  PURE settlement (no db/Date/random — P1)
│   │   ├── index.ts                            dispatch by bet_type
│   │   ├── h2h.ts (FR11) · per-hole-match.ts (FR12, owns formula P14)
│   │   ├── putting.ts (FR17) · segment.ts (FR15/16) · snake.ts (FR27–32/54)
│   │   ├── settlement-edge.ts                  the SettlementEdge IR + netter (P15)
│   │   ├── types.ts
│   │   └── __fixtures__/*.json                  golden hand-calc fixtures (P13 — FIRST artifact, UNIT)
│   ├── services/
│   │   ├── bets-query.ts                ★NEW  computeActionBoard / computeSettleUp / computeBetStanding
│   │   │                                       + activePuttingGames(roundId) [single source] ;
│   │   │                                       money_visibility chokepoint (D2/P8)
│   │   ├── bets-write.ts                ★NEW  create/edit/void/finalize/unfinalize + snake config;
│   │   │                                       authority + placement cutoff (D7/P10); tx helper
│   │   ├── putting-entry.ts             ★NEW  putts-entry logic; scores.ts DELEGATES here (min blast radius)
│   │   ├── leaderboard.ts               ~MOD  export netForSegment() (reuses allocateNetThroughHole) (D3/P2)
│   │   └── money-detail.ts              ~MOD  fold bet SettlementEdges into existing settle-up
│   ├── routes/
│   │   ├── bets.ts                      ★NEW  player GET/POST /api/events/:eventId/bets* (D8)
│   │   ├── admin/bets.ts                ★NEW  organizer POST/PATCH/DELETE + snake config + finalize (D8)
│   │   ├── scores.ts                    ~MOD  thin delegation to putting-entry.ts (D5/P12)
│   │   └── bets.integration.test.ts     ★NEW  HTTP + net-reconciliation + finalize freeze/reflow (Quinn)
│   ├── PORTS.md                         ~MOD  putts "least putts" port provenance entry
│   └── *.test.ts                        ★NEW  engine unit + fast-check ledger-invariant property test (P13)
└── package.json                         ~MOD  + fast-check (devDep)

apps/tournament-web/src/routes/
├── events.$eventId.bets.tsx             ~MOD  player create flow + consolidated Action board (FR1, FR33–36)
├── events.$eventId.settle-up.tsx        ~MOD  EXISTS — integrate bet SettlementEdges (FR37–40); no parallel page
├── events.$eventId.money.tsx            ~MOD  EXISTS — bet edges flow via money-detail.ts
├── events.$eventId.my-money.tsx         ~MOD  EXISTS — viewer P&L includes bet edges (T13-5)
├── admin.events.$eventId.bets.tsx       ★NEW  admin bets console (FR3–FR5)
└── <score-entry route>                  ~MOD  putts input when a putting game is active (P12)
```

### Architectural Boundaries
- **Engine (hard):** `engine/bets/` pure — inputs in, `SettlementEdge[]` + per-bet outcome out; reaches the DB only via `bets-query.ts`.
- **Net:** settlement reads net only via `netForSegment()` (P2); `leaderboard.ts` owns net.
- **Service:** `bets-query.ts` reads/computes (never writes) + is the `money_visibility` chokepoint + owns `activePuttingGames`; `bets-write.ts` writes only via `tx`.
- **Putts shared surface:** `scores.ts` delegates to `putting-entry.ts`; "is putts needed" determined once via `bets-query.activePuttingGames`.
- **Settle-up:** bet edges feed the **existing** `money-detail.ts` + `settle-up.tsx`/`my-money.tsx` — one money surface, extended.
- **Data:** new `bets`/`snake_*` tables additive; `individual_bets` untouched (P14); `hole_scores.putts` reused.

### Requirements → Structure Mapping
- Create/manage (FR1–7, FR48–50) → `routes/bets.ts` + `admin/bets.ts` → `bets-write.ts` → `schema/bets.ts`.
- Types/basis/segments (FR8–20) → `engine/bets/*` + `bet_sides`.
- Settlement (FR21–26) → `engine/bets/` ← `netForSegment` ← `leaderboard.ts`.
- Snake (FR27–32, FR54) → `engine/bets/snake.ts` + `snake_*` + `putting-entry.ts`.
- Board/settle-up (FR33–41) → `bets-query.ts` → existing web money/settle-up surfaces.
- Identity/audit (FR42–47) → inherited identity middleware + `writeAudit`/`emitActivity`.

### Data Flow
`create (player/admin) → bets-write [authority + cutoff + audit, in tx]` → `bets-query.compute* [scores + netForSegment + bet defs → engine/bets → SettlementEdge[] → net pairwise, money_visibility-filtered]` → existing web money/settle-up + bets/Action board (polled). `score/putt correction → re-settles on next read`. `round finalize → freezes finalized_outcome_json (reversible un-finalize→correct→re-finalize)`.

## Architecture Validation Results

### Coherence Validation ✅
- **Decision compatibility:** all decisions inherit a single running stack (versions compatible by construction); no contradictions. Recompute-on-read (D2) ↔ finalize-snapshot (D3) reconciled via the `state` enum + reversible finalize; the 2-stakeholder model and Snake's N-party model coexist via the `SettlementEdge` IR (P15).
- **Pattern consistency:** P1–P16 directly support the decisions — P2 enforces D3 net reuse, P14 enforces "don't touch `individual_bets`," P15 enforces D4 pairwise expansion, P8 enforces `money_visibility`.
- **Structure alignment:** the tree realizes every boundary — pure `engine/bets/`, the `bets-query` visibility chokepoint, the `putting-entry` delegation, integration into the *existing* settle-up/money surfaces.

### Requirements Coverage Validation ✅
- **Functional (FR1–FR54): fully covered.** Create/manage → `bets-write`+routes; model/types/basis → `bet_sides`+`engine/bets/*`; settlement → pure engine ← `netForSegment`; Snake → `snake.ts`+`snake_*`+`putting-entry`; board/settle-up → `bets-query`+`SettlementEdge`→existing money surfaces; identity/audit → inherited middleware+helpers; hardening FR48–54 → schema scope, placement cutoff (D7), side↔subject (`bet_sides`), unsettleable+resolve (`state`+`resolution_json`), Snake N-party (D4).
- **Non-functional: covered.** Correctness (C1–C5) → pure engine + golden fixtures + net-reconciliation + finalize freeze/reflow + `fast-check` invariant. Security (S1–S4) → visibility chokepoint, auth, audit-in-tx, no funds. Reliability (R1–R2) → online-only placing, single-tx atomicity. Perf/Usability/Deployability → inherited.

### Implementation Readiness Validation ✅
- **Decisions** documented with rationale; versions locked (inherited). **Patterns** P1–P16 cover the divergence-risk areas. **Structure** is concrete (real filenames, ★NEW/~MOD, FR-mapped).
- **Fixture clarification:** engine golden fixtures take **net-per-hole as a given INPUT** (hand-calc), independent of `netForSegment`'s code (consistent with P1); the net service is validated by the separate **net-reconciliation** test. Fixtures do not block on the net service existing.

### Gap Analysis
- **Critical gaps: NONE.**
- **Important (specify in the epic/stories — not architecture gaps):**
  1. **Subject-in-round validation rule** (FR51) — `bets-write` must reject subjects not on the scoped round's roster; pin the exact check + error.
  2. **Finalize/un-finalize trigger on a late correction** — who un-finalizes and when (organizer vs auto) is an operational rule for the settle-up story.
  3. **RESOLVED → LOW risk (verified 2026-06-20):** `money-detail.ts` already exposes **antisymmetric pairwise cents** (`FoursomeResult`) + a **per-game/per-round/per-hole** `MyMoneyResponse`; bet `SettlementEdge`s integrate as additional game-sources — no money-view rework.
- **Known minor integration:** bet activity types (`bet.created/settled/voided/finalized`) extend the existing **Zod discriminated union** in the activity spine (registered now; consumer is Growth).
- **Nice-to-have:** in-app Action toasts/banners (events emit now, consumer is Growth).

### Architecture Completeness Checklist
- ✅ Requirements analysis · ✅ Architectural decisions · ✅ Implementation patterns · ✅ Project structure — all complete.

### Architecture Readiness Assessment
- **Overall: READY FOR IMPLEMENTATION.**
- **Confidence: HIGH** — coherent, full FR/NFR coverage, conforms to the shipped stack, and the three biggest unknowns (`hole_scores.putts`, per-hole net, money-view integration) were all **verified favorable** this session.
- **Key strengths:** reuses proven infra (net, identity, money services, activity spine); the `SettlementEdge` IR + pure engine + golden-fixture gate make correctness testable; admin-first build order de-risks the deadline.
- **Future enhancement:** over/under, multi-round, verified handshake, event ledger, in-app surfaces (all PRD Growth).

### Implementation Handoff
- **First priority:** author + hand-approve **golden hand-calc fixtures** (the hard gate), then the `bets` schema — *not* a scaffold.
- **AI agent guidelines:** obey P1–P16 (esp. P2 net-reuse, P8 visibility, P14 engine ownership, P15 IR); never touch `individual_bets`; Tournament paths only.
