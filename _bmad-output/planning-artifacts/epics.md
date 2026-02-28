---
stepsCompleted: [1, 2]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
---

# Wolf-Cup - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Wolf-Cup, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: The system calculates Stableford points for each player per hole based on their net score relative to par
FR2: The system calculates wolf game money results per hole based on wolf assignments, net scores, and hole type (skins or wolf)
FR3: The system calculates skins results for holes 1–2 (net low ball; winner collects from each other player in the group; tie = no blood, no carryover)
FR4: The system ranks all players in the round by Stableford score and by money position at any point during or after the round
FR5: The system calculates Harvey Cup points per player per category (Stableford, money) using the rank-based formula scaled to active player count
FR6: The system splits Harvey Cup points between tied players using averaged adjacent rank values, producing half-point results
FR7: The system tracks each player's per-round Harvey Cup totals and applies the best-10-of-N rule to compute season standing totals
FR8: The system applies two-tier playoff point multipliers (Round of 8: rank × 3; Round of 4: rank × 8)
FR9: The system determines wolf hole assignments for holes 3–18 deterministically from the batting order established at ball draw
FR10: The system provides Guyan G&CC course data (18 holes, par, handicap stroke index, tee yardages) for use in net score calculation and display
FR11: On wolf holes (3–18) in 2v2, money components are resolved as team outcomes — winning team members each win $1 per point; losing team members each lose $1 per point; all four players net to $0 per component
FR12: On wolf holes where wolf goes alone (1v3), wolf wins or loses $1 per point against each of the 3 opponents individually; all four players net to $0 per component
FR13: The skin is only awarded to the player who holds the low net ball of the group; if low ball is tied or the low ball winner has worse than net par, no skin is awarded and no points carry over
FR14: Polie and greenie bonuses are team bonuses in 2v2; in 1v3, wolf earns the bonus against all 3 opponents individually
FR15: The system auto-detects net birdies and eagles from entered gross scores and player handicap for bonus calculation and statistical tracking
FR16: When auto-calculate money is on, the system applies greenie, polie, birdie, eagle, and double-bonus modifiers to money results per hole
FR17: The system tracks each player's cumulative money balance across all 18 holes for end-of-round settlement display
FR18: All per-hole money results must net to $0 across all 4 players in the group; the engine validates zero-sum on every hole calculation
FR19: Ties on any component result in no blood for that component; no carryovers on any component including skins
FR20: Admin can create an official round with a scheduled date, player groups, and a unique weekly entry code
FR21: Admin can create a casual round open to any participants including guests not in the league roster
FR22: Admin can cancel or mark a round as a rainout, preserving accurate round count and best-10 calculations
FR23: The system associates round results with round type (official or casual) and only applies official round results to season standings
FR24: Scorer can initiate an official round by entering the current week's entry code
FR25: Scorer can initiate a casual round without a code
FR26: Scorer can record the ball draw batting order for their group, which the system uses to assign wolf holes for the round
FR27: Scorer can enter gross scores for each player in their group on a per-hole basis
FR28: The system calculates each player's net score per hole using their current handicap index and the course handicap stroke index
FR29: The system displays the wolf assignment for each hole to the scorer during score entry (who is wolf, hole type, skins or wolf)
FR30: Scorer can review and edit scores for any hole in the current round before the round is finalized
FR31: The system queues score entries locally when offline and automatically syncs to the server when connectivity is restored
FR32: Admin can toggle auto-calculate money mode; when on, the system calculates per-hole money results from wolf partner decisions and net scores including all bonuses; when off, scorer manually enters net money total per player per hole
FR33: Scorer can record the wolf partner decision per wolf hole (alone or select a partner from the group) when auto-calculate money is enabled
FR34: On par 3 holes, scorer can optionally record greenie achievement for eligible players (hit green in regulation and 2-putt or better)
FR35: On any hole, scorer can optionally record polie achievement for any player (putt or chip-in from off the green on first putt)
FR36: Any user can view the live in-round leaderboard without authentication
FR37: The leaderboard displays each player's current Stableford score, money position, and the last hole their group has completed ("thru hole X")
FR38: The leaderboard automatically refreshes at regular intervals without user action
FR39: Users can manually trigger an immediate leaderboard refresh
FR40: The leaderboard displays a data freshness indicator showing time since last update
FR41: Admin can toggle live Harvey Cup points display on the mid-round leaderboard; off by default for regular season, always on for playoff rounds; changeable anytime by Jason or Josh
FR42: Any user can view year-to-date season standings including Harvey Cup point totals (Stableford + money), rounds played, and current drop score
FR43: The standings display sub player results in a section separate from full league member standings
FR44: The system identifies and displays playoff-eligible players based on the top-8 season standing cutoff after regular season rounds are complete
FR45: Admin can configure season parameters including scheduled round dates, total round count, and playoff format
FR46: Admin can set the weekly entry code for each official round
FR47: Admin can set player headcount and group assignments for each round
FR48: Admin can configure the side game schedule for the season and set the active side game per round
FR49: Admin can record the winner(s) of the active side game for any round
FR50: Admin can mark a player as a sub for any round, with their results tracked separately from full-member standings
FR51: Admin can convert a sub player to a full league member before the playoff eligibility cutoff
FR52: Admin can create and maintain the league roster including player names and GHIN handicap numbers
FR53: Admin can enter and update each player's current handicap index before each round
FR54: Casual round organizer can add guest players by name for a single round without adding them to the league roster
FR55: The app displays the active weekly side game name and format to all users
FR56: Admin can record the winner of a manual side game result (e.g., closest to pin) for any round
FR57: The system records wolf call decisions (alone vs. partner, partner selected, win/loss outcome) per player per hole for statistical purposes
FR58: The app provides statistical summaries per player including most wolves called, wolf win/loss record, most net birdies, most greenies, most polies, and biggest single-hole money win and loss
FR59: Statistical data is stored persistently in a relational database to support historical queries across rounds and seasons
FR60: Users can install the app to their iPhone home screen via Safari for full-screen, no-browser-chrome access
FR61: The app is publicly accessible at wolf.dagle.cloud without authentication for all read-only views (leaderboard, standings, course info)
FR62: Score entry for official rounds is restricted to users who have entered the current week's valid entry code
FR63: Admin panel access is restricted to authorized admin users (Jason and Josh)
FR64: Admin can edit per-hole gross scores, wolf partner decisions, and bonus inputs (greenie/polie) for any player in a finalized round; the system recalculates all affected net scores, Stableford points, money results, and YTD totals atomically; every edit is recorded in an immutable audit log with admin user ID, timestamp, round ID, hole number, player ID, field name, old value, and new value

