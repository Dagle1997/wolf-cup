# Tournament App — Product Brief

**Working name:** Tournament (TBD)
**Subdomain:** `tournament.dagle.cloud`
**Relationship to Wolf Cup PWA (wolf.dagle.cloud):** Sibling app, same monorepo, separate front end, separate DB, separate deploy. Shared engine code only (and minimally — likely just `stableford.ts`).
**v1 target:** Pinehurst trip, **May 7–10, 2026**, 8 players, 4 rounds (Talamore, Mid Pines, Pine Needles default / Pinehurst No. 2 alternate, Tobacco Road)
**Project type:** Personal side project. No monetization. Scope bar: "fun to build, my friends will actually use it."
**Date:** 2026-04-13

---

## 1. Vision

**Your group's game library.** Every circle you play in — Sunday morning at Guyan, Wednesday night scramble, the Pinehurst May crew, the Snowshoe July trip — lives in one app with its members, saved rules, and history already configured. Open the app, pick today's game, tee off. No spreadsheet, no recreation of rules, no "wait what are we playing today." Trips are the multi-round version of the same thing; leagues are the recurring version; one-offs are the single-round version.

The lock-in is the library. Every incumbent (Golf Genius, GHIN, 18Birdies) is shaped for one-format-at-a-time scoring. The moat is the shape of the data: a group's rule set + its member list + its history. Neither the major apps nor the spreadsheets cover this well.

Golf events today run on shared Google Sheets, hand-marked scorecards, and one guy's notepad. The audience is small and bursty, which is why nobody has built the app well. Fine for a side project; potentially more if the library thesis holds beyond golf.

The app supports two container types:

- **Round** — single round, today, settles now. Runs against your group's saved rule preset (e.g., "Monday morning Guyan, $5/point, no presses"). Port of Wolf Cup's practice-round flow. **Post-v1.**
- **Event** — multi-round, multi-day, with cross-round money + leaderboard + stats rollup, settle at end. Covers what people variously call trips, tournaments, member-guests, weekend series. Could be one course over multiple days or multiple courses. **This is v1.**

The distinguishing axis is *single round vs rollup-needed*, not *trip vs tournament* — those are the same shape. Whether it's 4 days at Guyan, Pinehurst, or Vegas is irrelevant to the data model.

An Event holds multiple rounds across multiple days at one or more courses. Each round has teams, a format, side games, and money. Stats, leaderboards, and head-to-head money roll up across the event. Settle-up at the end.

**Event is generic, not Pinehurst-specific.** The Pinehurst May 7–10 outing is the v1 *test case* — the first event — but the flow is reusable for any future event.

(App name and container name are placeholders. "Tournament" the working app name conflicts with how people use the word. Working naming options: app = Outing/Roundup/Loop/Eighteen, container = Event/Trip/Series. Pick before launch.)

## 2. Architecture Decisions (locked 2026-04-13)

- **Same monorepo** as Wolf Cup (`D:\wolf-cup`). New directories: `apps/tournament-web`, `apps/tournament-api`.
- **Separate subdomain** `tournament.dagle.cloud`. No brand or UX bleed with `wolf.dagle.cloud`.
- **Separate everything operationally:** docker service, Traefik route, DB volume, auth realm, CI job. **All explicit BMAD work items**, not assumed scaffolding.
- **No engine refactor in v1.** Tournament owns its own `Course`/`Tee`/`Hole` schema inside `apps/tournament-api`. Engine extraction (e.g., parameterizing `course.ts`) is deferred until duplication actually hurts. Tee/color assumptions leak through `types.ts`, `rounds.ts`, `side-game-calc.ts`, `ball-draw.tsx` — extraction is a real cross-cutting refactor, not a one-file cleanup.
- **Engine reuse limited to pure generic helpers** — likely just `stableford.ts`. Wolf Cup's money engine is Wolf-shaped (lowBall + skin + teamTotal) and not reusable for 2v2 best-ball-with-presses. Tournament gets its own money modules per format.
- **Wolf Cup is read-only from tournament's perspective.** Any temptation to edit `packages/engine` or `apps/api` or `apps/web` triggers a stop + flag to Josh.
- **Safety net:** root `pnpm test` and CI now run engine + API tests (854 today). Any tournament change that breaks them is caught before deploy.

