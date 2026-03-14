---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: complete
completedAt: 2026-03-14
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - 'git log (40 recent commits — features built outside original planning)'
  - 'reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm'
date: 2026-03-14
author: Josh
---

# Product Brief: Wolf-Cup

## Executive Summary

Wolf Cup v1 is live at `wolf.dagle.cloud` — the scoring engine, live leaderboard, admin panel, score corrections, GHIN integration, weighted pairings, and AssTV branding are all built and deployed. The 2026 season opens in approximately 6 weeks.

This product brief covers a **Phase 2 enhancement package** targeting three areas: the commissioner's pre-round workflow, season management, and a stats experience powered by four years of historical data.

**The core insight:** The current app requires Commissioner Jason to do everything at round creation time, but his real workflow starts days earlier when players respond "in" or "out" over GroupMe. Attendance tracking, sub recruitment, and tee/group decisions happen across Monday–Friday, not in a single admin session. The app needs to model that cadence.

**The stats opportunity:** Four years of Excel data (2022–2025) with per-week Stableford, money, Harvey points, tee color, and playoff results are available for import. Combined with 2026 live data, the app can launch with a rich historical stats experience — head-to-head rivalry cards, multi-season comparisons, per-tee performance, and playoff analysis. This transforms the stats page from empty-on-day-1 to a launch feature for the kickoff dinner.

All changes must ship before opening day 2026 (~early-mid May).

---

## Core Vision

### Problem Statement

Commissioner Jason's weekly workflow spans Monday through Friday — players trickle in responses over 1-2 days via GroupMe, subs need to be found and verified, and the final headcount isn't known until hours before tee time. The current app forces all of this into a single "Create Round" action, requiring Jason to either hold everything in his head or make multiple trips to a buried admin screen. Season setup requires manually counting Fridays and entering a playoff format that never changes. Test seasons and cancelled rounds clutter the interface with no way to clean up. Pairings exist but lack transparency — Jason and the league can't see who's played with whom.

Meanwhile, the stats page — the feature players are most excited about — has no historical context. The league has three years of rich data locked in Excel spreadsheets that could power rivalry stats, tee performance breakdowns, and playoff narratives from day 1.

### Problem Impact

- **Daily friction:** Jason can't incrementally mark players as they confirm — he has to batch everything at the end, risking missed responses
- **Sub recruitment bottleneck:** Adding a sub requires manual handicap entry when GHIN lookup could auto-populate; no persistent sub bench means re-entering the same sub's info each time they play
- **Season setup tedium:** Manually counting Fridays between two dates, entering an unchanging playoff format, no ability to delete test data
- **Tee rotation complexity:** The app doesn't understand the difference between a rainout (tees rotate) and a skipped week like member-guest (tees hold) — this logic lives in Jason's head
- **Cancelled round artifacts:** Empty groups from cancelled rounds remain visible; no way to record why a round was cancelled (rainout vs. administrative error) or filter them out
- **Pairing opacity:** Players and Jason have to trust the algorithm without seeing the who-played-with-who matrix
- **Empty stats page:** Four years of league history exist in Excel but aren't accessible in the app; the stats page starts at zero on opening day without an import

### Why Existing Solutions Fall Short

The current Wolf Cup app solves the *during-round* and *post-round* problems excellently — live scoring, leaderboard, score corrections, standings all work. But the *pre-round* workflow (Monday through Friday before tee time) is still largely manual and mental. The attendance-to-round pipeline doesn't exist as a first-class flow. And the stats experience, while functional for 2026 data, can't tap into the league's rich history.

### Proposed Solution

**1. Pre-Round Attendance System (flip the workflow)**

