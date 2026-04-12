---
title: 'Side Game Rotation & Auto-Calculation'
slug: 'side-game-rotation-auto-calc'
created: '2026-04-11'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Hono API', 'Drizzle ORM + SQLite', 'React 19 + TanStack Router/Query', 'Vitest', 'shadcn/ui + Tailwind v4']
files_to_modify: ['apps/api/src/db/schema.ts', 'apps/api/src/schemas/round.ts', 'apps/api/src/routes/rounds.ts', 'apps/api/src/routes/admin/rounds.ts', 'apps/api/src/routes/admin/side-games.ts', 'apps/api/src/lib/badges.ts', 'apps/api/src/routes/history.ts', 'apps/web/src/routes/score-entry-hole.tsx', 'apps/web/src/routes/standings_.history.tsx', 'apps/web/src/routes/admin/season.tsx', 'new: apps/api/src/lib/side-game-calc.ts']
code_patterns: ['finalization hook: Harvey then pairings (non-fatal try/catch)', 'side game detection via scheduledRoundIds JSON', 'award pipeline: computeAllAwards() in badges.ts', 'perSeason list controls year emoji rendering', 'score entry conditionals via wolfSchedule type checks']
test_patterns: ['Vitest with in-memory SQLite for API routes', 'pure unit tests for engine functions', 'side-games.test.ts has 20 existing tests']
---

# Tech-Spec: Side Game Rotation & Auto-Calculation

**Created:** 2026-04-11

## Overview

### Problem Statement

The 2026 Wolf Cup season has 6 side games that rotate on a 6-round cycle across the 20-round season. Five of these games can be auto-calculated (4 from existing score/bonus data, 1 from new putts input), and one (Closest to Pin) uses manual winner recording. Side game results need to persist as historical records viewable across seasons going forward. A new "Side Game Champion" trophy on Champions & History recognizes the player with the most side game wins each season.

### Solution

Create the 6 side games with pre-assigned round schedules. Add auto-calculation at finalization for 5 games (Most Net Pars, Most Skins, Least Putts, Most Net Under Par, Most Polies). Add conditional `putts` field to score entry for Least Putts weeks only. Keep Closest to Pin as manual admin entry. Add "Side Game Champion" trophy to Champions & History. Build side game results history viewable per season.

### Scope

**In Scope:**
- Create 6 side games for 2026 season, assign to rounds in 6-game rotation
- Auto-calculate winners at finalization for: Most Net Pars, Most Skins (cross-group unique lowest net), Least Putts, Most Net Under Par, Most Polies
- Add `putts` column to `hole_scores` + conditional putts input on score entry (only during Least Putts weeks)
- Closest to Pin remains manual (admin records winner after round)
- Surface active side game + winner on leaderboard
- "Side Game Champion" trophy on Champions & History — most wins across all 6 games in a season, ties = co-champions, shows name + win count + year
- Side game results history — viewable per season going forward (starting 2026)

**Out of Scope:**
- Historical side game data pre-2026 (no backfill)
- Purging test data (deferred)
- Par 3 Specialist award (future idea, not now)

## Context for Development

### Codebase Patterns

