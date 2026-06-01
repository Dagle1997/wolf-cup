---
title: 'In-App Play-Money Betting — "The Book" (PIN identity)'
slug: 'play-money-betting'
created: '2026-06-01'
status: 'draft'
stepsCompleted: [1]
note: 'DRAFT — design only, per Josh 2026-06-01 ("spec out the pin method"). Needs the adversarial-review pass (BMAD + codex) before ready-for-dev, like tech-spec-scouting-harvey-win-odds did. Teased on the marketing brochure as "In-App Betting — Coming Soon" (the $500 bankroll is an internal design number, deliberately NOT advertised on the stamp).'
tech_stack: ['TypeScript', 'Hono (apps/api)', 'Drizzle/libsql', 'bcrypt (already a dep — admin password hashing)', '@wolf-cup/engine (profitMultiple, americanToImplied, dead-heat)', 'React + TanStack Query + Tailwind (apps/web)']
files_to_modify: ['apps/api/src/db/schema.ts', 'apps/api/src/db/migrations/0029_play_money_betting.sql (new)', 'apps/api/src/middleware/player-auth.ts (new)', 'apps/api/src/routes/player-auth.ts (new)', 'apps/api/src/routes/bets.ts (new)', 'apps/api/src/lib/bet-settlement.ts (new)', 'apps/api/src/lib/top-member.ts (new — extracted from scouting retrospective)', 'apps/api/src/routes/scouting.ts (reuse the extracted top-member helper)', 'apps/api/src/routes/admin/rounds.ts (settle bets on finalize)', 'apps/api/src/index.ts (mount routers)', 'apps/web/src/components/ScoutingPanel.tsx (place-bet affordance on The Line)', 'apps/web/src/routes/bet-login.tsx (new — claim/PIN)', 'apps/web/src/routes/book.tsx (new — my bets + play-money leaderboard)', 'apps/web/src/lib/player-session.ts (new)']
code_patterns: ['mirror admin sessions: sessions table + cookie + bcrypt (apps/api/src/middleware/admin-auth.ts)', 'settlement reuses engine profitMultiple + dead-heat 1/k (packages/engine/src/odds.ts)', 'bets snapshot the posted American at placement (line re-prices on read — a placed ticket must lock its price)', 'settlement hooks the finalize endpoint after computeAndStoreHarvey (admin/rounds.ts)', 'migrations need --> statement-breakpoint between every statement']
test_patterns: ['api: in-memory libsql file::memory:?cache=shared + migrate + seed + app.request(); seed harvey_results for settlement tests', 'engine settlement helpers already unit-tested (profitMultiple, dead-heat)']
---

# Tech-Spec (DRAFT): In-App Play-Money Betting — "The Book"

**Created:** 2026-06-01

## Overview

### Problem Statement
"The Line" prices every member's odds to win the week, and players want to actually *bet* it. The blocker is identity: the app has **no per-player accounts today** — the leaderboard and scouting are fully public, and scoring runs off a per-round entry code + a designated scorer (`admin-auth.ts` is the only login, for organizers). To give each player a season bankroll and track who bet what, we need lightweight per-player identity.

### Solution
Add **play-money betting** on top of the existing odds engine, gated behind a **claim-your-player + 4-digit PIN** identity (no email, no OAuth). Each league member claims their name from the roster once, sets a PIN, and the device remembers them. Every member gets a **$500 season bankroll** of fun-credits ("wolf-bucks"). They place flat bets against the posted line for the upcoming round; bets **settle automatically when the round finalizes** (reusing the House settlement engine we already built); a **play-money leaderboard** ranks the season's sharpest bettor. **Strictly play money — no real currency.**

