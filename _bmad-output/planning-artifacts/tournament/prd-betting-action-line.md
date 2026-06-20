---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
status: 'COMPLETE + codex-hardened (2026-06-20) — all 12 steps done; adversarial review folded in (FR1–FR54, Snake rules locked). Readiness report: implementation-readiness-report-betting-2026-06-20.md. Ready for architecture / epics. Hard gate before settlement code: approved golden hand-calc fixtures (NFR-C1/C3/C4).'
visionNotes:
  vision: 'An open, player-run book for the trip — anyone on the roster, playing or not, can put money on the event''s players as long as a fellow roster member takes the other side. Every bet is visible on the Action board and auto-settles from the scores already being entered, so settle-up is simply true, not argued.'
  differentiator: 'Player-driven / anyone-driven open social book: not the organizer doing data entry — joined players (and non-playing roster members) place their own action from their phones; admin can also enter/adjust/void any bet.'
  coreInsight: 'Scores are already entered for the team money to work, so bets auto-settle off the same data for free; the Action board turns the social layer into visible receipts (pull-not-push, FD-5).'
  wowMoment: 'PLACING — throw down action in a few taps, find a taker, it is live on the board. Settle-up (walk off 18, it is all tallied, nobody argues) is the trust payoff.'
  modelDecisions:
    - 'Subjects (what the bet is about) = event players/outcomes in the playing field.'
    - 'Stakeholders (money parties, side A / side B) = any VERIFIED roster entity, whether or not they are in the round''s playing field (the Kyle case). Both sides ALWAYS required.'
    - 'NO house / NO null side / NO odds / NO Monte-Carlo Line (decided 2026-06-20).'
    - 'Free-text "type a name" for a non-roster outsider = DEFERRED (not v1); stakeholders must be verified roster members.'
    - 'Reuses join-code login identity (B0, shipped) + existing player records; no separate non-player person entity needed.'
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/product-brief.md
  - _bmad-output/planning-artifacts/tournament/prd.md
  - _bmad-output/planning-artifacts/tournament/architecture.md
  - _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md
  - _bmad-output/brainstorming/brainstorming-session-2026-06-16.md
  - _bmad-output/planning-artifacts/tournament/event-setup-ux-backlog.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 1
  projectDocs: 3