- **Season calendar:** Enter start/end dates, auto-calculate Fridays, unselect off-weeks (member-guest, club tournaments). Calendar is editable mid-season. Drives tee rotation logic — skipped weeks (club events) hold tees; rainouts still rotate. Playoff format defaults to the standard (stop asking).
- **Weekly attendance board:** Each scheduled Friday gets its own attendance page. Visible to all players (read-only); admin controls checkboxes. Jason marks players in/out as responses come in across the week. Shows "14/16 confirmed" progress. Accessible from top-level navigation — one tap, not buried.
- **Sub roster & GHIN lookup:** "Add Sub" button on attendance board. Jason types a name, searches GHIN, picks the correct match, handicap and GHIN number auto-populate and save. Sub is saved to a season-scoped bench. Next time they sub, they appear in a dropdown with round count ("Wellman — 3 rounds"). Handicap auto-refreshes from GHIN on each appearance.
- **Round creation from attendance:** Once headcount is a multiple of 4 and all spots filled, Jason creates the round directly from the attendance board. Player selections, tees, and sub flags carry over. Group suggestions fire from there. System enforces multiples of 4 — Wolf requires exactly 4 per group, always.

**2. Season & Round Management Improvements**

- **Season delete:** Clean up test seasons (e.g., the "Mar 1 2026 to Mar 1 2026" test)
- **Round filtering:** Filter or hide cancelled/test rounds from the round list
- **Cancellation reasons:** Record why a round was cancelled (rainout vs. administrative error) — rainouts are historically relevant, mistakes should be filterable
- **Cancelled round UI cleanup:** Fix bug where cancelled rounds still show empty "Group 1 — no players assigned"
- **Pairing re-suggest bugs:** Fix issues where adding subs and re-suggesting doesn't work, and deleting/re-adding groups breaks auto-suggest
- **Sensible defaults:** Harvey live ON by default for 2026, playoff format pre-filled

**3. Head-to-Head Rivalry Stats & Historical Data**

- **Historical Excel import (2022–2025):** Python extraction script parses standings and playoffs tabs from each year's final Excel sheet. Per-week data: player name, gross score, Stableford points, money won/lost, Harvey points (Stableford + money categories), tee color, round date. Playoff data: R8 and R4 results, advancement, final standings. Player name normalization handled via lookup table (e.g., "Moses" → "Jason Moses", "Scotty" → "Scott").
- **Head-to-head rivalry drill-down (mobile):** Player-centric design — pick your name, see everyone you've been grouped with (2026+) or played in the same league week (2022–2025), sorted by most rounds together. Tap any name to expand rivalry card: rounds together, money differential, wolf record (2026+), Harvey finish comparison. Clean distinction: "Group history available from 2026. Earlier seasons show league-wide stats."
- **Pairing grid (desktop):** Full N×N matrix for Jason's pairing review — color-coded cells by frequency. Desktop-only; mobile uses the drill-down.
- **Season picker:** Pill-style filter — `[ 2022 | 2023 | 2024 | 2025 | 2026 | All Time ]` + `[ All | Regular | Playoffs ]`. Multi-select for years, single-select for round type. Present from day 1 (non-interactive until multiple seasons exist becomes interactive immediately with imported data).
- **Per-tee performance:** Player stats card shows average Stableford differential from handicap broken down by tee color (blue/black/white). Available from 2022 with imported tee data.
- **Playoff analysis:** Season average vs. playoff average comparison. Playoff appearance history, Final Four appearances, best playoff finish. "Ronnie chokes in playoffs" as a real, data-backed stat.
- **Architecture:** All stats API endpoints accept optional `seasonId` parameter. If null, aggregates across all seasons. Multi-season is free at the API layer from day 1.

### Key Differentiators

- **Workflow-first design:** The app models Jason's actual weekly cadence (Monday–Friday attendance trickle), not an idealized single-session admin flow
- **Smart sub management:** GHIN lookup + persistent sub bench eliminates re-entry; round count helps Jason pick the most engaged sub
- **Calendar-driven seasons:** Tee rotation, round count, and off-week handling are derived from the calendar — not manually tracked
- **Four years of history on day 1:** The stats page launches with 2022–2025 data already loaded — rivalries, tee performance, playoff narratives are real from the kickoff dinner
- **Builds on proven foundation:** All v1 infrastructure (engine, API, pairing algorithm, GHIN client, extraction scripts) is reused; this is UX, workflow, and data layered on top