### NonFunctional Requirements

NFR1: Each foursome's per-hole money must net to $0 across all 4 players — enforced by the engine on every calculation
NFR2: The total money across all foursomes in a round must also net to $0 — enforced at round completion
NFR3: Zero-sum violations are critical bugs; the system must surface them immediately, not silently produce wrong results
NFR4: Stableford points must be correctly calculated per the Stableford system for each player per hole
NFR5: Harvey Cup points are assigned to league-wide ranks (not per-group ranks) across all groups in the round
NFR6: Total Harvey Cup points awarded per category per round must equal the mathematically expected total for the active player count
NFR7: Ties must produce correct averaged half-point splits such that the total still matches expected
NFR8: Best-10-of-N must correctly identify and exclude drop rounds under all rainout and sub-join scenarios
NFR9: The scoring engine output must be validated against the 2025 season Excel data for all 17 rounds before launch
NFR10: Wolf hole assignments must be deterministic and immutable once ball draw is entered — no mid-round recalculation
NFR11: Score corrections to a completed hole must trigger full downstream recalculation for that round
NFR12: Database writes for score submissions must be atomic — partial writes are not acceptable
NFR13: Initial app load on cold LTE connection: < 3 seconds
NFR14: Score entry submission acknowledged by server: < 2 seconds on LTE
NFR15: Harvey Cup and money recalculation after score entry: < 500ms server-side
NFR16: Leaderboard polling interval: 5 seconds; update visible to all users within 10 seconds of score entry
NFR17: PWA app shell loads from cache instantly on repeat visits (no network required for shell)
NFR18: The app must be operational during Friday round hours (1:00pm–5:30pm ET) as the priority availability window
NFR19: Offline score entry must preserve 100% of entered data with zero loss; scores must sync in correct hole order upon reconnect
NFR20: The app must remain usable in read-only mode (serving cached leaderboard) even when the server is temporarily unreachable
NFR21: All client-server communication over HTTPS
NFR22: Admin panel protected by session-based authentication; sessions expire after reasonable inactivity
NFR23: Weekly entry codes must be invalidated when a new code is set or a round is closed
NFR24: Player data stored is limited to: name, GHIN number, handicap index, round scores — no SSNs, payment data, or email addresses
NFR25: No third-party analytics or tracking scripts
NFR26: Deploys as a standalone Docker container behind Traefik on the existing VPS — no dependency on other services
NFR27: Deployment does not require downtime during non-round hours
NFR28: Application logs must capture scoring calculation inputs and outputs to support post-round dispute resolution
NFR29: Admin edit operations on finalized round data must be atomic — all recalculations succeed or none are persisted; partial updates are not acceptable

