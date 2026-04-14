---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-requirements', 'step-06-epics', 'step-06-revision-2026-04-13']
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/product-brief.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 0
  projectDocs: 0
workflowType: 'prd'
projectType: 'tournament-app'
outputFolder: '_bmad-output/planning-artifacts/tournament/'
classification:
  projectType: 'PWA + API (web app)'
  domain: 'sports / golf scoring'
  complexity: 'medium'
  projectContext: 'greenfield'
  notes: 'Sibling to Wolf Cup in same monorepo. Two container types planned (Round, Event); v1 = Event only. Multi-tenancy latent (10-item future-proofing checklist) but not built. Guyan Thursday League named v1.5 milestone.'
---

# Product Requirements Document - Tournament

**Author:** Josh
**Date:** 2026-04-13

## Note to Reviewers

This PRD is written for a sibling app inside an active monorepo. A substantial portion of tournament's functional surface is satisfied by **porting battle-tested code from Wolf Cup** (the sibling app live at `wolf.dagle.cloud`, with 854 green tests and a shipped 2026 season). When evaluating scope, risk, and effort, please account for the following:

- **Offline scoring + sync is already solved.** `apps/web/src/lib/offline-queue.ts` is an IndexedDB queue battle-tested through the 2026 season launch. Tournament ports it verbatim (story T5.3) — the entry shape swaps, the mechanics do not. Offline complexity is downgraded from "high risk" to "low risk, port verbatim."
- **Score-correction audit log is already solved.** `apps/api/src/routes/admin/score-corrections.ts` is the port target for FR-B8 (T5.9).
- **GHIN handicap client is already solved.** Copy as-is (T3.4, FR-A6).
- **Scorer UI with the iOS keyboard focus fix is already solved** (Wolf Cup commit `ebe3cea`, 2026-04-12). Port (T5.2).
- **PDF generation pattern is already solved** — `reference/wolf-cup-admin-guide.html`/`.pdf` and `reference/wolf-cup-marketing.html`/`.pdf` are the templates (T4.3 port).
- **Photo gallery with R2 is already solved** (Wolf Cup 2026-03-21 feature). Port (T7.4).
- **Auth is SSO-first, not password-based** (FD-4 2026-04-14). Tournament ships Google SSO + magic-link email fallback, with one-time GHIN lookup bind after SSO. Apple SSO deferred v1.5. No password port from Wolf Cup.
- **Stableford engine primitive is already shared.** `packages/engine/src/stableford.ts` is reused by both Wolf Cup and tournament.

Every story carries a reuse tag: **[port]** (copy verbatim or near-verbatim), **[extract]** (lift into `packages/*` for shared use), or **[new]** (novel tournament-specific work). Of 53 total stories, **13 are port/extract** (already-proven code) and **40 are new**. The new work concentrates in tournament-specific rules/money logic, permissions, and cross-event identity — exactly where the product wedge lives.

This is why the PRD treats some items (offline sync, audit log, GHIN, PDF, photo gallery) with less defensive scaffolding than a greenfield PRD would. They aren't being ignored — they're being inherited.

## Executive Summary

**Working name:** Tournament (app name TBD — see brief §4.12). **Target testing window:** the Pinehurst trip **May 7–10, 2026**. **Deadline posture (revised 2026-04-13):** foundation-first, ship-when-solid. No hard external deadline; if the foundation isn't ready by May 7, the June trip is the next natural testing window. **Definition of done for v1:** all 8 players use the app for all 4 rounds instead of falling back to paper; head-to-head money is correct at settle-up.

The app is **your golf-buddy group's game library**. Every circle you play in — Sunday morning at Guyan, Wednesday night scramble, the Pinehurst May crew, the Snowshoe July trip — lives in one app with its members, saved rules, and history already configured. Open the app, pick today's game, tee off. No spreadsheet, no rule recreation, no "wait what are we playing today."