## Target Users

### Primary Users

**Commissioner Jason — Weekly Operations Manager**

Jason runs the league's week-to-week operations. His workflow starts Monday when he posts to GroupMe asking who's in, and doesn't end until Friday when the round is created with groups assigned. Today he tracks responses mentally, recruits subs via text, and enters everything into the app in a single session. Phase 2 gives him a persistent attendance board that mirrors his real cadence, a sub bench with GHIN auto-lookup, and a calendar-driven season that handles tee rotation and off-weeks automatically. He makes pairings from his laptop — the desktop pairing grid with who-played-with-who history gives him transparency and accountability. Sub recruitment is exclusively Jason's responsibility (escalating to Josh if his list is exhausted — which has almost never happened).

The pairings view replaces Golf Game Book screenshots entirely. When Jason publishes groups, the app shows each group with **course handicaps from the selected tee** (not index — players need "I'm getting 16 strokes today," not "my index is 14.1"). Screenshot-friendly layout: all groups visible in one viewport, date, tee color, course handicaps, "Handicaps updated [timestamp]." Jason screenshots and pastes to GroupMe for non-app users — the screenshot from Wolf Cup looks better than Golf Game Book.

**Handicap freshness:** Two-touch GHIN refresh ensures course handicaps are current. (1) **Friday morning auto-refresh (6am ET):** Bulk refresh all confirmed players from GHIN — eliminates the "what's your handicap?" parking lot conversations. (2) **Ball draw confirm:** Already built in v1 — final lock before scoring begins. Catches any last-minute GHIN updates.

*Success moment:* It's Wednesday, 12 of 16 confirmed. Jason opens the attendance board, marks two more players in from today's GroupMe replies, sees "14/16 — 2 subs needed." Clicks Add Sub, searches GHIN for Wellman, auto-populates handicap. Wellman's in. Thursday all 16 confirmed — Jason creates the round, suggests groups, screenshots the pairings with course handicaps, posts to GroupMe. Done before Friday.

**League Players (Josh, Patterson, Bonner, etc.) — Competitors & Stats Consumers**

The 17-20 active league members who play weekly. The attendance board is potentially the **most frequently visited page during the week** — it replaces the GroupMe counting problem that 12+ players experience every Monday through Friday ("Is that 13 or 14?" "Who's keeping count?"). Players check it for instant headcount and to see who's confirmed without scrolling through chat. Read-only — only Jason controls checkboxes. Once groups are published, players see their group assignment and course handicaps in the app immediately.

During and after the season, they browse the stats page — head-to-head rivalry cards, per-tee performance, playoff history, multi-season comparisons. A few players will dive deep on day 1; engagement grows as data accumulates and rivalries develop narrative weight.

**Two-tier adoption model:** Not everyone will install the app — some older members will rely entirely on Jason's GroupMe screenshots. The app doesn't require 100% adoption to deliver full value. Jason uses the app as system of record; GroupMe-only players get the same information secondhand via screenshots. The pairings view is designed to be screenshot-friendly (all groups in one viewport, course handicaps, clean layout) so Jason's GroupMe posts are *better* than what Golf Game Book produced.

| Tier | Users | Experience |
|------|-------|-----------|
| App users (~60-70%) | Younger players, stats enthusiasts, engaged members | Full experience — attendance board, stats, leaderboard, group assignments |
| GroupMe-only (~30-40%) | Older members, less tech-engaged | Same info via Jason's screenshots — pairings, handicaps, entry code |