### Additional Requirements

**From Architecture — Infrastructure & Setup:**
- Monorepo scaffold: pnpm workspaces with `packages/engine`, `apps/api`, `apps/web` structure
- Root config files: `pnpm-workspace.yaml`, `tsconfig.base.json`, shared root `package.json` scripts
- CI pipeline: GitHub Actions running vitest + tsc + eslint on every push/PR
- Deploy script (`deploy.sh`) for deliberate SSH-based production deployment committed to repo

**From Architecture — Engine:**
- `packages/engine` must be a pure TypeScript package (zero framework dependencies, no HTTP, no DB, no logging)
- Historical data validation gate: engine must pass all 17 rounds of 2025 season Excel data before any API or UI work begins
- Engine modules: `types.ts`, `wolf.ts`, `stableford.ts`, `money.ts`, `harvey.ts`, `validation.ts`, `course.ts`, `index.ts`
- Test fixtures: `packages/engine/src/fixtures/season-2025/` with 17 JSON input/expected-output files

**From Architecture — API:**
- Hono + @hono/node-server REST API
- Drizzle ORM + better-sqlite3 (SQLite) with drizzle-kit migrations
- Recalculate-on-write: every score POST triggers full round recalculation atomically
- Zod validation middleware on all mutation routes before engine calls
- Three-tier auth middleware: public / entryCodeMiddleware / adminAuthMiddleware
- Casual round entry code bypass: entryCodeMiddleware checks `round.type` before validating code
- Custom session cookie auth (bcrypt passwords, httpOnly/Secure/SameSite=Strict cookies)
- Sub player tracking: `round_players.is_sub` boolean per round
- Harvey toggle: `seasons.harvey_live_enabled` boolean; playoff rounds always override to ON
- Structured JSON logging of engine inputs + outputs on every score calculation

**From Architecture — Frontend:**
- Vite + React SPA + TypeScript + vite-plugin-pwa (Service Worker, offline app shell)
- TanStack Router (file-based, type-safe SPA routing)
- TanStack Query (refetchInterval: 5000, staleTime: 4000 for leaderboard polling)
- IndexedDB offline queue via `idb` library — sequential drain by hole number on reconnect
- shadcn/ui + Tailwind CSS v4 (mobile-first, 48px touch targets, high-contrast)
- PWA manifest for iPhone home screen install (icon, display:standalone, theme_color)

**From Architecture — Deployment:**
- Two-container Docker compose: `api` (Hono+Node.js) + `web` (nginx serving Vite SPA build)
- SQLite file as Docker volume: `./data/wolf-cup.db`
- Traefik handles TLS and routing at VPS level

### FR Coverage Map