workflowType: 'prd'
projectType: 'tournament-app'
scope: 'Player-driven + admin-managed in-event betting for Tournament — "The Action" WITHOUT odds. Player front-end (joined players self-create bets vs others) + admin portal (add/adjust/void any bet) + consolidated Action board + pairwise settle-up + event ledger. NO odds / NO Monte-Carlo Line / NO house.'
outputFolder: '_bmad-output/planning-artifacts/tournament/'
classification:
  projectType: 'PWA + Hono/SQLite API (brownfield feature addition)'
  domain: 'sports / golf — peer betting / settlement'
  complexity: 'medium'
  projectContext: 'brownfield'
  notes: |
    Feature addition layered on shipped Tournament v1. Tournament app ONLY
    (apps/tournament-api, apps/tournament-web) per monorepo rule FD-1/FD-2.
    Reference (NOT to be edited): Wolf Cup apps/api/src/services/bets.ts (the
    settle engine + Action board + pairwise settle-up).

    DECIDED 2026-06-20 (Josh): "The Line" is OUT — odds_win, the Monte-Carlo
    markets engine, American odds, and betting vs The House are all dropped.
    Rationale: (a) Wolf Cup's Line is built on accumulated in-SEASON in-app
    results (round_results stableford/money history); it literally gates until
    weeks of prior rounds exist — a 2-day Tournament event has none. (b) GHIN
    gives index TREND (handicap_history.json, proven) but NOT reliable
    per-course posted-score history, and net play flattens index-based odds
    anyway. (c) Nobody wants to be the house. A novelty gross-only line was
    considered and shelved.

    IN scope: a front-end betting system where joined players (already
    authenticated via B0 join-codes / device-binding, shipped 2026-06-15)
    add their OWN bets against other event players; an admin portal where the
    organizer adds bets for anyone and edits/adjusts/voids any bet; a
    consolidated public "Action" board (respecting Group money_visibility
    posture); pairwise settle-up; event-scoped ledger.

    Tournament ALREADY has: individual_bets engine (match_play_per_hole +
    match_play_with_auto_press, auto-press chains, multi-round) and a
    participant-gated POST route, so player bet-create exists at the API
    layer. GAPS this PRD fills: front-end create/manage UX, additional bet
    types (h2h stroke / over_under — TBD in discovery), admin management
    surface, consolidated Action board, settle-up/ledger presentation.

    Distinct from the paused F1 rules/games PRD (prd-f1-rules-games.md, the
    rules-engine rework). Closely related to the F1b backlog item
    (event-setup-ux-backlog.md "Side games — player-driven"); this PRD is the
    formal home for that work.

    PARTY-MODE REFINEMENTS (2026-06-20, accepted by Josh):
    1. IDENTITY = a dual-actor, two-surface product: a player self-serve
       betting surface (on-course, thumbs-only, ~3 taps to place action) AND
       an admin console (organizer enters/edits/voids everyone's action).
       Same data, two opposite UX postures. It is a PLAYER-FACING CONSUMER
       surface, not an internal tool — judge "done" accordingly. (John/Sally)
    2. The "medium" rating carries a CORRECTNESS-SENSITIVE CORE that earns the
       same golden-fixture + audit discipline as the money engine: (a) TWO
       write paths to the same bet (player + admin) need explicit authority +
       an audit trail (mirror score-corrections); (b) auto-settle-from-scores
       means a score correction re-grades money, and admin void/adjust must
       recompute cleanly; (c) Group money_visibility (open/participant/
       self_only) gates who sees whose action. (Winston)
    3. DOMAIN is cash-settled SOCIAL betting — no payment processing, no real
       book; trust comes from visible auto-settled math, not an operator.
       Firmly sports/recreation, NOT regulated fintech/gambling. (Mary)
---

# Product Requirements Document — Tournament Betting: "The Action"

**Author:** Josh
**Date:** 2026-06-20
**Scope:** A player-driven + admin-managed in-event betting surface for the Tournament app ("The Action"), auto-settled from scores. **The Line / odds / house are explicitly OUT** (evaluated and cut 2026-06-20). Distinct from the paused F1 rules/games PRD; this is the formal home for the F1b "player-driven side games" backlog item.

## Executive Summary

Golf-trip side action — the matches, presses, and one-off bets struck on the tee and at the turn — runs on memory, the group text, and one guy's notepad, then gets argued over at settle-up. This PRD gives the Tournament app an **open, player-run book**: anyone on the event roster, playing that round or not, places real-money action on the event's players as long as a fellow roster member takes the other side. Every bet is visible on a live **Action board** and **auto-settles from the same scores players are already entering**, so settle-up is simply *true*, not negotiated. Tournament already does exactly this for each event's team money; the side action is the last money surface still running on memory.

The product is **dual-actor and two-surface**: a **player self-serve surface** (a logged-in player thumbs in "$10, my net 4 beats Ben's," someone taps *take it*, and it's on the board before he's teed up) and an **admin console** (the organizer enters action for anyone and edits, adjusts, or voids any bet).

**Deliberately out of scope:** odds, a Monte-Carlo "Line," and a house. All three were evaluated and cut — the odds model needs weeks of in-season results a 2-day event lacks, GHIN gives no reliable per-course history, and nobody wants to take the book's side. Trust comes from visible auto-settled math, not an operator.

The build is **additive**. Tournament's match-play bet type already auto-settles from scores; join-code login (B0), the slope-aware leaderboard net, and the money/settle-up services with their `money_visibility` posture all exist. The net-new work: the **front-end create/manage UX, a consolidated Action board, pairwise settle-up + an event-scoped ledger, an admin management surface, and additional bet types** — **h2h stroke**, the **putting games** the crew plays (total-putts head-to-head, optionally front/back/total), and **Snake** (the group 3-putt game), with over/under as a fast-follow. These reuse the proven settle-from-scores *pattern* with new graders off the leaderboard net; the putting games add **conditional per-hole putts entry** (a port of Wolf Cup's "least putts" flow). The correctness edge to hold: two write paths to one bet, and **voiding or adjusting a settled bet must leave the ledger consistent** — earning the same golden-fixture + audit discipline as the money engine.

**Target proving ground:** the **Pete Dye member-guest, June 26–27 (~12 players)** — a secondary real-money test bed in the mold of Pinehurst, on a now-mature app. Posture is foundation-first / ship-when-solid: expected to succeed, low downside, no do-or-die deadline.

### What Makes This Special

The wedge is that the book is **player-driven and open** — not the organizer doing data entry for a dozen people, but everyone in the trip's orbit placing their own action, including the sweat in the cart who isn't swinging a club. The **core insight**: scores are *already* entered for the team money to work, so bets settle off that same data for free, and the Action board turns the social layer into visible **receipts** — the "app creates pull, not push" thesis (FD-5) the rest of Tournament runs on. Subjects (what the bet is about) are cleanly separated from stakeholders (who has money on it), so a non-playing roster member like Kyle backs a side with no special handling — both sides are always verified roster entities, and the bet exists only once someone takes it.

## Project Classification

- **Type:** Brownfield feature addition — PWA + Hono/SQLite API (`apps/tournament-api` + `apps/tournament-web` only)
- **Domain:** Sports / golf — cash-settled **social** peer betting; no payment processing, no real book, not regulated fintech/gambling
- **Complexity:** Medium — hard primitives exist; net-new work is UX surfaces plus a correctness-sensitive core (two write paths, auto-settle/void-recompute, visibility gating)
- **Context:** Brownfield — builds on `individual_bets`, B0 join-code identity, the money/settle-up services, and the Group `money_visibility` posture

## Success Criteria

### User Success
- **Placing is fast and social:** a logged-in player creates a bet (pick subject, stake, type, name a taker) in **≤ ~30 seconds / a few taps**, and it appears on the Action board immediately.
- **Real money rides on the app, not the notepad:** at Pete Dye, the crew tracks their actual side action in-app over both rounds instead of memory / group-text.
- **Settle-up is trusted, not argued:** at the end, each person's net is visible and accepted **without dispute**, because every bet shows its hole-by-hole basis.
- **The open book works:** a non-playing roster member (the Kyle case) can back a side and it shows correctly in their settle-up.
- **Admin is never the bottleneck:** the organizer can add, edit, adjust, or void any bet live, without a developer.