*Success moment:* It's Thursday night. Josh opens the app, sees "16/16 confirmed" on the attendance board — doesn't need to scroll through 40 GroupMe messages. Groups are already posted — he can see he's with Patterson, Moses, and Bonner, playing from the blues, and his course handicap is 16. After Round 4, he taps into Stats, pulls up his head-to-head with Patterson — "Played together 3 times, Patterson leads money +$14." Screenshots it. Trash talk ensues.

### Secondary Users

**Remote Spectators & Occasional Viewers**

Same as v1 — no-auth access to leaderboard and standings. Phase 2 adds the stats page and historical data as additional public content. Low priority but gets the content for free since the stats page is public.

### User Journey — Phase 2 Features

**Kickoff Dinner (Pre-Season Onboarding):**
Jason pulls up the app at the season kickoff dinner. Four years of historical stats are loaded — "All Time" head-to-head rivalries, playoff records, per-tee performance. Players install the PWA on the spot. The stats page sells the app before anyone tees off.

**Pre-Season Setup (Jason):**
1. Creates season → enters start/end dates → app auto-calculates Fridays → unchecks member-guest weekend → confirms 17 rounds
2. Tee rotation auto-assigned based on calendar (blue → black → white cycle, skipped weeks hold tees, rainouts still rotate)
3. Playoff format pre-filled (standard, never changes)

**Weekly Cycle (Monday–Friday):**
1. Monday: Jason posts to GroupMe. Opens attendance board — "0/16 confirmed"
2. Mon–Thu: As responses come in, Jason toggles players. Players check attendance page for instant headcount
3. Sub needed: Jason clicks "Add Sub," searches GHIN, picks the match, handicap auto-populates, sub saved to season bench with round count
4. All confirmed (could be as early as Wednesday): Jason taps "Create Round" — players, tees, sub flags carry over. Suggests groups with pairing history visible. Publishes groups. **Players see their group assignment and course handicaps in the app immediately** — replaces Golf Game Book screenshots
5. Jason posts entry code to GroupMe. Screenshots pairings with course handicaps for non-app users
6. Friday 6am: Auto-refresh handicaps from GHIN for all confirmed players
7. Friday: Round is live, groups set, handicaps current. Ball draw confirm does final GHIN refresh per group

**In-Season Stats (Players):**
1. Historical data (2022–2025) powers rivalry cards, tee breakdowns, and playoff analysis from day 1
2. 2026 group-level rivalry stats and wolf records build weekly
3. Season picker: single year, multi-year, or All Time. Regular vs. Playoffs filter

### Future Vision (Out of Scope — Day 1)

- **Player self-check-in:** Lightweight RSVP via shareable link or entry code — players mark themselves in/out without Jason
- **Push notification RSVP:** App sends weekly "Are you in?" notification, auto-updates attendance board
- **Player availability calendar:** Players pre-mark vacation weeks at season start

These require player identity/authentication infrastructure that doesn't exist for non-admin users today. Captured for future consideration, not opening day.

## Success Metrics

### User Success — Commissioner Jason

- **Attendance board adoption:** Jason uses the app's attendance board as his primary weekly tracking tool for the full 2026 season — not a mental list, not a notepad, not re-reading GroupMe
- **Zero manual handicap entry:** All handicaps pulled from GHIN via search or Friday morning auto-refresh. No more "what's your handicap?" conversations in the parking lot
- **Golf Game Book eliminated:** App is the sole source for pairings. Jason screenshots from the app, not Game Book. One less tool in his weekly stack
- **Sub management streamlined:** Returning subs appear in dropdown with round count and pre-populated GHIN data — no re-entering info for someone who's subbed before
- **Season setup is a one-time event:** Create season, set date range, auto-calculate Fridays, uncheck known off-weeks, done. No manual Friday counting, no re-entering playoff format
- **Time-to-groups:** Once all players confirmed, Jason goes from "everyone's in" to "round created, groups suggested, pairings posted to GroupMe" in minutes — down from 15-30 minutes of Game Book fiddling, GHIN lookups, and manual entry

