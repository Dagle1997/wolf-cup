---
stepsCompleted: [1, 2, 3, 4]
status: complete
completedAt: 2026-03-14
inputDocuments:
  - '_bmad-output/planning-artifacts/product-brief-Wolf-Cup-2026-03-14.md'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
---

# Wolf-Cup Phase 2 - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Wolf-Cup Phase 2, decomposing the requirements from the Phase 2 Product Brief into implementable stories. Phase 2 targets three areas: the commissioner's pre-round workflow, season management improvements, and a stats experience powered by four years of historical data. All features ship before opening day 2026 (~early-mid May).

## Requirements Inventory

### Functional Requirements

FR65: Admin can enter a start and end date for a season and the system auto-calculates all Fridays between those dates as scheduled rounds
FR66: Admin can uncheck specific Fridays to exclude them from the season (member-guest, club tournaments); calendar is editable mid-season
FR67: The system auto-calculates total round count from remaining checked Fridays
FR68: The system assigns tee rotation (blue → black → white cycle) per the calendar, holding rotation for unchecked/skipped weeks and advancing rotation for rainout/cancelled rounds
FR69: Playoff format is pre-filled with the standard format and does not need to be entered each season
FR70: Admin can delete a season (including test seasons)
FR71: Each scheduled Friday has an attendance page showing the roster with in/out status, accessible from top-level navigation
FR72: Admin can toggle individual players in/out on the attendance board; all users can view the board read-only
FR73: The attendance board displays confirmed count and total needed (e.g., "14/16 confirmed")
FR74: Admin can add a sub directly from the attendance board via "Add Sub" button
FR75: Admin can add a sub by typing a name, searching GHIN for matching profiles, selecting the correct match, and auto-populating GHIN number and handicap index
FR76: Subs are saved to a season-scoped bench; returning subs appear in a dropdown with their round count and auto-refreshed handicap
FR77: The system displays course handicap (from the selected tee) on the pairings view, not the handicap index
FR78: Admin can create a round directly from the attendance board when headcount is a multiple of 4; system prevents creation otherwise
FR79: Round creation pre-populates with confirmed players, calendar tee, and sub flags from the attendance board
FR80: Published group assignments are visible to all players in-app with course handicaps, tee, date, and "Handicaps updated [timestamp]"
FR81: The system performs a bulk GHIN handicap refresh for all confirmed players at 6am ET on scheduled round days
FR82: "Handicaps updated [timestamp]" is displayed on both the pairings page and the leaderboard
FR83: Any user can view a player-centric head-to-head drill-down showing everyone that player has been grouped with (2026+) or played in the same league week (2022-2025), sorted by frequency
FR84: Tapping a player in the drill-down shows a rivalry card with: rounds together, money differential, Harvey finish comparison, wolf record (2026+ only), and a narrative headline stat
FR85: Stats pages include a season picker (individual years, multi-select, All Time) and a round type filter (All, Regular, Playoffs)
FR86: Player stats cards include per-tee performance (average Stableford differential by tee color)
FR87: Player stats cards include playoff analysis (season avg vs. playoff avg, appearances, Final Four history, best finish)
FR88: The system imports historical season data (2022-2025) from Excel files including per-week gross score, Stableford points, money, Harvey points, tee color, round dates, and playoff results
FR89: Historical player names are normalized to match current roster via a lookup table
FR90: Admin can filter or hide cancelled/test rounds from the round list
FR91: Admin can record a cancellation reason (rainout vs. administrative error) when cancelling a round
FR92: Cancelled rounds do not display empty group assignments in the UI
FR93: Admin can replace a player in a published group assignment with a different player (existing confirmed player, bench sub, or newly added sub) without recreating the round or other groups

### NonFunctional Requirements