## 3. What to Reuse from Wolf Cup

The PWA shell, offline sync pattern, money ledger logic patterns, Drizzle+SQLite patterns, auth pattern, deploy infra (Docker Compose + Traefik). **Patterns, not code.** Tournament copies what's useful into its own files.

Specifically reuses (potentially):
- `stableford.ts` from `packages/engine` (pure import)
- Hole-by-hole score entry UI conventions
- Offline-first sync behavior pattern
- Access-code gate pattern

Specifically new:
- Trip container (above round)
- Multi-format support (Wolf Cup is hardcoded)
- Multi-course support across a single trip
- Cross-round head-to-head money tracking
- Course/scorecard database (loadable independent of round assignment)
- Pairing algorithm with constraints

## 4. v1 Feature Set

### 4.1 Trip Container
- Name, dates, player roster (8 target, flexible)
- Multi-course schedule with **tentative or confirmed** course state
- Trip-level settings: handicap basis, default stakes, default format
- Trip homepage: countdown, schedule, roster, activity feed

### 4.2 Course & Scorecard Database
- **Source of truth (v1):** club scorecard. USGA NCRDB reconciliation deferred (rating/slope drift between sources is real and material — verified during pre-BMAD diff).
- **Primary loading path:** PDF/photo upload → Claude vision parse → validator (par ∈ {3,4,5}, SI 1–18 unique, Out/In totals match) → editable review → save.
- **OCR pipeline validated** (2026-04-13) on 3 of 4 Pinehurst courses; produces accurate transcription of source PDFs. Vision pipeline trusted; source-of-record disagreement is a separate problem deferred to v2.
- Each saved entry stores `source_url`, `extraction_date`, `verified` flag.
- Courses are **loadable independent of round assignment** so alternates (e.g., Pinehurst No. 2 for the Pine Needles round) can be pre-loaded without committing to play them.
- 4 Pinehurst seeds already in `reference/pinehurst-may-2026-courses.json` (Talamore, Mid Pines, Pine Needles, Tobacco Road verified; Pinehurst No. 2 marked unverified).

### 4.3 Groups & Rule Sets