FR1 → Epic 1 — Stableford calculation (engine)
FR2 → Epic 1 — Wolf game money calculation (engine)
FR3 → Epic 1 — Skins calculation holes 1–2 (engine)
FR4 → Epic 1 — Player ranking by Stableford and money (engine)
FR5 → Epic 1 — Harvey Cup points rank-based formula (engine)
FR6 → Epic 1 — Half-point tie splits (engine)
FR7 → Epic 1 — Best-10-of-N drop score logic (engine)
FR8 → Epic 1 — Two-tier playoff point multipliers (engine)
FR9 → Epic 1 — Deterministic wolf hole assignments from batting order (engine)
FR10 → Epic 1 — Guyan G&CC hardcoded course data (engine)
FR11 → Epic 1 — 2v2 team money resolution, zero-sum per component (engine)
FR12 → Epic 1 — 1v3 lone wolf money resolution (engine)
FR13 → Epic 1 — Skin awarded to low net ball holder only (engine)
FR14 → Epic 1 — Polie/greenie team bonuses 2v2; individual 1v3 (engine)
FR15 → Epic 1 — Auto-detect net birdies and eagles (engine)
FR16 → Epic 1 — Auto-calculate money modifiers (greenie, polie, birdie, eagle) (engine)
FR17 → Epic 1 — Cumulative money balance across 18 holes (engine)
FR18 → Epic 1 — Zero-sum validation on every hole calculation (engine)
FR19 → Epic 1 — Tie = no blood, no carryover on any component (engine)
FR20 → Epic 2 — Admin creates official round with entry code
FR21 → Epic 2 — Admin creates casual round (open to guests)
FR22 → Epic 2 — Admin cancels/rainout a round
FR23 → Epic 2 — Official vs casual round type enforced in data model
FR24 → Epic 3 — Scorer initiates official round with entry code
FR25 → Epic 3 — Scorer initiates casual round without code
FR26 → Epic 3 — Scorer records ball draw batting order
FR27 → Epic 3 — Scorer enters gross scores per hole per player
FR28 → Epic 3 — System calculates net score using handicap and stroke index
FR29 → Epic 3 — Wolf assignment displayed to scorer per hole
FR30 → Epic 3 — Scorer reviews and edits scores for any hole before round finalization
FR64 → Epic 2 — Admin edits per-hole gross scores, wolf decisions, and bonus inputs on finalized rounds with full audit trail
FR31 → Epic 3 — Offline score queue + automatic sync on reconnect
FR32 → Epic 2 — Admin toggles auto-calculate money mode
FR33 → Epic 3 — Scorer records wolf partner decision per hole
FR34 → Epic 3 — Scorer records greenie achievement on par 3 holes
FR35 → Epic 3 — Scorer records polie achievement on any hole
FR36 → Epic 3 — Live leaderboard publicly accessible, no auth required
FR37 → Epic 3 — Leaderboard shows Stableford, money, "thru hole X" per group
FR38 → Epic 3 — Leaderboard auto-refreshes every 5 seconds
FR39 → Epic 3 — Pull-to-refresh for immediate leaderboard update
FR40 → Epic 3 — Staleness indicator ("Updated X seconds ago")
FR41 → Epics 2+3 — Harvey toggle: admin configures (Epic 2), leaderboard displays (Epic 3)
FR42 → Epic 4 — YTD standings: Harvey Cup totals, rounds played, drop score
FR43 → Epic 4 — Sub results displayed separately from full member standings
FR44 → Epic 4 — Playoff-eligible players identified and displayed (top-8 cutoff)
FR45 → Epic 2 — Admin configures season parameters (dates, round count, playoff format)
FR46 → Epic 2 — Admin sets weekly entry code per round
FR47 → Epic 2 — Admin sets headcount and group assignments per round
FR48 → Epic 2 — Admin configures side game schedule and active side game
FR49 → Epic 2 — Admin records side game winner(s)
FR50 → Epic 2 — Admin marks player as sub for a round
FR51 → Epic 2 — Admin converts sub to full member before playoff cutoff
FR52 → Epic 2 — Admin creates and maintains league roster (names, GHIN numbers)
FR53 → Epic 2 — Admin enters and updates player handicap index per round
FR54 → Epic 3 — Casual round organizer adds guest players by name for single round
FR55 → Epic 3 — Active side game name and format displayed to all users
FR56 → Epic 2 — Admin records manual side game result
FR57 → Epic 5 — System records wolf call decisions per player per hole
FR58 → Epic 5 — Player stat summaries: wolf record, birdies, greenies, polies, money highs/lows
FR59 → Epic 5 — Statistical data persistent across rounds and seasons
FR60 → Epic 6 — PWA: iPhone home screen install via Safari
FR61 → Epic 3 — App publicly accessible at wolf.dagle.cloud (no auth for read-only)
FR62 → Epic 3 — Score entry for official rounds restricted to valid entry code holders
FR63 → Epic 2 — Admin panel restricted to Jason and Josh (session auth)

## Epic List

### Epic 1: Foundation & Verified Harvey Cup Scoring Engine
The mathematical core of the app — Stableford calculation, wolf money resolution, Harvey Cup points (rank-based, tie splits, best-10-of-N, playoff multipliers) — implemented as a pure TypeScript package (`packages/engine`), fully tested, and validated against all 17 rounds of 2025 historical data. No UI. This is the trust layer every other epic depends on.
**FRs covered:** FR1–FR19
**Additional:** Monorepo scaffold (pnpm workspaces), CI pipeline (GitHub Actions), historical validation fixtures (17 rounds)

