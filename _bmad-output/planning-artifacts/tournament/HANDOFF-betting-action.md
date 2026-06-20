# HANDOFF — Tournament "The Action" Betting

**Last updated:** 2026-06-20 · **Author:** Josh (+ Claude facilitation)
**Purpose:** Resume cleanly in a fresh context. Everything below is on disk + committed.

---

## TL;DR — where we are

Planning is COMPLETE (PRD → readiness → architecture → epics → 16 stories, all committed). **Story 1.1 is now FULLY IMPLEMENTED and all green** (the 1.1b server/UI wiring was built 2026-06-20 on top of the previously-committed 1.1a core). API full suite **1107 passed / 2 skipped**, web **354 passed**, `pnpm -r typecheck` clean. **Not yet committed** — the 1.1b work is uncommitted in the working tree (commit/push gated on Josh).

**Resume point:** review the 1.1b diff, commit it, then **Story 1.2 (per-hole match-play bet type)** — see epics-betting-action.md. Story 1.2 reuses the same engine/IR/route/settle-up spine; it adds a new `per_hole_match` type (golden fixtures first, per the story's hard gate) + `CREATABLE_BET_TYPES` entry in `bets-write.ts`.

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

- **Branch: `feat/tournament-betting-story-1.1`** (NOT master — branched per harness rule; Josh's flow is normally master-based, so a `git merge --ff` to master is fine. **Nothing pushed** — push is gated.)
- Commits on the branch:
  - `42db435` docs(tournament): planning artifacts (PRD/arch/readiness/epics+16 stories)
  - `dfdb739` feat(tournament): Story 1.1 foundation — schema + pure h2h-net engine + approved golden fixtures
  - `7c6c9fa` feat(tournament): Story 1.1 — netForSegment net contract + reconciliation test
- Working tree: clean except this handoff. **Migration `0018` is generated but NOT applied to prod** (deploy-gated; app has no users yet so DB risk is nil — Josh confirmed).
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