NFR30: The attendance board and round creation flow must be fully functional on Android Chrome mobile (Jason's primary device)
NFR31: The pairings view must render all groups (up to 5 groups / 20 players) in a single mobile viewport without scrolling — screenshot-friendly
NFR32: The Friday 6am GHIN auto-refresh must complete and display confirmation before tee time; failure must be visible to admin
NFR33: All stats API endpoints accept an optional seasonId parameter; when null, aggregate across all seasons
NFR34: Historical data import is a one-time migration with player name normalization; imported data is read-only after import

### Additional Requirements

**From Existing Architecture (applicable to Phase 2):**
- Season calendar schema: new table tracking each Friday with status (active/skipped/cancelled), tee assignment, and attendance state
- Attendance state: persistent per-week-per-player in/out tracking, independent of round existence
- Sub bench table: season-scoped, stores name, GHIN number, handicap index, round count
- Scheduled job infrastructure: cron or similar for Friday 6am GHIN refresh
- Historical data tables: imported season results with season/year tagging, integrated into existing tables with season references
- Narrative headline stat generation logic: picks most extreme/interesting rivalry stat for display
- All admin flows (attendance, round creation, group suggestions) designed mobile-friendly for Android Chrome
- Pairings view designed screenshot-friendly: all groups in one viewport with course handicaps, tee, date, timestamp

### FR Coverage Map

FR65 → Epic P2.1 — Auto-calculate Fridays from date range
FR66 → Epic P2.1 — Uncheck off-week Fridays, editable mid-season
FR67 → Epic P2.1 — Auto-count total rounds from checked Fridays
FR68 → Epic P2.1 — Tee rotation with hold/advance logic
FR69 → Epic P2.1 — Pre-fill playoff format
FR70 → Epic P2.1 — Season delete
FR71 → Epic P2.2 — Attendance page per scheduled Friday
FR72 → Epic P2.2 — Admin toggle in/out, all users read-only
FR73 → Epic P2.2 — Confirmed count display
FR74 → Epic P2.2 — Add Sub button on attendance board
FR75 → Epic P2.2 — Sub GHIN search and auto-populate
FR76 → Epic P2.2 — Season-scoped sub bench with round count
FR77 → Epic P2.3 — Course handicap on pairings (not index)
FR78 → Epic P2.3 — Create round from attendance (multiples of 4)
FR79 → Epic P2.3 — Pre-populate round from attendance
FR80 → Epic P2.3 — Published groups visible to all with course HCP + timestamp
FR81 → Epic P2.3 — Friday 6am bulk GHIN refresh
FR82 → Epic P2.3 — "Handicaps updated" timestamp on pairings + leaderboard
FR83 → Epic P2.4 — Head-to-head drill-down
FR84 → Epic P2.4 — Rivalry card with narrative headline
FR85 → Epic P2.4 — Season picker + round type filter
FR86 → Epic P2.4 — Per-tee performance stats
FR87 → Epic P2.4 — Playoff analysis stats
FR88 → Epic P2.4 — Historical Excel import (2022-2025)
FR89 → Epic P2.4 — Player name normalization
FR90 → Epic P2.3 — Round filtering
FR91 → Epic P2.3 — Cancellation reasons
FR92 → Epic P2.3 — Cancelled round UI cleanup
FR93 → Epic P2.3 — Player swap in published groups

## Epic List

### Epic P2.1: Season Calendar & Smart Setup
Admin can create a season with auto-calculated Fridays, tee rotation, off-week management, and sensible defaults — eliminating manual counting and repetitive configuration. Admin can also delete test seasons. Harvey live defaults to ON for 2026.
**FRs covered:** FR65, FR66, FR67, FR68, FR69, FR70
**Additional:** Harvey live toggle default ON (existing setting, new default)

### Epic P2.2: Weekly Attendance & Sub Management
Admin can track weekly player attendance incrementally across the week, recruit and manage subs with GHIN auto-lookup, and maintain a season-scoped sub bench — decoupling "who's playing" from "create the round." Players can view the attendance board read-only for instant headcount.
**FRs covered:** FR71, FR72, FR73, FR74, FR75, FR76
**NFRs:** NFR30 (Android mobile-friendly)

### Epic P2.3: Round Creation, Groups & Round Management
Admin can create a round directly from the attendance board, get group suggestions with pairing history, publish groups visible to all players with course handicaps and freshness timestamp, swap players after publishing, and benefit from automated Friday handicap refresh. Includes round filtering, cancellation reasons, cancelled round UI cleanup, and pairing re-suggest bug fixes.
**FRs covered:** FR77, FR78, FR79, FR80, FR81, FR82, FR90, FR91, FR92, FR93
**NFRs:** NFR31 (screenshot-friendly pairings), NFR32 (GHIN refresh reliability)
**Depends on:** Epic P2.1 (calendar provides tee assignment), Epic P2.2 (attendance provides confirmed players)

### Epic P2.4: Historical Data Import & Multi-Season Stats
Historical Excel data (2022-2025) is imported and the stats page is enhanced with head-to-head rivalry drill-downs, narrative headline stats, season picker, per-tee performance, and playoff analysis — all powered by 4+ years of data. Fully independent of Epics P2.1-P2.3 and can be built in parallel.
**FRs covered:** FR83, FR84, FR85, FR86, FR87, FR88, FR89
**NFRs:** NFR33 (seasonId on all stats endpoints), NFR34 (one-time import)

---

## Build Priority

| Priority | Epic | Timeline | Dependencies |
|----------|------|----------|-------------|
| **P0 — Sequential** | P2.1 → P2.2 → P2.3 | Weeks 1–4 | Critical path; must ship for opening day |
| **P0 — Parallel** | P2.4 (historical import + stats) | Weeks 1–6 | Independent; enables stats on day 1 |

---

## Epic P2.1: Season Calendar & Smart Setup

Admin can create a season with auto-calculated Fridays, tee rotation, off-week management, and sensible defaults — eliminating manual counting and repetitive configuration. Admin can also delete test seasons. Harvey live defaults to ON for 2026.

### Story P2.1.1: Season Calendar — Auto-Calculate Fridays & Off-Week Management

As an admin,
I want to enter a start and end date and have the system auto-calculate all Fridays, with the ability to uncheck off-weeks,
So that I don't have to manually count Fridays or enter a total round count.

**Acceptance Criteria:**

**Given** an admin is creating or editing a season
**When** they enter a start date and end date (e.g., April 5 to September 6)
**Then** the system calculates and displays all Fridays between those dates as scheduled rounds
**And** auto-populates the total round count from the number of Fridays

**Given** the calendar of Fridays is displayed
**When** the admin unchecks a Friday (e.g., member-guest weekend)
**Then** that Friday is excluded from the season schedule
**And** the total round count updates automatically

**Given** a season is already active mid-season
**When** the admin unchecks a newly discovered off-week Friday
**Then** the calendar updates, total round count adjusts, and no existing round data is affected

**Given** the admin is configuring a season
**When** the playoff format field is displayed
**Then** it is pre-filled with the standard playoff format (Round of 8 → Round of 4)
**And** the admin does not need to re-enter it each season

**Notes:**
- Schema: new `season_weeks` table tracking each Friday with status (active/skipped), season reference
- FR65, FR66, FR67, FR69 covered

### Story P2.1.2: Tee Rotation Auto-Assignment

As an admin,
I want the system to automatically assign tee rotation (blue → black → white) per the calendar, correctly handling skipped weeks and rainouts,
So that I don't have to manually track which tee is next.

**Acceptance Criteria:**

**Given** a new season is created
**When** tee rotation is initialized
**Then** the first active Friday is always assigned blue tees

**Given** a season calendar with active Fridays
**When** the system assigns tee rotation
**Then** tees cycle blue → black → white → blue across active (checked) Fridays in order

**Given** an unchecked/skipped Friday (club event, member-guest)
**When** tee rotation is calculated
**Then** the skipped week is ignored — the tee holds and the next active Friday gets the same tee that was scheduled for the skipped week

**Given** two or more consecutive Fridays are skipped
**When** tee rotation is calculated
**Then** the tee holds through all skipped weeks — the next active Friday gets the tee that was due before the skips

**Given** a round is cancelled (rainout) after being created
**When** tee rotation is recalculated
**Then** the rainout Friday's tee still advances — the next Friday gets the next tee in the cycle
**And** this matches the existing league rule: rainouts rotate, skipped weeks hold

**Given** the admin unchecks or re-checks a Friday mid-season
**When** the calendar is saved
**Then** tee assignments for all future Fridays are recalculated based on the updated calendar
**And** tee assignments for past rounds are not changed

**Given** playoff rounds
**When** tee assignment is determined
**Then** playoff rounds are always blue tees regardless of rotation (existing v1 behavior)

**Notes:**
- Tee rotation logic: deterministic from calendar state, resets to blue each season
- FR68 covered

### Story P2.1.3: Season Delete & Harvey Default

As an admin,
I want to delete a test season and have Harvey live default to ON when creating a new season,
So that I can clean up test data and avoid re-entering settings that never change.

**Acceptance Criteria:**

**Given** an admin views the list of seasons
**When** they select delete on a season
**Then** the season and all associated data (rounds, scores, results, attendance, pairing history) are permanently removed
**And** a confirmation prompt warns "This will permanently delete all data for this season. This cannot be undone."

**Given** a season has finalized rounds with player data
**When** the admin attempts to delete it
**Then** the confirmation prompt is shown with the round count and player count to make the impact clear

**Given** an admin creates a new season
**When** the season settings form is displayed
**Then** the Harvey live toggle defaults to ON (enabled)

**Notes:**
- Cascading delete: season → season_weeks → rounds → groups → scores → results → attendance → pairing_history
- FR70 covered + Harvey default ON

---

## Epic P2.2: Weekly Attendance & Sub Management

Admin can track weekly player attendance incrementally across the week, recruit and manage subs with GHIN auto-lookup, and maintain a season-scoped sub bench — decoupling "who's playing" from "create the round." Players can view the attendance board read-only for instant headcount.

### Story P2.2.1: Weekly Attendance Board

As an admin,
I want an attendance page for each scheduled Friday where I can toggle players in/out as responses come in across the week,
So that I can track attendance incrementally without holding it in my head or re-reading GroupMe.

As a player,
I want to see who's confirmed for this week without scrolling through GroupMe,
So that I know the headcount instantly.

**Acceptance Criteria:**

**Given** a season with a calendar of scheduled Fridays (from P2.1)
**When** any user navigates to the attendance page
**Then** the current or next upcoming Friday is displayed by default with the full league roster
**And** each player shows their in/out status
**And** the confirmed count is displayed (e.g., "14/16 confirmed")

**Given** the attendance page is displayed
**When** an admin toggles a player's status to "in" or "out"
**Then** the status is persisted immediately
**And** the confirmed count updates in real time

**Given** a non-admin user views the attendance page
**When** they view the roster
**Then** they can see all player statuses (read-only)
**And** they cannot toggle any checkboxes

**Given** the attendance page
**When** accessed from the app's main navigation
**Then** it is reachable in one tap from the home screen (top-level nav item)

**Given** the attendance page is loaded on Android Chrome mobile
**When** the admin interacts with player toggles
**Then** all controls are functional with 48px+ touch targets and no horizontal scrolling

**Notes:**
- Schema: `attendance` table — seasonWeekId, playerId, status (in/out/unset), updatedAt
- Attendance is independent of round existence — tracked before round creation
- FR71, FR72, FR73 covered; NFR30 addressed

### Story P2.2.2: Sub Roster & GHIN Lookup

As an admin,
I want to add a sub from the attendance board by searching GHIN, auto-populating their info, and saving them to a season bench,
So that I don't re-enter sub info every time they play and I can quickly see which subs have played the most.

**Acceptance Criteria:**

**Given** an admin is on the attendance board and needs a sub
**When** they click "Add Sub"
**Then** a form appears with a name text input and a GHIN search icon

**Given** the admin types a name and clicks the GHIN search icon
**When** the search returns results
**Then** matching GHIN profiles are displayed (name, GHIN number, handicap index, club)
**And** the admin can select the correct match

**Given** the admin selects a GHIN match
**When** the selection is confirmed
**Then** the sub's GHIN number and current handicap index are auto-populated
**And** the sub is saved to the season's sub bench
**And** the sub is marked as "in" on the current week's attendance board

**Given** a sub who has previously played this season
**When** the admin clicks "Add Sub"
**Then** a dropdown shows existing bench subs with round count (e.g., "Wellman — 3 rounds")
**And** selecting a bench sub auto-refreshes their handicap from GHIN
**And** the sub is marked as "in" on the current week's attendance board

**Given** a sub is on the bench from a previous week
**When** their handicap is refreshed from GHIN
**Then** the updated handicap index is saved to the bench record

**Notes:**
- Schema: `sub_bench` table — seasonId, playerName, ghinNumber, handicapIndex, roundCount, createdAt, updatedAt
- Sub bench is season-scoped; new season = empty bench
- Reuses existing GHIN client (direct API, built in v1)
- FR74, FR75, FR76 covered

---

## Epic P2.3: Round Creation, Groups & Round Management

Admin can create a round directly from the attendance board, get group suggestions with pairing history, publish groups visible to all players with course handicaps and freshness timestamp, swap players after publishing, and benefit from automated Friday handicap refresh. Includes round filtering, cancellation reasons, cancelled round UI cleanup, and pairing re-suggest bug fixes.

### Story P2.3.1: Round Creation from Attendance Board

As an admin,
I want to create a round directly from the attendance board with all confirmed players, tees, and sub flags pre-populated,
So that I don't have to re-enter player selections or round settings manually.

**Acceptance Criteria:**

**Given** the attendance board shows all players confirmed and headcount is a multiple of 4
**When** the admin views the attendance board
**Then** a "Create Round" button is visible and enabled

**Given** the headcount is not a multiple of 4 (e.g., 13 or 15)
**When** the admin views the attendance board
**Then** the "Create Round" button is disabled
**And** a message indicates how many more players are needed (e.g., "1 sub or player needed")

**Given** the admin clicks "Create Round"
**When** the round is created
**Then** all confirmed players are added to the round as round_players
**And** sub bench players are flagged as `is_sub = true`
**And** the tee is set from the season calendar's tee rotation for that week
**And** an entry code is generated for the round
**And** the scheduled date is set to that Friday
**And** the round is created with **no groups assigned yet** — groups are set on the round management screen

**Given** the round is created from attendance
**When** a scorer enters the entry code on Friday
**Then** they can select their group and proceed to scoring as normal (existing v1 flow)

**Notes:**
- Reuses existing round creation API; new endpoint or extension that accepts attendance week reference
- Round creation produces a round with players but no groups — group assignment happens on the round management screen (next story)
- FR78, FR79 covered

### Story P2.3.2: Group Publishing with Course Handicaps

As an admin,
I want to suggest and publish groups that all players can see, with course handicaps from the correct tee and a handicap freshness timestamp,
So that players know their group and course handicap before Friday without needing a Golf Game Book screenshot.

As a player,
I want to see my group assignment and course handicap in the app,
So that I don't have to wait for a GroupMe screenshot or calculate my own course handicap.

**Acceptance Criteria:**

**Given** an admin has created a round from the attendance board
**When** they navigate to the round management screen and click "Suggest Groups"
**Then** the weighted pairing algorithm runs with pairing history counts displayed per suggested group
**And** the admin can accept, modify, or re-suggest groups

**Given** pairing history is displayed per suggested group
**When** the group details are shown
**Then** an expandable section shows all pair combinations within the group with their grouping count (e.g., "Ben + Jeff: 4x, Ben + Josh: 2x")
**And** the default collapsed view shows the highest pair count ("Most paired: Ben + Jeff 4x")

**Given** groups are assigned
**When** the pairings view is displayed (admin or any user)
**Then** each group shows player names with their **course handicap** from the selected tee (not handicap index)
**And** the tee color and round date are displayed
**And** a "Handicaps updated [timestamp]" is shown

**Given** the pairings view is rendered on mobile
**When** there are up to 5 groups (20 players)
**Then** all groups render in a single viewport without scrolling
**And** the layout is screenshot-friendly (clean, high-contrast, all info visible)

**Given** only finalized official rounds are considered for pairing history
**When** pairing counts are calculated
**Then** cancelled, practice, and hidden rounds are excluded

**Notes:**
- Course handicap = calculated from handicap index + course slope/rating per tee
- Pairings view is a new public route (no auth required)
- Manual group manipulation remains available (existing v1 feature) — admin can rearrange groups freely before publishing
- FR77, FR80 covered; NFR31 addressed

### Story P2.3.3: Player Swap in Published Groups

As an admin,
I want to replace a player in a published group with a different player without recreating the round or other groups,
So that last-minute dropouts are handled quickly.

**Acceptance Criteria:**

**Given** groups have been published for a round
**When** a player drops out and the admin needs to replace them
**Then** the admin can select the player to remove from their group
**And** select a replacement from: confirmed attendance players not yet assigned, or bench subs (with "Add Sub" flow if needed)

**Given** a swap is executed
**When** the replacement is confirmed
**Then** the dropped player is removed from the group and marked "out" on the attendance board
**And** the replacement is added to the same group slot
**And** the replacement's sub flag is set correctly
**And** all other groups remain unchanged
**And** the pairings view updates with the new player's course handicap

**Given** the replacement is a new sub not yet on the bench
**When** the admin initiates the swap
**Then** they can use the "Add Sub" GHIN search flow inline before completing the swap

**Notes:**
- FR93 covered

### Story P2.3.4: Handicap Auto-Refresh & Manual Refresh

As an admin,
I want handicaps to auto-refresh from GHIN on Friday morning and to be able to manually trigger a refresh anytime,
So that course handicaps are always current and players don't have to look up their own handicap.

**Acceptance Criteria:**

**Given** a round is scheduled for a Friday with confirmed players
**When** 6:00am ET on that Friday arrives
**Then** the system performs a bulk GHIN refresh for all confirmed players in the round
**And** the "Handicaps updated [timestamp]" on pairings page and leaderboard reflects the refresh time

**Given** the Friday auto-refresh completes successfully
**When** any user views the pairings page or leaderboard
**Then** the "Handicaps updated 6:03am" timestamp is visible

**Given** the Friday auto-refresh fails (GHIN API unavailable)
**When** the admin views the pairings or attendance page
**Then** the stale timestamp is visible (e.g., "Handicaps updated Wed 4:32pm")
**And** a "Refresh Handicaps" manual button is available

**Given** the admin clicks "Refresh Handicaps"
**When** the refresh completes
**Then** all player handicaps are updated from GHIN
**And** the timestamp updates to the current time

**Given** the pairings page is loaded and handicaps are more than 12 hours old
**When** the page loads
**Then** a visual indicator (color/badge) highlights that handicaps may be stale

**Given** ball draw is confirmed for a group (existing v1 flow)
**When** the scorer confirms the ball draw
**Then** handicaps for those 4 players are refreshed from GHIN (existing behavior, unchanged)

**Notes:**
- Scheduled job infrastructure: node-cron or system cron calling internal API endpoint
- Manual refresh button on pairings page and attendance page
- FR81, FR82 covered; NFR32 addressed

### Story P2.3.5: Round Filtering, Cancellation Reasons & UI Cleanup

As an admin,
I want to filter the round list, record why a round was cancelled, and not see ghost groups from cancelled rounds,
So that the admin interface is clean and historical cancellation context is preserved.

**Acceptance Criteria:**

**Given** the admin views the round list
**When** there are cancelled or test rounds
**Then** a filter is available to show/hide cancelled rounds
**And** the default view hides cancelled rounds (or shows them dimmed)

**Given** an admin cancels a round
**When** the cancellation is submitted
**Then** a cancellation reason is required: "Rainout" or "Administrative" (or free text)
**And** the reason is stored and displayed on the round detail view

**Given** a round has been cancelled
**When** the round is viewed in the round list or detail view
**Then** no empty "Group 1 — no players assigned" artifacts are displayed
**And** the round shows its cancellation reason and cancelled status cleanly

**Given** an admin has created groups and then needs to re-suggest after adding subs
**When** the admin clicks "Suggest Groups" again
**Then** the algorithm re-runs with the updated player list
**And** new group suggestions are returned (existing pairing re-suggest bug fixed)

**Given** an admin deletes a group and adds a new one
**When** the admin clicks "Suggest Groups"
**Then** the suggestion works correctly (existing group delete/re-add bug fixed)

**Given** any stats calculation or pairing history count
**When** rounds are aggregated
**Then** cancelled, practice, and hidden rounds are excluded from all calculations

**Notes:**
- Cancellation reason: new column `cancellation_reason` on rounds table (nullable text)
- Round list filter: query param or UI toggle
- Bug fixes: investigate and fix the pairing re-suggest and group delete/add issues
- FR90, FR91, FR92 covered + pairing bugs

---

## Epic P2.4: Historical Data Import & Multi-Season Stats

Historical Excel data (2022-2025) is imported and the stats page is enhanced with head-to-head rivalry drill-downs, narrative headline stats, season picker, per-tee performance, playoff analysis, and per-hole performance — all powered by 4+ years of data. Fully independent of Epics P2.1-P2.3 and can be built in parallel.

### Story P2.4.1: Historical Excel Import — Extraction & Data Model

As a developer,
I want to extract historical season data from 2022-2025 Excel files and import it into the database with correct player name mapping,
So that the stats page has 4 years of historical data on day 1.

**Acceptance Criteria:**

**Given** a final season Excel file (e.g., `Wolf Cup 2025 Final Sheet Season Ended.xlsm`)
**When** the extraction script runs against the standings tab
**Then** it extracts per-round data for each player: gross score, Stableford points, money won/lost, tee color, round date
**And** it extracts Harvey points per round per category (Stableford rank points, money rank points, total Harvey)
**And** player names in column E are read with the 3-row stride pattern (name, Stableford/Harvey, money/Harvey)
**And** round data starts at column CS/CT with 2-column stride per round
**And** tee color is read from row 5
**And** round dates are read from row 2
**And** hidden/rainout columns (e.g., DA/DB area) are detected and skipped

**Given** the extraction script runs against the playoffs tab
**When** playoff data is parsed
**Then** R8 players are extracted from column E with rank from column D
**And** R8 rounds are extracted from columns G/H and I/J (3-row stride + blank row spacing)
**And** R4 players are extracted from column N with rank from column M
**And** R4 rounds are extracted from columns P/Q and R/S
**And** all playoff rounds are tagged as blue tees and playoff round type

**Given** player names differ from the current roster
**When** the import runs
**Then** a name normalization lookup table maps historical names to canonical roster names (e.g., "Moses" → "Jason Moses", "Scotty Pierson" → "Scott Pierson")
**And** any unmatched name halts the import with a clear error for manual resolution

**Given** the import completes for a season
**When** the data is queried
**Then** each imported round is associated with the correct historical season, round date, tee, and round type (regular or playoff)
**And** imported data is read-only (no editing through the admin UI)

**Given** the same import script is run against 2022, 2023, and 2024 Excel files
**When** the extraction runs
**Then** the script handles minor layout differences between years with minimal configuration changes

**Notes:**
- Extends the proven `extract-2025-fixtures.py` pattern (zipfile + xml.etree)
- One-time migration; import script lives in `packages/engine/scripts/`
- Josh reviews each import output for accuracy before final load
- FR88, FR89 covered; NFR34 addressed

### Story P2.4.2: Season Picker & Multi-Season Stats API

As a player,
I want to filter stats by season, multiple seasons, or all-time, and by regular season vs. playoffs,
So that I can compare performance across different years and contexts.

**Acceptance Criteria:**

**Given** the stats page is loaded
**When** the season picker is displayed
**Then** it shows pill-style buttons for each available season (2022, 2023, 2024, 2025, 2026) plus "All Time"
**And** a round type filter is shown: "All", "Regular", "Playoffs"

**Given** a user selects one or more seasons
**When** the stats data loads
**Then** all stats on the page reflect only the selected season(s)
**And** selecting multiple seasons aggregates data across those years

**Given** a user selects "Playoffs" round type filter
**When** the stats load
**Then** only playoff round data is included in all calculations

**Given** any stats API endpoint (existing or new)
**When** called with an optional `seasonId` parameter (or array of season IDs)
**Then** results are filtered to those seasons
**And** when `seasonId` is null or omitted, results aggregate across all seasons

**Given** the stats page is loaded with no filter selection
**When** the default view is displayed
**Then** the current season (2026) is selected by default

**Notes:**
- All existing stats endpoints updated to accept `seasonId?` and `roundType?` query params
- FR85 covered; NFR33 addressed

### Story P2.4.3: Head-to-Head Rivalry Drill-Down

As a player,
I want to pick any player and see everyone they've been grouped with, then tap a name to see a rivalry card with key matchup stats,
So that I can see my head-to-head history and talk trash with data.

**Acceptance Criteria:**

**Given** a user navigates to the head-to-head stats section
**When** they select a player (or themselves)
**Then** a list of every other player they've been grouped with (2026+) or played in the same league week (2022-2025) is displayed
**And** the list is sorted by number of rounds together (most to least)
**And** the list respects the current season picker / round type filter

**Given** a user taps a player name in the list
**When** the rivalry card expands
**Then** it shows: rounds together, money when grouped together (both players' money in shared rounds — not "against you"), Harvey finish comparison (how many times you finished higher vs. them), and wolf record against them (2026+ only, when both in same group)

**Given** the rivalry card is displayed for pre-2026 data
**When** group-level stats are not available
**Then** the card clearly indicates "League-wide stats — group history available from 2026"
**And** money and Harvey comparison use league-wide round data (both played that week, not necessarily same group)

**Given** only cancelled, practice, or hidden rounds exist between two players
**When** the rivalry card is displayed
**Then** those rounds are excluded from all calculations

**Notes:**
- API: `GET /api/stats/head-to-head/:playerId` returns all rivalries with optional seasonId filter
- Money labeled as "When grouped together" — correlation, not direct confrontation
- Wolf record is the premium head-to-head stat (direct 1v1 context)
- FR83 covered

### Story P2.4.4: Narrative Headline Stats

As a player,
I want each rivalry card to feature a compelling headline stat that captures the story of the matchup,
So that the stats are fun, shareable, and create trash-talk moments.

**Acceptance Criteria:**

**Given** a rivalry card is displayed with sufficient data
**When** the headline stat is generated
**Then** the system selects the single most extreme or interesting stat from the rivalry and displays it as a narrative headline

**Given** the following stat categories are evaluated with minimum sample size gates
**When** ranking which is "most interesting"
**Then** the system uses this priority (most extreme wins, only fires if threshold met):
1. Money dominance (>$20 differential, 5+ shared rounds): "Jay runs hot when you're around: +$31 to your -$23"
2. Undefeated wolf record (4+ shared rounds): "Moses has never lost a wolf hole against you"
3. Playoff record (one player dominates, 3+ playoff rounds together): "You've never beaten Bonner in playoffs"
4. Tee dominance (>2.0 Stableford differential, 3+ rounds on that tee): "Ronnie averages +4.2 from the blues vs. your +1.1"
5. Close rivalry (within $5 lifetime, 5+ shared rounds): "Dead even: within $3 across 8 rounds"
6. Default (below all thresholds): "12 rounds together" (just the count)

**Given** a rivalry has fewer than 3 shared rounds
**When** the headline is generated
**Then** it uses the default "X rounds together" (not enough data for a meaningful narrative)

**Given** a player screenshots the rivalry card
**When** the screenshot is taken on mobile
**Then** the headline, key stats, and player names are all visible in a clean, shareable format

**Notes:**
- Headline generation is a pure function: takes rivalry stats object, returns headline string
- Lives in engine package for testability
- Wolf record is the premium head-to-head stat — it's direct confrontation, not correlation
- FR84 covered

### Story P2.4.5: Per-Tee Performance & Playoff Analysis

As a player,
I want to see how I perform from different tees and in playoffs vs. regular season,
So that I can understand my game better and see who chokes under pressure.

**Acceptance Criteria:**

**Given** a player's stats card is displayed
**When** per-tee performance is shown
**Then** it displays average Stableford points broken down by tee color (blue, black, white)
**And** shows differential from expected (positive = better than handicap, negative = worse)
**And** includes round count per tee for context
**And** respects the season picker filter

**Given** a player has playoff round data (from 2022-2025 import or 2026+)
**When** playoff analysis is shown
**Then** it displays: number of playoff appearances, Final Four appearances, best playoff finish
**And** regular season average Harvey points vs. playoff average Harvey points
**And** a clear comparison label (e.g., "Season avg: 12.4 pts → Playoffs avg: 8.1 pts")

**Given** a player has never made the playoffs
**When** playoff analysis is shown
**Then** it displays "No playoff appearances" with their best regular season finish

**Given** historical data is imported (2022-2025)
**When** per-tee and playoff stats are calculated
**Then** they include historical data based on the season picker selection

**Notes:**
- Per-tee: group round_results by rounds.tee, average Stableford
- Playoff: filter by round type, compare averages
- FR86, FR87 covered

### Story P2.4.6: Public Pairing History Page

As a league member,
I want to see a pairing history page accessible from standings showing how many times each player has been grouped with every other player,
So that I can see the algorithm is fair and no one is getting preferential pairings.

**Acceptance Criteria:**

**Given** a user navigates to the pairing history page (linked from standings/stats navigation)
**When** the page loads
**Then** the user can select a player (or default to viewing all)
**And** for the selected player, a list shows every other player with their grouping count
**And** sorted by count descending

**Given** the season picker is active
**When** a user selects a different season or "All Time"
**Then** the pairing counts reflect only the selected season(s)

**Given** pairing history data exists for 2026 (from finalized official rounds only)
**When** the page displays counts
**Then** cancelled, practice, and hidden rounds are excluded from all counts

**Given** historical data from 2022-2025 does not include group-level pairings
**When** a user views pre-2026 seasons
**Then** the pairing history page shows "Group-level pairing data available from 2026 season"

**Notes:**
- Public route (no auth required), same as standings
- Reuses existing pairing_history table data + public API endpoint
- Trust/transparency feature — proves the algorithm is fair

### Story P2.4.7: Per-Hole Performance Analysis

As a player,
I want to see my average score relative to par on every hole, broken down by par type, with my best and worst holes identified,
So that I can understand my game and know where to focus improvement.

**Acceptance Criteria:**

**Given** a player has at least 1 finalized official round in 2026+
**When** they view their per-hole stats section
**Then** it displays average score relative to par for each of the 18 holes
**And** identifies their best hole (lowest avg to par) and worst hole (highest avg to par)
**And** includes round count for context ("Based on X rounds")

**Given** per-hole data is displayed
**When** the par type breakdown is shown
**Then** it shows average score relative to par grouped by par 3s, par 4s, and par 5s
**And** identifies which par type is their strongest and weakest

**Given** a player has no 2026+ rounds
**When** they view the per-hole section
**Then** it shows "Hole-by-hole analysis available after your first 2026 round"

**Given** only historical data (2022-2025) exists for a player
**When** they view per-hole stats
**Then** hole-by-hole is not shown (historical import does not include per-hole data)
**And** the section clearly states this limitation

**Given** the season picker is set to a specific season or All Time
**When** per-hole stats are calculated
**Then** only 2026+ finalized official rounds matching the filter are included
**And** cancelled, practice, and hidden rounds are excluded

**Notes:**
- Data source: `hole_scores` (gross) + `course` (par per hole)
- API: `GET /api/stats/per-hole/:playerId?seasonId=`
- 2026+ only — no historical per-hole data exists
- Active after first finalized round