### User Success — League Players

- **Instant headcount:** Any player can check the attendance page and know how many are confirmed within 2 seconds — no scrolling through GroupMe
- **Group assignments visible in-app:** Players see their group, course handicap from the correct tee, and who they're playing with — before Friday, no screenshot needed (though Jason still posts one for the non-app crowd)
- **Stats create moments:** Players screenshot rivalry cards with **narrative headline stats** ("Patterson owns you: +$47 lifetime", "You've never beaten Moses in playoffs") and share them in GroupMe. The stat that gets shared tells a story, not just a number
- **Four years of history on day 1:** The kickoff dinner demo with 2022–2025 data loaded gets players to install the PWA on the spot

### Technical Success

- **Historical import complete:** All 4 seasons (2022–2025) imported with correct player mapping, per-week Stableford/money/Harvey, tees, and playoff results
- **Friday handicap auto-refresh with visible confirmation:** 6am GHIN bulk refresh runs reliably every scheduled round day. "Handicaps updated 6:03am" timestamp visible on both the **pairings page** and the **leaderboard** — Jason sees it worked, players see the data is fresh. Ball draw confirm refresh continues working as built
- **GHIN refresh failure visibility:** If the Friday auto-refresh fails, Jason is aware and can manually trigger a refresh before tee time
- **Pairing bugs resolved:** Re-suggest works after adding subs or modifying groups. Deleting/re-adding groups doesn't break auto-suggest
- **Cancelled round cleanup:** No visual artifacts from cancelled rounds. Cancellation reason recorded (rainout vs. administrative)
- **Season calendar drives tee rotation:** Skipped weeks (club events) hold tees. Rainouts rotate. Tee assignments are correct without Jason tracking manually
- **Screenshot-friendly pairings:** All groups render in one mobile viewport with course handicaps, tee, date, and handicap freshness timestamp

### Business Objectives

This is a private league app with no revenue model — "business success" means **the app becomes the system of record and Jason's life gets easier.** Specifically:

- Wolf Cup app fully replaces Golf Game Book for the 2026 season (pairings, scoring, standings)
- Jason's weekly overhead drops from the current multi-tool, multi-step process to a single app workflow
- The stats page becomes a source of league culture and engagement — rivalries, records, and playoff narratives live in the app, not in scattered Excel files or memory
- **Full season lifecycle test:** The app survives at least one off-week (member-guest), at least one sub joining the bench mid-season, a rainout with correct tee rotation, AND playoff rounds with correct multipliers and tee assignments (always blue)

### Key Performance Indicators

| KPI | Target | Measurement |
|-----|--------|-------------|
| Attendance board usage | Every round in 2026 | Jason confirms he used it vs. mental tracking |
| Manual handicap entries | Zero | No manual HI entry needed after GHIN search/auto-refresh |
| Golf Game Book dependency | Eliminated | Jason confirms he no longer uses Game Book for pairings |
| Historical data imported | 4 seasons (2022–2025) | All seasons loaded, spot-checked by Josh for accuracy |
| Stats page engagement | Players share screenshots | Organic GroupMe shares of rivalry cards with narrative headlines |
| Pairing transparency | Visible to Jason | Who-played-with-who counts shown during group suggestion |
| PWA installs | Majority of active players | Observed at kickoff dinner or by Round 2 |
| GHIN auto-refresh reliability | 100% of scheduled Fridays | "Handicaps updated" timestamp visible on pairings + leaderboard |
| Time-to-groups | Under 5 minutes | Jason's felt experience from "all confirmed" to "groups posted" |
| Season lifecycle survival | Full season | Handles off-week, sub join, rainout, and playoffs correctly |

## MVP Scope

*Note: "MVP" in this context means "Phase 2 opening day" — the minimum feature set that ships before the first 2026 round. The v1 app is already live and functional.*