The library is organized by two container types: **Round** (single-round, apply the group's saved config, settle now) and **Event** (multi-round, multi-day, leaderboard + stats + cross-round money rollup, settle at end). v1 ships **Event only**, scoped to the Pinehurst May 7–10 trip as the first real event. Round is post-v1.

v1 ships one Event (Pinehurst) with one Group (the trip roster), 2v2 best ball format (the "Guyan Game") with parameterized press + auto-press + carry-over greenies + cross-foursome individual bets, a **skins sub-game** (gross / net / gross-beats-net modes; participant-scoped opt-in per FD-10/11), one-scorer-per-foursome scoring with SSO + GHIN-bind identity (FD-4), offline-tolerant sync, live cross-group leaderboard, head-to-head money matrix, PDF schedule/pairings export, and GHIN handicap lookup (copied client, manual-override fallback). **Engagement loop is strictly app-internal** (FD-5 "App creates pull, not push"): every social moment — birdies, presses firing, leaderboard changes, award triggers — surfaces inside the app as toasts, banners, and animations. No push notifications, no SMS, no email. Pre-event surface = reference + receipts (screenshot-worthy schedule, pairings, course previews).

### What Makes This Special

**The wedge in one sentence:** *the app remembers how this specific group plays golf — and, because scoring is the data-entry surface players already have to use, it accumulates cross-context stats that nobody has the discipline to track manually.*

**Primary wedge — persistent group memory.** Every golf-buddy group has the same repeating friction: same people, same arguments, same side-bets, same house rules, same need to re-explain every round. The Group entity is a library of saved rule sets, saved rosters, saved pairings patterns, and saved history. Open the app, pick today's game, play. The app doesn't add work — it removes the work people are already doing in their heads, on notepads, or in Google Sheets.

**Secondary wedge — passive cross-event stats.** Because scoring is the data-entry surface players already need to use for the money to work, stats accumulate as a byproduct. Once a Group has multiple Events logged — home-course weekly rounds + road trips + tournaments — the app can answer questions nobody could answer before without manual upkeep: *Alan says he has a Volkswagen game — good around town, not on the road. Provable? Home course vs. Pinehurst vs. Vegas, same handicap, different averages? Which partners actually carry you? Which opponents do you only beat at home?* Zero marginal effort from the user; rich compounding signal over 10+ trips a year.

**Credibility proof — advanced bet modeling.** Cross-foursome individual bets ("Rick and Josh running a $5/hole in different groups") and head-to-head money matrices across never-grouped players are features built by someone who actually plays these games. Not the primary sales pitch — evidence that the person who built this understands why existing apps feel like they were designed by people who've never sat at the clubhouse bar arguing about whether a 5-foot putt was given.

**Competitive landscape, fairly stated.** 18Birdies supports multi-round tournaments and saved per-game preferences but does not foreground persistent group-specific rule memory or cross-event stat rollups. Golf Genius serves enterprise tournament operations at enterprise prices and UX complexity. Golf GameBook covers social scoring but lacks some formats and carries user-visible paywall friction. These apps can approximate parts of the group-memory story if you squint; none make it the center of the UX. The moat is market shape, not algorithmic novelty: small bursty audiences, one or two trips a year per group, weekly games invisible to outsiders — the unit economics are bad for VC-funded incumbents, which is why there's room for a player-owner side project.

## Project Classification

- **Type:** Progressive Web App (PWA) + Hono API backend. pnpm monorepo, sibling to Wolf Cup under `tournament.dagle.cloud`.
- **Domain:** Sports / Golf scoring. Niche consumer hobby. No regulatory burden.
- **Complexity:** Medium. Domain logic has real depth — rule-schema with press mechanics, cross-foursome individual bets, constraint-based pairing across multi-day events, head-to-head money across non-co-grouped players. No team scaling concerns (solo dev). Hard external deadline: May 7, 2026.
- **Context:** Greenfield app with brownfield sibling (Wolf Cup). v1 reuses `stableford.ts` (pure) and copies Wolf Cup's GHIN client (no engine refactor, no Wolf Cup file edits). Tournament owns its own `Course`/`Group`/`Rule`/`Bet` schemas.
- **Business context:** The moat is market shape, not technology. Small, bursty audiences (one or two trips a year per group; weekly games invisible to outsiders) make the unit economics bad for VC-funded incumbents, which is why it's open for a player-owner side project. Monetization is not assumed; a per-club licensing path ($2/member, per-tenant subdomain) is a plausible future tier and shapes the 10-item future-proofing checklist in the brief.
- **Multi-tenancy posture:** single-tenant v1, subdomain-per-club multi-tenancy latent. Named v1.5 milestone: Guyan Thursday night league as second container type (League) and first real-world validation of format/rule flexibility.

## Success Criteria

### User Success

- **All 8 Pinehurst players use the app for all 4 rounds** (May 7–10) instead of falling back to paper. This is the primary v1 success signal.
- **Player first-arrival is friction-free:** invite link → roster-confirmed in ≤3 taps. No auth wall before teeing off on day 1.
- **On-course phone interaction is minimized** (UX principle, not just a metric). Players want to golf, not manage an app. Scorer enters scores and gets off the phone; spectators glance at the in-app leaderboard between shots when curious. No push notifications yank players out of the trip headspace (FD-5).
- **Scorers enter hole scores in ≤10 seconds per foursome** (tap number → auto-advance → done). Auto-presses fire silently; manual press is one tap with no confirmation dialog.
- **Spectators see leaderboard updates within 30 seconds** of scorer entry, across all 4 groups.
- **Head-to-head money is correct at settle-up** — players who never shared a foursome can see their balance against each other, matching hand-calculation.
- **If the app fails, the trip doesn't.** PDF pairings/schedule export produces a printable fallback on demand.
- **Setup time is unbounded.** Event creation, course loading, rule configuration, and player invites happen off-course. No time pressure on the pre-event flow.

### Business Success

- **Side project, not revenue-driven.** v1 success = 8-friend validation at Pinehurst.
- **v1.5 milestone:** Guyan Thursday night league adoption (first non-trip, first repeating-customer validation).
- **Per-club licensing path kept open** ($2/member, per-tenant subdomain). Not committed, not monetized in v1, but architecture doesn't foreclose it (10-item future-proofing checklist in brief).
- **No paid tier, no ads, no payment processing** in v1.

### Technical Success

- **Zero Wolf Cup regressions.** 854+ existing tests (464 engine + 390+ API) stay green through the entire tournament build. Wolf Cup (`apps/api`, `apps/web`) keeps its current names (FD-1); tournament scaffolds as `apps/tournament-api` + `apps/tournament-web` alongside. Only `packages/engine` pure functions are shared; no Wolf Cup runtime code paths are touched during tournament work without explicit approval and passing tests.
- **Offline-tolerant sync validated** via airplane-mode drill (enter scores offline, reconnect, merge cleanly) before May 7.
- **No push / SMS / email notifications validated** — per FD-5, all engagement is app-internal (toasts, banners, in-feed animations). Push validation removed from scope; the app creates pull, not push.
- **GHIN lookup works** (copied client + manual-override fallback when lookup fails or GHIN is down).
- **Course scorecard validator** rejects malformed data (par ∉ {3,4,5}, SI not 1–18 unique, Out/In totals mismatch).
- **CI runs engine + Wolf Cup API + tournament tests** on every commit; all green gate on deploy.
- **Tournament has its own DB, docker service, Traefik route, auth realm.** Wolf Cup DB is never opened by tournament code.

### Measurable Outcomes

| Metric | Target | When measured |
|---|---|---|
| Pinehurst player adoption | 8/8 players score all 4 rounds in-app | End of trip (May 10) |
| Score entry speed | ≤10s per hole per foursome (scorer familiar with UI) | During trip, informal observation |
| Leaderboard latency | <30s score-entry → visible update on other devices | Continuous during trip |
| Head-to-head money correctness | Matches hand-calculation for all pairs | End of trip settle-up |
| Paper fallback | PDF export generates correctly at any time | Always |
| Wolf Cup test suite | 854 tests green | Every commit |
| In-app engagement surfaces live | Toasts/banners/feed render score events inside app ≤ 6s after commit | During trip, continuous |
| Offline sync drill | Airplane-mode scores merge on reconnect | Before May 7 |
| 9-hole foursome test | No critical bugs surface (Josh + Jeff + Ben + 1) | Before May 7 |

## Product Scope

### MVP — Minimum Viable Product (v1, ships by May 7)

- Event container (single Event = Pinehurst May 7–10)
- One Group per Event (trip roster as implicit Group)
- Group entity fully in schema (members, rule sets, FK from events/rounds/players) — minimal UI (view/rename/edit rule sets/members)
- 2v2 best ball format with parameterized rule schema
- Press (manual button) + auto-press (N-down trigger family) + cross-foursome individual bets
- One-scorer-per-foursome scoring
- Offline-tolerant sync
- Live cross-group leaderboard
- Head-to-head money matrix across all players
- Schedule + pairings + course preview (screenshot-worthy reference surface)
- Player first-arrival flow (invite link → confirm → schedule view)
- PDF schedule/pairings export
- Course loader (scorecard PDF → vision parse → validate → save), seeded with 4 Pinehurst courses + #2 alternate
- GHIN handicap lookup (copied Wolf Cup client) + manual-override fallback
- In-app engagement surfaces (toasts/banners/animations on birdies, presses firing, leaderboard changes) — no push, SMS, or email (FD-5)
- Skins sub-game (gross / net / gross-beats-net modes, participant-scoped opt-in, carry on hole ties) — FD-11
- Carry-over greenies (2-putt validation; unclaimed rolls to next par 3) as 2v2 rule param — FD-12
- SSO identity (Google + magic-link email fallback) + one-time GHIN bind — FD-4
- Ecosystem foundation columns (`context_id`, `tenant_id`) on all writable tables — FD-6
- In-app install prompt (iOS instructions + Android `beforeinstallprompt`) — FD-14
- Per-event photo gallery (pattern reuse from Wolf Cup R2)

### Growth Features (v1.5, post-Pinehurst)

- Round container type (single-round flow)
- Multi-group library UI (group picker, group switcher, "start round with group X")
- Rule-set day-of-week last-used-on-this-weekday fallback suggestion
- Guyan Thursday night league (League container type with weekly recurrence, persistent member roster, attendance per week, season-long stats)
- Additional formats (Stableford standalone, Wolf ported generically from Wolf Cup engine, Nassau, BBB, low-round-of-day pot)
- Cross-group "two best balls" pot (gross/gross, gross/net, net/net configurable) and match-play points + team-win pot — big-trip bets deferred per FD-12
- Polies/greenies as skins-tiebreaker toggle (v1 ships skins without tiebreakers)
- Mid-round press button UX polish
- Player voting on rules/games for the week
- Predictions module (pick winners before event)
- User-contributed course photos with hole+course tags

### Vision (Future)

- Multi-club tenancy (subdomain-per-club, one SQLite DB per tenant, branding config per tenant)
- Per-club licensing tier ($2/member/year)
- Expanded format library (Sixes, BBB, Rabbit, Alternate Shot, Scramble)
- Inter-group rules conditional on field size (Saturday's $10/man 4-ball when 2+ groups present)
- Engine extraction: parameterize `packages/engine/src/course.ts` + fix tee-color leaks across Wolf Cup/tournament
- USGA/scorecard system-of-record reconciliation for course data
- Real GHIN reuse (extracted `@wolf-cup/ghin-client` package)
- NCRDB pipeline (Playwright-based) for course bootstrap at scale
- ~~SMS/iMessage bridge if push engagement proves insufficient~~ — retired per FD-5 (no push infrastructure, ever)
- Full rule-marketplace (browse/share rule sets across users)
- Cross-sport library (bowling, poker nights, tennis ladders) if the library thesis holds beyond golf

## Trip-Critical Scope Lock

**Deadline posture (revised 2026-04-13):** There is no hard external deadline. Pinehurst 2026-05-07 is the **target** testing window — a relaxed 8-player crew who knows about the app only through Josh, who will tolerate bugs and provide real feedback. If the foundation isn't ready by May 7, the next natural testing window is the **June trip (roughly 30 days later)**. The project posture is therefore **foundation-first, ship-when-solid**. No one outside Josh has expectations set; the downside of slipping past May 7 is "Josh is mildly disappointed," not "8 players are mad." This posture permits deeper schema and architectural work that pays off across 10+ trips per year.

This section names what the app **must do well** to be a real tournament app at all (trip-critical), versus what can land in a later release without breaking the thesis.

### Must ship (trip-critical)

1. Event creation with seeded or manually-entered course data.
2. Group + roster + rule set + pairings defined.
3. Invite-link first-arrival flow working.
4. Locked pairings + PDF export (paper fallback if app fails day-of).
5. Single-scorer score entry per foursome with authorization enforcement.
6. Offline queue + reconnect sync (port Wolf Cup pattern).
7. Deterministic money engine (2v2 best ball + press + auto-press + cross-foursome bets).
8. Head-to-head money matrix + settle-up view.
9. Live cross-group leaderboard.
10. Score correction audit log.
11. Round lifecycle states (not_started / in_progress / complete_editable / finalized).
12. Live 9-hole validation round before target Event date.
13. **Skins pot runnable alongside 2v2 on day 1** (FD-11): gross / net / gross-beats-net modes, participant-scoped opt-in, carries on hole ties.
14. **Carry-over greenies** (FD-12): 2-putt validation; unclaimed rolls to next par 3.
15. **SSO + GHIN bind** (FD-4) with manual-HI bailout (FD-13 guardrail 2) — auth must not fail the trip on captive-portal wifi.
16. **Mid-event rule-edit path** (FD-13 guardrail 1) — organizer can fix a wrong param day 2 without DB surgery.
17. **In-app engagement surfaces** (FD-5) — no push, SMS, or email ever; event spine + toast/banner/feed must work.
18. **In-app install prompt** (FD-14) + browser-tab read-only graceful degradation.

### Can miss target, ship in next window

1. GHIN lookup automation (manual handicap entry is acceptable v1 path; captive-portal / hotel-wifi failure bails out to manual entry per FD-13).
3. Course PDF vision parser (manual course entry works; parser is convenience, not blocker).
4. Pairing optimizer intelligence (manual pairing UI is enough; smart suggest can follow).
5. Dedicated Bets page UI (data visible via Money page is sufficient initially).
6. Manual-press UI polish (capability must ship; aesthetic refinement can lag).
7. Photo gallery, course preview richness, advanced spectator features.
8. Cross-event stats surfaces (schema foundation is v1; stats UI is v1.5+).

### Design Principles (PRD-level, added 2026-04-13/14)

1. **App creates pull, not push** (FD-5). Engagement surfaces live inside the app; no OS push, no SMS, no email.
2. **Data-entry cost paid only by participants who benefit** (FD-10). Optional data fields (putts, sandies, etc.) asked only of opted-in participants; rejected otherwise.
3. **Stats + gallery = retention thesis.** The off-season compound surface is what keeps groups in the app between trips. Business Success tests against it.
4. **The app remembers how this group plays golf.** Primary wedge. Group memory (rosters, rule sets, pairings patterns, history) is the thing no competitor centers.

### Explicitly out of v1

- Round container type (v1 ships Event only).
- League container type (Guyan Thursday).
- Multi-tenancy (subdomain-per-club).
- Rule marketplace / cross-user rule sharing.
- Any monetization, paid tier, or payment processing.

## User Journeys

User types: **Josh** (Organizer + Scorer + Player, all three hats), **Jeff** (Scorer + Player for one foursome), **Mark** (Player + Spectator, avoids fiddling with apps), **Rick** (Power user with cross-foursome individual bets). No admin/ops (Josh is it), no API consumers, no support role.

### Journey 1 — Josh the Organizer (Happy Path, Setup Through Settle-up)

**Opening scene.** It's April 14, 2026. Josh is at his kitchen table with a cup of coffee and a draft of the Pinehurst trip roster in his phone's Notes app. Eight guys, four rounds, four courses. Historically this is the moment he'd build a Google Sheet that nobody would look at until May 6. Instead, he opens `tournament.dagle.cloud` on his laptop, clicks **Start an Event**, types "Pinehurst May 2026," picks the four dates, and searches the course library. Three of the four courses are already loaded (he loaded them during the scorecard OCR spike). Pinehurst No. 2 he loads fresh — uploads the PDF, vision parser returns tees + hole table, validator flags one hole's par (the known BlueGolf discrepancy), Josh edits it manually, saves.

**Rising action.** Josh creates the Group: "Pinehurst Crew 2026," adds 8 players by name. GHIN lookup pulls 6 of 8 handicaps automatically; 2 he enters manually. He picks the 2v2 best-ball rule preset, tweaks a few parameters (sandies on, auto-press at 2-down — "Rick and Scottie's thing"), names it "Pinehurst stakes," saves it to the Group. He opens the pairings page, hits **Suggest ("everyone plays everyone once")**, reviews the grid for all 4 rounds, manually pins himself with Ben on day 1, locks the rest. Shares the invite link in the iMessage chat: "pairings are set, app here."

**Climax.** May 7, 8:30 AM at Talamore. Josh tees off with Ben, Jeff, and Mark. As scorer for his foursome, he taps hole 1, enters four numbers, taps next. Takes 8 seconds. He doesn't touch the phone again until hole 2.

**Resolution.** May 10, 7:00 PM, hotel lobby. Four rounds done, 72 holes scored. Josh opens the Money page — head-to-head matrix shows Rick is up $47 on Mark across all 4 rounds (they shared only 1 group). Rick and Scottie's auto-press bet has fired 4 times; Rick owes Scottie $80. Josh walks through the settle-up screen with everyone, money changes hands in cash, nobody argues because the math is visible. On the drive home, the iMessage chat has 40 screenshots from the app.

**Requirements revealed:** Event creation wizard, course loader (OCR + validator + manual edit), Group CRUD, rule-preset editor, pairings with constraint presets + manual override, scorer entry UI, money page with head-to-head matrix + settle-up view, shareable invite links.

### Journey 2 — Jeff the Scorer (On-Course, One Foursome)

**Opening scene.** May 8, 9:15 AM at Mid Pines. Jeff is scorer for his foursome (himself, Rick, Scottie, Mark). He opens the app, taps into today's round. The scorecard loads offline-cached — good, because Mid Pines back 9 has dead cell.

**Rising action.** Hole 1: Jeff shoots 4, Rick 5, Scottie 4, Mark 6. He taps the numbers in sequence, auto-advance takes him to hole 2. 9 seconds. He pockets the phone. Hole 2: same deal. On hole 5 the app fires an auto-press — Rick is now 2-down in his bet with Scottie. Little in-app banner: "Auto-press: Rick ↔ Scottie, stakes doubled." Jeff glances, keeps playing. On hole 7, Scottie makes a birdie. Jeff enters the score. Mark, curious between shots, pulls out his phone and opens the app himself — the leaderboard shows Scottie's move with an in-app toast. No buzz, no notification pulling anyone out of the round (FD-5). Mark shouts something sarcastic, Rick grumbles.

**Climax.** Hole 14 at Mid Pines, zero bars. Jeff enters 4 holes offline. Hole 18, bars return. The app shows a tiny sync indicator; five seconds later, the leaderboard on Josh's phone (in group 1 already on the putting green) updates with their four scores.

**Resolution.** 3:45 PM, back at the clubhouse. Jeff's group finishes. The round closes, final leaderboard shows for the day. Everyone screenshots it and throws it in the iMessage chat.

**Requirements revealed:** Scorer entry UI with auto-advance, offline-tolerant score entry, sync indicator + retry logic, auto-press evaluation engine, in-app toasts/banners on qualifying events (FD-5), leaderboard update on sync.

### Journey 3 — Mark the Reluctant Player (First-Arrival + During Event)

**Opening scene.** May 6, 10 PM. Mark gets a text from Josh: "pairings for Pinehurst, tap here." Mark has never used a golf app. He taps, dreading a sign-up wall.

**Rising action.** Lands on the Pinehurst event home. Countdown: "1 day until tee-off." His name is pre-filled at the top: "You're playing — tap to confirm." One tap. Schedule appears — 4 courses with hero images, tee times, his pairings for each day. Mark spends 30 seconds scrolling. He taps Pine Needles hole 17 — the app shows yardage and a photo. He closes the app. Done.

**Climax.** May 8, mid-round at Mid Pines. Between shots on hole 8, Mark pulls his phone out just to check the leaderboard. Opens the app — a subtle in-app banner at the top reads "Scottie just birdied 7." Scottie moved up 2 spots, Mark is in 5th. Screenshots it, throws it in the chat with "Scottie's on a heater 🔥." Closes the app. No buzz pulled him out — he chose to look (FD-5). On hole 12, Mark is curious how his own foursome stacks against group 1, opens the app, views the cross-group leaderboard, closes the app. That's the pattern — glance, get back to playing.

**Resolution.** May 10 evening. Mark opens the app one more time, sees the final money page. He's down $23. Pays Rick in Venmo from the Venmo app. Doesn't have to think about whether the math is right — the screen shows hole-by-hole with the bets clearly. Closes the app, trip over.

**Requirements revealed:** Invite-link first-arrival flow (SSO + GHIN bind per FD-4), hero course images, in-app engagement surfaces (toasts/banners/animations; no push per FD-5), screenshot-worthy leaderboard, hole-by-hole money breakdown, **cross-group leaderboard viewable by anyone at any time** (including spectators in other foursomes mid-round).

### Journey 4 — Rick the Power User (Cross-Foursome Bet)

**Opening scene.** April 20, at home. Rick DMs Josh: "me and Scottie need our auto-press thing. And I got a $5/hole match going with you all 4 days. Can the app do that?"

**Rising action.** Josh opens the Group rule editor, adds two individual bets:
- Rick ↔ Scottie, "auto-press at 2-down," multiplier 2x
- Rick ↔ Josh, $5/hole match play, no press

Josh shares the updated rules with Rick. Rick opens his app, sees his Bets page listing both bets with status "Not started yet." He's happy.

**Climax.** May 7, Rick and Josh are in different foursomes at Talamore. On hole 7, Rick (group 2) shoots a 3. Josh (group 1) shoots a 4. The app computes the hole head-to-head: Rick wins $5. Rick's Bets page updates live: "Rick ↔ Josh: Rick +$5." Zero input from either of them — the engine pulled hole scores from both scorecards and computed automatically. Meanwhile in Rick's own foursome, Scottie is 3-up through 8; the auto-press fires silently, Rick sees a banner on hole 9 telling him the stakes doubled.

**Resolution.** May 10 settle-up. Rick's four-day head-to-head with Josh: Rick up $35. Rick-Scottie auto-press: Rick down $80 (auto-presses compound when you're losing). Net to Rick: -$45. Everything's visible on the Bets page, no spreadsheet needed, Rick finally retires his notepad.

**Requirements revealed:** Cross-foursome individual bet schema, auto-press trigger evaluation engine, Bets page UI (per-player, per-bet live standing), hole-by-hole score pull from multiple scorecards, money aggregation across team + side bets into unified settle-up.

### Journey Requirements Summary

Capabilities revealed across the four journeys:

- **Event creation & management:** wizard, course loader with OCR + validator + manual edit, Group CRUD, rule-preset editor + saved rule sets, pairings (constraint-presets + manual override), invite-link generation
- **Scorer UX (high streamlining bar):** fast entry (tap + auto-advance, ≤10s/foursome), offline-tolerant, sync indicator, auto-press silent firing with on-screen banner, manual press button (1-tap, undoable)
- **Player/spectator UX:** lazy-auth invite-link first-arrival flow, schedule view, course previews with hero images + hole detail, Bets page (per-player live standing), money page (head-to-head matrix + hole-by-hole breakdown), screenshot-worthy leaderboards
- **Cross-group leaderboard visibility:** anyone — scorer, spectator, or player in another foursome — can pull up the live cross-group leaderboard at any time during an event. "Glance, get back to playing" is the explicit usage pattern.
- **Engagement loop (FD-5 "pull not push"):** in-app toasts/banners/animations on score movement → player pulls phone out between shots → screenshot → iMessage chat (app is content source, not chat venue; no push, SMS, or email ever)
- **Settle-up:** unified end-of-trip money view combining team games + individual cross-foursome bets
- **Offline:** full score entry + sync-on-reconnect; course data cached locally
- **Export:** PDF schedule/pairings (trust insurance)
- **GHIN:** lookup at event setup, manual override fallback

## Domain Requirements

Each requirement is testable and traceable to a Step 4 journey (J1–J4) or Step 3 success criterion, scoped to v1 unless tagged `[v1.5]` or `[vision]`.

### Functional Requirements

#### FR-A — Event & Group Management

- **FR-A1** System shall create an Event with name, date range, and an ordered list of rounds (each round = date + course + tees). *(J1)*
- **FR-A2** System shall load a course from a scorecard PDF via vision parser, producing tees + 18-hole table (par, SI, yardage per tee). *(J1)*
- **FR-A3** System shall run a course validator rejecting: par ∉ {3,4,5}, SI not 1–18 unique, Out/In totals inconsistent with per-hole values.
- **FR-A4** System shall allow manual edit of any parsed course field post-validation. *(J1 — BlueGolf discrepancy)*
- **FR-A5** System shall persist a Group entity with name, members (name + optional GHIN + handicap), and saved rule sets. *(J1)*
- **FR-A6** System shall look up a player's handicap index by GHIN number via copied Wolf Cup client, with manual override when lookup fails.
- **FR-A7** System shall save and reuse rule sets within a Group (name + parameterized rule config). Minimum v1: one saved rule set per Event.
- **FR-A8** System shall suggest pairings across a multi-round Event honoring constraint preset "everyone plays everyone once" with manual pin/lock per slot. *(J1)*
- **FR-A9** System shall generate a per-Event invite link that routes first-arrival users to a roster-confirmation screen (no auth wall). *(J1, J3)*

#### FR-B — Scoring

- **FR-B1** System shall designate one scorer per foursome; scorer is the only role permitted to enter gross hole scores for that foursome.
- **FR-B2** Scorer entry UI shall accept four gross scores per hole with auto-advance to the next hole after the final entry. Target: ≤10s per foursome per hole. *(J2)*
- **FR-B3** System shall accept score entry while offline, queue mutations locally, and sync to server on reconnect without data loss. *(J2 climax)*
- **FR-B4** System shall show a visible sync indicator whenever queued mutations exist, and resolve within 30s of connectivity returning.
- **FR-B5** System shall cache the active round's course data and scorecard shell locally so score entry functions with zero server connectivity after the round is opened once online.
- **FR-B6** System shall allow a scorer to correct a previously-entered hole score at any time during the Event; correction re-triggers downstream money/bet recomputation. No explicit time-gate (trip is 4 days; post-trip corrections are out of scope by reality, not by rule).
- **FR-B7** System shall support scorer role transfer. Organizer or current scorer can reassign the scorer role for a foursome to any participant in that foursome mid-round. Transfer is atomic, preserves all entered scores, and produces a visible handoff state on both old and new scorer devices. *(Codex review — dead-phone recovery)*
- **FR-B8** System shall record an immutable score-correction audit log with: actor (user id), hole, group, round, prior value, new value, timestamp, and client event id. Audit log is visible to organizer and, within the correction's Group, subject to the Group money-visibility posture (FR-D9). Port from Wolf Cup `apps/api/src/routes/admin/score-corrections.ts` pattern. *(Trust insurance for money-affecting edits)*
- **FR-B9** System shall model round lifecycle with explicit states: `not_started | in_progress | complete_editable | finalized | cancelled`. Each transition enforces gate conditions (e.g., finalize requires all 18 holes scored for all players) and logs actor + timestamp. No silent state changes.
- **FR-B10** Scoring shall use a single-writer model: exactly one scorer may commit gross score mutations per foursome at any moment (enforced via session.userId check against round.scorerAssignments[groupId]). Offline mutations queue locally (IndexedDB), drain in hole-number order on reconnect, and resolve conflicts at the DB layer via `onConflictDoUpdate` on `(roundId, playerId, holeNumber)` — last-write-wins, idempotent on replay. Duplicate queue entries (same client event id) are dropped server-side. Port queue mechanics from Wolf Cup `apps/web/src/lib/offline-queue.ts` verbatim; add the authorization check that Wolf Cup omits.

#### FR-H — Permissions & Roles

Roles: **organizer** (event creator), **scorer** (designated per foursome per round), **participant** (player on the roster), **spectator** (invite-link read-only, non-roster).

- **FR-H1** Edit event, rules, pairings — organizer only. **Rule-config is editable mid-event** (FD-13 guardrail 1): change is audit-logged, stamped with effective-hole boundary, applies forward; engine recomputes money/leaderboard from boundary forward. A visible diff banner surfaces to all participants so no silent drift occurs.
- **FR-H2** Assign/transfer scorer role — organizer, or current scorer (transfer only).
- **FR-H3** Commit/correct gross scores for a foursome — designated scorer only (FR-B10).
- **FR-H4** Generate PDF schedule/pairings — any participant (read-only artifact).
- **FR-H5** View money matrix & settle-up — all Group members, subject to Group money-visibility posture (FR-D9). Spectators never see money in any mode.
- **FR-H6** View bets — each participant sees bets they are party to; organizer sees all; spectators see none.
- **FR-H7** Upload photos to gallery — any participant; organizer can delete.

#### FR-C — Leaderboard & Live Updates

- **FR-C1** System shall display a live cross-group leaderboard accessible to any Event participant (scorer, player, or spectator) at any time during the Event. Spectators include non-player viewers (e.g., family members) via invite link with read-only access. *(J3)*
- **FR-C2** Leaderboard updates shall propagate from scorer entry to other participants' devices in <30s under normal connectivity.
- **FR-C3** System shall surface qualifying score-movement events as **in-app toasts / banners / feed entries** inside the leaderboard, gallery, and player-home surfaces — never as OS push notifications, SMS, or email (FD-5 "App creates pull, not push"). v1 in-app trigger set: birdie or better, lead change, auto-press fire, bet standing flip, award trigger.
- **FR-C4** No push / SMS / email notification infrastructure ships in v1 or v1.5. Engagement is strictly pull-based. (This is a **core design principle**, not a deadline-driven cut — per FD-5.)
- **FR-C5** Leaderboard tie-break ordering shall be explicit and consistent: (1) primary score metric (format-dependent — stableford points for best-ball variants), (2) gross strokes ascending, (3) back-9 count-back, (4) hole-by-hole comparison from 18 backward. Match-play contexts use holes-up / holes-remaining instead.

#### FR-D — Rules, Money & Bets

- **FR-D1** System shall support 2v2 best ball (the "Guyan Game") as the v1 team format, parameterized over: **sandies (on/off, v1)**, auto-press trigger (N-down), press multiplier, **`greenie_carryover` (boolean, default off; FD-12)**, **`greenie_validation` enum `'2-putt' | 'none'` (default `'2-putt'` when carryover on)**. When `greenie_carryover` is on, an unclaimed or unvalidated greenie rolls to the next par 3; last par 3 can accumulate up to 4× base value. *(J1)*
- **FR-D2** System shall support manual press via one-tap button by any player in a foursome, undoable before the next hole is scored.
- **FR-D3** System shall support cross-foursome individual bets between any two Event participants, regardless of whether they share a foursome on any given round. *(J4)*
- **FR-D4** Supported individual-bet types v1: match play $/hole, match play with auto-press at N-down.
- **FR-D10** *(FD-10/11, new)* System shall support **sub-games** as first-class, round-scoped, participant-scoped entities. Any subset of a round's participants may opt into any sub-game; pot = sum of opt-in buy-ins. Each sub-game type declares its data requirements (data-entry cost principle: optional fields asked only of opted-in participants).
- **FR-D11** *(FD-11, new)* System shall support **Skins** as the v1 sub-game. Per-hole outright-winner scan across the whole group; modes `gross`, `net`, `gross_beats_net` (gross skin wins outright; net applies only when no gross skin). Ties carry to the next hole; unclaimed pot at hole 18 splits proportionally among the rounds' skin winners (or rolls to next round of the same Event — organizer choice captured in sub-game config). Polies/greenies as tiebreakers deferred v1.1.
- **FR-D12** *(FD-10, schema)* Sub-game types recognized by schema in v1 (scaffolded, not implemented beyond Skins): `skins`, `ctp` (closest-to-pin), `sandies`, `putting_contest`. Only `skins` has implementation code in v1; others are schema stubs so future work is additive, not migrational.
- **FR-D5** Auto-press engine shall evaluate trigger conditions after every hole-score commit and fire silently (no confirmation prompt); firing shall produce a visible banner on affected players' devices. *(J2, J4)*
- **FR-D6** System shall compute a head-to-head money matrix across all Event participants, including pairs that never shared a foursome, as the sum of all applicable team-game results + individual bets across all rounds. *(J1, J4)*
- **FR-D7** Settle-up view shall show per-player net balance and a drill-down of hole-by-hole bet/team contributions.
- **FR-D8** Money computations shall be deterministic and reproducible: recomputation from raw scores + rule config produces identical output.
- **FR-D9** Group-level money-visibility posture shall be a Group property with enum values: `open` (all Group members see all balances and bets — Pinehurst default), `participant` (each member sees only rounds they played in), `self_only` (each member sees only their own balance; others see only "settled / owed / paid" without dollar amounts). v1 ships `open` only; schema column present and defaulted so v1.5 can add `participant` / `self_only` without migration. Audit log visibility (FR-B8) is mode-aware — under `self_only`, corrections to other players' scores surface actor+hole but redact prior/new dollar deltas.

#### FR-E — Player Experience

- **FR-E1** First-arrival flow from invite link shall reach "you're in, here's the schedule" in ≤3 taps: invite-link tap → Google SSO (or magic-link email fallback) → one-time GHIN lookup + confirm → done. *(J3, FD-4)*
- **FR-E2** Read-only access (schedule, pairings, course previews) shall be available pre-SSO via the raw invite link. Mutating actions (scoring, creating/editing) require completed SSO + GHIN bind.
- **FR-E8** *(FD-14, new)* System shall show an **in-app install prompt** after first SSO: iOS animated "Tap Share → Add to Home Screen" instruction card; Android uses `beforeinstallprompt` for one-tap install. Dismissable; reappears at most once on 2nd open; never after install completes.
- **FR-E9** *(FD-14, new)* Browser-tab (non-installed) usage shall render read-only leaderboard / standings / pairings / schedule without error. Scorer flow requires PWA install for offline-queue reliability; UI surfaces a clear "install to score" prompt when a non-installed user opens a scorer surface.
- **FR-E10** *(FD-4, new)* If GHIN lookup fails (captive portal, hotel wifi, GHIN outage), system shall provide a **manual-entry bailout**: enter handicap index manually, proceed; flag for later reconciliation when network returns.
- **FR-E3** Schedule view shall display each round's date, course (with hero image), tee times, and the viewer's pairing for that round.
- **FR-E4** Course preview shall include per-hole detail (par, yardage, SI) and at least a hero image for the course.
- **FR-E5** System shall support per-Event photo gallery with R2 storage (reusing Wolf Cup gallery pattern).
- **FR-E6** Bets page shall display each individual bet a viewer participates in, with live running standing. *(J4)*
- **FR-E7** Event dates, round dates, and tee times shall be stored and rendered in the Event's declared local timezone (not server TZ, not UTC). Event creation captures the timezone; all date math uses it.

#### FR-F — Export & Trust

- **FR-F1** System shall export a printable PDF schedule + pairings for the full Event on demand. *(J1)*
- **FR-F2** PDF export shall function regardless of app availability (generated server-side, downloadable, self-contained).

#### FR-G — Deployment Isolation

- **FR-G1** Tournament shall deploy to `tournament.dagle.cloud` with its own Traefik route, docker service, SQLite volume, and auth realm, sharing no database files or runtime process with Wolf Cup.
- **FR-G2** Tournament code shall not read, write, or import from Wolf Cup's `apps/api` or `apps/web` source; shared dependencies limited to `packages/engine` read-only.

### Non-Functional Requirements

#### Performance

- **NFR-P1** Scorer hole-entry interaction shall complete (tap to auto-advance) in ≤10s for a familiar user.
- **NFR-P2** Leaderboard update propagation shall be <30s end-to-end under typical LTE connectivity.
- **NFR-P3** Event home page shall load and render the schedule in <2s on a cold PWA launch with warm cache.

#### Reliability & Offline

- **NFR-R1** Score entry shall remain fully functional with zero connectivity for the duration of an 18-hole round.
- **NFR-R2** Offline-queued mutations shall merge without data loss or duplication on reconnect, validated by an airplane-mode drill before 2026-05-07.
- **NFR-R3** Atomic finalization: if any post-round computation (money, bets, leaderboard close) fails, the round shall remain in its pre-finalize state — no partial writes.

#### Security & Auth

- **NFR-S1** Invite links shall grant read-only access scoped to one Event. Scoring/editing requires an authenticated session via SSO (FD-4).
- **NFR-S2** Authentication uses **Google SSO** (primary) + **magic-link email fallback**. No passwords in v1. Apple SSO deferred to v1.5. After SSO, a one-time GHIN lookup + confirm binds `players.apple_sub` / `players.google_sub` + `players.ghin` as the trust anchor. Re-binding requires re-verification.
- **NFR-S3** Only designated scorer for a foursome may commit gross score mutations for that foursome (FD-3 hole-level soft-lock: first-writer claims; subsequent writers get "overwrite?" confirmation; full audit log on every touch).

#### Correctness

- **NFR-C1** For all Event participant pairs, the head-to-head money matrix shall match hand-calculation at settle-up.
- **NFR-C2** Engine-level tournament tests shall include golden-file fixtures for each supported rule variant.
- **NFR-C3** Wolf Cup test suite (854 tests) shall remain green on every commit.

#### Deployability

- **NFR-D1** CI shall run engine + Wolf Cup API + tournament tests on every commit and gate deploy on all green.
- **NFR-D2** Course data shall be importable (courses JSON seed) and re-importable without breaking existing Events referencing a course.

#### Observability & Recovery

- **NFR-O1** Production shall log score-mutation sync failures, money/side-game recompute failures, notification delivery failures, and course-parse failures, each tagged with enough context (event id, round id, user id, hole, timestamp) for rapid manual diagnosis by a solo developer under deadline pressure. Not enterprise telemetry — a single append-only log file + structured JSON lines is acceptable.
- **NFR-B1** System shall support on-demand export of raw Event state (scores, rounds, players, rule config, money ledger, audit log) as downloadable JSON. Purpose: disaster recovery, external verification, data portability. Organizer-only.

#### Device Support Floor

- **NFR-Dev1** Primary support: iOS Safari installed as PWA (scorer + player use case) + desktop Chrome/Edge (organizer setup use case). Best-effort: Android Chrome, desktop Safari, desktop Firefox. Out of scope: older iOS versions (<16), Windows mobile, non-Chromium Android browsers.

### Traceability (sample)

| Requirement | Traces to | Test |
|---|---|---|
| FR-B2 (≤10s entry) | J2, Step 3 user success | Manual timing drill on 9-hole practice round before 2026-05-07 |
| FR-D6 (head-to-head matrix) | J1, J4 resolution | Golden-file tests with hand-calc fixtures |
| FR-C1 (cross-group leaderboard anyone) | J3 climax | E2E: non-scorer player views leaderboard mid-round |
| NFR-R2 (offline merge) | J2 climax | Airplane-mode drill scripted before 2026-05-07 |
| FR-F1 (PDF export) | J1 | Generate PDF at any lifecycle state, visually verified |
| FR-G1 (deployment isolation) | Step 3 tech | Verify separate volume + service in docker-compose |

### Resolved Scope Decisions (2026-04-13)

1. **Sandies** — IN v1 as a rule-config toggle on the 2v2 best-ball format.
2. **Score correction window** — no hard gate; event-duration reality is the natural bound.
3. **Notification trigger set** — v1: birdie-or-better + lead change. Add more post-launch if feedback demands.
4. **Non-player spectators** — IN v1. Invite-link read-only access covers family/remote viewers.

## Foundation Decisions

Decisions that shape v1 schema and architecture. Recording here so Step 7 (Technical Decisions) inherits them as locks, not open questions.

### FD-4: Player identity — SSO + GHIN bind (no passwords v1)

- `players.id` is the local primary key, stable forever.
- `players.ghin` is a **nullable unique** column. Populated when known; used as the join key across Events for cross-event stat aggregation.
- `players.apple_sub` and `players.google_sub` are **nullable unique** columns (partial unique indexes where non-null). Populated on first SSO bind.
- **Read access** (stats, leaderboard, money matrix subject to posture) is low-friction: invite-link click + SSO tap (Google primary, magic-link email fallback) → device cookie binds device to player id. Apple SSO deferred to v1.5 ($99/yr Apple Developer cost unjustified at current scale).
- **Write access** (score entry, corrections) uses the same SSO identity. Hole-level soft-lock (FD-3) prevents accidental crossover: first scorer claims a hole; subsequent writers get "overwrite?" confirmation. Full audit log on every touch.
- **Admin actions** (edit rules, finalize rounds, delete data, merge players) gated on organizer identity from SSO (v1 = Josh as sole admin; FD-13 encodes single-admin guardrails).
- **GHIN bind is one-time after SSO**: lookup on ghin.com → confirm → bind. Re-binding requires re-verification (friction as deterrent). `players.ghin` + `players.apple_sub` / `players.google_sub` together form the trust anchor.
- Non-GHIN players (trip guests, new golfers): SSO-only identity; no cross-event aggregation. If they later get a GHIN, UPDATE `players.ghin` — historical data auto-joins because FKs point at `player_id`, not GHIN. No migration.
- GHIN can change in reality (club switch, number reissue). Schema includes a `player_identity_merges` table so admin can merge two local player records without rewriting history. v1 UI exposes this as an admin-only action; v2 can automate.

### FD-6: Cross-context stats foundation — ecosystem columns on every writable table

- **Every writable domain table** carries `context_id TEXT NOT NULL` and `tenant_id TEXT NOT NULL` from day one. Wolf Cup's migration 0025 (completed + deployed 2026-04-14) added these to all 17 Wolf Cup tables before first live round. Tournament inherits the convention on every new table.
- **`context_id` taxonomy** (loose, naming convention not enforced):
  - `league:*` for seasonal leagues (`league:guyan-wolf-cup-friday`)
  - `event:*` for bounded trips (`event:pinehurst-may-2026`)
  - `group:*` for recurring-no-season groupings
  - `ad-hoc:*` for one-offs
- **`tenant_id`** separates clubs / organizations. `'guyan'` for Josh's current world; multi-club is latent architecture.
- **No stats service in v1.** Columns are insurance; federation code comes v2+ when 3+ contexts exist.

### Money visibility is a Group property, not a global setting

- `groups.money_visibility` enum: `open | participant | self_only`.
- v1 ships `open` only; column present for v1.5 to add the other modes without migration.
- Pinehurst default: `open`. Cut-throat Thursday regulars will want `self_only`.
- Audit log visibility (FR-B8) is mode-aware: under `self_only`, corrections to other players' scores surface actor+hole but redact prior/new dollar deltas so the correction is auditable without leaking balance info.

### Course data is durable across re-tees

- `courses` carries a `revision` concept. A 2027 Pinehurst No. 2 resurfacing produces a new revision row, not an in-place update. Historical rounds computed against revision N stay valid forever.
- Scoring rounds pin `course_revision_id`, not just `course_id`. Money and leaderboard recomputations use the pinned revision.

### Cross-event stats are v1 schema, v1.5+ UI

- v1 schema foundation supports cross-event rollups (durable player id, durable course revisions, complete hole-level data with context, visibility-aware reads).
- v1 UI does **not** ship cross-event stats surfaces. "Alan's Volkswagen game provable" is a v1.5+ feature.
- Principle: make the decision in v1 schema that makes v1.5+ cross-event analytics *data-joinable without migration*. This is cheap now, expensive later.

### FD-1: Monorepo posture — no rename

- **Wolf Cup keeps its current names** (`apps/api` + `apps/web`) indefinitely. No pre-tournament rename.
- Tournament scaffolds as `apps/tournament-api` + `apps/tournament-web` **alongside** Wolf Cup. No shared DB, no shared runtime, explicit package boundaries.
- `packages/engine` stays the shared home for pure-function rule primitives (`stableford.ts` already there, `best-ball-2v2.ts` + `skins.ts` join via extraction per rule-of-three).
- Rationale: Wolf Cup ships its first live round 2026-04-17 (3 days from PRD signoff); renaming a shipping app for aesthetic parity is unjustified risk. CLAUDE.md disambiguation note: `apps/api` + `apps/web` = Wolf Cup; `apps/tournament-*` = Tournament.

### FD-2: Port posture — copy verbatim, no shared package for ported code

- Port targets (offline queue, GHIN client, PDF gen, photo gallery, auth middleware shape, audit log pattern, iOS keyboard fix) get **copied** into tournament's tree.
- Not shared in `packages/*`. Only `packages/engine` pure functions are shared.
- Rationale: Wolf Cup is in maintenance mode (rules change ~once/year by vote); tournament is in discovery mode with hundreds of unknowns. Shared code would tax Wolf Cup with churn it doesn't need.
- Rule-of-three trigger: extract when the same file has been copy-modified 3+ times.

### FD-3: Scoring — hole-level soft-lock + full audit log

- Replaces drafted "strict scorer-auth enforcement."
- First-writer-to-a-hole claims it; subsequent writers get **"Alan entered hole 3, overwrite?"** confirmation.
- Full audit log on every touch: original value, new value, who, when.
- Identity for the audit entry comes via device cookie + SSO (FD-4).
- Tournament-mode peer-attestation deferred to v1.5 — schema supports it via `scoring_mode` enum + `attestor_user_id` nullable column.

### FD-5: Notifications — app-internal engagement only (core design principle)

- **No push notifications. No SMS. No email notifications.**
- Every social moment (birdies, presses firing, leaderboard changes, award triggers) surfaces **inside the app** as toasts, banners, animations, feed entries.
- Rationale: lock-screen buzzes yank users to the Messages app where work texts live, killing trip headspace. The app creates pull, not push.
- This is a **core design principle**, not a v1 choice — every future notification decision tests against it.
- Saves all push infrastructure work. Simplifies architecture considerably.

### FD-7: Round is the atomic stats unit

- Seasons, events, series are **optional groupers**, not required parents.
- `rounds.season_id`, `rounds.event_id` nullable.
- A Sunday round at Guyan with no season membership is still a full stats-producing unit.

### FD-8: Rule sets are tenant-scoped, named, revisioned

- `rule_sets` table at **tenant scope** (not Group scope as drafted in earlier FR-A7 text).
- "Rick's Nassau" is one row, referenced by multiple Groups / Events within the tenant.
- **Rule-set revisions** (same pattern as course revisions): rule config evolves, rounds pin a specific `rule_set_revision_id`, historical rounds stay accurate.
- Enables stats aggregation either by rule-set identity (all versions of Rick's Nassau) or by exact revision (this precise config).

### FD-9: Filter cube for stats

Primary filter = **date range / year** (Sunday end-of-year dinner use case: this-year real, prior-years proven-over-time).

Full filter dimensions (v1.5+ UI):
- Date range / day-of-week / season
- Contexts (multi-select)
- Rule sets (multi-select, with or without revision specificity)
- Participants / partners / opponents
- Stakes / monetary threshold
- Courses / venues

### FD-10: Sub-games are first-class, participant-scoped

- Any subset of a round's players can opt into any sub-game.
- Sub-game types (`skins`, `ctp`, `sandies`, `putting_contest`, future) each declare their data requirements.
- **Data-entry cost principle**: optional data fields are asked only of opted-in participants. GIR / fairway tracking **rejected** on this principle. Putts for putting-contest participants **accepted** (participants pay, participants benefit).
- **Sub-games are round-scoped, not group-scoped.** Rick in Group 1 + Scott in Group 2 can run a putting contest; each scorer prompts for putts for their group's participants only; engine federates at compute time. Same pattern as cross-foursome $/hole matches.

### FD-11: Skins in v1 as the first concrete sub-game

- 2v2 "Guyan Game" (Wolf-rules-derived best ball with parameter toggles per FR-D1) is the primary format.
- **Skins** is a per-hole outright-winner scan across the whole group — same shape as Wolf Cup's side-game skins calc. Runs alongside 2v2; independent pot.
- **Three modes** (rule-config toggle): `gross`, `net`, `gross_beats_net` (gross wins outright; falls back to net if no gross skin).
- Participant-scoped per FD-10: subset opts in, pot splits among opt-ins, carries on hole ties.
- Polies/greenies as tiebreaker: deferred to v1.1.
- Engine cost: ~150 LOC, new `packages/engine/src/formats/skins.ts`, golden-file tested. 1-2 days.
- UI cost: opt-in toggle on round setup + skins column on leaderboard. Half day.

### FD-12: v1 bet menu stays lean; carry-over greenies as 2v2 rule param

Pinehurst crew is small-stakes; big-trip bet menu deferred.
- **v1 bets**: press + auto-press (FR-D1), cross-foursome individual bets (FR-D3/D4), skins (FD-11), **carry-over greenies** as new 2v2 rule param (FR-D1 `greenie_carryover` / `greenie_validation`).
- **Carry-over greenies**: toggle on/off; 2-putt validation required to claim; unclaimed/unvalidated rolls to next par 3; last par 3 can accumulate up to 4× base value. Engine change ~50 LOC in `best-ball-2v2.ts` + golden-file tests for the carry chain.
- **DEFER to v1.1** (tracked in OOS, not forgotten): cross-group "two best balls" pot (gross/gross, gross/net, net/net modes), match-play points + team-win pot, Nassau, BBB, low-round-of-day.

### FD-13: Single-admin v1 with four guardrails

Pinehurst reality: Josh is sole organizer; 5hr car ride with 4 players = onboarding runway; Eric pre-briefed at work = de facto scorer for the other foursome. No co-organizer UI in v1.

- **Guardrail 1 (mid-event rule edit)**: Rule-config editable mid-event; change audit-logged, effective-hole boundary, applies forward; engine recomputes money/leaderboard from boundary forward; visible diff banner to participants. Golden-file fixture includes a mid-event edit scenario. (FR-H1)
- **Guardrail 2 (GHIN bailout)**: GHIN lookup failure has explicit manual-HI-entry bailout (captive-portal / hotel-wifi mitigation). (FR-E10)
- **Guardrail 3 (scorer handoff)**: Scorer is per-foursome, not per-user. Phone-dies handoff: anyone in the foursome SSOs and picks up scoring; FD-3 soft-lock + audit log cover it.
- **Guardrail 4 (role collapse)**: Organizer = scorer = same person in v1. No role split. Scorer identity via device cookie + SSO (FD-3 + FD-4).
- **DEFER v1.5+**: explicit co-organizer role, mid-event organizer transfer, scorer permission scopes.

### FD-14: PWA-primary holds; two cheap additions

Pinehurst crew = 8 install-capable; Josh on-site. No Bobby-equivalent. No install-cliff engineering.

- **Addition 1 (install prompt)**: In-app install prompt after first SSO — iOS animated "Share → Add to Home Screen" card; Android `beforeinstallprompt` one-tap. Dismissable; reappears at most once on 2nd open. (FR-E8)
- **Addition 2 (browser-tab graceful)**: Non-installed browser-tab users see read-only leaderboard / standings / pairings / schedule without error; scorer flow requires PWA install for offline-queue reliability. (FR-E9)
- **DEFER**: physical QR-at-breakfast on-ramp, install wizard for Bobby-equivalents, full browser-tab offline tolerance.

### FD-15: Handoff via full BMAD architecture workflow

Josh chose Path A — "do it right for the future" — consistent with foundation-first posture and no-hard-deadline reality (June trip as fallback if May 7 slips).

- **Sequence**: (1) commit Pass 1–5 PRD updates; (2) `create-architecture` → `tournament/architecture.md`; (3) `create-epics-and-stories` → formal epic + story breakdown (may supersede this PRD's embedded epic list); (4) `create-story` + `dev-story` loop per story; (5) retrospective after epic 1.
- **Tradeoff accepted**: ~2-3 weeks of design work before first production code. Pinehurst 2026-05-07 likely slips; June trip becomes the realistic first-test window.
- **Scope that benefits most from design-first**: sub-game framework (FD-10/11), context_id + tenant_id ecosystem hooks (FD-6), rule-set revisioning (FD-8), skins + carry-greenies engine (FD-11/12), mid-event rule-edit guardrail (FD-13).

---

## Risks & Mitigations

Preview of Step 10 content — captured here at PRD draft time to anchor tech decisions in Step 7.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Money correctness failure at settle-up** — any pair's balance off by any amount | Low if disciplined, Catastrophic if not | Product loses credibility instantly | Engine is pure; golden-file fixtures per rule variant (NFR-C2); one full hand-calc fixture checked in (T6.9); correction audit log (FR-B8); raw-state export (NFR-B1) for external verification. This is THE central risk. |
| **Scorer auth not enforced; anyone with entry code writes** — Wolf Cup pattern inherited naively | Medium if un-addressed | High in a cross-foursome-bet context where one bad write shifts money across groups | Explicit FR-B10 single-writer enforcement story (T5.6); 403 test case; scorer assignment table schema |
| **Offline sync complexity underestimated** — Codex's warning | **Low** (downgraded from Codex's assessment) | High if realized | Wolf Cup's IndexedDB queue (`apps/web/src/lib/offline-queue.ts`) is battle-tested through the 2026 season launch; Bobby Marshall tested dead-cell holes. Port verbatim (T5.3), do not redesign. Airplane-mode drill (T5.10) validates before each target Event. |
| **~~iOS PWA push unreliable~~** — *retired 2026-04-14* | n/a | n/a | Moot per FD-5: app is strictly pull-based (toasts/banners/in-feed). Push infrastructure is explicitly out of scope forever, not deferred. |
| **Pairings optimizer rabbit hole** | Medium (combinatorics are addictive) | Low for an 8-player, 4-round event | Ship manual pin/lock UI (T4.2) first; optimizer (T4.1) tagged target-miss-tolerable. |
| **Course OCR vision parser time-sink** | Medium (PDFs vary wildly) | Low (Pinehurst courses are known) | Manual entry UI (T2.5) is the trip-critical path; parser (T2.3) is tagged target-miss-tolerable. |
| **Private money disclosure blocks adoption** — cut-throat Thursday regulars refuse the app because balances are visible | Low for Pinehurst, High for v1.5 expansion | High for product growth beyond Josh's relaxed crews | Group-level money-visibility posture (FR-D9) designed in v1 schema; v1.5 surfaces the non-`open` modes. |
| **~~Wolf Cup regression during monorepo rename~~** — *retired 2026-04-14* | n/a | n/a | No rename per FD-1. Wolf Cup keeps `apps/api` / `apps/web` names; tournament scaffolds alongside as `apps/tournament-*`. Risk does not exist. |
| **Skins engine correctness in gross-beats-net mode** | Medium (three modes × carry chain × per-hole ties = nontrivial golden-file space) | High (skins is a real-money pot; mis-attribution = trust failure) | Pure function `packages/engine/src/formats/skins.ts` (FD-11); 3+ hand-worked scorecards per mode as golden-file fixtures; ~150 LOC + tests; validated during 9-hole drill. |
| **Mid-event rule-edit recompute correctness** (FD-13 guardrail 1) | Medium (organizer edits rule param day 2; engine must recompute forward from change point, not retroactively) | High (silent money drift if wrong) | Rule-config change stamps an effective-round or effective-hole boundary; money engine recomputes from boundary forward; audit-logged; visible diff banner to all participants. Golden-file fixture includes a mid-event edit scenario. |
| **Spectator invite-link leakage** | Medium (links get forwarded) | Low — content is stats and money within a friend group, already socially public | Keep invite-link scope Event-only and read-only; no sensitive data beyond what GHIN.com + group chat already expose; organizer can revoke and regenerate. |
| **Solo-dev context switching between Wolf Cup and Tournament** | High (two live products one dev) | Medium | Changelog discipline: tag commits with which app. Run both test suites in CI. Don't touch Wolf Cup code paths during tournament feature windows unless critical bug. |

---

## Epics & Stories

9 epics, 54 stories (revised 2026-04-13 to add scorer-handoff, audit log, lifecycle, permissions, observability, privacy, and identity stories). Sequenced for **foundation-first, ship-when-solid** — target testing window is Pinehurst 2026-05-07 but the hard deadline is "when it's right."

**Reuse tags on every story:**
- **[port]** — copy Wolf Cup code verbatim or near-verbatim into tournament-scoped equivalent (e.g., offline queue, GHIN client, audit log pattern, PDF template). Cheap.
- **[extract]** — lift from `apps/api` or `apps/web` into a shared `packages/*` location, then consume from both apps. Medium.
- **[new]** — novel tournament-specific work with no Wolf Cup equivalent. Budget carefully.

Dependency shorthand: stories within an epic are usually linear unless marked `∥` (parallel OK).

---

## Epic T1 — Tournament Foundation

**Goal:** Stand up a new, isolated tournament app alongside Wolf Cup. Zero Wolf Cup regressions. Deployable shell on `tournament.dagle.cloud` with empty DB and auth realm before any feature work begins.

**Traces:** FR-G1, FR-G2, NFR-C3, NFR-D1, NFR-O1.

**Stories:**
- **T1.1 [new]** *(revised 2026-04-14, FD-1 no-rename)* Add CLAUDE.md disambiguation note: `apps/api` + `apps/web` = Wolf Cup; `apps/tournament-*` = Tournament. Update pnpm workspace globs if needed. No rename of existing Wolf Cup apps.
- **T1.2 [new]** Scaffold `apps/tournament-api` (Hono + Drizzle + better-sqlite3) with health endpoint; separate SQLite volume. All writable tables include `context_id` + `tenant_id` columns from day one (FD-6).
- **T1.3 [new]** Scaffold `apps/tournament-web` (Vite + React 19 + TanStack Router + shadcn).
- **T1.4 [new]** Add `tournament` docker service + volume + Traefik route (`tournament.dagle.cloud`) to `docker-compose.yml`.
- **T1.5 [new]** CI config: run engine + api (Wolf Cup) + web (Wolf Cup) + tournament-api + tournament-web + lint on every commit; gate deploy on green.
- **T1.6 [new]** *(revised 2026-04-14, FD-4 SSO-first)* Auth realm: Google SSO + magic-link email fallback, session cookie, separate DB. GHIN lookup + confirm bind populates `players.ghin` + `players.google_sub`. Apple SSO deferred v1.5. No password port from Wolf Cup.
- **T1.7 [new]** Structured JSON log sink (append-only file + console). Satisfies NFR-O1. One file per day; organizer-downloadable.

**Exit:** `curl tournament.dagle.cloud/health` returns 200 in prod; Wolf Cup's 854 tests still green; empty login page loads.

---

## Epic T2 — Course Library

**Goal:** Load and validate a golf course from a scorecard PDF, store it canonically, and have all 4 Pinehurst courses + Pinehurst No. 2 alternate seeded.

**Traces:** FR-A2, FR-A3, FR-A4, NFR-D2.

**Stories:**
- **T2.1 [new]** DB schema: `courses`, `course_tees`, `course_holes` (par, SI, yardage-per-tee), `course_revisions` (durable across re-tees — a 2027 Pinehurst No. 2 resurfacing doesn't invalidate 2026 rounds).
- **T2.2 [new]** Course seed importer from `reference/pinehurst-may-2026-courses.json`; idempotent re-import with revision-aware upserts.
- **T2.3 [new]** *[target-miss tolerable]* Scorecard PDF → vision parser → JSON (tees + hole table). Leverage existing Anthropic key. Fallback: manual entry in T2.5 is sufficient.
- **T2.4 [new]** Course validator (par ∈ {3,4,5}, SI 1–18 unique, Out/In totals consistent).
- **T2.5 [new]** Course admin UI: manual cell-by-cell entry + PDF upload review path. Manual entry is the trip-critical path; PDF parse is convenience.

**Exit:** All 4 Pinehurst courses visible in the course picker; upload-new-course flow tested end-to-end on Pinehurst No. 2 PDF.

---

## Epic T3 — Event, Group, Rules, Invites

**Goal:** Create the Pinehurst Event, its Group (roster + rule set), GHIN handicaps, and a working invite link.

**Traces:** FR-A1, FR-A5, FR-A6, FR-A7, FR-A9, FR-D1 (schema only), FR-E2.

**Stories:**
- **T3.1 [new]** DB schema: `events`, `event_rounds`, `groups`, `group_members`, `rule_sets`, `invites`, `players` (with optional unique `ghin` column as cross-event join key — see Foundation Decisions), `device_bindings` (cookie-based device ↔ player claim for low-friction "that's me" flow), `event_timezone`.
- **T3.2 [new]** Event creation wizard (name, date range, timezone, round-course-tees picker) → saves event + rounds.
- **T3.3 [new]** Group CRUD UI (name, members with name + optional GHIN + handicap + money-visibility posture).
- **T3.4 [port]** GHIN client copied verbatim from Wolf Cup (read-only) + manual-override path.
- **T3.5 [new]** Rule-set editor: 2v2 best ball preset with sandies toggle + auto-press trigger + press multiplier + individual-bet list + money-visibility posture selector (`open` only in v1, others stubbed).
- **T3.6 [new]** Invite-link generation + first-arrival roster-confirmation screen; lazy auth (password deferred to first mutation).
- **T3.7 [new]** Device-binding flow: first-arrival click on "that's me, I'm X" sets a cookie mapping device → player id. Any subsequent visit auto-views that player's stats. One-tap override: "that's not me."
- **T3.8 [new]** Permissions middleware enforcing FR-H1–H7 role matrix on every route.

**Exit:** Pinehurst Event + Group exist in prod with 8 players, one saved rule set, and an invite link that opens a read-only schedule view.

---

## Epic T4 — Pairings

**Goal:** Multi-round pairing generation honoring "everyone plays everyone once" with manual pin/lock override.

**Traces:** FR-A8.

**Stories:**
- **T4.1 [new]** *[target-miss tolerable]* Engine function: given roster + round count, suggest pairings minimizing repeats. Pinehurst workable with manual pinning alone; optimizer is convenience.
- **T4.2 [new]** Pairings UI: grid view across rounds, pin slot, lock whole round, regenerate unpinned. Manual pin/lock path is trip-critical.
- **T4.3 [port]** PDF export of schedule + pairings (FR-F1). Port PDF generation pattern from Wolf Cup's `reference/wolf-cup-admin-guide.html` / `wolf-cup-marketing.html` templates.

**Exit:** Josh has 4 rounds × 2 foursomes of locked pairings for Pinehurst, a shareable PDF, and share-link for iMessage.

---

## Epic T5 — Scoring, Offline Sync, Leaderboard

**Goal:** Scorer can enter hole scores in ≤10s per foursome, offline-tolerant, and everyone sees the cross-group leaderboard update within 30s.

**Traces:** FR-B1–B6, FR-C1, FR-C2, NFR-P1, NFR-P2, NFR-R1, NFR-R2, NFR-S3.

**Stories:**
- **T5.1 [extract]** DB schema: `hole_scores` (copy Wolf Cup shape + add `scorer_user_id` + `client_event_id` for idempotency), `score_corrections` (audit log — FR-B8 port from `apps/api/src/routes/admin/score-corrections.ts`), `round_states` (lifecycle per FR-B9), `scorer_assignments` (per-round-per-group).
- **T5.2 [port]** Scorer entry UI: port from Wolf Cup including iOS-keyboard synchronous-focus fix (commit ebe3cea). Swap wolf-decision payload shape for tournament's (scores-only + putts when needed).
- **T5.3 [port]** Offline queue via IndexedDB — port `apps/web/src/lib/offline-queue.ts` + `useOfflineQueue` hook + `useOnlineStatus` hook verbatim. Rename DB `wolf-cup-offline` → `tournament-offline`. Shape-swap the entry type (no `wolfDecision` field, add `clientEventId` for server-side dedup).
- **T5.4 [port]** Course + scorecard shell cached locally when round opened online. Reuse Wolf Cup pattern.
- **T5.5 [new]** Cross-group leaderboard view. Wolf Cup has a leaderboard but it's single-group/single-round shaped; tournament needs a true cross-group view.
- **T5.6 [new]** Score POST endpoint enforces FR-B10 single-writer: session.userId must equal `scorer_assignments[round][group]` or request returns 403. This is the behavioral delta from Wolf Cup (which accepts any entry-code holder).
- **T5.7 [new]** Scorer handoff endpoint (FR-B7): organizer or current scorer can POST to transfer; atomic update with visible handoff state on both devices.
- **T5.8 [new]** Round lifecycle state machine (FR-B9): transitions gated and logged; `finalized` is immutable via normal paths (only correction-with-audit).
- **T5.9 [port]** Score correction endpoint with audit log: port `admin/score-corrections.ts` behavior, add FR-B8 actor+prior+new persistence, add FR-D9 visibility filtering.
- **T5.10 [new]** Airplane-mode drill script + checklist (NFR-R2 validation gate). Scripted manual test, not automated.

**Exit:** 9-hole practice foursome scored end-to-end, including ≥3 offline holes, merged on reconnect. Leaderboard visible to non-scorer.

---

## Epic T6 — Rules Engine, Money, Bets, Settle-up

**Goal:** 2v2 best ball + press + auto-press + cross-foursome individual bets all compute deterministically, head-to-head matrix correct, settle-up view usable.

**Traces:** FR-D1–D8, NFR-C1, NFR-C2, NFR-R3.

**Stories:**
- **T6.1 [extract]** Engine: 2v2 best ball hole/round scoring in `packages/engine/src/formats/best-ball-2v2.ts` (pure, golden-file tested). Reuses `stableford.ts` primitives already shared with Wolf Cup.
- **T6.2 [new]** Engine: manual press + auto-press trigger evaluation (N-down family) in `packages/engine/src/rules/press.ts`.
- **T6.3 [new]** Engine: cross-foursome individual bets ($/hole match, $/hole with auto-press) in `packages/engine/src/rules/individual-bets.ts`.
- **T6.4 [new]** API: hole-score commit triggers press-engine evaluation + emits in-app event payload (consumed by T8 engagement surfaces).
- **T6.5 [new]** Head-to-head money matrix API + UI, visibility-mode-aware (FR-D9).
- **T6.6 [new]** Settle-up view with per-player net + hole-by-hole drill-down, visibility-mode-aware.
- **T6.7 [new]** Manual-press UI (one-tap, undoable before next hole). Capability trip-critical; polish tolerable to defer.
- **T6.8 [new]** *[target-miss tolerable]* Dedicated Bets page UI (per-player live standings). Same data visible via Money page until this ships.
- **T6.9 [new]** Hand-calc money fixture validation (NFR-C1 gate): build one Pinehurst-plausible fixture, hand-calculate, match. Golden-file checked in.
- **T6.10 [new]** Leaderboard tie-break implementation (FR-C5) with unit tests covering each break step.

**Exit:** Golden-file tests pass. One full 4-player, 4-round, multi-bet Pinehurst-shaped fixture computes identically to hand-calc spreadsheet.

---

## Epic T7 — Player Experience

**Goal:** Non-scorer players and spectators have a screenshot-worthy, friction-free surface that makes the app content flow into the iMessage chat.

**Traces:** FR-E1, FR-E3, FR-E4, FR-E5, FR-F1 (already in T4), photo gallery from MVP list.

**Stories:**
- **T7.1 [new]** Event home: countdown + "you're in" + schedule entry.
- **T7.2 [new]** Schedule view: each round's course hero image, tee times, your pairing (TZ from FR-E7).
- **T7.3 [new]** Course preview: per-hole detail page (par/yardage/SI + hero image).
- **T7.4 [port]** Per-Event photo gallery — port Wolf Cup's R2 upload + camera icon + lightbox + multi-photo sequential upload (commit history: 2026-03-22). Reuse same R2 bucket with per-Event prefix. Low effort.
- **T7.5 [new]** Raw-state JSON export endpoint (NFR-B1): organizer-only, downloads scores + rounds + players + rule config + money ledger + audit log.

**Exit:** Mark's journey works end-to-end: invite link → confirm → browse schedule → view leaderboard → see money. Zero confusion.

---

## Epic T8 — In-App Engagement Surfaces (revised 2026-04-14, FD-5)

**Goal:** Every qualifying moment — birdies, presses firing, leaderboard changes, award triggers — surfaces **inside the app** as toasts, banners, or feed entries. Zero push / SMS / email. The app creates pull, not push.

**Traces:** FR-C3, FR-C4, FD-5.

**Stories:**
- **T8.1 [new]** Event-source spine: score commits, auto-press fires, bet standing flips, lead changes all emit structured app-events (topic + payload + timestamp). Engine is source-of-truth.
- **T8.2 [new]** Leaderboard in-app toast/banner component: renders an event's headline line for ~6s on any surface the viewer has open; dismissable; sticky-pinned to leaderboard feed.
- **T8.3 [new]** Player-home "what's happening" feed (reverse-chronological event list, scoped to the Event). Becomes the natural pull-surface players open between shots.
- **T8.4 [new]** Award trigger surfaces (first birdie of trip, first eagle, skins-pot streak) animate on the player's own home when triggered by their score.

**Explicit non-goals (FD-5, permanent):** Web Push API, VAPID, APNs, SMS gateway, email transactional, server-sent pushes of any kind.

**Exit:** Scottie birdies hole 7 → Mark opens the app between shots → in-app banner at the top of the leaderboard reads "Scottie birdied 7" + feed entry appears. No buzz, no notification escape.

---

## Epic T9 — Pre-Event Validation

**Goal:** Real-world dry-run to surface bugs before the target Event.

**Traces:** Step 3 measurable outcomes rows (9-hole foursome test, offline sync drill, hand-calc match, PDF fallback).

**Stories:**
- **T9.1 [new]** 9-hole live foursome test at Guyan (Josh + Jeff + Ben + 1). Full flow: open round, score 9 holes (with ≥3 offline), view leaderboard, check money. Record bugs; fix before target Event.
- **T9.2 [new]** Final pre-event checklist walkthrough: PDF export generates cleanly, airplane-mode drill passes, Wolf Cup tests green, course data validated, invite links tested, scorer-handoff tested, audit log tested, permissions matrix tested.
- **T9.3 [new]** Ship/defer decision: either greenlight target Event or defer to next trip window with punch list.

**Exit:** App is green across all checks, or a deliberate defer-to-next-window decision is documented.

---

## Sequencing & Slip Tolerance

**Foundation-first critical path** (must ship for a trip to be possible at all):

**T1 Foundation → T2 Courses (seed + validator + manual UI only) → T3 Event/Group/Rules/Invites/Permissions/Device-binding → T4 manual Pairings + PDF → T5 Scoring (all stories including single-writer enforcement, handoff, lifecycle, audit) → T6 core math + tie-break + hand-calc fixture → T9 validation**

**Target-miss tolerable** (can slip to next trip window without breaking the thesis):
- **T2.3** PDF vision parser — manual course entry is fine
- **T4.1** pairings optimizer — manual pinning is fine
- **T6.8** dedicated Bets page UI — Money page shows the same data
- **T6.7** manual-press UI polish — capability must work; aesthetic can wait
- **T7.4** photo gallery (low-effort port; near-zero actual risk of slipping but permissible)
- **T8** in-app engagement surfaces (event spine + toast/banner/feed components; no push/SMS/email per FD-5)

**Trip-critical hard blockers** (slip = defer the trip, not ship partial):
- **T1.1–T1.7** foundation + SSO auth + CI (no rename per FD-1)
- **T5.1–T5.9** scoring including single-writer auth, handoff, lifecycle, audit log
- **T6.1–T6.6, T6.9, T6.10** money correctness + tie-break + hand-calc validation
- **T4.2, T4.3** manual pairings UI + PDF fallback
- **T3.8** permissions matrix enforcement
- **T9.1, T9.2** validation

## Story Count Summary

| Epic | Stories | Tag mix |
|---|---|---|
| T1 Foundation | 7 | 2 port, 2 extract, 3 new |
| T2 Courses | 5 | 5 new |
| T3 Event/Group/Rules/Invites/Permissions | 8 | 1 port, 7 new |
| T4 Pairings | 3 | 1 port, 2 new |
| T5 Scoring/Leaderboard | 10 | 4 port, 1 extract, 5 new |
| T6 Rules/Money/Bets | 10 | 1 extract, 9 new |
| T7 Player UX | 5 | 1 port, 4 new |
| T8 Notifications | 2 | 2 new |
| T9 Validation | 3 | 3 new |
| **Total** | **53** | **9 port, 4 extract, 40 new** |

**Reuse payoff:** 13 of 53 stories (~25%) are port or extract work that leverages Wolf Cup's shipped code — offline queue, PDF generation, GHIN client, photo gallery, scorer UI iOS fix, auth middleware, audit log pattern, `stableford.ts` engine primitive. The real engineering surface is closer to 40 novel stories, mostly concentrated in tournament-specific rules/money logic, permissions, and cross-event identity — exactly where the product wedge lives.