### Business Success
- Side project, no revenue. **Success = the Pete Dye crew uses it for real action and trusts the settle-up**, validating the "open, player-run book" wedge.
- **Repeat signal:** the same crew (or another Tournament group) reaches for it on the *next* trip without being told to.

### Technical Success
- **Deterministic auto-settlement:** bets settle purely from scores; a score correction **re-grades automatically**; void/adjust leaves the ledger consistent — all golden-fixture tested.
- **Net reuses the leaderboard net** (slope-aware, locked-HI aware); **fails closed** when net isn't trustworthy (unknown tee/HI) rather than auto-paying — mirrors Wolf Cup.
- **`money_visibility` respected** — no balance / bet leakage across the posture (open / participant / self_only).
- **Both write paths audited** — player-created and admin-created/edited/voided bets each write an audit row (mirror score-corrections).
- **Zero Wolf Cup regressions; Tournament paths only; CI green** on every commit.

### Measurable Outcomes

| Metric | Target | When measured |
|---|---|---|
| Place-a-bet time | ≤ ~30s, few taps (familiar user) | Pete Dye, informal |
| In-app action adoption | Crew's real side bets live in-app both rounds | Pete Dye |
| Settle-up disputes | **0** unresolved at trip end | End of Pete Dye |
| Settlement correctness | Matches hand-calc for every settled bet | Golden fixtures + trip end |
| Score-correction re-grade | A corrected score re-settles affected bets automatically | Test + trip |
| Visibility leakage | 0 — no bet/balance shown outside posture | Tests |
| Wolf Cup suite | Green every commit | CI |

## Product Scope

### MVP — Minimum Viable Product (target: Pete Dye, Jun 26–27)
- **Player self-serve create — TRUST model:** pick subject(s) from the field, bet type, stake, and name a **verified roster taker**; the bet is **live immediately** (no acceptance step). Wrong / disputed → admin or placer **voids or adjusts**.
- **Admin console:** add a bet on anyone's behalf, edit, adjust, void.
- **Bet types (reuse + minimal new):** per-hole match-play (exists today) + **h2h** (net/gross, optional front/back/total = Nassau) + the **putting games** (total-putts h2h, optional front/back/total) + **Snake** (group 3-putt game). Over/under and multi-round are fast-follow.
- **Putting data:** conditional per-hole putts entry (only when a putting game is active, only for its participants) — a port of Wolf Cup's "least putts" flow.
- **Action board:** all live / settled bets for the event, with outcomes, respecting `money_visibility`.
- **Pairwise settle-up** across all bets (who pays whom), netted per stakeholder pair — including the holder-pays-all shape of Snake.
- **Auto-settle from scores**, score-correction re-grade, fail-closed net.

### Growth Features (Post-MVP)
- **VERIFIED handshake create:** player proposes → named taker gets an **in-app pending request** → taps **Accept** to make it live. In-app only (FD-5 — no OS push / SMS / email). The "no ghost bets" path for larger / less-trusting contexts.
- Over/under, multi-round bets, auto-press UX surfacing, putting / CTP-style prop bets.
- Event-scoped **ledger / history** view; cross-event betting record.
- In-app Action toasts / banners (bet placed, taken, flipped) per FD-5.
- Richer admin (bulk entry, bet templates for common stakes).

### Vision (Future)
- Reconsider "The Line" / odds only if a long-running league context ever makes the data real (not a 2-day event).
- Cross-event betting stats ("the trip's biggest winner over 10 trips").
- Bet marketplace / open proposals anyone can take.

## User Journeys

User types: **Rick** (player + active bettor), **Kyle** (roster member, not playing this round, wants in on the action), **Josh** (organizer / admin — runs the book and the settle-up), **Jeff** (scorer — generates the data bets settle on). No API consumers; no support role (Josh is it).

### Journey 1 — Rick the Bettor (Happy Path, Player Self-Serve)

**Opening scene.** June 26, 7:50 AM, first tee at Pete Dye. Rick and Ben are needling each other about who's playing better. Historically this bet lives in Rick's head and gets "settled" from memory Sunday night, badly. Rick pulls out his phone — he's already logged in (join code, day one).

**Rising action.** He taps **+ Bet**, picks **h2h**, subject A = himself, subject B = Ben, basis **net**, stake **$20**, names the taker: **Ben** (a verified roster member). Trust model — no acceptance step. He taps **Place**. ~20 seconds. The bet is live on the Action board before the starter waves them up.

**Climax.** Through the round Rick checks the board between holes — his net vs Ben updates as Jeff enters scores. On 16 Rick stuffs one and pulls ahead. The board shows the swing live. No spreadsheet, no argument about what the bet was.

**Resolution.** Round done. Rick's h2h settled: he's up $20 on Ben. It's already netted into the settle-up — he doesn't do anything. He screenshots the board for the group text.

**Requirements revealed:** player-authenticated bet creation (join-code identity), bet-type + subject + stake + taker picker, trust-model immediate-live, live Action board with per-bet running outcome, auto-settle from scores, pairwise settle-up.

