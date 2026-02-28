---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish']
classification:
  projectType: web_app_pwa
  domain: general_sports_recreation
  complexity: medium
  projectContext: greenfield
inputDocuments:
  - 'inline-project-brief (provided in session)'
  - 'reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm'
  - 'reference/scorecards/Wolf golf score card 24AB 2.pdf'
  - 'C:/Users/jstoll/OneDrive - Richwood Industries/Documents/wolf rules.pptx'
  - 'C:/Users/jstoll/OneDrive - Richwood Industries/Documents/Wolf 6-20-2025.png'
  - 'reference/videos/AssTV branding assets'
  - 'reference/videos/Final Videos/ (2024 production + 2025 drone/match footage)'
briefCount: 1
researchCount: 0
brainstormingCount: 0
projectDocsCount: 6
workflowType: 'prd'
---

# Product Requirements Document - Wolf-Cup

**Author:** Josh
**Date:** 2026-02-27

## Executive Summary

The Wolf Cup is a private golf league of up to 20 players that plays weekly on Fridays during an ~18-week summer season at Guyan Golf and Country Club (Huntington, WV). For three years, post-round scoring has meant Commissioner Jason manually entering results into Excel on Sunday, with year-to-date standings distributed to players via GroupMe on Monday — a 48-hour delay that serves no one. The Wolf Cup PWA eliminates that delay: live Stableford and money scoring during the round, a strategic leaderboard visible to all players on their phones in real time, and season standings always current.

The app replaces Golf Game Pass, which cannot correctly implement the Wolf Cup's Harvey Cup scoring system — rank-based points awarded separately for Stableford and money performance each week, with variable point pools by player count, half-point tie splits, best-10-of-season totals, and a two-stage playoff multiplier system. Correct scoring is non-negotiable.

The app deploys to `wolf.dagle.cloud` as a Progressive Web App installable on iPhone via Safari home screen. Season standings and the live round leaderboard are publicly accessible — no login required. A weekly score-entry code distributed by Jason each Monday restricts score entry only; one scorer per group uses it during the round. Remote spectators can follow live from anywhere with just the URL.

### What Makes This Special

The Wolf Cup app is not a generic golf scoring utility — it is the next evolution of AssTV (Appalachian Sports Station TV), the league's homegrown sports production brand. AssTV has escalated each year: one camera, then live drone footage and gimbals, then on-course reporting and player interviews. The app applies that same ambition to the product layer — giving the league its own infrastructure for the first time: correct scoring, live strategic information, a season-long narrative in one place, and a permanent home for the AssTV video archive.

The live leaderboard is the strategic nerve center of the game. Knowing you're 2 Harvey points behind 3rd vs. 10 points behind changes how aggressively a player calls wolf, pursues skins, or plays defense. That real-time decision support is what no third-party app can replicate — they don't know these rules.

*Jeff Madden — Executive Producer / Creative Director, AssTV. The creative force behind the league's production identity.*

### Project Classification

- **Type:** Progressive Web App — mobile-first React frontend, installable via Safari, no app store
- **Domain:** Sports / Recreation — private league, no regulatory requirements, ~25 users
- **Complexity:** Medium — greenfield, but the Harvey Cup scoring engine (variable player counts, dual rank-based scoring, half-point tie splits, best-10-of-N, two-tier playoff multipliers) is genuine business logic complexity
- **Context:** Greenfield — replacing Golf Game Pass, which cannot correctly implement Wolf Cup rules
- **Deployment:** `wolf.dagle.cloud`, existing VPS with Traefik/Docker infrastructure — standalone, no dependency on press-scheduler or configurator (both being retired during LeanView migration)

## User Journeys

### Journey 1: The Scorer — Friday at Guyan (Happy Path)

*Matt Jaquint, first group, 1:00pm tee time.*

**Opening Scene:** It's the third Friday in June. Matt's in the parking lot with Group A — Ronnie, Tim, and Moses. He pulls up `wolf.dagle.cloud` on his iPhone, taps the home screen icon, and enters this week's score-entry code from Jason's Monday GroupMe message. He's in. Before hole 1, the group draws balls on the first tee — Matt draws 2nd, Moses draws 1st. Matt enters the ball draw order in the app. The app locks in every wolf assignment for the round: holes 3–18 by batting order, holes 1–2 as skins only.

