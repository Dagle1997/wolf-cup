# HANDOFF — Tournament "The Action" Betting

**Last updated:** 2026-06-20 · **Author:** Josh (+ Claude facilitation)
**Purpose:** Resume cleanly in a fresh context. Everything below is on disk + committed.

---

## TL;DR — where we are

Planning is COMPLETE (PRD → readiness → architecture → epics → 16 stories, all committed). **Stories 1.1, 1.2, and 1.3 are FULLY IMPLEMENTED, COMMITTED + PUSHED** to `origin/feat/tournament-betting-story-1.1` (`102e5db`, `5d7c3ed`, `443614a` — HEAD == origin). **Story 1.4 (organizer edit & void with ledger consistency) is FULLY IMPLEMENTED and all green, but UNCOMMITTED** in the working tree. API full suite **1128 passed / 2 skipped**, web **358 passed**, `pnpm -r typecheck` + lint clean both packages. **Push/prod-deploy still gated on Josh.**

**Resume point:** commit (+push) 1.4, then **Story 1.5 (The Action board)** — see epics-betting-action.md. Epic 1 then finishes with 1.6 (settlement robustness — corrections, completeness, fail-closed).

### 1.4 — built 2026-06-20 (uncommitted)
- **No new engine math** (no golden-fixture gate — those were for the settlement-math stories 1.1–1.3). 1.4 is lifecycle (durable `state`) + ledger-consistency, verified by integration tests. Recompute-on-read means edit just re-validates + replaces config/sides; the outcome re-derives on the next read (FR4).
- **POLICY (ratified with Josh, supersedes the written FR49 override AC):** the organizer may **change or correct any bet parameter at ANY time** — including after scoring has started. The safety net is (a) every edit writes a **before/after audit row**, and (b) the web UI requires an **explicit warning + confirmation**. So the placement cutoff does NOT gate *edits*; it still gates *new bet creation* (FR49, with an `override` escape on create only). **Stakes are WHOLE DOLLARS ONLY** (no cents — error-proofing the most-missed field; stored/settled in cents as before).
- **New activity/audit type `action_bet.edited`** registered in `engine/types/activity-events.ts` (interface + union + array + zod + map) and `lib/audit-log.ts` (`ACTION_BET_EDITED`). `action_bet.voided` was already registered (1.1b scaffolding).
- **`services/bets-write.ts`** — extracted shared `validateBetParams(tx, eventId, input, {allowScoresExist})` (create + edit so they can't disagree); it now also rejects a non-whole-dollar stake (`non_whole_dollar_stake` 400). Added:
  - `editActionBet(tx, …)` — full-replace of config + both sides; **only a `live` bet is editable** (terminal → 409 `cannot_edit_terminal`); calls `validateBetParams` with `allowScoresExist:true` (admin corrects anytime); writes a **before/after** audit row + `action_bet.edited` activity in one tx. **No `override` param** (edits are always allowed).
  - `voidActionBet(tx, …)` — sets `state='void'` + `voided_at/by`; only a `live` bet (terminal → 409 `cannot_void_terminal`); audit (`action_bet.voided`, previousState + sides) + activity in one tx. `settleActionBet` already short-circuits `void` → no edges, so a voided bet drops out of settle-up and the ledger stays zero-sum (FR5/FR47/NFR-C4) — verified by test.
  - `createActionBet(tx, …)` keeps `override?:boolean` (FR49 escape for placing a *new* bet after scores; recorded in the audit row).
  - `BetWriteError.status` widened to `400 | 404 | 409 | 422`.
- **Route** `routes/admin-event-bets.ts` — `PATCH /events/:eventId/bets/:betId` (edit, bare params, no override) + `POST /events/:eventId/bets/:betId/void` (void). Added `/events/:eventId/bets/*` middleware so sub-paths get `requireSession`+`requireOrganizer`. Create parses `createBodySchema` (params + optional `override`); `errorLabelFor(status)` maps 404→`not_found`, 409→`conflict`.
- **Web** `apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx` — whole-dollar stake input (step 1, integer-only validation); per-row **Edit** + **Void** in an "Actions" column. Edit loads the bet into the existing form (edit mode) → "Save changes" → **warning + "Confirm change"** two-step (recompute/audit warning). Void is the existing Void → Confirm void / Cancel two-step. Voided/finalized/unsettleable rows show no actions. Create/edit error alerts incl. `non_whole_dollar_stake`.
- **Tests:** `admin-event-bets.integration.test.ts` (now 19): edit recomputes settle-up (no override) + before/after audit + activity; **admin may correct after scores (no override) audited**; **whole-dollar rejected on create AND edit**; void drops out + zero-sum + audit preserved; terminal guards (re-void/edit-voided → 409); 404 unknown bet; edit re-validates (same-stakeholder → 400); 403 non-organizer; create-override-after-scores (audited). Web `admin.events.$eventId.bets.test.tsx` (4): two-step void posts once + flips to Void; Cancel no-post; Edit loads form + confirmed change PATCHes whole-dollar cents + exits edit mode; fractional stake disables Save.

### 1.3 — built 2026-06-20 (uncommitted)
- **Hard gate met:** golden fixture `engine/bets/__fixtures__/h2h-gross-a-clean-win.json` hand-authored + Josh-approved BEFORE enabling gross creation.
- **No engine change** — `settleH2h` is basis-agnostic (sums given values), so gross is identical math on gross numbers; the fixture documents the gross winner-take-stake expectation and is added to `h2h.test.ts` (now 6).
- **Creation** (`bets-write.ts`): `CREATABLE_BASES_BY_TYPE.h2h` flipped to `['net','gross']` (FR13). Putts still rejected.
- **Gross path** already lived in `bets-query.ts` (basis-aware net source from 1.2) — 1.3 just enables h2h to use it.
- **Web** (`admin.events.$eventId.bets.tsx`): the Net/Gross basis selector now shows for BOTH types (h2h no longer forced to net).
- **Tests:** `admin-event-bets.integration.test.ts` (now 10) adds an h2h-gross end-to-end case that proves GROSS (not net) is used — Ben is given an 18 HI so he wins on NET but loses on GROSS; the gross bet resolves to Rick. Net-basis behavior unchanged (regression-safe; the 1.1 net fixtures + tests still pass).

### 1.2 — built 2026-06-20 (uncommitted)
- **Hard gate met:** 3 hand-APPROVED golden fixtures (`engine/bets/__fixtures__/per-hole-match-{a-net-clean-win,b-net-push,c-gross-openbook}.json`) authored + Josh-approved BEFORE engine code.
- **`engine/bets/per-hole-match.ts`** `settlePerHoleMatch` — lower per-hole value wins the hole, tie pushes, money = **(holesWonA − holesWonB) × stake** (margin × stake, NOT winner-take-stake). Basis-agnostic. Reuses SettlementOutcome (no spine change): `marginNet` = hole margin, `subjectNetTotal` = holes won. Test `per-hole-match.test.ts` (6: 3 fixtures + determinism + provisional + putts-unsupported).
- **Dispatch** (`index.ts`): `per_hole_match` → `settlePerHoleMatch`, with a **putts → `unsupported`** guard (FR12 fail-loud, P6 defense-in-depth).
- **Creation** (`bets-write.ts`): replaced the flat CREATABLE lists with **`CREATABLE_BASES_BY_TYPE`** = `{ h2h:['net'], per_hole_match:['net','gross'] }` (per-type basis policy; putts rejected as `unsupported_basis` 400). Josh's call: per_hole_match ships net+gross creatable now.
- **Basis-aware net source** (`bets-query.ts` `settleActionBet`): picks `p.gross` vs `p.net` from netForSegment per `bet.basis`. **KNOWN LIMITATION:** netForSegment fails closed without an HI even for a gross bet (early return) → a gross bet for a player with no HI is provisional. Every event player has an HI in practice; documented followup if it ever bites.
- **Web** (`admin.events.$eventId.bets.tsx`): bet-type selector (Head-to-head / Match play) + a basis selector shown for per_hole_match (Net/Gross); h2h forces net. List row shows the type.
- **Tests:** `admin-event-bets.integration.test.ts` extended to 9 (added per_hole_match net end-to-end settle-into-settle-up + putts-rejected-at-creation).

### 1.1b — built 2026-06-20 (uncommitted)
- **Activity/audit:** `action_bet.created/.settled/.voided/.finalized` registered in `engine/types/activity-events.ts` (union + Zod + map) and `lib/audit-log.ts`. **Decision (ratified w/ Josh):** distinct `action_bet.*` types, NOT the legacy `bet.created` — that name is taken by individual_bets (`routes/bets.ts`) with an incompatible payload (P14, never cross-wire). `NET_CALC_VERSION = 1` added to `leaderboard.ts`.
- **`services/bets-write.ts`** — `createActionBet(tx, …)` + `actionBetCreateSchema`. Tx-only; FR50 (distinct stakeholders), distinct subjects, FR9/FR51 (all 4 roster members), FR49 placement cutoff, betType/basis CREATABLE gate (h2h+net only in 1.1). Writes bet + 2 sides + audit + activity in one tx. **SPEC-WORDING CORRECTION:** the AC's "subjects distinct from stakeholders (FR8)" is imprecise — fixtures (a) prove stakeholder==subject is the *normal* self-backing case; FR8 only means they *may* differ (open book, fixture c). The write path does NOT force subject≠stakeholder.
- **`services/bets-query.ts`** — recompute-on-read settle (`settleActionBet`), `computeActionBetEdgesForEvent` (the **P8 visibility chokepoint** feeding money), `listBetsForEvent`/`getActionBetView` for the route, net-calc-version mismatch flag (dormant until banking).
- **`engine/bets/scope.ts`** — pure `scopedHolesForScope(scope, holesToPlay)` shared by write (cutoff) + query (net) so they can't disagree.
- **Route** `routes/admin-event-bets.ts` (POST/GET `/api/admin/events/:eventId/bets`, organizer-gated) wired in `app.ts`. NOTE: the handoff's `routes/admin/*` path was wrong — routes are flat files; matched `admin-event-handicaps.ts` conventions.
- **Settle-up integration:** `money.ts:computeMoneyMatrix` now folds bet edges into the combined matrix + a new `actionLedger` split; `money-detail.ts:computeMyMoney` adds a new `'action'` game kind (whole stake on the last scoped hole to preserve the loss-less per-hole-sums-to-round-net invariant). **NOTE:** the pairwise matrix lives in `money.ts`, not `money-detail.ts` as the old handoff said — both were updated.
- **Web:** `apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx` (create h2h-net + open-book toggle + bet list w/ state) + "The Action" link on the event admin index. Roster/rounds sourced from the existing pairings endpoint (no GHIN call).
- **Tests:** `routes/admin-event-bets.integration.test.ts` (7 tests: create/list, 403, FR50, FR49, settles-into-settle-up end-to-end, push contributes nothing, open-book non-playing backer collects + appears in settle-up). All prior suites still green.

---

## Git state

- **Branch: `feat/tournament-betting-story-1.1`** (NOT master — branched per harness rule; Josh's flow is normally master-based, so a `git merge --ff` to master is fine). **HEAD == `origin/feat/tournament-betting-story-1.1` through Story 1.3 (`443614a`); Story 1.4 is uncommitted in the working tree** — push of 1.4 is gated on Josh.
- Pushed commits on the branch (newest last): `42db435` (planning artifacts) → `dfdb739` (1.1 foundation) → `7c6c9fa` (1.1 net contract) → `102e5db` (1.1b) → `5d7c3ed` (1.2) → `443614a` (1.3).
- Working tree: Story 1.4 changes (bets-write/bets-query untouched, route, schema types, web page + tests) + this handoff. **Migration `0018` is generated but NOT applied to prod** (deploy-gated; 1.4 added NO migration — `voided_at/by` already existed; app has no users yet so DB risk is nil — Josh confirmed).
- **Three untracked files are NOT part of this work — do not commit them:** `_bmad-output/scouting-group-aware-money-proposal.md`, `apps/tournament-web/e2e/screenshots.spec.ts`, `reference/Wolf-Cup Updates 6-1-2026.pdf`.

## Verify commands (run from `apps/tournament-api`)

- `pnpm typecheck` → clean.
- `pnpm vitest run src/engine/bets src/services/leaderboard.test.ts` → the new betting + net tests.
- `pnpm vitest run` → full suite, currently **1092 passed / 2 pre-existing skips** (NFR-D1 green).

---

## DONE (built + committed)

1. **Golden hand-calc fixtures — hand-APPROVED by Josh (the hard gate).** `apps/tournament-api/src/engine/bets/__fixtures__/h2h-net-{a-clean-win,b-push,c-nonplaying-backer}.json`. They are the source of truth; the engine matches them.
2. **Schema:** `apps/tournament-api/src/db/schema/action-bets.ts` — tables `bets` + `bet_sides` (registered in `schema/index.ts`). Migration `src/db/migrations/0018_sharp_warstar.sql` (purely additive — 2 CREATE TABLEs, touches no existing table).
3. **Pure engine:** `apps/tournament-api/src/engine/bets/` — `types.ts`, `settlement-edge.ts` (`netPairwise` IR netter), `h2h.ts` (`settleH2h`), `index.ts` (`settleBet` dispatch + fail-loud). Tests: `h2h.test.ts` (fixtures), `settlement-edge.test.ts` (`fast-check` invariant). `fast-check` added as devDep.
4. **Net contract:** `netForSegment(roundId, playerId, holeNumbers[])` in `services/leaderboard.ts` + reconciliation tests in `services/leaderboard.test.ts`.

## LOCKED decisions (do not re-litigate)

- **h2h = WINNER-TAKE-STAKE:** loser's stakeholder pays winner's the full stake ONCE (not per-stroke, not margin×stake).
- **`SettlementEdge {fromPlayerId,toPlayerId,cents,sourceBetId,sourceType}`** — `from` PAYS `to` (debtor→creditor; matches the "Josh→Kyle $50" settle-up convention). Edges are between **stakeholders, never subjects** (the open-book "Kyle" case).
- **Net is a GIVEN input** to the engine (P2). `netForSegment` produces it via the **canonical `getHandicapStrokes`** per-hole allocation (NOT the leaderboard's proportional `allocateNetThroughHole` — that can't produce per-hole net; the architecture's wording was imprecise, ratified with Josh). Over a full 18 it reconciles exactly with `leaderboard.netThroughHole`; front+back sum to total. Locked-HI aware; fail-closed with a `trust` reason (`no_handicap`/`no_course_data`/`incomplete`).
- **Filename `action-bets.ts`** (not `bets.ts` — that's taken by `individual_bets`, which must NOT be extended, P14). Table names `bets`/`bet_sides` are bare/free.
- **Bet binds to `event_round_id`** (→ `event_rounds.id`); scores resolve via the scoring `rounds` row that links to it.
- **CHECK policy:** closed enums (`state`, `hole_scope`, `side`) get DB CHECK; open enums (`bet_type`, `basis`) are Zod-validated only (FR20 additive — no migration for a new type).
- **`state` enum** `live|provisional|settled|push|void|unsettleable|finalized`, default `live`; durable lifecycle only — `settled/push/provisional` are recompute-on-read (P3/P4).
- Later-story columns (`parent_bet_id`, `voided_at/by`, `resolution_json`, `finalized_outcome_json`, `net_calc_version`) are in the `bets` table now (nullable) to avoid live-chain rebuilds.
- **App has NO users yet → touching live code/DB is safe** (Josh).

## TO RESUME — remaining Story 1.1 ("1.1b" wiring), in order

1. **`bets-write.ts`** (transaction helper, writes only via a passed `tx`): create a bet — insert `bets` + two `bet_sides` rows + an audit row (`writeAudit`) + an activity row (`emitActivity`) **in one `tx`**. Enforce authority (organizer for admin route) + **placement cutoff** (reject create once an in-scope score/putt exists, FR49) + FR50 (same player can't be both stakeholders) + FR51 (subjects are roster players on the scoped round). **Register the new activity types** (`bet.created/settled/voided/finalized`) in the existing activity Zod discriminated union (see `db/schema/activity.ts` + the engine activity-events type) or `emitActivity` will reject them.
2. **`bets-query.ts`** (read-only query service): load a bet + its sides; for each subject call `netForSegment` over the bet's scoped holes; build `H2hInput.netPerHoleBySubject` from the per-hole nets; run `settleBet`; return the outcome + edges. **This is the `money_visibility` chokepoint (P8)** — enforce visibility here, not in routes. Also owns `activePuttingGames(roundId)` later (Epic 3).
3. **Admin route** `POST/GET /api/admin/events/:eventId/bets` (+ wire into the Hono app). Mirror existing route conventions (`routes/admin/*`, error shape `{error,code?,requestId,fields?}`, `requireSession`+organizer gate).
4. **Settle-up integration:** fold bet `SettlementEdge`s into `services/money-detail.ts` so the EXISTING `my-money.tsx` / `money.tsx` / `settle-up.tsx` pages render them (architecture marks all three `~MOD`). Verify by test (readiness open-item #3).
5. **Minimal admin UI:** `apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx` — create an h2h-net bet + list bets with state. Mobile-aware, design-system primitives, ≥44px targets.

### Key reference points for the next instance
- **Engine entry:** `import { settleBet } from '../engine/bets/index.js'` → returns `{ state, subjectNetTotal, result, edges }`. `netPairwise(edges)` nets to pairwise debts.
- **Net contract:** `import { netForSegment } from './leaderboard.js'` → `{ perHole, total, trust }`.
- **Conventions to copy:** `db/schema/bets.ts` (individual_bets) for table/FK/CHECK style; `services/money-detail.ts` for the existing pairwise money shape; `routes/admin/*` for route+auth patterns; `db/schema/_columns.ts` `ecosystemColumns()` (`tenant_id` default 'guyan' + `context_id`); `writeAudit`/`emitActivity` tx helpers (grep for them).
- **Story spec + ACs:** `_bmad-output/planning-artifacts/tournament/epics-betting-action.md` Story 1.1.
- **Memory:** `project_tournament_action_betting_prd.md` (full session trail + decisions).

## Constraints (non-negotiable)

- **Tournament paths only** (`apps/tournament-api`, `apps/tournament-web`). Wolf Cup is read-only port reference (FD-1/FD-2).
- Conform to `architecture-betting-action.md` patterns **P1–P16** (esp. P2 net-reuse, P8 visibility chokepoint, P9 audit/activity in tx, P14 never touch individual_bets, P15 SettlementEdge IR).
- Wolf Cup + existing Tournament suites stay green; CI gates deploy. **No push / no prod deploy without Josh's explicit approval.**