A **Group** is a first-class entity, not just a roster. Represents a user's recurring golf circle — "Sunday morning at Guyan," "Wednesday night scramble," "Pinehurst May trip crew." Properties:
- Members (persistent player list, with optional handicap tracking)
- **Named rule sets** attached to the group (e.g., "Alan's rules", "Sunday", "Wednesday morning", "Masters week stakes")
- (Future) Inter-group rules that activate by field size (e.g., Saturday's $10/man 4-ball only when 2+ groups are playing)

**v1 scope for Groups:** schema is fully built — `groups` table, `group_members`, `rule_sets` owned by a group, `group_id` foreign key on events/rounds/players. A minimal but real UI exists in v1: you can view a Group (members + rule sets), rename it, add/edit rule sets attached to it, add/remove members. For Pinehurst, the trip roster is one Group. Deferred to v1.5: multi-group library picker, group switching UI, cross-group rule activation, group-to-group membership merging. Rationale: accepting the Group entity's shape now avoids a painful data migration later when the Thursday league / weekly-games use cases land.

**Rule-set day-of-week auto-suggest (UX):** if a rule set is named after a day of the week ("Sunday", "Wednesday"), it auto-populates the dropdown when starting a round on that day. User can override. Zero-friction recall of "what are we playing today."

*v1.5 upgrade (deferred):* fallback to **last-used-on-this-weekday** when no name match ("Alan's" is your default Saturday rule set even though it's not named that). Requires tracking `{weekday, rule_set_id, used_at}` per round. Rejected for v1: most-used frequency weighting (over-engineered; edge cases outweigh benefit).

### 4.4 Format System
- v1 default: **2v2 best ball** (covers ~90% of Guyan group play). Parameterized rule schema — every group plays slightly different money rules.
- **Rules don't change mid-round.** Stableford, sandies/polies/greenies, net-vs-gross are fixed at tee-off. No mid-round rule editor.
- **Press is a configured mechanic, not a rule change.** Rules declare whether pressing is allowed, whether auto-presses trigger, and how the multiplier behaves. Mid-round, the only action is firing a press (manual button) or auto-press firing automatically.
- **Press button** (v1): any player with scoring access can call a press on the current hole. Press increases the stake multiplier for current and subsequent holes per the rule's press config.
- **Auto-press triggers** (v1 schema, basic implementation): rules can declare triggers like "auto-press when 2 down" (Rick + Scottie's default). Engine evaluates triggers per-hole against current money state and fires presses automatically. Rule schema must express this; v1 implementation covers the "N-down" trigger family.
- Side-bet modules layered on any format: polies, greenies, closest to pin, long drive, low round, sandies.
- **Group-owned rule sets** applied with one tap (or auto-suggested by day-of-week).
- v2: Stableford, individual stroke play net, Skins (with carryover/validation/pole rules), Wolf, Nassau, etc. Architecture must allow additions without rework.
- v2: inter-group rules conditional on field size (rule schema must allow this).
- **Out of scope for v1:** Wolf (lives in Wolf Cup app), Nassau, BBB, Sixes, Rabbit.

### 4.4a Cross-Foursome Individual Bets

Individual bets between specific pairs of players, independent of which foursome each is in. Example: Rick and Josh agree on $5/hole match play; Rick and Scottie have their usual auto-press on 2-down. These bets compute whether or not the two players share a foursome — scores come from each player's group scorecard.

v1 schema requirements:
- A bet between two (or more) specific players, with its own stake, rules, and press config
- Computed per hole from the two players' hole scores (possibly from different scorecards)
- Rolled into the trip's head-to-head money matrix and final settle-up
- Each player's side must agree the bet exists (no ghost bets)

v1 UI scope: create/join pair bets in a simple list, see current standing per bet on the money page. Full bet marketplace / negotiation UX = v1.5.

### 4.5 Pairing Algorithm
Inputs: player list, number of rounds, constraints. Constraint presets:
- "Everyone plays with everyone at least once"
- "No back-to-back repeats"
- "Lock pair X and Y together, rotate others"
- "Balance team handicaps"
- "Fully manual, I'll set it each day"

Output: suggested pairing grid for the whole trip. Organizer can lock, shuffle, or override any day. **Course/round swap (e.g., Pine Needles → No. 2) preserves pairings.**

### 4.6 Live Scoring
- **One scorer per foursome** (v1). One player in each group is the designated scorer; others spectate live via shareable link. Fewer devices to sync, simpler auth, smaller failure radius if a phone dies. "Everyone scores themselves" is a v1.5 option.
- Scorer enters all scores for their group; sync across all other devices on reconnection.
- Offline-first; syncs when connection returns.
- Cross-group leaderboard awareness mid-round — spectators see live updates from all groups.

### 4.7 Leaderboards & Stats
- Per-round leaderboard.
- **Trip-cumulative leaderboard** (money, points, low net, low gross).
- **Head-to-head money matrix** across all players, regardless of whether they shared a group. Hole-by-hole comparison at full strokes, win/tie/lose aggregated.
- Fun stats: most pars, most birdies, worst hole, comeback of the trip, etc.

### 4.8 Pre-Event Surface — Reference + Receipts (NOT engagement loop)

Pre-event, the app is **not competing with the iMessage group** for daily attention. It's a clean reference + a source of screenshot-worthy content people share back to the chat.

- Countdown to day one (passive, costs nothing)
- Schedule (date, course, tee time, format) — screenshots well
- Pairings page — screenshots well, posts to chat
- Course list with hero image + key stats per course — "look at hole 16, holy shit" → posts to chat
- Roster with confirmations
- Player invites via shareable link

**No in-app message board in v1.** Cut. Smack talk lives in iMessage; building a second venue competes with what already works and loses. (See §7.)

### 4.8a Player First-Arrival Flow (v1 must-have)

When a player taps the organizer's invite link for the first time, the experience must be **immediately compelling and immediately useful** — no setup wall, no "create account" friction.

Sequence (target: 3 taps to "wow"):
1. Land on event home: hero image of trip (course collage or first day's hero), countdown, "Welcome to {Event Name}"
2. "You're in" — name pre-filled from invite link, one-tap confirmation
3. Lands on Schedule view: dates, courses (with hero photos), pairings if set, player roster

**Account / auth:** lazy. Player gets full read access immediately via the invite token. Auth (set a password) only required when they actually need to *enter scores* — pushed to game day, not setup day. (GHIN linkage deferred per §5.) The bar is "Mark sees the trip and gets excited," not "Mark fills out a profile."

### 4.8b Course Photos — Sourced, Not Hoped For

The course-preview hype works only if photos exist. v1 must source them, not hope users upload them.

Sources, in priority order:
1. **Club website hero/course-tour images** — Pinehurst, Mid Pines, Talamore, Tobacco Road all publish them. Personal-use embed is legally fine for a private-trip app.
2. **User-tagged photos from prior trips** with hole+course tags (e.g., "#3 @ Mid Pines"). Once the gallery exists with that tagging schema, photos accumulate and surface back into course previews automatically. Tag schema: `course_id` + `hole_number` (optional) + `caption`.
3. **Manual upload** as fallback for missing courses.

Default at trip creation: pre-load 1 hero image per course from sourced URLs. User can replace.

### 4.9 During-Event Engagement
- Leaderboard updates as scores enter
- **Push notifications** for leaderboard movement: "Josh just shot -2 on hole 7, you're 3 strokes back." This is the smack-talk catalyst — players screenshot the notification and post to iMessage. App becomes content source, not chat venue.
- Per-event gallery (pattern reuse from Wolf Cup R2 setup)
- Live head-to-head money so players know what's at stake walking up to 18

### 4.9a Pairings & Schedule PDF Export (v1 must-have)

Trust-insurance feature. At any time during or before an event, one-tap export of:
- Schedule (dates, courses, tee times)
- Current pairings per round
- Player roster with handicaps

Rendered as PDF (or printable HTML → browser print). Pattern reuse from Wolf Cup's existing season-calendar export. If the app dies mid-trip, you pull out the paper and keep going.

### 4.10 Post-Event
- Final leaderboard (screenshot-worthy)
- Settle-up summary
- Photo gallery as memorabilia

### 4.11 Home Screen / Top-Level Navigation
- Visiting the app shows "**Start an Event**" CTA + list of the user's events
- "Start a Round" entry point is **hidden in v1** — doesn't exist yet, dead buttons confuse testers
- Within an Event, the surface is: Schedule, Players, Courses, Pairings, Live Scoring, Leaderboard, Money, Gallery (no Board — cut)

### 4.12 Naming (open)
- App working name "Tournament" is wrong — Tournament is a thing people set up *inside* the app, not the app itself.
- App candidates: **Outing**, Roundup, Loop, Eighteen, Tee Sheet, Bag
- Container candidates: **Event** (current placeholder), Trip, Series, Tour
- Tentative pick: app = **Outing**, container = **Event**. Decide before launch.

## 5. Out of Scope for v1

- National course database / NCRDB integration (manual upload only; OCR primary)
- ~~GHIN API integration~~ — **IN scope for v1.** Players must be pulled via GHIN search (name + state), matching Wolf Cup's existing pattern. Implementation: **copy** Wolf Cup's GHIN client (`ghin-client.ts`, `ghin.ts`, scheduled-refresh pattern) into `apps/tournament-api/src/` rather than extract to a shared package. Zero Wolf Cup touch; accept duplication since GHIN client isn't under active development. Fallback: manual-override handicap entry when lookup fails / GHIN is down — a network blip must not brick the trip.
- Payment processing (cash settle-up)
- Engine refactor / `course.ts` parameterization
- USGA/scorecard system-of-record reconciliation
- Multi-club tenancy
- Admin/club-level features
- Weekly league use case (Wolf Cup handles that)
- **Round container type** (Event only in v1; Round is post-v1)
- **In-app message board** (cut — competes with iMessage and loses; app is reference + receipts, not chat venue)
- **SMS / iMessage group bridge** (Twilio in/out, per-user phone identity matching, TCPA compliance — multi-week feature on its own; reconsider only if push-notification-driven engagement falls flat)
- **Phone contacts API** for player picker (iOS PWA support is restricted; manual entry + invite link for v1)
- **Voting on rules / games** (v1.5)
- **Predictions module** (v1.5)

## 6. Explicit Non-Goals (v1)

- Not a tournament-management tool
- Not competing with Golf Genius, GHIN, or 18Birdies
- Not monetized in v1
- Not a social network beyond trip-scoped message boards
- Not multi-club / multi-tenant in v1

## 6b. Plausible Future Paths (informational — do not spec for v1)

These are real possibilities, captured so v1 architecture doesn't actively foreclose them. Do not let any of them expand v1 scope.

- **Guyan Thursday night league** as a second customer post-trip. Same club, different format/group, members already said they want a Wolf-Cup-style app because the pro-shop tool is poor. Closest concrete next-step after the May trip works. Same DB/auth tenant — just a different "container" type (league vs trip). Validates the format/rule flexibility before any multi-club ambitions.
- **Per-club licensing** ($2/member, fully customized to the club's games and betting formats). Long-shot dream tier — discussed but not committed. Would require real multi-tenancy, which v1 deliberately avoids. Mentioning it only so v1 doesn't bake in single-club assumptions that a future tenant model would have to undo.

**Implication for v1 design:** keep "Guyan" out of any code path or schema. Trip and (future) league live in their own containers; club identity (when it exists) is data, not hardcoded.

## 6c. Future-Proofing Checklist for v1

These are cheap-now / expensive-later design choices. Bake them into v1 even though v1 is single-tenant single-trip, because retrofitting them costs days each.

**Schema:**
1. No hardcoded club identity in code paths. "Guyan" / "Pinehurst" / etc. are data, never literals.
2. Tables that are logically tenant-owned (courses, rule sets, players, trips, leagues, settings) are *shaped* to accept a `clubId` column later. v1 either omits the column or hardcodes a single `default` value. Just don't preclude the column.
3. Container types (`trip` v1, `league` future) live in separate tables, not a polymorphic `competition` table with a discriminator. Two clean shapes beat one fuzzy one.

**Data:**
4. **One SQLite DB per tenant** when multi-tenancy lands. v1 is one tenant → one DB file. The hostname middleware that picks the DB file is the entire multi-tenancy mechanism. This scales surprisingly far and makes "your data is yours" a real promise (one file = one club's complete export).
5. Courses are records loaded by ID, never imported from a fixture. (Tournament owns its own `Course` schema; this is already in the brief.)

**Auth & sessions:**
6. Cookies set on the **specific subdomain** (`tournament.dagle.cloud`), never on `dagle.cloud`. A cookie scoped to the parent domain leaks across every future tenant subdomain. One-line config; impossible to retrofit cleanly.
7. User identity is per-app for v1. When tenancy lands, user↔tenant becomes many-to-many. Don't bake "user belongs to one club" into v1.

**Infra:**
8. **Wildcard TLS** (`*.dagle.cloud`) at Traefik. Confirm this is in place before adding any second subdomain. Per-subdomain certs hit Let's Encrypt rate limits at scale.
9. Hostname-based routing in Traefik already handles subdomain-per-tenant cleanly. No special work in v1; just don't break it.

**Branding:**
10. Page title, logo URL, primary color, app display name come from a small config object — never hardcoded literal strings in JSX. v1 hardcodes the object inline; v2 swaps it for a tenant lookup. Five minutes now, weeks later.

**Explicitly NOT in this checklist** (premature for v1):
- Row-level security / `tenant_id` enforcement middleware
- Tenant onboarding / signup flows
- Cross-tenant analytics
- Real auth provider (Auth0/Clerk) — bcrypt pattern from Wolf Cup is fine
- Per-tenant DB migrations / migration orchestration

## 7. Known Risks & Open Questions

1. **Scorecard OCR edge cases.** Validated on 4 Pinehurst cards. Risk: cards with non-standard layouts, faded prints, bad photo angles. Mitigation: validator catches obvious failures; manual edit grid is the fallback.
2. **Pairing algorithm complexity.** Constraint satisfaction can balloon. Start with the 4–5 presets above; custom constraint builder is v2.
3. **Retention between trips.** Real concern. Pre-trip hype features are the primary mitigation. If the app is dead between trips, the app is dead.
4. **Complexity vs vapor-lock.** Progressive disclosure is the core UX discipline. Default path: trip name, dates, players → done. Everything else is optional.
5. **Source-of-truth drift** (USGA vs club scorecard for rating/slope). Real and material. Deferred to v2; v1 uses club scorecard exclusively, with `source_url` + `extraction_date` recorded for re-pull.
6. **Pinehurst No. 2 unverified.** BlueGolf scrape returned per-hole pars summing to 73 (canonical par 72), suggesting U.S. Open / member-tee mixing. Action item: re-photo official scorecard on-site or pull official PDF before the May 9 swap (if call-in succeeds).

## 7b. v1.5 Milestone — Guyan Thursday Night League

**Promoted from "future path" to named milestone.** First real customer outside the trip use case. Members already say their pro-shop tool is poor and they want a Wolf-Cup-style experience.

Scope (lightweight — most of the work is reuse):
- New container type: **League** (recurring weekly, persistent member roster, attendance per week, season-long stats)
- Reuses the same scoring / money / leaderboard / pairing primitives built for v1 Event
- Same DB schema, same auth model (still single-tenant; "Guyan" is data not code per future-proof checklist)
- Probably one or two formats they actually play (TBD — confirm with Thursday night organizer before scoping)

**Why it matters:** validates the format/rule flexibility thesis on real recurring usage, validates the "second customer in the same building" path before any multi-club ambitions. If Thursday league works for Q3 2026, the per-club licensing conversation has actual evidence behind it.

**Sequencing:** v1 Event must ship and survive Pinehurst before Thursday league work begins. No parallel scope.

## 7c. Pre-Trip Validation Plan

Minimum validation before May 7:
- **iOS PWA push validation spike** (by April 30). One afternoon. Deploy a test push notification endpoint, install the tournament PWA on a real iPhone, fire a notification, confirm it arrives on lock screen. If iOS PWA push is unreliable, pivot to server-sent SMS notifications (Twilio, scoped to push notifications only — NOT a full SMS bridge). Blocks during-event engagement loop; answer needed before shipping.
- **Offline sync airplane-mode drill** (30 min). Put the scorer phone in airplane mode at hole 3, enter scores for holes 4–6, re-enable connectivity, confirm scores sync cleanly and leaderboard updates for other devices. Catches merge-conflict class of bugs that unit tests miss.
- **9-hole foursome test** at Guyan with Josh + Jeff + Ben + 1 more. Shakes out live scoring, leaderboard updates, offline-tolerance basics, PDF export. One-scorer-per-foursome flow exercised for real. Any ugly bugs surface here instead of day 1 of the trip.

## 8. v1 Success Criteria

Pinehurst May trip runs through the app end to end:
- All 4 courses pre-loaded (3 verified, #2 alternate flagged unverified pending re-pull)
- Pairings set using "everyone plays everyone" constraint across 4 rounds
- Live scoring works across all 4 rounds, offline-tolerant
- Daily and trip leaderboards update in real time
- Head-to-head money is correct at the end of the trip
- Course swap (Pine Needles → No. 2) is a one-tap operation that preserves pairings, side games, and pre-trip data
- The 8 guys actually use it instead of falling back to paper

Plus operational gates:
- Tournament has its own DB; Wolf Cup DB never opened by tournament code
- Tournament has its own docker service + Traefik route
- CI runs engine + Wolf Cup API + tournament tests; all green before deploy
- Zero edits to `packages/engine`, `apps/api`, `apps/web` files in v1 (or any made are explicitly approved by Josh and accompanied by passing Wolf Cup tests)

## 9. Notes for BMAD PM Agent

- This is a side project. Do not propose enterprise features, paid tiers, or multi-tenant architecture in v1.
- Wolf Cup PWA exists, is functional, and is in active weekly use. **Do not propose changes to Wolf Cup.** Tournament is a sibling; engine extraction is explicitly deferred.
- Pinehurst trip May 7–10 is the real v1 deadline. Scope accordingly.
- User is owner, sole developer, and a player on the target trip. Feedback loop is fast.
- Prefer "working for 8 friends in May" over "architecturally pure."
- Source-of-record for course data in v1 = club scorecard. Don't propose USGA reconciliation as v1 work.
- Tee colors and tee data are course-owned, not engine-owned. Tournament's `Course` schema is internal to `apps/tournament-api`.
- Infra isolation (docker service, Traefik, DB, CI) is explicit BMAD work, not assumed scaffolding.