### Epic 2: League Administration — Roster, Rounds & Season Setup
Jason can do everything needed to run the league: maintain the player roster, enter handicaps, create official and casual rounds with entry codes, configure the season, manage subs, handle rainouts, set the side game schedule, record side game results, toggle auto-calculate money and live Harvey settings. Full admin panel with session auth. Includes post-round score correction with full audit trail.
**FRs covered:** FR20–FR23, FR32, FR41 (admin toggle), FR45–FR53, FR56, FR63, FR64

### Epic 3: Live Score Entry & Real-Time Leaderboard
Scorers enter gross scores hole-by-hole during a round — official (entry code) or casual (no code) — with wolf assignment displayed per hole, offline queuing on connectivity loss, and automatic sync on reconnect. All players and remote spectators watch a live leaderboard update every 5 seconds with "thru hole X" per group and a staleness indicator — no login required.
**FRs covered:** FR24–FR31, FR33–FR35, FR36–FR41 (display), FR54, FR55, FR61–FR62

### Epic 4: Season Standings & Year-to-Date Rankings
Any user can view full YTD season standings — Harvey Cup point totals (Stableford + money), rounds played, best-10 drop score, sub results separated from full members, and playoff eligibility display (top-8 cutoff).
**FRs covered:** FR42–FR44

### Epic 5: Player Statistics & Wolf Records
Players can view personal stat summaries: wolf call record (alone vs. partner, win/loss), net birdie/eagle count, greenie/polie totals, biggest single-hole money win and loss — persistent across rounds and seasons.
**FRs covered:** FR57–FR59

### Epic 6: PWA Installation & Production Deployment
The app deploys to `wolf.dagle.cloud` on the existing Traefik/Docker VPS, installs on iPhone home screen via Safari with the Wolf Cup icon and full-screen display, with a deliberate deploy script for safe production updates.
**FRs covered:** FR60
**Additional:** Docker compose (api + nginx), deploy.sh, PWA manifest finalization, Traefik integration

---

## Epic 1: Foundation & Verified Harvey Cup Scoring Engine

The mathematical core of the app — Stableford calculation, wolf money resolution, Harvey Cup points (rank-based, tie splits, best-10-of-N, playoff multipliers) — implemented as a pure TypeScript package (`packages/engine`), fully tested, and validated against all 17 rounds of 2025 historical data. No UI. This is the trust layer every other epic depends on.

### Story 1.1: Monorepo Scaffold & CI Pipeline

As a developer,
I want the project scaffolded as a pnpm workspaces monorepo with `packages/engine`, `apps/api`, and `apps/web` and a CI pipeline running on every push,
So that all development work has a consistent, validated foundation from day one.

**Acceptance Criteria:**

**Given** the repository root after `pnpm install`
**When** `pnpm -r typecheck` is run
**Then** `tsc --noEmit` runs across all three packages with zero errors
**And** `pnpm --filter @wolf-cup/engine test` runs Vitest and passes (empty suite acceptable)

**Given** a push to any branch
**When** the GitHub Actions CI workflow runs
**Then** it executes engine tests, `tsc --noEmit`, and eslint in sequence
**And** any TypeScript error or failing test fails the CI workflow

**Given** a fresh clone of the repository
**When** a developer runs `pnpm install`
**Then** `packages/engine`, `apps/api`, and `apps/web` are all scaffolded with their `package.json` names (`@wolf-cup/engine`, `@wolf-cup/api`, `@wolf-cup/web`) and interdependencies resolve correctly

### Story 1.2: Course Data & Wolf Hole Assignment Engine

As a scorer,
I want wolf hole assignments determined automatically from the ball draw batting order,
So that the correct player is identified as wolf on every hole without manual tracking.

**Acceptance Criteria:**

**Given** any of the four batting positions and hole number 1–18
**When** `getWolfAssignment(battingOrder, holeNumber)` is called
**Then** holes 1–2 return `{ type: 'skins' }` regardless of batting order
**And** holes 3–18 return the correct wolf player per the fixed assignment table (Batter 1: holes 3,6,9,14 / Batter 2: holes 4,7,10,16 / Batter 3: holes 5,11,12,17 / Batter 4: holes 8,13,15,18)
**And** the function is pure — identical inputs always return identical output