### Journey 2 — Kyle the Non-Playing Backer (The Open Book)

**Opening scene.** June 26. Kyle's on the trip but sitting this round out (bad back). He's on the event roster, just not in a foursome today. He wants action anyway.

**Rising action.** Kyle opens the app — logged in via his own join code, full access despite not playing. He sees Rick-vs-Ben already on the board. He creates his own: **h2h**, subject A = **Josh**, subject B = **Madden**, basis **net**, $10, taker = **Steven** (another roster member who'll fade Josh). Both sides verified roster members; Kyle is side A's stakeholder though he's not a subject. Live immediately.

**Climax.** Kyle never swings a club but he's got skin in the game all afternoon, watching Josh and Madden's nets on the board from the clubhouse. The bet settles when both subjects finish 18.

**Resolution.** Josh edges Madden net; Kyle (backing Josh) collects $10 from Steven. It shows in **Kyle's** settle-up line even though he never teed off — and in Steven's. The "open book" works: action isn't limited to the players swinging clubs.

**Requirements revealed:** **subjects ≠ stakeholders** (a non-subject roster member is a side), full access for non-playing roster members, settle-up spans non-players, verified-roster constraint on both sides (no free-text outsiders, v1).

### Journey 3 — Josh the Organizer (Admin Console)

**Opening scene.** June 26 mid-morning. Two older guys in group 3 made a $5/hole match on the tee but won't fiddle with the app. They tell Josh. As organizer, the book is his to keep complete.

**Rising action.** Josh opens **Admin → Bets**, adds their bet on their behalf — per-hole match-play, the two of them, $5/hole — auto-confirmed (admin is authority). Later, someone says a stake was wrong: a $20 was meant to be $10. Josh **edits** it; the board and settle-up recompute. A bet got entered twice; Josh **voids** the duplicate.

**Climax.** Sunday evening, settle-up. Josh opens the consolidated **settle-up** view: every bet — player-placed and admin-entered — netted pairwise, who-pays-whom. He reads it down the table. Money changes hands in cash. Nobody argues, because every line drills into its hole-by-hole basis.

**Resolution.** The book closed clean with zero disputes — including the two guys who never touched the app. Josh was never a bottleneck and never had to do mental math.

**Requirements revealed:** admin add-for-anyone (auto-confirmed), admin edit / adjust / void with recompute, consolidated settle-up with drill-down, audit trail on admin writes, `money_visibility` posture applied to the board.

### Journey 4 — The Correction & Void (Recovery / Edge)

**Opening scene.** June 27, back nine. Jeff realizes he typed Madden's score on 12 as a 5; it was a 6. A bet between Madden and Rick hinges on net holes.

**Rising action.** Jeff corrects hole 12 through the normal score-correction flow. The bets engine **re-grades automatically** — Madden-vs-Rick flips on that hole; the Action board and settle-up update with no manual touch. Separately, a net h2h can't be graded because one subject's tee/HI is unresolved; rather than guess, the app holds that bet **live (fail-closed)** instead of auto-paying a wrong number.

**Climax.** At settle-up, the corrected bet shows the *right* number, and the ungradeable one is clearly flagged "waiting on handicap," not silently mis-settled. Josh resolves the HI; it settles correctly.

**Resolution.** A data fix and a missing-data case both resolved without corrupting anyone's balance. Trust in the number holds — the whole reason people stopped using the notepad.

**Requirements revealed:** score-correction triggers bet re-grade, deterministic recompute, **fail-closed net** when tee/HI unknown, clear "ungradeable / pending" surfacing, void/adjust leaves ledger consistent.

### Journey Requirements Summary

Capabilities revealed across the four journeys:

- **Player betting (self-serve):** join-code-authenticated create; subject + type (h2h / per-hole match) + basis (net/gross) + stake + verified taker; trust-model immediate-live; place in ~3 taps.
- **Open book / stakeholders:** subjects separated from stakeholders; non-playing roster members have full access and can be a side; settle-up spans non-players; both sides must be verified roster members.
- **Admin console:** add-for-anyone (auto-confirmed), edit / adjust / void with recompute, audit trail on every admin write.
- **Action board:** live per-bet outcomes for the event, `money_visibility`-aware.
- **Settlement:** auto-settle from scores; pairwise who-pays-whom with hole-by-hole drill-down; score-correction re-grade; **fail-closed net**; ungradeable / pending clearly surfaced; void/adjust ledger-consistent.
- **Identity:** reuses B0 join codes; full access for any roster member, playing or not.

## Domain-Specific Requirements

### Compliance & Regulatory
- **None applicable — by deliberate scope.** This is a **private, cash-settled social book**. The app **never holds, transfers, escrows, or processes money** — settle-up is purely *informational* (it tells people who owes whom; cash / Venmo happens between humans, outside the app). There is **no operator / house** taking the other side. These three boundaries (no funds flow, no book, private group) are what keep it out of payment-processing (PCI), money-transmission, and gambling-licensing regimes. **This is a load-bearing product constraint, not an oversight** — any future move toward in-app payments or a real house would change the regulatory picture entirely and is explicitly out of scope.

### Technical Constraints (domain-driven)
- **Deterministic settlement from scores.** Outcomes are a pure function of (scores + bet config); recomputed on read, never stored as authoritative. A score correction re-settles automatically. Golden-file fixtures per bet type; hand-calc gate before trip.
- **Net is the leaderboard net, never re-derived.** Reuse the slope-aware, locked-HI-aware net the leaderboard / money services already compute (the recurring `Math.round(HI)` bug family is avoided by *not* re-deriving).
- **Fail-closed grading.** A net bet whose tee / HI isn't trustworthy stays **live**, never auto-pays a guessed number. Gross is always gradeable.
- **Money privacy is enforced, not cosmetic.** Bets and balances respect the Group `money_visibility` posture (open / participant / self_only); spectators (non-roster) never see money in any mode.
- **Audit on every write.** Player-created and admin-created / edited / voided bets each write an audit row (actor, before/after, timestamp) in the same transaction — mirrors score-corrections.
- **Integer-money discipline** (cents / whole-dollar), consistent with the existing engines.

### Integration Requirements
- **Internal only.** Consumes existing Tournament surfaces: the scoring / leaderboard net, B0 join-code identity, the money / settle-up services, and the `activity` spine (for future in-app Action banners). **No external integrations** — no payment APIs, no odds feeds, no GHIN dependency for settlement (GHIN only ever informs handicaps upstream).

### Risk Mitigations
- **Wrong settlement** → golden fixtures + hand-calc release gate; deterministic recompute.
- **Money leakage** → visibility-posture tests on every read path.
- **Ghost bets** → v1 trust model + void / adjust; verified handshake is the growth mitigation.
- **Dual-write authority confusion** (player vs admin) → explicit authority rules + audit trail.
- **Stale outcomes after a correction** → recompute-on-read means no cache to invalidate.

## Web App (PWA) Specific Requirements

### Project-Type Overview
A brownfield feature inside Tournament's existing **React 19 + TanStack Router SPA / vite-plugin-pwa** front end and **Hono + Drizzle / SQLite** API. No new app, no new stack — new routes + services within the existing shells (`apps/tournament-web`, `apps/tournament-api`). All platform-level decisions are **inherited, not re-opened**.

### Technical Architecture Considerations

- **SPA or MPA → SPA.** New TanStack Router file-based routes: a **player betting surface** (`events.$eventId.bets` extended for self-serve create), an **Action board**, and an **admin bets console** (`admin.*`). Auto-generated route tree; named exports only; kebab-case files (existing conventions).
- **Real-time → existing polling, no new mechanism.** The Action board and settle-up refresh via the **TanStack Query `refetchInterval`** already used by the leaderboard (5s during active rounds, 30s idle, pause on scorer viewport, resume on `visibilitychange`). Bets settle on read, so a poll tick surfaces the latest outcome with zero extra infra. (SSE / WebSocket stays the deferred upgrade path.)
- **Browser / device support → inherit NFR-Dev1.** Primary: **iOS Safari installed PWA** (the on-course player surface) + **desktop Chrome / Edge** (admin console). Best-effort Android Chrome. The player create-flow is **mobile-first, one-handed, thumb-reachable** (the first-tee moment); the admin console is comfortable on desktop *and* usable on a phone.
- **SEO → N/A.** Private, auth-gated app; no public / indexable surface. No SEO work.
- **Accessibility → match existing primitives.** Reuse the design-system primitives (PageShell, cards, `ScrollableTable` with `role=region` / focus-ring), **≥44px tap targets**, dark-mode tokens. No new a11y framework; consistency with the shipped app is the bar.
- **Responsive → mobile-first for players.** Bet creation and the Action board are designed at 375px first; tables wrapped in horizontal-scroll regions (existing T12 pattern) to avoid page overflow.

### Implementation Considerations
- **API shape:** resource-nested routes under existing conventions — player / participant routes under `/events/:eventId/bets*`, admin under `/admin/...`; error shape `{ error, code?, requestId, fields? }`; every mutation in a `db.transaction` with audit + (future) activity emit in the same tx.
- **State:** local `useState` + TanStack Query + URL params (no state library) — consistent with the app; the Action board's "which event / round" is URL-driven.
- **Offline:** bet *placing* is an online action (needs a verified taker + immediate board write); it is **not** added to the offline score queue in v1. Reads degrade gracefully; score entry (which bets settle on) keeps its existing offline path.
- **Performance:** recompute-on-read settlement over a ~12-player, 2-round event is millisecond-scale SQLite; Action board target <2s warm cold-launch, in line with NFR-P3.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP approach: experience / problem-solving MVP.** The smallest thing that makes the Pete Dye crew *actually use it* for real action and *trust the settle-up*. Validated learning = two questions: (1) do players self-place action from their phones, and (2) is the settle-up accepted without dispute? Everything else is deferrable.

**Resource reality:** solo dev (Josh), ~1 week to Pete Dye, **foundation-first / target-not-deadline** posture (June-trip fallback if needed). Scope is trimmable without breaking the thesis.

**The floor that de-risks the deadline:** the **admin console is built before player self-serve**. If the player create-UX slips, Josh enters the book himself and the trip *still succeeds* — the same admin-entered model Wolf Cup shipped. Player self-serve is the differentiator, but it is **not** the thing that can sink the trip.

### MVP Feature Set (Phase 1), in build order

- **1a — Correctness core (build + golden-fixture first):** bet model with **subjects ≠ stakeholders**, both sides required, no house; bet types **per-hole match-play** (reuse existing engine) + **h2h** (lower 18 net/gross), the new grader reusing the **leaderboard net** (fail-closed when tee / HI unknown). Deterministic, recompute-on-read, score-correction re-grade. Golden fixtures + hand-calc gate.
- **1b — Admin console (the floor):** add a bet for anyone (auto-confirmed), edit / adjust, **void** (ledger-consistent), with an audit row per write. Delivers the whole trip on its own.
- **1c — Player self-serve + Action board (the differentiator):** mobile-first create (join-code auth, trust model → live immediately), and the consolidated **Action board** (visibility-aware) showing live / settled bets.
- **1d — Pairwise settle-up:** who-pays-whom netted per stakeholder pair, hole-by-hole drill-down, spanning non-playing backers and the holder-pays-all shape of Snake.
- **1e — Putting data + Snake / putting-game engine:** conditional per-hole **putts entry** (port Wolf Cup's "least putts" pattern; `hole_scores.putts` appears to already exist), the **Snake** escalation + one-pays-all engine, and the **putts-basis h2h** grader (shares the front/back/total segmentation primitive with Nassau).

**Core journeys supported by Phase 1:** all four (Rick self-serve, Kyle open-book backer, Josh admin, correction / void).

### Post-MVP Features

**Phase 2 (Growth):**
- **Verified handshake** create (propose → in-app Accept → live; FD-5 in-app, no push).
- **Over/under** + **multi-round** bets; auto-press UX surfacing; putting / CTP-style props.
- In-app Action **toasts / banners** (placed, taken, flipped) via the `activity` spine.
- Event-scoped **ledger / history** view; richer admin (bulk entry, bet templates).

**Phase 3 (Expansion / Vision):**
- **Cross-event betting stats** ("biggest winner over 10 trips").
- **Bet marketplace** / open proposals anyone can take.
- Reconsider **odds / "The Line"** only in a long-running league context where the data is real (never a 2-day event).

### Risk Mitigation Strategy

- **Technical:** correctness is the dominant risk — mitigated by golden fixtures + hand-calc release gate, **reusing the leaderboard net** (never re-derived), **fail-closed** grading, and recompute-on-read (no cache to invalidate). Riskiest specifics — **void / adjust ledger consistency** and **dual-writer authority** (player vs admin) — covered by audit trail + targeted tests.
- **Market:** "will players actually self-place?" — de-risked by the **admin-console floor**: the trip succeeds on admin entry alone, and real Pete Dye usage tells us whether self-serve adoption is real before investing in Phase 2.
- **Resource:** solo dev, 1 week — de-risked by **admin-first build order**, **trimmable bet-type scope** (ship per-hole + h2h; over/under → Phase 2), and the **target-not-deadline** posture.
- **Snake / putting (build item 1e):** the heaviest new piece is **putts entry**, but it is a **port** of Wolf Cup's conditional "least putts" entry (asks only when a putting game is active, only for its participants) — and `hole_scores.putts` appears to already exist in Tournament, so it is more tractable than it first sounds. Snake's one-pays-all escalation is the one genuinely new settlement shape; covered by its own golden fixtures (NFR-C1/C4).

## Functional Requirements

> Binding capability contract. Anything not listed will not exist downstream unless explicitly added. **[MVP]** = target for Pete Dye (Jun 26–27); **[Growth]** = fast-follow.

### Bet Creation & Management
- **FR1 [MVP]:** A logged-in roster member can create a bet by specifying its subject(s), bet type, basis, stake, and the opposing stakeholder.
- **FR2 [MVP]:** A player-created bet goes live immediately on creation (trust model) — no acceptance step required from the opposing side.
- **FR3 [MVP]:** An organizer can create a bet on behalf of any roster members (auto-confirmed).
- **FR4 [MVP]:** An organizer can edit a bet's parameters after creation, and its outcome recomputes.
- **FR5 [MVP]:** An organizer can void a bet, removing it from settlement while preserving an audit record.
- **FR6 [MVP]:** A bet's creator can void or correct their own bet **only before any dependent score/putt for its scope exists**; once scoring has begun, only an organizer may void/adjust it (audited). Segmented bets (Nassau / putting front-back-total) are voided/edited as **one parent**, never per-segment.
- **FR7 [Growth]:** A player can propose a bet to a named taker who must accept it in-app before it goes live (verified handshake; in-app only, no push).

### Bet Model, Types & Basis
- **FR8 [MVP]:** The system can represent a bet whose **subjects** (what it's about) are distinct from its **stakeholders** (who has money on it).
- **FR9 [MVP]:** A bet requires two opposing stakeholders, both verified roster members; it cannot exist with only one side (no house).
- **FR10 [MVP]:** A stakeholder can be any roster member, whether or not they are in the round's playing field.
- **FR11 [MVP]:** The system supports a **head-to-head** bet type (one subject's total vs another's; lower wins).
- **FR12 [MVP]:** The system supports a **per-hole match-play** bet type: payout = **(holes won − holes lost) × stake**, pushed holes earn nothing. v1 has **no auto-press** in this path (distinct from the existing auto-press engine). **Putts basis is not valid** for per-hole match (putts settle on totals only).
- **FR13 [MVP]:** A bet can be graded on **net**, **gross**, or **putts** basis.
- **FR14 [MVP]:** A head-to-head bet's subjects may be in **different foursomes** (cross-group).
- **FR15 [MVP]:** A head-to-head bet can be **segmented by course hole number** — *total* (holes 1–18, one bet) or *front / back / total* (1–9, 10–18, 1–18; three linked, independently-settled bets); the bet's **stake applies to each segment**. Segments are fixed by hole number, never play order.
- **FR16 [MVP-capable]:** Front/back/total segmentation on a net/gross h2h is a **Nassau**; on a putts h2h it is a segmented **putting game** — the same mechanism on a different basis.
- **FR17 [MVP]:** A **putting game** is a putts-basis head-to-head on **total putts** (never per-hole), with a configurable amount and optional front/back/total segmentation; subjects may be cross-foursome.
- **FR18 [Growth]:** The system supports an **over/under** bet type (a subject's total vs a numeric line; push on equality).
- **FR19 [Growth]:** A bet can apply across multiple rounds of an event.
- **FR20 [MVP]:** New bet types can be added without a schema migration (additive type model).

### Settlement
- **FR21 [MVP]:** The system settles each bet automatically from the event's recorded scores — no separate scoring of the bet.
- **FR22 [MVP]:** When a score is corrected, every affected bet re-settles automatically.
- **FR23 [MVP]:** Net bets are graded using the same handicap-aware net the leaderboard uses (locked-HI aware), never re-derived.
- **FR24 [MVP]:** A net bet whose tee or handicap isn't trustworthy stays unsettled (**fail-closed**) rather than settling on a guess.
- **FR25 [MVP]:** A bet settles only once all its subjects have completed the holes it depends on; until then it shows live.
- **FR26 [MVP]:** A bet that ends level settles as a **push** — no money moves.

### Group Games — Snake (putting)
- **FR27 [MVP]:** An organizer can enable a **Snake** putting game for a group/round, with a configurable **starting amount** and **increment**, among a participant set (default the foursome).
- **FR28 [MVP]:** When any putting game (Snake or a putts-basis bet) is active, the scorer records **putts per hole only for the players in that game**; players in no putting game are never asked. *(Port Wolf Cup's conditional "least putts" entry pattern.)*
- **FR29 [MVP]:** The system tracks the **snake holder** as the player of the **most recent qualifying putt event (≥3 putts)** in hole/play sequence. When **two or more participants qualify on the same hole**, the holder is the one with the **most putts** (a 4-putt takes the snake over a 3-putt; a 5-putt over a 4-putt); **only if they are tied on putt count** does the scorer **designate "last one in the hole"** (group rule). The value still escalates for **every** qualifying event on the hole. Order across holes follows the round's play sequence (front/back or shotgun start).
- **FR30 [MVP]:** Each qualifying event **escalates** the value. The **first** qualifying event of the round sets value = **starting amount + (putts − 3) × increment** — a first 3-putt = starting amount; a first 4-putt = starting + one increment (e.g. $5 → $6). Each **subsequent** qualifying event adds **(putts − 2) × increment** (3-putt = +1 increment; 4-putt = +2). If **no qualifying event occurs all round, nobody holds the snake and there is no payout** (settled, zero).
- **FR31 [MVP]:** At round end the **holder pays the final snake value to each other participant**, netted into the event settle-up.
- **FR32 [MVP]:** A viewer can see each player's **putting total** for the round and the live snake holder + value.

### The Action Board
- **FR33 [MVP]:** Any roster member can view a consolidated **Action board** of the event's bets, each with its live or settled outcome.
- **FR34 [MVP]:** The Action board honors the Group money-visibility posture, never showing bets/balances outside it.
- **FR35 [MVP]:** Spectators (non-roster) cannot see any money or bets.
- **FR36 [MVP]:** A viewer can see, for any bet they're permitted to see, the **hole-by-hole basis** of its outcome.

### Settle-Up & Ledger
- **FR37 [MVP]:** The system computes a **pairwise settle-up** (who pays whom) across all settled bets, netted per stakeholder pair.
- **FR38 [MVP]:** Settle-up includes **non-playing stakeholders** — a backer who never teed off appears in it.
- **FR39 [MVP]:** A push, or an even stakeholder pair, contributes nothing to settle-up.
- **FR40 [MVP]:** One-pays-all games (Snake) are represented in settle-up as the holder → each-other-participant directional amounts.
- **FR41 [Growth]:** A viewer can see an event-scoped **betting ledger / history** (per-person won / lost / net).

### Identity & Access
- **FR42 [MVP]:** A roster member authenticates via their join-code / device identity and gains full betting access (view, create, settle-up), whether or not they are playing.
- **FR43 [MVP]:** Both sides of every bet are constrained to verified roster members; free-text non-roster names are not permitted in v1.
- **FR44 [MVP]:** Creating a bet grants no scoring rights — only the designated scorer can change scores (unchanged).

### Audit & Integrity
- **FR45 [MVP]:** Every bet write (create / edit / adjust / void), by player or organizer, records an audit entry (actor, before/after, timestamp).
- **FR46 [MVP]:** Bet outcomes are deterministic and reproducible from scores + bet config.
- **FR47 [MVP]:** Voiding or adjusting a settled bet leaves the settle-up ledger consistent (no orphaned balances).

### Bet Lifecycle, Scope & Integrity (codex adversarial review, 2026-06-20)
- **FR48 [MVP]:** A bet binds at creation to a **specific round and an explicit hole set**; settlement uses only that scope. (Cross-round aggregation is Growth — FR19.)
- **FR49 [MVP]:** **Placement cutoff** — a bet cannot be created once any score/putt within its scope has been recorded, except an **audited organizer override** (prevents betting on a known result).
- **FR50 [MVP]:** Each side stores **{stakeholder, subject}** explicitly; the same player cannot be both stakeholders; settlement knows which subject each side backs.
- **FR51 [MVP]:** Every score-dependent **subject must be a verified roster player assigned to the bet's scoped round.**
- **FR52 [MVP]:** A bet that cannot be graded (untrustworthy net per FR24, or incomplete / DNF / pickup scores) is marked **UNSETTLEABLE** and surfaced for **organizer resolution** — never silently dropped from settle-up, never left live forever. The organizer resolves (fix tee/HI, enter a value, or void); DNF/pickup handling per basis is an organizer decision, not a silent default.
- **FR53 [MVP]:** **Visibility is stakeholder + organizer based** — a player who is only a *subject* of a bet is not automatically shown its stake. `money_visibility` (open / participant / self_only) governs which stakeholders/viewers see which amounts, enforced on **every** money read path (board, settle-up, bet detail, export).
- **FR54 [MVP]:** **Snake is a distinct N-participant settlement type** (not the two-stakeholder model): **one active Snake per group per round**; participants are **verified playing roster members fixed before the first scoped putt**; it settles only when **putts are complete for every participant on every scoped hole** (else it shows **provisional**); at settle-up it expands to pairwise debts (holder → each other participant).

## Non-Functional Requirements

### Correctness & Determinism (primary)
- **NFR-C1:** Settlement is a **pure function of (scores + bet config)**, recomputed on read; identical inputs → identical outputs. **Golden-file fixtures per bet type**: h2h net/gross, per-hole match, putting-total, front/back/total segments, and Snake (first-event recurrence incl. first-4-putt = start+1, subsequent (putts−2)×increment, same-hole holder = most putts then "last in" tiebreak, no-event = no payout, one-pays-all expansion).
- **NFR-C2:** A score correction **re-settles all affected bets** with no manual step — asserted by test.
- **NFR-C3:** Net / putts settlement **matches hand-calculation** for every bet type before the trip (hand-calc release gate).
- **NFR-C4:** Voiding or adjusting any bet (including a settled one) leaves settle-up **internally consistent** — for zero-sum bets the pair directions sum to zero; for Snake the holder's payout equals the sum of others' receipts — asserted by an invariant test.
- **NFR-C5:** Money in **integer units** (cents / whole dollars); no floating-point drift.

### Performance
- **NFR-P1:** Placing a bet completes (tap → live on board) within **~2s on LTE**; the create flow is a few taps.
- **NFR-P2:** Action board and settle-up recompute-on-read render **< 2s warm** for a ~12-player, 2-round event; poll-refresh stays at the existing leaderboard cadence (5s active round).

### Security & Privacy
- **NFR-S1:** The `money_visibility` posture is **enforced on every read path**; bets / balances never leak outside it; **spectators (non-roster) see no money** — tested.
- **NFR-S2:** Bet writes require an **authenticated roster identity** (join-code / device or SSO); **both stakeholders must be verified roster members.**
- **NFR-S3:** Every bet mutation writes an **audit row in the same transaction** (actor, before/after, timestamp).
- **NFR-S4:** The app **never holds or transfers funds** — settle-up is informational (cash / Venmo between humans); there is no payment surface to secure.

### Reliability & Offline
- **NFR-R1:** Bet **placing is an online action** (needs a live taker + board write); it is **not queued offline in v1.** Score entry (which bets settle on) keeps its existing offline path; a late or corrected score re-settles on sync.
- **NFR-R2:** A bet write + its audit (+ future activity emit) **commit in one transaction**; no partial writes persist.

### Usability & Accessibility
- **NFR-U1:** Inherits the existing design-system primitives and dark-mode tokens; **≥44px tap targets**; the player create flow is **mobile-first / one-handed**; tables wrapped in scroll regions (no 375px overflow).

### Scalability
- **N/A at v1 scale** (single event, ~12 players, 2 rounds). Recompute-on-read is millisecond-scale SQLite; revisit only if a board read exceeds ~200ms (existing tripwire).

### Deployability & Regression
- **NFR-D1:** The **Wolf Cup suite and existing Tournament suites stay green on every commit**; this work touches **Tournament paths only.**
- **NFR-D2:** CI runs all suites and gates deploy on green.