### Scope
**In scope:**
- **Player identity (PIN):** `player_credentials` (PIN hash, bcrypt) + `player_sessions` (mirrors admin `sessions`: id + playerId + sliding expiry, `player_session` cookie). "Claim your player" = pick an active, non-guest roster member + set a 4-digit PIN. Login = name + PIN → session cookie (long sliding TTL so the phone stays signed in). PIN attempt **lockout** (5 fails / 10 min) since 4 digits is weak.
- **Wallet:** `bet_wallets` (seasonId, playerId, balance), seeded to **`SEASON_BANKROLL = 500`** on first claim/login for the active season. One wallet per (season, player). Fresh $500 each season (no carryover).
- **Place a bet:** `POST /bets` (player-auth) — bet on a **member to win the week** at the **posted American odds snapshotted at placement** (the line re-prices on read — a placed ticket must lock the price it was taken at). Validations: round is the upcoming **scheduled** round with an **open (non-gated) line**; target is a **priced member** on that line; `stake` is an integer ≥ `MIN_STAKE` and ≤ wallet balance; stake is **escrowed** (deducted) immediately. Multiple bets allowed up to the balance.
- **Settlement:** on `POST /rounds/:id/finalize` (after `computeAndStoreHarvey`), settle every `open` bet on that round against the actual **top member** (reuse the retrospective's member-winner logic, extracted to `lib/top-member.ts`). Won = credit `stake × (1 + profitMultiple(postedAmerican))`; dead-heat splits at **`1/k`** (reuse engine convention); lost = nothing (stake already escrowed); a cancelled/ungradeable round **voids** open bets and refunds stakes. **Idempotent** (only touches `status='open'`).
- **The Book (leaderboard + my bets):** public `GET /bets/leaderboard?seasonId` (wallet balance + W–L–void record, ranked) and `GET /bets/mine` (player-auth). UI: a **"Place bet" affordance on The Line** (when signed in + line open), a wallet chip, a **"My Bets"** list, and a **play-money leaderboard** ("🏆 The Book — sharpest degenerate").

**Out of scope:**
- **Real currency** — never.
- **OAuth** — deferred. PIN now; tournament's arctic/Google OAuth (`apps/tournament-api`) is the proven "someday" upgrade path if the league outgrows PINs.
- **Parlays, multiple markets, live in-play betting, cash-out, variable odds boosts.**
- **Cross-season carryover** (each season = fresh $500).
- Betting on anything other than **win-the-week** (the existing single market).

## Context for Development

### Codebase Patterns
- **Admin sessions to mirror** (`apps/api/src/middleware/admin-auth.ts`): a `sessions` row (`id`, `adminId`, `expiresAt`) keyed by a `session` cookie, 24h **sliding** expiry, bcrypt password hashes. Player auth copies this exactly with `player_sessions` (`id`, `playerId`, `expiresAt`) + a `player_session` cookie + a longer TTL (e.g. 30 days) so phones stay logged in. New `playerAuthMiddleware` sets `c.set('playerId', …)`.
- **Roster** (`players` table): `id`, `name`, `ghinNumber`, `isActive` (0/1), `isGuest` (0/1). Claimable = `isActive=1 AND isGuest=0`. Guests are round-only and cannot bet.
- **The posted line** comes from the existing `odds` block on `GET /scouting/:roundId` (`computeOddsLine` → per-member `postedAmerican`, members-only, frozen to pre-round form). Bets reference + **snapshot** `postedAmerican`.
- **Settlement math already exists** in `packages/engine/src/odds.ts`: `profitMultiple(american)` and the dead-heat **1/k** convention (used by the House ledger's `simulateWeekHousePnl`). Reuse verbatim — do **not** reinvent payout math.
- **Top member of a finalized round** is already computed in `scouting.ts::buildRetrospective` (max `stablefordPoints + moneyPoints` over members, dead-heat → co-winner set, sub posting the high is settled around). **Extract to `lib/top-member.ts`** and reuse for both the retrospective and settlement (single source of truth).
- **Finalize hook** (`apps/api/src/routes/admin/rounds.ts`, `POST /rounds/:id/finalize`): already runs `computeAndStoreHarvey` → `recordPairings` → side games → CTP lock → email. **Add `settleBetsForRound(id)` right after `computeAndStoreHarvey` succeeds**, non-fatal-wrapped (a settlement bug must not break finalize, mirroring the existing non-fatal blocks).
- **Migrations**: drizzle/libsql, **`--> statement-breakpoint` between every statement** (silent-fail gotcha). Next file = `0029_play_money_betting.sql`.

### Files to Reference
| File | Purpose |
| ---- | ------- |
| `apps/api/src/middleware/admin-auth.ts` | Session-cookie pattern to mirror for players |
| `apps/api/src/routes/admin/auth.ts` | Login / bcrypt / change-password reference |
| `apps/api/src/db/schema.ts` | `players`, `sessions`, `seasons`, `harvey_results`; add 4 tables |
| `packages/engine/src/odds.ts` | `profitMultiple`, `americanToImplied`, dead-heat 1/k |
| `apps/api/src/routes/scouting.ts` | `buildRetrospective` top-member logic → extract; posted line source |
| `apps/api/src/routes/admin/rounds.ts` | `finalize` hook — add settlement; `computeAndStoreHarvey` |
| `apps/web/src/components/ScoutingPanel.tsx` | Add place-bet affordance on The Line + wallet chip |

### Technical Decisions
- **PIN identity, not accounts.** 4-digit PIN + bcrypt + attempt lockout. Device-remembered via a long sliding cookie. Friction = ~10s once. Spoofing is possible but it's play money in a ~16-man private league, and the public leaderboard makes shenanigans obvious. Documented limitation; OAuth is the someday upgrade.
- **Escrow at placement.** Stake is deducted from the wallet when the bet is placed (not at settlement), so a player can never bet beyond their balance and we never need a "reserved" column. Refund on void.
- **Snapshot the odds at placement.** The line legitimately re-prices on read (frozen-to-inputs, recomputed). A placed ticket stores `postedAmerican` so it settles at the price the bettor actually took — not whatever the line says at finalize.
- **Bet window = the upcoming scheduled round only**, and only while the line is **open** (non-gated: pairings set + ≥ `MIN_FIELD_ROUNDS` prior rounds). Closes the instant the round goes `active`/`finalized`.
- **Settlement reuses the engine + the extracted top-member helper**, runs once at finalize, idempotent on `status='open'`, dead-heat `1/k`. Off-board/cancelled → void + refund.
- **Determinism / integrity:** all money is integer wolf-bucks (no floats). Settlement payout = `round(stake × (1 + profitMultiple) × winShare)`; document the rounding rule. Wallet writes for a round's settlement run in a single transaction.

## Implementation Plan

Dependency order: **schema/migration → identity (auth) → wallet → place-bet → settlement → leaderboard/UI**. Identity + wallet are independently shippable (you can claim + see your $500 before betting exists).

### Tasks

#### Schema
- [ ] **Task 1: Migration `0029_play_money_betting.sql` + schema.ts** — 4 tables (every statement `--> statement-breakpoint`):
  - `player_credentials` (`player_id` PK/FK, `pin_hash` text, `failed_attempts` int default 0, `locked_until` int null, `created_at`, `updated_at`).
  - `player_sessions` (`id` text PK, `player_id` FK, `expires_at` int; index on player_id).
  - `bet_wallets` (`id`, `season_id` FK, `player_id` FK, `balance` int, `created_at`, `updated_at`; **unique (season_id, player_id)**).
  - `bets` (`id`, `season_id` FK, `round_id` FK, `bettor_player_id` FK, `target_player_id` FK, `stake` int, `posted_american` int, `status` text `'open'|'won'|'lost'|'void'`, `payout` int default 0, `created_at`, `settled_at` int null; indexes on round_id, bettor_player_id).

#### Identity (PIN)
- [ ] **Task 2: `player-auth.ts` middleware** — mirror `admin-auth.ts` with `player_session` cookie → `player_sessions` lookup + sliding 30-day expiry → `c.set('playerId', …)`.
- [ ] **Task 3: `routes/player-auth.ts`** — `GET /book/claimable` (active non-guest roster, flagged whether each already has a PIN), `POST /book/claim` (playerId + 4-digit PIN → bcrypt hash, only if unclaimed), `POST /book/login` (playerId + PIN → verify, **lockout** after 5 fails/10 min, set cookie + seed wallet if absent), `POST /book/logout`, `GET /book/me` (playerId + wallet balance). Mount at `/api`.

#### Wallet + bets
- [ ] **Task 4: wallet seeding** — on first login/claim for the active season, insert `bet_wallets` row at `SEASON_BANKROLL = 500` (idempotent via the unique constraint).
- [ ] **Task 5: `routes/bets.ts` — `POST /bets`** (player-auth): validate window (target round = current scheduled round, line open), target is a priced member on the live `computeOddsLine`, `MIN_STAKE ≤ stake ≤ balance`; snapshot `postedAmerican`; **escrow** (decrement wallet) + insert bet, in one transaction. `GET /bets/mine` (player-auth): open + settled tickets. `GET /bets/leaderboard?seasonId` (public): per-player balance + W–L–void, ranked.

#### Settlement
- [ ] **Task 6: `lib/top-member.ts`** — extract the member-winner logic from `buildRetrospective` (max combined Harvey over roster members, co-winner set on dead-heat); refactor `scouting.ts` to use it (no behavior change).
- [ ] **Task 7: `lib/bet-settlement.ts` — `settleBetsForRound(roundId)`** — load `open` bets for the round; compute winners via `top-member.ts`; for each: won → credit `stake × (1 + profitMultiple(postedAmerican)) × (1/k)`, lost → no credit, all in one transaction; set status/payout/settled_at. Idempotent. Wire into `admin/rounds.ts` finalize **after** `computeAndStoreHarvey`, non-fatal-wrapped. Cancelled-round path (admin) → void + refund.

#### Web
- [ ] **Task 8: claim/PIN UI** (`routes/bet-login.tsx` + `lib/player-session.ts`) — pick-your-name + PIN screen; remembers the session.
- [ ] **Task 9: place-bet on The Line** (`ScoutingPanel.tsx`) — when signed in + line open, a "Place bet" control per member (stake input at the posted price) + a wallet-balance chip. Hidden when gated/closed or signed out (show a "claim your player to bet" prompt).
- [ ] **Task 10: The Book** (`routes/book.tsx`) — "My Bets" (open/settled) + the play-money leaderboard.

#### Tests
- [ ] **Task 11: api integration** — claim/login/PIN-lockout; wallet seeds to 500; place-bet validations (window, balance, invalid target, odds snapshot); settlement won/lost/**dead-heat 1/k**/void+refund; idempotent re-settle; leaderboard ranking. Engine `profitMultiple`/dead-heat already unit-tested.

### Acceptance Criteria
- [ ] **AC1 (claim/login):** an active non-guest member can claim once (set PIN) and log in with name+PIN; a guest cannot; wrong PIN locks out after 5 tries for 10 min; the session persists on the device.
- [ ] **AC2 (bankroll):** first login for the season seeds a $500 wallet exactly once; a new season starts fresh at $500.
- [ ] **AC3 (place):** a signed-in player can bet a priced member to win the upcoming round at the **posted price (snapshotted)**; stake is escrowed; cannot bet > balance, < MIN_STAKE, on a gated/closed line, or on a non-member/unpriced target.
- [ ] **AC4 (settle):** on finalize, open bets on that round settle — winners credited `stake×(1+profitMultiple)` (×`1/k` on a dead-heat), losers forfeit the escrow; settlement is idempotent and never breaks finalize.
- [ ] **AC5 (void):** a cancelled round voids open bets and refunds stakes.
- [ ] **AC6 (the book):** the leaderboard ranks players by balance with their W–L record; "My Bets" shows open + settled tickets with payouts.
- [ ] **AC7 (no real money / no leak):** all amounts are play-money integers; bet/wallet endpoints require player-auth (except the public leaderboard); the line/settlement logic is unchanged for non-bettors.

## Additional Context
### Dependencies
- **No new libraries** (bcrypt already a dep). Reuses `@wolf-cup/engine` settlement math, the existing odds block, and the admin-session pattern. One migration (`0029`).
### Notes
- **Security posture:** 4-digit PINs are intentionally low-friction; bcrypt + lockout + the fact that it's valueless play money in a private league make it acceptable. If the league ever wants real stakes or stronger identity, swap PIN → the tournament app's arctic OAuth (out of scope here).
- **Why settlement reuses everything:** the odds, `profitMultiple`, dead-heat `1/k`, and the top-member computation already exist and are tested/live (the House ledger settles simulated bettors with this exact machinery). This feature is ~70% identity + plumbing on top of a proven engine.
- **Marketing commitment:** the brochure hero carries an "In-App Betting — Coming Soon" stamp (the $500 figure was deliberately removed before send — it stays an internal design number, so we can tune `SEASON_BANKROLL` without contradicting anything advertised).
- **Pre-dev:** run the adversarial review (BMAD adversarial-general + codex, as scouting did) before flipping `status` to `ready-for-dev` — focus areas: escrow/refund correctness under concurrent bets, settlement idempotency + double-credit, odds-snapshot vs re-price, PIN brute-force, and bet-window race (line open → round goes active mid-placement).