**Rising Action:** Hole 1 — net scores entered in 20 seconds while walking to hole 2. The live leaderboard shows Group B already entered hole 1. Moses is leading after one hole and starts chirping.

**Climax — Value Moment:** On hole 12, Matt enters Ronnie's birdie. Ronnie jumps from 5th to 3rd in Stableford for the day. A player in Group C sees it on the live leaderboard and texts the GroupMe: "Ronnie's making a run." The leaderboard is creating the broadcast.

**Resolution:** Round ends. Standings are final before players reach their cars. Jason's phone doesn't light up once with "can you send the spreadsheet?"

**Edge Case — Connectivity Drop:** On hole 7 Matt loses signal behind the maintenance building. He enters holes 7 and 8 offline. Signal returns on hole 9 — the app syncs both holes silently. No data lost.

---

### Journey 2: The Viewer — Strategic Leaderboard Mid-Round

*Josh Stoll, Group D, hole 14. He called wolf on hole 11 and lost — bleeding money.*

**Opening Scene:** Josh is 4th in money for the day, $18 in the hole. He checks the live leaderboard between holes. Patterson is 3rd, $11 ahead.

**Climax:** He sees Patterson just bogeyed hole 13. Patterson drops to 4th in Stableford — Josh is now 3rd. Two wolf holes left. He knows: win one, hold position, finish top 3 in both categories. He goes wolf on hole 15.

**Resolution:** Wins it. Finishes 3rd money, 2nd Stableford. Checks YTD standings on the walk back — moved from 6th to 5th overall. That's the app working exactly right.

---

### Journey 3: The Commissioner — Monday Setup

*Jason, Monday morning, coffee in hand.*

**Opening Scene:** 13 members confirmed. Jason needs 3 subs for 16. Wellman, McGinnis, and Hettlinger say yes.

**Rising Action:** Jason opens the admin panel. Sets headcount to 16, assigns 4 groups, enters each player, sets this week's entry code, sets the active side game (Closest to Pin, Hole 6).

**Resolution:** 8 minutes total. Posts entry code and pairings to GroupMe. Rest of the week: nothing. Sunday: does not open Excel. Not once.

**Edge Case — Rainout:** 11am Friday, pouring rain. Jason marks the round cancelled in admin. Season shifts cleanly — round counter accurate, best-10 calculations intact, no orphaned data.

---

### Journey 4: The Remote Spectator — Late Season from Work

*Kyle Cox couldn't make it this Friday. He's in Columbus for a meeting. It's round 14, playoff bubble is 3 rounds away.*

**Opening Scene:** 2pm Friday, hotel conference room. Kyle pulls up `wolf.dagle.cloud` on his laptop — no code, no login, just the URL.

**Climax:** He's watching live. Patterson wins the day. Kyle does the math — he'd need top 3 finishes for the next 3 rounds to sneak into 8th. He texts the GroupMe: "I'm watching from Columbus, tell someone to choke."

**Resolution:** Kyle has the same real-time access as people standing on the course.

---

### Journey Requirements Summary

| Journey | Capabilities Required |
|---------|----------------------|
| Scorer — happy path | Score entry with code, ball draw input, hole-by-hole wolf display, live sync, PWA home screen |
| Scorer — connectivity edge | Offline score buffering, background sync on reconnect |
| Player/Viewer | Live leaderboard, YTD standings, real-time Harvey + money recalculation |
| Commissioner — setup | Admin: headcount, pairings, entry code, side game schedule, sub management, handicaps |
| Commissioner — rainout | Round cancellation, season recalculation, best-10 integrity |
| Remote Spectator | Public URL, no-auth read access, desktop + mobile |

---

### Wolf Hole Assignment Reference

| Batter | Wolf Holes |
|--------|-----------|
| 1 | 3, **6** (par 3), 9, 14 |
| 2 | 4, **7** (par 3), 10, 16 |
| 3 | 5, 11, **12** (par 3), 17 |
| 4 | 8, 13, **15** (par 3), 18 |