**Given** any valid hole number 1–18
**When** `getCourseHole(holeNumber)` is called
**Then** it returns the correct par, handicap stroke index, and tee yardages for that hole at Guyan G&CC
**And** an invalid hole number throws a typed `InvalidHoleError`

### Story 1.3: Stableford Scoring Engine

As a player,
I want my gross score converted to Stableford points correctly on every hole,
So that my daily total is accurate and fairly comparable across all players.

**Acceptance Criteria:**

**Given** a player's gross score, handicap index, hole par, and stroke index
**When** `calculateStablefordPoints(grossScore, handicapIndex, par, strokeIndex)` is called
**Then** it returns the correct Stableford points: net double eagle = 5, net eagle = 4, net birdie = 3, net par = 2, net bogey = 1, net double bogey or worse = 0
**And** handicap strokes are allocated using standard course handicap calculation

**Given** a player with handicap 18 on a par-4 stroke index 1 hole (receives 1 stroke) who shoots gross 5 (net par)
**When** `calculateStablefordPoints` is called
**Then** it returns 2

**Given** a player with handicap 36 on a par-3 stroke index 1 hole (receives 2 strokes) who shoots gross 4 (net birdie)
**When** `calculateStablefordPoints` is called
**Then** it returns 3

### Story 1.4: Wolf Money Engine — Per-Hole Resolution

As a player,
I want money won and lost on each hole calculated correctly — skins holes (1–2), 2v2 wolf holes, and 1v3 lone wolf holes — so that end-of-round settlement is accurate.

**Acceptance Criteria:**

**Given** four players' net scores and a 2v2 wolf alignment
**When** `calculateHoleMoney(netScores, wolfAssignment, wolfDecision)` is called
**Then** the low ball of each team is compared; winning team each wins $1, losing team each loses $1 per money component
**And** the skin is awarded to the player with the absolute low net ball (must be net par or better); tied or worse than net par = no skin, no carryover
**And** all four players net to exactly $0 per component

**Given** a lone wolf (1v3) alignment
**When** `calculateHoleMoney` is called
**Then** wolf wins/loses $1 against each of the 3 opponents individually ($3 total swing for wolf)
**And** all four players net to $0 per component

**Given** all four players tie on a hole
**When** `calculateHoleMoney` is called
**Then** all players receive $0 on every component (no blood)

**Given** any calculated money result
**When** `validateZeroSum(moneyResults)` runs
**Then** it throws a typed `ZeroSumViolationError` if any component does not net to $0 across all four players

### Story 1.5: Wolf Money Engine — Bonus Modifiers

As a player,
I want birdie, eagle, greenie, and polie bonuses applied correctly to hole money,
So that exceptional shots are rewarded accurately in both 2v2 and 1v3 scenarios.

**Acceptance Criteria:**

**Given** a player's gross score, handicap, and hole par
**When** `detectBirdieEagle(grossScore, handicapIndex, par)` is called
**Then** it returns `'birdie'`, `'eagle'`, `'double_eagle'`, or `null` based on net score vs par
**And** detection is consistent with the Stableford engine's net score calculation

**Given** a greenie is recorded on a par-3 in a 2v2 hole
**When** `applyBonusModifiers(baseMoneyResult, bonuses, wolfAssignment)` is called
**Then** both members of the greenie player's team receive the greenie bonus; opposing team each loses the equivalent
**And** zero-sum is maintained across all four players after bonus application

**Given** a greenie in a 1v3 lone wolf scenario
**When** bonuses are applied
**Then** the wolf earns the greenie bonus against each of the 3 opponents individually
**And** all four players still net to $0

### Story 1.6: Harvey Cup Points Engine

As a league member,
I want Harvey Cup points calculated from my finish rank across all players in the round,
So that standings accurately reflect relative performance each week.

**Acceptance Criteria:**

**Given** all players' Stableford totals and money totals for a completed round and the active player count
**When** `calculateHarveyPoints(rankings, playerCount)` is called
**Then** each player receives Harvey Cup points for their Stableford rank and money rank per the rank-based formula scaled to player count
**And** rankings are computed league-wide across all groups (not per-group)

**Given** two players tie for 2nd place in Stableford
**When** Harvey points are calculated
**Then** both receive (2nd place points + 3rd place points) / 2
**And** the sum of all Harvey points distributed equals the expected total for the active player count

**Given** 16 active players with no ties
**When** `calculateHarveyPoints` runs
**Then** the sum of all Stableford Harvey points and all money Harvey points each equals the mathematically expected total for 16 players