### Core Features (Opening Day)

**1. Season Calendar & Setup**
- Enter start/end date → auto-calculate Fridays between those dates
- Display calendar of Fridays with ability to uncheck off-weeks (member-guest, club tournaments)
- Auto-count total rounds from remaining checked Fridays
- Tee rotation auto-assigned per calendar (blue → black → white cycle)
- Skipped weeks (unchecked) hold tee rotation; rainout/cancelled rounds still rotate
- Calendar editable mid-season (uncheck newly discovered off-weeks)
- Playoff format pre-filled with standard format (not asked each time)
- Season delete for cleanup of test seasons

**2. Weekly Attendance Board**
- Each scheduled Friday gets its own attendance page
- Accessible from top-level navigation (one tap from home)
- Visible to all users (read-only); admin toggles player checkboxes
- Shows progress: "14/16 confirmed" with player list
- Admin can toggle players in/out incrementally as responses trickle in across the week
- "Add Sub" button for sub recruitment directly from attendance board

**3. Sub Roster & GHIN Integration**
- "Add Sub" flow: type name → search GHIN → pick correct match → auto-populate GHIN number + handicap index
- Sub saved to season-scoped bench on first use
- Returning subs appear in dropdown with round count ("Wellman — 3 rounds")
- Handicap auto-refreshes from GHIN on each appearance
- Sub bench persists for the season; if same person subs in 2027, new bench entry (season-scoped)

**4. Round Creation from Attendance**
- "Create Round" button on attendance board (available when headcount is a multiple of 4)
- System enforces multiples of 4 — cannot create with 13, 15, etc.
- Pre-populates round with confirmed players, tees from calendar, sub flags
- Group suggestions fire from round creation with pairing history counts visible
- Published groups visible to all players in-app (course handicaps from selected tee, not index)
- Screenshot-friendly pairings layout: all groups in one viewport, date, tee, course handicaps, "Handicaps updated [timestamp]"
- Admin flows (attendance, round creation, group suggestions) designed mobile-friendly — Jason shouldn't need to be at his desktop (Android Chrome primary)

**5. Handicap Auto-Refresh**
- Friday 6am ET: Bulk GHIN refresh for all confirmed players in that day's scheduled round
- "Handicaps updated [timestamp]" visible on pairings page AND leaderboard
- Failure visibility: admin aware if refresh failed, can manually trigger
- Ball draw confirm refresh continues working (already built in v1)

**6. Head-to-Head Rivalry Stats**
- Player-centric drill-down (mobile): pick a player → see everyone they've played with, sorted by frequency
- Tap any name → rivalry card: rounds together, money differential, Harvey finish comparison, wolf record (2026+ only for group-level data)
- Narrative headline stat on each rivalry card — logic picks the most interesting stat and frames it as a story:
  - Money dominance: "Patterson owns you: +$47 lifetime"
  - Undefeated: "Undefeated: Moses is 5-0 against you"
  - Playoff record: "You've never beaten Bonner in playoffs"
  - Tee dominance: "Ronnie averages +4.2 Stableford from the blues vs. your +1.1"
  - Close rivalry: "Dead even: you're within $3 lifetime across 8 rounds"
- 2022–2025 data: league-wide stats (both played that week). 2026+: group-level stats
- Season picker: pill-style `[ 2022 | 2023 | 2024 | 2025 | 2026 | All Time ]` + `[ All | Regular | Playoffs ]`
- Per-tee performance on player stats card (avg Stableford differential by tee color)
- Playoff analysis: season avg vs. playoff avg, playoff appearances, Final Four history, best finish

**7. Historical Excel Import (2022–2025)**
- Python extraction script for each year's final Excel sheet
- Standings tab: per-week gross score, Stableford points, money won/lost, Harvey points (Stableford + money categories), tee color, round date
- Playoffs tab: R8 and R4 results (different layout — 3-row stride with blank row spacing, different column offsets), advancement, final standings
- Player name normalization via lookup table ("Moses" → "Jason Moses", "Scotty Pierson" → "Scott Pierson")
- All playoff rounds tagged as blue tees
- Hidden/rainout columns (DA/DB area) skipped