Holes 1–2: skins only — net low ball wins, winner collects $1 from each other player, tie = no blood. Range: +$6 best, -$2 worst.
Holes 3–18: wolf format. Wolf assignment is purely batting order — deterministic, set at ball draw on hole 1 tee, no mid-round recalculation.

## Success Criteria

### User Success

- Every scorer can enter scores for their group on the first Friday of the 2026 season without instruction or confusion
- Live leaderboard updates within seconds of score entry — players check standings between holes and use it to inform wolf decisions
- Jason performs zero post-round Excel entry. By the time players reach their cars after round, standings are final and current
- Remote spectators can follow any round live via `wolf.dagle.cloud` — no code, no install required
- YTD season standings are always one tap away from the home screen; no GroupMe blast needed
- The scoring math matches the Harvey Cup rules exactly — verified against 2022–2025 historical data before launch

### Business Success

- App is live and on-course tested before the first round (target: 2 weeks prior, ~early-mid April 2026)
- Jason uses it as the system of record for the full 2026 season — no Excel fallback
- Survives a full season lifecycle: opening day, a rainout/reschedule, mid-season sub join, playoff rounds with multipliers
- AssTV gallery captures in-season content organically — no year-end scramble to collect assets

### Technical Success

- Deploys cleanly to `wolf.dagle.cloud` on existing VPS (Traefik/Docker) — standalone, no dependency on press-scheduler or configurator
- Handles 4 concurrent scoring sessions (one per group) without race conditions or data conflicts
- Works on spotty golf course WiFi — graceful degradation if connection drops mid-round (score entry queues locally, syncs on reconnect)
- PWA installs on iPhone via Safari with no friction — own icon, full-screen, no browser chrome

### Measurable Outcomes

- Harvey Cup scoring engine output matches historical Excel data for all 17 rounds of the 2025 season (pre-launch acceptance test)
- Zero incorrect score calculations reported during the 2026 season
- Jason's Sunday Excel update time: 0 minutes
- 100% of active players install the PWA or access via browser by Round 2

## PWA & Platform Requirements

### Project-Type Overview

Wolf Cup is a mobile-first Single-Page Application (SPA) deployed as a Progressive Web App, installable on iPhone via Safari and accessible on Android Chrome and desktop browsers. The app serves a private league of ~25 known users plus occasional remote spectators — not a public marketing site. All technical decisions optimize for iPhone-first reliability, PWA installability, and readability on the golf course.

### Browser Matrix

| Browser | Priority | Notes |
|---------|----------|-------|
| iPhone Safari | Primary — PWA install target | Full PWA support required (home screen icon, full-screen, offline) |
| Android Chrome | Secondary (1–2 users) | Standard responsive web; no PWA install requirement |
| Desktop Chrome | Secondary (remote spectators) | Full read-only access |
| Desktop Firefox | Tertiary | Basic read-only support |
| IE / Edge Legacy | Excluded | Zero users; no support |

### Responsive Design

- **Mobile-first layout** — designed for 375px–428px viewport (iPhone SE → iPhone Pro Max)
- Hole-by-hole score entry and leaderboard must be fully operable one-handed on iPhone
- Desktop layout scales gracefully for remote spectators — clean responsive stretch, no dedicated desktop design required
- Touch targets minimum 48×48px — critical for on-course use with gloves or sweaty fingers
- Score entry UI must be readable in direct sunlight (high-contrast, no low-luminance backgrounds)

### Real-Time Strategy

**Polling at 5-second interval + pull-to-refresh:**

- 5-second automatic polling keeps leaderboard current without any user action
- Pull-to-refresh (swipe down on mobile) available as on-demand refresh
- "Last updated X seconds ago" indicator on leaderboard — players can see data freshness at a glance
- Each player row displays **"thru hole X"** — immediately shows which hole a group has scored through, making it clear if a group is live, behind on entry, or has stopped entering

### Leaderboard Information Depth — Commissioner Toggle