- **Finalization hook:** `POST /rounds/:id/finalize` in `admin/rounds.ts:706-758`. Sequence: status → Harvey (critical) → pairings (non-fatal). Side game auto-calc inserts after Harvey as non-fatal.
- **Side game detection:** Leaderboard API (`leaderboard.ts:195-214`) queries all side games for the season, checks if current round ID is in `scheduledRoundIds` JSON array. Returns `{ name, format }` or null.
- **Score submission:** `POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/scores` accepts array of `{ playerId, grossScore }`. Idempotent upsert.
- **Award pipeline:** `computeAllAwards()` in `badges.ts:205-411` takes historical data, computes per-category awards, returns `Award[]`. Called by `/history` endpoint.
- **Award rendering:** `AwardCard` in `standings_.history.tsx:272-323` uses `perSeason` list to show year emojis under award icons.
- **Score entry conditionals:** Uses `wolfSchedule[holeNum-1]?.type` to determine skins vs wolf UI. Same pattern for side game conditional.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/api/src/db/schema.ts:210-241` | `hole_scores` table — add `putts` column |
| `apps/api/src/schemas/round.ts:48-57` | `submitHoleScoresSchema` — add optional `putts` |
| `apps/api/src/routes/rounds.ts:934-941` | Score upsert — include putts |
| `apps/api/src/routes/admin/rounds.ts:706-758` | Finalization endpoint — insert auto-calc hook |
| `apps/api/src/routes/admin/side-games.ts` | Existing side game CRUD — add auto-calc function |
| `apps/api/src/lib/badges.ts:205-411` | Award computation — add `side_game_champion` |
| `apps/api/src/routes/history.ts:14-116` | History endpoint — query side game results |
| `apps/web/src/routes/score-entry-hole.tsx:383-492` | Score entry mutations — add putts to payload |
| `apps/web/src/routes/standings_.history.tsx:282` | `perSeason` list — add `side_game_champion` |
| `apps/api/src/routes/leaderboard.ts:195-214` | Side game detection — update query to select `calculationType`, add `totalPutts` on putts weeks, add winner banner after finalization |
| `apps/web/src/hooks/useOfflineQueue.ts` | Offline queue type + `drain()` function — add putts to payload (NOT `apps/web/src/lib/offline-queue.ts`) |
| `apps/api/src/schemas/score-correction.ts` | Score correction fieldName enum — add `'putts'` |

### Technical Decisions

- **"Most Skins" side game is field-wide net skins on ALL 18 holes** — NOT related to the money-game skins mechanic on holes 1 & 3. For each of the 18 holes, compute every player's net score (using full course handicap). If exactly one player across the entire field has the unique lowest net, they earn a "skin." Count skins per player. This is a completely separate concept from the per-group skins holes in the wolf money game.
- **Side games use FULL course handicap — NOT relative (play-off-the-low-man).** The money game uses relative course handicap (standard wolf — you only get the difference from the best player in your group). Side games are field-wide, so every player gets their full course handicap strokes regardless of group composition. This means: `calcCourseHandicap(handicapIndex, tee)` → `getHandicapStrokes(courseHandicap, strokeIndex)` — no subtraction of group minimum. The `tee` for the round is required. **If `tee` is null on the round, default to `'blue'`** (same fallback used by score corrections).
- **Tiebreaker:** All ties = co-winners. Multiple winners are recorded as separate rows in `side_game_results`. Scorecard playoff can be added later if needed — hole-by-hole data is already in the DB. **No-contest exception:** If the winning count/total is zero (e.g., zero skins, zero polies, zero net pars), then no winner is recorded — the game is a no-contest. This is NOT a tie; it means no one earned the award that week. "All players tied at zero" = no-contest, not co-winners.
- Putts input only appears on score entry during Least Putts weeks — hidden otherwise to avoid confusion. A contextual label explains why the field is showing: "This week's side game: Least Putts."
- **Live putts leaderboard on Least Putts weeks:** The leaderboard API includes a `totalPutts` field per player when the active side game is `auto_putts`. Frontend shows a "Putts" column on the leaderboard that week so players can track the competition in real time.
- Closest to Pin uses existing manual result recording — groups place a tee marker, next group compares.
- 4 par 3s at Guyan: holes 6, 7, 12, 15.
- Skins holes (money game) are 1 and 3 (recently changed from 1 and 2). This has NO bearing on the "Most Skins" side game which counts all 18 holes.
- Side game rotation: 6 games cycle through 20 rounds (1-6, 7-12, 13-18, 19-20 restart at 1-2).
- Side game results are persistent historical records, viewable across future seasons.
- Auto-calculation runs at finalization (same time as Harvey) — all groups must be complete. **Auto-calc must verify all 18 holes are scored for all players before computing. For Least Putts, also verify all 18 putts entries exist per player (not just grossScores).**
- Least Putts is auto-calculated (sum putts per player, lowest wins) — not manual.
- Side Game Champion trophy uses same rendering pattern as other awards (perSeason year emojis). **Shows on Awards Wall only, NOT on individual player drill-down cards** (add `'side_game_champion'` to `AWARDS_WALL_ONLY` list in badges.ts).
- Add `calculationType` column to `side_games` table — enum: `auto_net_pars`, `auto_skins`, `auto_putts`, `auto_net_under_par`, `auto_polies`, `manual`. Separates computation dispatch from display name. **Null `calculationType` treated as `manual` (skip auto-calc).**
- **`toSideGameResponse` helper must include `calculationType`** in the response shape. Update it to return `{ id, seasonId, name, format, calculationType, scheduledRoundIds }`. This affects the list endpoint, leaderboard detection, and round data endpoint — all consumers need `calculationType`.
- **`format` display strings for the 6 games:** (1) "Most holes at net par", (2) "Closest tee shot on par 3s", (3) "Lowest unique net score on any hole — all players, all 18 holes", (4) "Fewest total putts", (5) "Most holes under net par", (6) "Most polies in the round".
- Putts is **required** on Least Putts weeks — enforced at API (reject if missing) and frontend (disable Next until filled).
- Side game initialization is an admin action after rounds are created — "Initialize Side Game Rotation" button auto-creates 6 games and assigns to rounds via `(roundIndex % 6)`. **Rounds must be created before initialization. Only official, non-cancelled rounds are eligible.**
- **After finalization with auto-calc, show the computed winner on the admin round detail page.** Admin can override/edit the result. For manual side games (CTP), show a prompt: "Closest to Pin — record the winner." Auto-calc results set `winnerName` to null — display logic uses player name from `players` join, falling back to `winnerName` for manual/guest entries.
- **Partial rounds / incomplete groups:** If a round doesn't have all 18 holes scored for all players, auto-calc returns no-contest. Rain-shortened rounds or partial groups don't produce a side game winner.
- **Rounds added after initialization:** If rounds are added to the season after side game initialization, admin must manually assign them to side games via the existing PATCH endpoint. No automatic re-initialization.
- **Result write model with auto/manual discriminator:** Add a `source` column to `side_game_results`: `'auto' | 'manual'`. Auto-calc inserts use `source = 'auto'`. Manual/admin entries use `source = 'manual'`. The finalization hook (Task 7a/7b) **only deletes rows where `source = 'auto'`** before recomputing — manual overrides are preserved across recomputation. Admin override of an auto-calc result: delete the auto row, insert a manual row with `winnerPlayerId` (not just `winnerName`). The existing `POST /rounds/:roundId/side-game-results` endpoint must accept `winnerPlayerId` for roster players (already supported) and set `source = 'manual'`. Side Game Champion counts ALL rows with `winnerPlayerId IS NOT NULL` regardless of source. This ensures overrides count toward the trophy. Validate that `sideGameId` is scheduled for `roundId`. Reject duplicates per `(sideGameId, roundId, winnerPlayerId)`.
- **`calcMostPolies` must scan ALL wolf_decisions for the round** — including skins holes (1 and 3). Polies can be recorded on any hole, not just wolf holes. Count polies awarded TO each player (player IDs in `bonusesJson.polies` arrays are recipients).
- **Score corrections must support `putts` field corrections.** Add `'putts'` to the `fieldName` enum in the score corrections Zod schema. Range validation: 0-9. A putts correction on a finalized round triggers side game recomputation (same as gross score corrections trigger Harvey recomputation).
- Season wipe for test data is a one-time manual DB operation, not in scope.
- Season finalization (status field + admin button) is a separate future spec.
- Tee rotation already works and stays separate from side games.
- Guest/sub winners (via `winnerName` only, no `winnerPlayerId`) do not count toward Side Game Champion trophy — intentional, guests aren't in the league standings.
- **`computeAllAwards` 7th parameter is optional** (`sideGameWins?: ...`) to maintain backward compatibility with existing tests. **Deploy Task 12 and Task 13 together** — if Task 12 ships without Task 13, the trophy silently does nothing (no data passed).
- **History endpoint architecture note:** The first 6 parameters of `computeAllAwards` are hardcoded `HISTORICAL_*` constants from `history-data.ts`, not live DB queries. The 7th parameter (side game wins) IS from a live DB query. This means the Side Game Champion trophy can render for a season that doesn't yet have a champion in the static data. This is acceptable — side game results accumulate throughout the season before a champion is crowned.
- **Winner banner on leaderboard:** After finalization, the leaderboard API includes the side game winner(s) in the response. The frontend shows a banner at the top of the leaderboard: e.g., "Most Net Pars Winner: Ben McGinnis (7 net pars)". For manual games (CTP), the banner appears after the admin records the winner. Banner stays visible until the next round starts.

## Implementation Plan

### Tasks

#### Phase 1: Schema & Migration

- [x] Task 1: Add `putts` column to `hole_scores` and `calculation_type` column to `side_games`
  - File: `apps/api/src/db/schema.ts`
  - Action: Add `putts: integer('putts')` (nullable) to `holeScores` table after `grossScore`. Add `calculationType: text('calculation_type')` to `sideGames` table after `format`. Add `source: text('source')` to `sideGameResults` table — values: `'auto'` or `'manual'`, nullable (existing rows treated as manual).
  - Notes: `putts` is nullable — only populated on Least Putts weeks. `calculationType` values: `auto_net_pars`, `auto_skins`, `auto_putts`, `auto_net_under_par`, `auto_polies`, `manual`. `source` discriminates auto-calc vs manual entries — finalization only deletes `source = 'auto'` rows on recompute, preserving manual overrides.

- [x] Task 1b: Update manual result endpoint with `source`, validation, and delete capability
  - File: `apps/api/src/routes/admin/side-games.ts` and `apps/api/src/schemas/side-game.ts`
  - Action: (1) In the `POST /rounds/:roundId/side-game-results` handler, set `source = 'manual'` on insert. (2) Add validation: reject with 422 if `sideGameId` is not scheduled for the given `roundId` (check `scheduledRoundIds` contains `roundId`). (3) Add `DELETE /rounds/:roundId/side-game-results/:resultId` endpoint — needed for admin to remove/override results and to mark a game as no-contest (delete all results for that round+game). (4) Update `toSideGameResponse` helper to include `calculationType` in the response shape — all consumers (list, leaderboard, round data) need this field. (5) Update the leaderboard side game detection query (`leaderboard.ts:196-213`) to also select `calculationType`.
  - Notes: The existing endpoint already accepts `winnerPlayerId` — no change needed there. The delete endpoint is necessary because the schema requires either `winnerPlayerId` or `winnerName`, so "no-contest" can't be recorded as a row — it's the absence of a row.

- [x] Task 2: Generate and apply Drizzle migration
  - File: `apps/api/src/db/migrations/` (new file)
  - Action: Run `cd apps/api && npx drizzle-kit generate` to create migration. Verify SQL adds both columns.
  - Notes: Migration must be safe for existing data — both columns are nullable so no data issues.

#### Phase 2: API — Score Submission with Putts

- [x] Task 3: Update score submission schema to accept optional `putts`
  - File: `apps/api/src/schemas/round.ts`
  - Action: Add `putts: z.number().int().min(0).max(9).optional()` to each score object in `submitHoleScoresSchema`.
  - Notes: Optional at schema level — conditional enforcement happens in the route handler.

- [x] Task 4: Update score submission endpoint to store putts and conditionally require it
  - File: `apps/api/src/routes/rounds.ts`
  - Action: In the POST scores handler (~line 934), include `putts` in the upsert values. Before upserting, check if the round's active side game has `calculationType === 'auto_putts'`. If so, validate that every score object includes `putts` — return 422 if missing.
  - Notes: Query the round's side game by joining `sideGames` → `scheduledRoundIds` contains `roundId`. Cache the lookup for the request.

- [x] Task 5: Expose active side game info on round data endpoint
  - File: `apps/api/src/routes/rounds.ts`
  - Action: In the GET round endpoint (used by score entry page), include `sideGame: { name, format, calculationType } | null` in the response by checking `scheduledRoundIds` like the leaderboard does.
  - Notes: Score entry page needs this to know whether to show putts input.

#### Phase 3: Auto-Calculation Engine

- [x] Task 6: Create side game calculation module
  - File: `apps/api/src/lib/side-game-calc.ts` (new)
  - Action: Create pure functions for each calculation type:
    - `calcMostNetPars(scores, handicaps, courseHoles, tee)` — count holes where `gross - strokes === par` per player across all groups. Highest count wins.
    - `calcMostSkins(scores, handicaps, courseHoles, tee)` — for each hole, compute net score per player across ALL groups. If exactly one player has the unique lowest net, they get a skin. Count skins per player. Highest wins.
    - `calcLeastPutts(scores)` — sum `putts` column per player. Lowest wins.
    - `calcMostNetUnderPar(scores, handicaps, courseHoles, tee)` — count holes where `gross - strokes < par` per player. Highest wins.
    - `calcMostPolies(wolfDecisions)` — count polies per player from `bonusesJson` across all groups. Highest wins.
    - `computeSideGameWinner(roundId, calculationType, db)` — dispatcher that queries data, calls the appropriate calc function, and returns `{ winnerPlayerIds: number[], detail: string }`. All ties = co-winners (multiple IDs returned).
  - Notes: **Use FULL course handicap (not relative/play-off-the-low-man).** Compute: `calcCourseHandicap(handicapIndex, tee)` → `getHandicapStrokes(courseHandicap, strokeIndex)` per hole. No group minimum subtraction. Use `calcCourseHandicap`, `getHandicapStrokes`, `getCourseHole` from `@wolf-cup/engine`. The `tee` for the round is required. **Must verify all 18 holes are scored for all players before computing** — return empty result if incomplete. For `calcMostPolies`: count polies *awarded to* each player (from `bonusesJson.polies` arrays across all wolf_decisions for the round — the player ID in the array is the recipient, not the recorder).

- [x] Task 7a: Hook auto-calc into finalization endpoint
  - File: `apps/api/src/routes/admin/rounds.ts`
  - Action: After Harvey computation (~line 750), add non-fatal try/catch block. Modify the existing round query (line 717-721) to also select `tee`. Apply fallback: `const roundTee = (round.tee as Tee) ?? 'blue'`. Query side games scheduled for this round. For each with `calculationType !== 'manual'` and `calculationType !== null`, call `computeSideGameWinner()` passing `roundTee`. **Within a transaction:** delete any existing `side_game_results` for this round+sideGameId where `source = 'auto'`, then insert result(s) with `source = 'auto'`, `notes` containing the detail string (e.g., "7 net pars"). If co-winners, insert one row per winner.
  - Notes: Follow the pairings pattern — log errors but don't fail finalization. Skip if no side game is scheduled for the round. Treat null `calculationType` as manual. The delete+insert MUST be in a single transaction to prevent data loss on crash between the two operations.

- [x] Task 7b: Add `putts` correction support to score corrections
  - File: `apps/api/src/schemas/score-correction.ts` and `apps/api/src/routes/admin/score-corrections.ts`
  - Action: (1) Add `'putts'` to the `fieldName` enum in the Zod schema. (2) In the score corrections handler, add an explicit `else if (fieldName === 'putts')` branch (do NOT let it fall through to the default/handicapIndex branch — that would corrupt data). The putts branch should: look up the existing `hole_scores` row by `(roundId, playerId, holeNumber)`, validate new value is integer 0-9, update the `putts` column, determine `rescoreGroupId` from the player's group assignment. (3) After the putts update, trigger side game recomputation using the same logic as Task 7a (transactional delete `source='auto'` + recompute + insert).
  - Notes: The existing handler uses `if/else if` dispatch on fieldName. A missing branch for `'putts'` would cause it to fall through to the handicapIndex handler and silently corrupt data. This is the most dangerous integration point — test thoroughly.

- [x] Task 7c: Hook side game recomputation into ALL score correction types
  - File: `apps/api/src/routes/admin/score-corrections.ts`
  - Action: After the existing money/Harvey recomputation block that runs for any correction on a finalized round, add side game auto-calc recomputation. Query the round's scheduled side game. If `calculationType` is auto, recompute using `computeSideGameWinner()` with same transactional delete+insert pattern from Task 7a. Non-fatal try/catch.
  - Notes: Any correction (grossScore, handicapIndex, polie, putts) can affect side game results. This ensures side game winners stay in sync. Same pattern as Harvey recomputation already works.

#### Phase 4: Admin — Side Game Initialization

- [x] Task 8: Add "Initialize Side Game Rotation" endpoint
  - File: `apps/api/src/routes/admin/side-games.ts`
  - Action: Add `POST /seasons/:seasonId/side-games/initialize` endpoint. Query all rounds for the season filtered to `type = 'official'` and `status != 'cancelled'`, sorted by `scheduled_date`. Creates the 6 side games with names, `calculationType`, and assigns `scheduledRoundIds` based on round order: game `(i % 6)` where `i` is 0-indexed round position. Returns the created games with a summary of the rotation.
  - Notes: Guard against double-initialization — if side games already exist for the season, return 409. **Only official, non-cancelled rounds are eligible** — casual/practice rounds and cancelled rounds are excluded from the rotation. The 6 games in order: (1) Most Net Pars / `auto_net_pars`, (2) Closest to Pin / `manual`, (3) Most Skins / `auto_skins`, (4) Least Putts / `auto_putts`, (5) Most Net Under Par / `auto_net_under_par`, (6) Most Polies / `auto_polies`.

- [x] Task 9: Add "Initialize Side Game Rotation" button and hide manual creation until initialized
  - File: `apps/web/src/routes/admin/season.tsx`
  - Action: In the SideGamesSection component, if no side games exist for the season, show ONLY the "Initialize Side Game Rotation" button — **hide the manual "Add Side Game" form** to prevent partial-config. On click, call the initialize endpoint. On success, refetch side games list and show the rotation table with all 6 games. After initialization, show the existing side game list UI with edit capabilities (PATCH), but no manual "Add" form — the 6 games are the canonical set.
  - Notes: This prevents a scenario where one manual insert would cause the initialize endpoint to 409, leaving the season half-configured with no recovery path. The initialize button is the only entry point for side game creation.

#### Phase 5: Frontend — Conditional Putts Input

- [x] Task 10: Add putts input to score entry on Least Putts weeks
  - File: `apps/web/src/routes/score-entry-hole.tsx`
  - Action: Fetch `sideGame` from round data (added in Task 5). If `sideGame?.calculationType === 'auto_putts'`, render a "Putts" numeric input for each player below the gross score input. Include putts in the score submission payload. Disable "Next Hole" button if any player's putts field is empty. Add a contextual banner/label at the top of the score entry: "This week's side game: Least Putts — enter putts for each hole."
  - Notes: Use same input styling as gross score. Label "Putts" with smaller text. Default to empty (not 0). Putts range 0-9.

- [x] Task 11: Update offline queue to include putts
  - File: `apps/web/src/lib/offline-queue.ts` (QueueEntry type) and `apps/web/src/hooks/useOfflineQueue.ts` (the `drain()` function at ~line 39)
  - Action: (1) In `offline-queue.ts`, update the `QueueEntry` type's `scores` array to include optional `putts?: number`. (2) In `useOfflineQueue.ts`, update the `drain()` function to include putts in the POST body when replaying scores. (3) In `score-entry-hole.tsx`, update the enqueue calls to pass putts data when available.
  - Notes: The drain function is named `drain`, NOT `drainQueue` or `replayScore`. Without this fix, putts entered while offline would be silently dropped when the queue drains, and the API will 422-reject on Least Putts weeks.

- [x] Task 11b: Add side game winner banner + live putts total to leaderboard
  - File: `apps/api/src/routes/leaderboard.ts` and `apps/web/src/routes/index.tsx`
  - Action: (1) Update the leaderboard API query to select `calculationType` from side games (currently missing — only selects `name`, `format`, `scheduledRoundIds`). (2) When `calculationType === 'auto_putts'`, add a `totalPutts` field per player by summing `hole_scores.putts` for the round. (3) After finalization, query `side_game_results` for this round and include `sideGameWinner: { playerName, detail } | null` in the leaderboard response. (4) Frontend: on the collapsed leaderboard row, show "Putts: 31" inline next to name on Least Putts weeks. (5) Frontend: show a winner banner at the top of the leaderboard when `sideGameWinner` is present — e.g., "🏆 Most Net Pars Winner: Ben McGinnis (7 net pars)". Banner visible from finalization until the next round starts.
  - Notes: Display putts inline on the **collapsed leaderboard row only** — NOT on the expanded scorecard which is already busy. The winner banner shows for ALL side game types after finalization, not just putts weeks. For CTP, the banner appears after admin records the winner manually.

#### Phase 6: Side Game Champion Trophy

- [x] Task 12: Add Side Game Champion award computation
  - File: `apps/api/src/lib/badges.ts`
  - Action: Add `computeSideGameChampion(sideGameWins: { playerName: string; year: number; wins: number }[])` function. Input is pre-aggregated: one entry per player per season with their win count. For each year, find the player(s) with the max `wins`. Return as `Award` with `id: 'side_game_champion'`, `category: 'superlatives'`, `emoji: '🏅'`, `name: 'Side Game Champion'`. Recipients get `detail: 'N wins'` and `years: [year]`. Ties = multiple recipients for that year (co-champions). Add as 7th parameter to `computeAllAwards()` signature: `sideGameWins`.
  - Notes: Follow the `computeMoneyMan` pattern. Add call in `computeAllAwards()` after existing superlatives. **Update the call site at `history.ts:107-109` to pass the new parameter** (see Task 13).

- [x] Task 13: Query side game results in history endpoint and pass to awards
  - File: `apps/api/src/routes/history.ts`
  - Action: Before the `computeAllAwards()` call (~line 107), add query: join `sideGameResults` → `rounds` → `seasons` → `players`. Group by `winnerPlayerId` + `season.year`, count wins. Transform into `{ playerName, year, wins }[]` array — one entry per player per season with their total win count. Update the `computeAllAwards()` call at line 107-109 to pass this as the 7th argument.
  - Notes: Only include results where `winnerPlayerId` is not null (exclude guest-only entries). Do NOT discard the `wins` count — the award computation needs it to display "N wins" in the detail field.

- [x] Task 14: Add `side_game_champion` to frontend perSeason rendering list
  - File: `apps/web/src/routes/standings_.history.tsx`
  - Action: Add `'side_game_champion'` to the `perSeason` array on line 282.
  - Notes: One-liner. Ensures the trophy shows year emojis like all other awards.

#### Phase 7: Admin — Post-Finalization Side Game Display

- [x] Task 15: Show auto-calc winner on admin round detail after finalization
  - File: `apps/api/src/routes/admin/rounds.ts` and `apps/web/src/routes/admin/rounds.tsx`
  - Action: On the admin round detail page, after finalization, show the side game result: game name + winner. For manual side games (CTP), show a prompt card: "Closest to Pin — Record the winner" linking to the existing Record Result UI. For auto-calc games, show the winner with an edit/override option.
  - Notes: This gives the admin immediate feedback on what happened and a clear action for manual games.

#### Phase 8: Side Game Results History

- [x] Task 16: Include side game results in the `/history` public endpoint
  - File: `apps/api/src/routes/history.ts`
  - Action: In the existing `/history` GET endpoint, add a query: **LEFT JOIN** `sideGameResults` → `sideGames` (via `sideGameId`) → `rounds` (via `roundId`) → **LEFT JOIN** `players` (via `winnerPlayerId`). Use `COALESCE(players.name, sideGameResults.winnerName)` as the display name — this handles both roster players (joined via `winnerPlayerId`) and guest/manual entries (stored in `winnerName`). For each season, return an array of `{ gameName, winnerDisplayName, winnerPlayerId, roundDate, notes, source }`. Include as a `sideGameResults` field in the per-season response objects.
  - Notes: This is a **public** endpoint — no admin auth required. The LEFT JOIN on `players` is critical — an INNER JOIN would silently drop guest CTP winners where `winnerPlayerId` is null. Guest winners should appear in history, they just don't count toward the Side Game Champion trophy.

- [x] Task 17: Add side game results to Champions & History view
  - File: `apps/web/src/routes/standings_.history.tsx` (or new section)
  - Action: In the Champions & History page, add a "Side Games" section below awards. For each season, show a table/list of side game results: game name, winner name, round date, notes (detail). Data comes from the `sideGameResults` field added to the `/history` endpoint response in Task 16.
  - Notes: Only show for seasons that have side game data (2026+). Keep it compact — collapsible per season.

### Acceptance Criteria

#### Side Game Rotation & Setup
- [x] AC 1: Given a season with 20 rounds created, when admin clicks "Initialize Side Game Rotation", then 6 side games are created with correct names, `calculationType` values, and `scheduledRoundIds` assigned in rotating order (1-6, 7-12, 13-18, 19-20).
- [x] AC 2: Given side games already exist for a season, when admin clicks "Initialize Side Game Rotation", then a 409 error is returned and no duplicates are created.
- [x] AC 3: Given a round with a scheduled side game, when the leaderboard is loaded, then the active side game name and format are displayed.
- [x] AC 4: Given a season with fewer than 20 rounds, when admin clicks "Initialize Side Game Rotation", then side games are created and assigned to available rounds using `(roundIndex % 6)` rotation — some games may have fewer scheduled rounds than others.

#### Putts Input
- [x] AC 5: Given a round where the active side game has `calculationType = 'auto_putts'`, when a player opens score entry, then a "Putts" input field appears for each player on every hole with a contextual banner explaining why.
- [x] AC 6: Given a Least Putts week, when a scorer submits a hole without filling in putts for all players, then the API returns 422 and the frontend prevents submission.
- [x] AC 7: Given a round where the active side game is NOT Least Putts, when a player opens score entry, then no putts input is shown.
- [x] AC 8: Given a player enters putts while offline on a Least Putts week, when connectivity is restored, then the offline queue replays the scores with putts data intact.

#### Live Putts Leaderboard & Winner Banner
- [x] AC 8b: Given a Least Putts week, when the leaderboard is loaded, then each player's running putts total is shown inline on the collapsed row.
- [x] AC 8c: Given a non-Least Putts week, when the leaderboard is loaded, then no putts total is shown.
- [x] AC 8d: Given a finalized round with an auto-calc side game winner recorded, when the leaderboard is loaded, then a winner banner appears at the top showing the game name, winner name, and detail (e.g., "Most Net Pars Winner: Ben McGinnis (7 net pars)").
- [x] AC 8e: Given a finalized round with a manual side game (CTP) where the admin has recorded the winner, when the leaderboard is loaded, then the winner banner shows the CTP winner.
- [x] AC 8f: Given a finalized round where no side game winner exists yet (CTP not yet recorded, or no-contest), when the leaderboard is loaded, then no winner banner is shown.

#### Auto-Calculation
- [x] AC 9: Given a finalized round with side game "Most Net Pars" (`auto_net_pars`), when finalization completes, then the player with the most net pars across all groups (using full course handicap, not relative) is recorded as the winner in `side_game_results`.
- [x] AC 10: Given a finalized round with side game "Most Skins" (`auto_skins`), when finalization completes, then skins are computed across ALL 18 holes cross-group (unique lowest net per hole across entire field using full course handicap — not limited to skins holes 1 & 3), and the player with the most skins is recorded as the winner.
- [x] AC 11: Given a finalized round with side game "Least Putts" (`auto_putts`), when finalization completes, then the player with the fewest total putts across 18 holes is recorded as the winner.
- [x] AC 12: Given a finalized round with side game "Most Net Under Par" (`auto_net_under_par`), when finalization completes, then the player with the most holes where net score < par (using full course handicap) is recorded as the winner.
- [x] AC 13: Given a finalized round with side game "Most Polies" (`auto_polies`), when finalization completes, then the player with the most polies (counted by recipient from `bonusesJson.polies` arrays) across all groups is recorded as the winner.
- [x] AC 14: Given two or more players tied for the best result in any auto-calc side game, when finalization completes, then all tied players are recorded as co-winners (one `side_game_results` row per winner).
- [x] AC 15: Given a finalized round with side game "Closest to Pin" (`manual`), when finalization completes, then no auto-calculation runs — admin sees a prompt to record the winner on the round detail page.
- [x] AC 16: Given auto-calculation fails during finalization, when the error occurs, then finalization still succeeds (non-fatal), error is logged, and no side game result is recorded.
- [x] AC 17: Given not all players have 18 holes scored, when auto-calc runs, then no winner is computed and no result is recorded.
- [x] AC 18: Given no player qualifies for the side game (e.g., zero polies, zero skins), when auto-calc runs, then no result is recorded and admin round detail shows "No winner this week."
- [x] AC 19: Given a round is re-finalized (via score correction flow), when auto-calc runs again, then existing auto-calc side game results for that round are replaced (idempotent), while manual entries are preserved.
- [x] AC 19b: Given a putts value is corrected via score corrections on a finalized Least Putts round, when the correction is applied, then the side game winner is recomputed with the updated putts data.

#### Side Game Champion Trophy
- [x] AC 20: Given a season with side game results, when Champions & History is loaded, then a "Side Game Champion" award card shows the player(s) with the most total side game wins for that season, with name, win count, and 2-digit year.
- [x] AC 21: Given two players tied for most side game wins in a season, when Champions & History is loaded, then both are shown as co-champions on the award card.

#### Admin Round Detail
- [x] AC 22: Given a finalized round with an auto-calc side game, when admin views the round detail, then the side game winner is displayed with the game name and result detail.
- [x] AC 23: Given a finalized round with a manual side game (CTP), when admin views the round detail, then a "Record the winner" prompt is shown linking to the Record Result UI.

#### History
- [x] AC 24: Given side game results exist for a season, when Champions & History is loaded, then a "Side Games" section shows all results grouped by season with game name, winner, and round date.

## Additional Context

### Dependencies

- `@wolf-cup/engine` — `calcCourseHandicap`, `getHandicapStrokes`, `getCourseHole` for net score computation in skins/net pars/net under par calculations.
- Drizzle ORM — migration generation for new columns.
- No new external libraries required.

### Testing Strategy

**Unit Tests (new file: `apps/api/src/lib/side-game-calc.test.ts`):**
- Test each calc function with known inputs/outputs
- Test skins cross-group: 2 groups, verify unique-low-across-field logic
- Test ties = co-winners for all game types (multiple player IDs returned)
- Test edge cases: all players tied (no winner), single group, missing putts data, zero polies/skins
- Test FULL course handicap is used (not relative) — verify same player gets same net score regardless of group composition
- Test polies counted by recipient (player ID in bonusesJson.polies array), not by wolf decision recorder
- Test score completeness guard: incomplete round returns empty result

**API Integration Tests (update: `apps/api/src/routes/admin/side-games.test.ts`):**
- Test initialize endpoint: creates 6 games, correct rotation assignment, 409 on duplicate
- Test finalization auto-calc: mock round with scores, verify `side_game_results` populated
- Test putts validation: 422 when putts missing on auto_putts week, passes on other weeks
- Test null calculationType treated as manual (no auto-calc)
- Test score corrections with `fieldName: 'putts'` triggers side game recompute
- Test leaderboard includes `totalPutts` per player on auto_putts weeks, omits it on other weeks
- Test `toSideGameResponse` includes `calculationType` in response
- Test override flow: auto-calc winner → admin overrides with manual entry → recompute preserves manual override → Side Game Champion counts the manual winner
- Test guest CTP winner appears in `/history` response (LEFT JOIN, not dropped by INNER JOIN)
- Test season side game results endpoint returns aggregated data

**Manual Testing:**
- Create season with rounds, initialize side games, verify rotation on admin page
- Enter scores on a Least Putts week — verify putts input appears with contextual label and is required
- Enter scores on a non-putts week — verify putts input is hidden
- Finalize a round — verify auto-calc winner appears on admin round detail
- Finalize a CTP round — verify "Record the winner" prompt appears
- Check Champions & History — verify Side Game Champion trophy renders with year

### Notes

- **High-risk item:** Cross-group skins calculation is new territory. Every other scoring calc is per-group. Test thoroughly with multi-group scenarios. Using course handicap (not relative) is critical for fairness — verify with test cases where group composition differs.
- **Future consideration:** Scorecard playoff tiebreaker (countback from hole 18) can be added later if ties become a problem. Hole-by-hole data is already in the DB — no architectural changes needed.
- **Known limitation:** Side game results only track `winnerPlayerId` — no score/count detail stored. The auto-calc detail (e.g., "7 net pars") is computed but only stored in `notes` field.
- **Phased rollout recommended:** Ship rotation + auto-calc for 4 non-putts games before April 17. Add putts collection before Week 4 (Least Putts). Trophy and history can ship anytime during the season.
- **Future consideration:** Season finalization (separate spec) could auto-lock side games and compute the Side Game Champion at season end rather than computing it dynamically on every Champions & History page load.
- **Future consideration:** Par 3 Specialist award — most CTP wins in a season. Natural extension once CTP results are tracked.
- **Future consideration:** Mid-season "Side Game Standings" showing running win counts per player. Not in scope but players will want it.

## Review Notes
- Adversarial review completed
- Findings: 17 total, 8 fixed, 9 skipped (noise/low-risk/by-design)
- Resolution approach: auto-fix
- **Fixed:** TOCTOU race on double-init (F3), subs excluded from side game winners (user req), side game banner for all weeks (F10), empty parens in winner banner (F16), detail overwrite on multi-year champions (F14), WolfDecisionRow naming (F5), putts pre-population on hole revisit (F9), completeness check >= 18 (F12)
- **Skipped (by design/low-risk):** F2 (completed rounds don't run side games), F4 (perf acceptable for 6 games), F6 (auto-calc notes are identical), F7 (calculationType only set via init — intentional), F8 (cross-season requires admin mistake), F11 (playerRows includes all groups), F13 (dates always YYYY-MM-DD), F15 (putts on wrong week = no harm), F17 (offline drain test = implicit)