**8. Round Management Improvements**
- Round filtering: filter or hide cancelled/test rounds from round list
- Cancellation reasons: rainout vs. administrative error
- Cancelled round UI cleanup: fix bug where empty "Group 1 — no players assigned" shows after cancellation
- Pairing re-suggest bugs: fix re-suggest after adding subs, fix broken suggest after deleting/re-adding groups
- Harvey live toggle defaults ON for 2026

### Build Priority & Critical Path

| Priority | Work Stream | Timeline | Dependencies |
|----------|-------------|----------|-------------|
| **P0 — Critical Path** | Season Calendar → Attendance Board → Sub Roster → Round Creation from Attendance | Weeks 1–4 | Sequential chain; must ship for opening day |
| **P0 — Parallel** | Historical Excel Import (data migration) | Weeks 1–3 | Independent; enables stats on day 1 |
| **P1 — Parallel** | Head-to-Head Stats, Rivalry Cards, Season Picker, Per-Tee, Playoffs, Narrative Headlines | Weeks 3–6 | Depends on import data being available |
| **P1 — Throughout** | Bug fixes (pairing re-suggest, cancelled round UI), round filtering, handicap auto-refresh, sensible defaults | Weeks 1–6 | Independent; can be interleaved |

### Out of Scope (Opening Day)

| Feature | Reason | When |
|---------|--------|------|
| Pairing grid (desktop N×N matrix) | Mobile drill-down + suggestion counts cover the need; grid more valuable mid-season with data | Mid-season |
| Player self-check-in (RSVP) | Requires player auth infrastructure | Future |
| Push notification RSVP | Requires push infrastructure + player accounts | Future |
| Player availability calendar | Feature creep — solves 2-3 occurrences/season/player | Future |
| GroupMe integration / webhook | Parsing free-text is unreliable; manual attendance is sufficient | Future / Never |
| Golf Game Book data import | Marginal value over Excel import; scope explosion | Never |
| Hole-by-hole historical data (2022–2025) | Not in Excel; would require Game Book scraping | Never |
| Wolf partner decisions for historical data | Not in Excel; only available 2026+ | N/A |
| Side game historical stats | "No one really cares about the side games that much" | Never |
| Native app store distribution | PWA is sufficient for ~25 users | Future |

### MVP Success Criteria

Phase 2 is successful when:

1. **Jason's workflow is flipped:** Attendance board → round creation is the standard weekly flow for the full 2026 season
2. **Golf Game Book eliminated:** Jason no longer uses Game Book for pairings — app is the sole source
3. **Stats page has depth:** 4 years of historical data loaded; at least one rivalry card screenshot shared in GroupMe organically
4. **Season lifecycle complete:** The app handles at least one off-week, one sub bench addition, one rainout with correct tee rotation, and playoff rounds
5. **Handicaps are always fresh:** Friday auto-refresh works reliably; no "what's your handicap?" conversations on the first tee

### Future Vision

- **Pairing grid (desktop):** Full N×N who-played-with-who matrix, color-coded by frequency — ships mid-season when data is interesting
- **Player self-service RSVP:** Lightweight check-in without full auth (shareable link or entry code identity)
- **Push notifications:** Weekly "Are you in?" with one-tap response
- **Playoff scenario calculator:** "Who's still in it?" — auto-calculate contention paths based on standings
- **Video/photo gallery:** AssTV content archive integrated into the app
- **Course lookup:** Search and download scorecard for any course — enables casual rounds at other venues
- **Historical season archive UI:** Browse 2022–2025 round-by-round results in the app (data is imported, but no dedicated browse UI in Phase 2 — stats page surfaces it through aggregations)