During a round, the leaderboard shows Stableford and money standings by default. Live Harvey Cup points (showing each player's current day Harvey point earnings in real time) is a **commissioner-controlled league setting** presented at the season kickoff dinner for a league vote. Jason or Josh can toggle this on or off in the admin panel at any time — before the season, mid-season, or between rounds. The kickoff dinner vote sets the opening default, not a hard lock.

| Mode | Default | Behavior |
|------|---------|----------|
| Regular Season — Live Harvey OFF | ✅ Default | Stableford + money standings shown mid-round. Harvey points calculated and displayed after round completion only. Preserves the existing strategic dynamic. |
| Regular Season — Live Harvey ON | League vote | Full live Harvey points per hole mid-round. Levels the playing field; helps newer players understand strategy. |
| Playoffs | Always ON | Live Harvey points displayed every hole. Eliminates manual per-hole calculation currently done by hand. |

### Admin Access

Two users hold full admin panel access: **Jason** (Commissioner) and **Josh**. Admin capabilities include season configuration, roster management, handicap entry, weekly entry code, side game schedule, live Harvey toggle, and round cancellation.

### SEO Strategy

**Minimal — no public indexing required.**

- Basic `<meta>` tags (title, description) on all routes
- Open Graph tags for GroupMe link previews: title, description, AssTV logo or leaderboard image
- `robots.txt` set to `noindex` — private league, no organic traffic needed
- No sitemap, no structured data, no SEO infrastructure

### Accessibility Level

**Pragmatic readability — optimized for 50+ users on a golf course in sunlight:**

- Minimum 16px base font; leaderboard scores at 18–20px
- High-contrast ratios throughout (WCAG AA contrast floor, not a compliance target)
- No light gray on white, no color-only status indicators, no tiny instructional text
- Score entry buttons large and clearly labeled — usable without reading glasses
- No formal WCAG audit; no screen reader optimization required
- Keyboard navigation functional for desktop (basic tabindex, no complex ARIA)

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Experience MVP — the app must work correctly and feel right on day one for a known audience of ~25 people who will immediately know if the scoring is wrong. There is no soft launch; the first Friday of the 2026 season is go-live. Correctness of the Harvey Cup scoring engine is the non-negotiable foundation — everything else is UI wrapped around it.

**Resource:** Solo developer (Josh). ~6 weeks to opening day.

**Build sequence:** Harvey Cup scoring engine → validation against 2025 historical data → score entry flow → live leaderboard → admin panel → PWA packaging → live test round.

### Round Types

The app supports two round types powered by the same Wolf / Harvey Cup scoring engine:

| | Official Round | Casual Round |
|---|---|---|
| Started by | Any scorer with Jason's weekly code | Anyone — no code required |
| Players | League roster + registered subs | Any mix — league members and/or named guests |
| Course | Guyan G&CC | Guyan G&CC (MVP) |
| Scoring | Full Wolf / Harvey Cup | Full Wolf / Harvey Cup (same engine) |
| Counts toward YTD standings | ✅ Yes | ❌ No |
| Appears in season history | ✅ Yes | ❌ No |

Casual rounds enable pre-season testing, dry runs, and informal play with friends at any time — without polluting the season record.

### MVP Feature Set (Phase 1 — Opening Day)

**Core User Journeys Supported:**
- Scorer: score entry (official code or casual), ball draw, hole-by-hole wolf display, offline queue + sync
- Player/Viewer: live leaderboard with "thru hole X", YTD standings, pull-to-refresh, staleness indicator
- Commissioner/Admin: full admin panel — season config, roster, handicaps, weekly headcount, groups, entry code, side game schedule, sub management, round cancellation
- Remote Spectator: public read-only access, no code required

**Must-Have Capabilities:**
- Harvey Cup scoring engine: Stableford + money, variable player counts, rank-based points, half-point tie splits, best-10-of-N, two-tier playoff multipliers
- Official rounds: weekly entry code gates season scoring; one scorer per group
- Casual rounds: open to anyone, supports guests not in the league roster, no code required, results not counted in YTD
- Live leaderboard — public, "thru hole X" per group, money visible, pull-to-refresh, staleness indicator
- Commissioner toggle: live Harvey points mid-round (off by default regular season, always on playoffs); togglable anytime by Jason or Josh
- YTD season standings — rounds played, drop score, Harvey + money totals, sub pool separate
- Full admin panel — season dates, roster, weekly headcount, groups, entry code, handicaps, side game schedule, sub management, rainout/cancellation
- Course: Guyan G&CC — 18 holes, par, handicap index, tee yardages (hardcoded MVP)
- Side game display (weekly active game shown; closest-to-pin winner manual entry)
- AssTV branding throughout
- PWA — iPhone installable, full-screen, home screen icon

### Validation Gate (Pre-Launch)

Before go-live, the scoring engine must pass:
1. **Historical data test** — Harvey Cup output matches 2025 season Excel for all 17 rounds across multiple player-count scenarios
2. **Live test round** — admin opens a casual round with a small group (4+ players), full scoring flow end-to-end, results verified manually

### Post-MVP Features (Phase 2 — In-Season V1.x)

- Video/photo gallery — browsable, separate from scoring flow, upload capability for in-season capture
- Satellite hole views (Google Maps Static API per hole)
- Playoff bracket visualization
- Historical season archive (import 2022–2025 data)
- Course lookup — search and download scorecard (par, handicap index) for any course; enables casual rounds at other venues without manual entry

### Vision (Phase 3 — V2 / Future)

- Weekly RSVP automation (push notification, reply IN/OUT, auto-tally for Jason)
- Wolf Cup picture day — photographer upload workflow, player profile photos
- Full AssTV annual video production integration
- Pairing suggestions (Jason still approves — never fully automated)
- Native app store distribution if league grows
- In-app side game settlement / payment integrations

### Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|------------|
| Harvey Cup engine complexity | **High** | Build and validate in isolation first, before any UI. Verify against full 2025 season data. |
| Solo developer, 6-week timeline | **Medium** | Admin panel in scope but simplest viable implementation. No polish until scoring is correct. |
| First-round failure in front of the league | **Medium** | Live casual test round required before opening day. Casual round feature enables this anytime. |
| Handicap data — no official GHIN API | **Low** | Jason enters handicaps manually in admin each week. GHIN numbers stored for reference. Unofficial API explored post-MVP. |

## Functional Requirements

### Scoring Engine

- **FR1:** The system calculates Stableford points for each player per hole based on their net score relative to par
- **FR2:** The system calculates wolf game money results per hole based on wolf assignments, net scores, and hole type (skins or wolf)
- **FR3:** The system calculates skins results for holes 1–2 (net low ball; winner collects from each other player in the group; tie = no blood, no carryover)
- **FR4:** The system ranks all players in the round by Stableford score and by money position at any point during or after the round
- **FR5:** The system calculates Harvey Cup points per player per category (Stableford, money) using the rank-based formula scaled to active player count
- **FR6:** The system splits Harvey Cup points between tied players using averaged adjacent rank values, producing half-point results
- **FR7:** The system tracks each player's per-round Harvey Cup totals and applies the best-10-of-N rule to compute season standing totals
- **FR8:** The system applies two-tier playoff point multipliers (Round of 8: rank × 3, no extra points; Round of 4: rank × 8)
- **FR9:** The system determines wolf hole assignments for holes 3–18 deterministically from the batting order established at ball draw
- **FR10:** The system provides Guyan G&CC course data (18 holes, par, handicap stroke index, tee yardages) for use in net score calculation and display

### Wolf Money Engine

- **FR11:** On wolf holes (3–18) in 2v2, money components (low ball, skin, team total, polie, greenie) are resolved as team outcomes — the winning team's members each win $1 per point; losing team members each lose $1 per point; all four players net to $0 per component
- **FR12:** On wolf holes where wolf goes alone (1v3), wolf wins or loses $1 per point against each of the 3 opponents individually ($3 per point net for wolf); all four players net to $0 per component
- **FR13:** The skin is only awarded to the player who holds the low net ball of the group; if low ball is tied or the low ball winner has worse than net par, no skin is awarded and no points carry over
- **FR14:** Polie and greenie bonuses are team bonuses in 2v2 — if any member of a team earns a polie or greenie, both team members benefit; in 1v3, wolf earns the bonus against all 3 opponents individually
- **FR15:** The system auto-detects net birdies and eagles from entered gross scores and player handicap for bonus calculation and statistical tracking
- **FR16:** When auto-calculate money is on, the system applies greenie, polie, birdie, eagle, and double-bonus modifiers to money results per hole
- **FR17:** The system tracks each player's cumulative money balance across all 18 holes for end-of-round settlement display; no hole-by-hole cash exchange is required
- **FR18:** All per-hole money results must net to $0 across all 4 players in the group; the engine validates zero-sum on every hole calculation
- **FR19:** Ties on any component result in no blood for that component; no carryovers on any component including skins

### Round Management

- **FR20:** Admin can create an official round with a scheduled date, player groups, and a unique weekly entry code
- **FR21:** Admin can create a casual round open to any participants including guests not in the league roster
- **FR22:** Admin can cancel or mark a round as a rainout, preserving accurate round count and best-10 calculations
- **FR23:** The system associates round results with round type (official or casual) and only applies official round results to season standings
- **FR24:** Scorer can initiate an official round by entering the current week's entry code
- **FR25:** Scorer can initiate a casual round without a code
- **FR26:** Scorer can record the ball draw batting order for their group, which the system uses to assign wolf holes for the round

### Score Entry

- **FR27:** Scorer can enter gross scores for each player in their group on a per-hole basis
- **FR28:** The system calculates each player's net score per hole using their current handicap index and the course handicap stroke index
- **FR29:** The system displays the wolf assignment for each hole to the scorer during score entry (who is wolf, hole type, skins or wolf)
- **FR30:** Scorer can review and edit scores for any hole in the current round before the round is finalized
- **FR31:** The system queues score entries locally when offline and automatically syncs to the server when connectivity is restored
- **FR32:** Admin can toggle auto-calculate money mode; when on, the system calculates per-hole money results from wolf partner decisions and net scores including all bonuses; when off, scorer manually enters net money total per player per hole; toggle changeable anytime by Jason or Josh
- **FR33:** Scorer can record the wolf partner decision per wolf hole (alone or select a partner from the group) when auto-calculate money is enabled
- **FR34:** On par 3 holes, scorer can optionally record greenie achievement for eligible players (hit green and 2-putt)
- **FR35:** On any hole, scorer can optionally record polie achievement for any player (putt or chip-in longer than the flagstick on first putt from green)

### Leaderboard & Standings

- **FR36:** Any user can view the live in-round leaderboard without authentication
- **FR37:** The leaderboard displays each player's current Stableford score, money position, and the last hole their group has completed ("thru hole X")
- **FR38:** The leaderboard automatically refreshes at regular intervals without user action
- **FR39:** Users can manually trigger an immediate leaderboard refresh
- **FR40:** The leaderboard displays a data freshness indicator showing time since last update
- **FR41:** Admin can toggle live Harvey Cup points display on the mid-round leaderboard; off by default for regular season, always on for playoff rounds; changeable anytime by Jason or Josh
- **FR42:** Any user can view year-to-date season standings including Harvey Cup point totals (Stableford + money), rounds played, and current drop score
- **FR43:** The standings display sub player results in a section separate from full league member standings
- **FR44:** The system identifies and displays playoff-eligible players based on the top-8 season standing cutoff after regular season rounds are complete

### Season & League Administration

- **FR45:** Admin can configure season parameters including scheduled round dates, total round count, and playoff format
- **FR46:** Admin can set the weekly entry code for each official round
- **FR47:** Admin can set player headcount and group assignments for each round
- **FR48:** Admin can configure the side game schedule for the season and set the active side game per round
- **FR49:** Admin can record the winner(s) of the active side game for any round
- **FR50:** Admin can mark a player as a sub for any round, with their results tracked separately from full-member standings
- **FR51:** Admin can convert a sub player to a full league member before the playoff eligibility cutoff

### Roster & Player Management

- **FR52:** Admin can create and maintain the league roster including player names and GHIN handicap numbers
- **FR53:** Admin can enter and update each player's current handicap index before each round
- **FR54:** Casual round organizer can add guest players by name for a single round without adding them to the league roster

### Side Games

- **FR55:** The app displays the active weekly side game name and format to all users
- **FR56:** Admin can record the winner of a manual side game result (e.g., closest to pin) for any round

### Statistics

- **FR57:** The system records wolf call decisions (alone vs. partner, partner selected, win/loss outcome) per player per hole for statistical purposes
- **FR58:** The app provides statistical summaries per player including most wolves called, wolf win/loss record, most net birdies, most greenies, most polies, and biggest single-hole money win and loss
- **FR59:** Statistical data is stored persistently in a relational database to support historical queries across rounds and seasons

### Application Access & Distribution

- **FR60:** Users can install the app to their iPhone home screen via Safari for full-screen, no-browser-chrome access
- **FR61:** The app is publicly accessible at wolf.dagle.cloud without authentication for all read-only views (leaderboard, standings, course info)
- **FR62:** Score entry for official rounds is restricted to users who have entered the current week's valid entry code
- **FR63:** Admin panel access is restricted to authorized admin users (Jason and Josh)

## Non-Functional Requirements

### Correctness & Data Integrity

The highest-priority quality attribute for Wolf Cup. Incorrect scoring destroys trust instantly with a league that knows the numbers.

**Money validation (runtime check):**
- Each foursome's per-hole money must net to $0 across all 4 players — enforced by the engine on every calculation
- The total money across all foursomes in a round must also net to $0 — enforced at round completion
- Any violation of zero-sum is a critical bug; the system must surface it immediately, not silently produce wrong results

**Stableford / Harvey Cup validation:**
- Stableford points must be correctly calculated per the Stableford system for each player per hole
- At end of round, all players are ranked league-wide (across all groups) by total Stableford score and by total money won/lost — Harvey Cup points are assigned to those league-wide ranks, not per-group ranks
- Total Harvey Cup points awarded per category (Stableford, money) per round must equal the mathematically expected total for the active player count — this is the integrity check (equivalent to the Excel column-sum check against the points table)
- Ties must produce the correct averaged half-point splits such that the total still matches expected
- Best-10-of-N must correctly identify and exclude drop rounds under all rainout and sub-join scenarios

**Historical data validation (pre-launch gate):**
- The scoring engine output must be validated against the 2025 season Excel data for all 17 rounds
- The 2025 Excel is treated as the primary reference — it was hand-verified and always matched manual calculations, but was built with workarounds and may contain edge-case bugs
- Where engine output diverges from Excel, the discrepancy must be investigated and resolved against the mathematical rules — Excel is not automatically correct
- The engine must also be independently validated against the Harvey Cup point formula and known scenario calculations

**Wolf hole assignment integrity:**
- Wolf hole assignments must be deterministic and immutable once ball draw is entered — no mid-round recalculation under any condition
- Score corrections to a completed hole must trigger full downstream recalculation for that round

### Performance

- Initial app load on cold LTE connection: < 3 seconds
- Score entry submission acknowledged by server: < 2 seconds on LTE
- Harvey Cup and money recalculation after score entry: < 500ms server-side
- Leaderboard polling interval: 5 seconds; update visible to other users within 10 seconds of score entry
- PWA app shell loads from cache instantly on repeat visits (no network required for shell)

### Reliability

The app is the system of record during live Friday rounds — downtime during round hours is a significant failure.

- The app must be operational during Friday round hours (1:00pm–5:30pm ET) as the priority availability window
- Offline score entry must preserve 100% of entered data with zero loss; scores must sync in correct hole order upon reconnect
- The app must remain usable in read-only mode (serving cached leaderboard) even when the server is temporarily unreachable
- Database writes for score submissions must be atomic — partial writes that produce corrupted round data are not acceptable

### Security

Wolf Cup handles no payments and no sensitive PII. Security requirements are proportionate to that low-risk profile.

- All client-server communication over HTTPS
- Admin panel protected by session-based authentication; sessions expire after reasonable inactivity
- Weekly entry codes must be invalidated when a new code is set or a round is closed — old codes must not grant access to future rounds
- Player data stored: name, GHIN number, handicap index, round scores — no SSNs, payment data, or email addresses stored
- No third-party analytics or tracking scripts — private league, no data sharing

### Deployment & Operability

- Deploys as a standalone Docker container behind Traefik on the existing VPS — no dependency on press-scheduler or configurator infrastructure
- Deployment does not require downtime during non-round hours
- Application logs must capture scoring calculation inputs and outputs to support post-round dispute resolution