### Story 1.7: Best-10-of-N Drop Score & Playoff Multipliers

As a league member,
I want my season Harvey Cup total to reflect my best 10 rounds with correct drops, and playoff rounds scored with the appropriate multipliers,
So that my season ranking is fair regardless of rainouts or playoff appearances.

**Acceptance Criteria:**

**Given** a player's per-round Harvey Cup history and the total official rounds completed
**When** `calculateSeasonTotal(roundResults, totalRounds)` is called
**Then** the player drops their lowest (totalRounds − 10) rounds, minimum 0 drops
**And** cancelled/rainout rounds are excluded from the round count
**And** players who joined mid-season drop proportionally fewer rounds

**Given** a season with 17 rounds and 2 rainouts where a player participated in all 15 non-rainout rounds
**When** `calculateSeasonTotal` runs
**Then** the player drops their 5 lowest rounds and their total reflects their best 10

**Given** a playoff round marked `roundType: 'playoff_r8'`
**When** Harvey points are calculated
**Then** each player's points = their rank × 3

**Given** a playoff round marked `roundType: 'playoff_r4'`
**When** Harvey points are calculated
**Then** each player's points = their rank × 8

### Story 1.8: Historical Data Validation Gate

As the league commissioner,
I want the engine validated against all 17 rounds of the 2025 season before the app goes live,
So that I can be certain the scoring math is correct before the first official 2026 round.

**Acceptance Criteria:**

**Given** 17 JSON fixture files in `packages/engine/src/fixtures/season-2025/` — each containing player gross scores, handicaps, wolf decisions, and expected Stableford/money/Harvey Cup outputs
**When** `pnpm --filter @wolf-cup/engine test` runs the historical validation suite
**Then** all 17 rounds produce output matching expected fixture results
**And** any discrepancy fails the test with a message identifying the round, player, and metric

**Given** a fixture contains a known edge case (e.g., 3-way Stableford tie)
**When** the engine processes it
**Then** half-point splits match expected output and total distributed points still equals expected total

**Given** any single fixture fails
**When** CI runs
**Then** the pipeline fails and no API or UI stories may begin until this story passes 100%

---

## Epic 2: League Administration — Roster, Rounds & Season Setup

*(Full story breakdown to be created during Epic 2 sprint planning. Stories listed here as they are identified.)*

### Story 2.x: Post-Round Score Correction with Audit Trail

As an admin,
I want to correct per-hole gross scores, wolf decisions, and bonus inputs for a finalized round,
So that scoring errors caught during end-of-round review can be fixed without requiring the round to be voided and re-entered.

**Context:**
Groups retain a hand-written scorecard throughout the round. After round finalization, the admin compares the app totals to the card. If money doesn't net to $0 or a Stableford total doesn't match, the admin goes hole-by-hole to find and fix the discrepancy. Correctable fields are: gross score per player per hole, wolf partner decision, greenie recipients, and polie recipients.

**Acceptance Criteria:**

**Given** an admin is authenticated and a round has been finalized
**When** the admin navigates to the round correction view
**Then** they can select any group, any hole, and edit: gross score for any player, wolf partner decision, greenie inputs, polie inputs

**Given** the admin submits a correction
**When** the API processes it
**Then** the system recalculates net scores → Stableford points → hole money → YTD totals atomically for the affected group
**And** the zero-sum constraint is validated on the recalculated hole money before the write is committed
**And** if validation fails, no data is persisted and the admin receives a clear error

**Given** any correction is submitted
**When** it is persisted
**Then** an audit log entry is created containing: admin_user_id, timestamp (UTC), round_id, hole_number, player_id (where applicable), field_name, old_value, new_value
**And** the audit log is immutable — entries cannot be edited or deleted through any UI

**Given** an admin views the audit log for a round
**When** the log is displayed
**Then** all corrections for that round are shown in reverse-chronological order with admin name, timestamp, hole, field, and old → new values

**Notes:**
- Engine recalculation is atomic: one hole correction recalculates that hole for all 4 players in the group
- Wolf decision change and bonus input change each trigger a full hole money recalculation
- Gross score change triggers: net score recalc → Stableford recalc → money recalc (net scores feed money on non-skins holes via handicap strokes)
- No UI restriction on number of corrections per round — admin may correct the same hole multiple times (each edit creates a new audit entry)
- Audit log is read-only in the UI; no delete or edit capability for audit entries
