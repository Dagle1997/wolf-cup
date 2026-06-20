---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: 'COMPLETE + adversarially hardened (2026-06-20). 5 epics, 16 stories, all MVP FR1–FR54 mapped; Pete Dye must-have = Epics 1+2+3 (4+5 trim-able). Final validation passed; 14 adversarial findings folded in (state enum, net-calc version, roster-not-playing gate, shotgun play-sequence, UNSETTLEABLE resolve action, Nassau parent non-settling, etc.). READY FOR IMPLEMENTATION — first artifact = golden hand-calc fixtures (hard gate).'
nextStep: 'DONE — proceed to implementation (Story 1.1: golden fixtures + bets schema).'
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/prd-betting-action-line.md
  - _bmad-output/planning-artifacts/tournament/architecture-betting-action.md
  - _bmad-output/planning-artifacts/tournament/implementation-readiness-report-betting-2026-06-20.md
outputFolder: '_bmad-output/planning-artifacts/tournament/'
scope: 'Epics & stories for Tournament "The Action" betting (FR1–FR54). Brownfield; Tournament paths only. Feature-scoped file — does NOT clobber epics-phase1.md.'
---

# Tournament "The Action" Betting - Epic Breakdown

## Overview

Complete epic and story breakdown for the Tournament betting feature, decomposing PRD `prd-betting-action-line.md` (FR1–FR54) + architecture `architecture-betting-action.md` into implementable stories. Brownfield on the shipped Tournament app; `apps/tournament-api` + `apps/tournament-web` only.

## Requirements Inventory

### Functional Requirements

**Bet Creation & Management**
- FR1 [MVP]: roster member creates a bet (subject(s), type, basis, stake, opposing stakeholder).
- FR2 [MVP]: player-created bet goes live immediately (trust model, no acceptance).
- FR3 [MVP]: organizer creates a bet for any roster members (auto-confirmed).
- FR4 [MVP]: organizer edits a bet's params; outcome recomputes.
- FR5 [MVP]: organizer voids a bet (audit preserved).
- FR6 [MVP]: creator voids/corrects own bet only before any in-scope score/putt exists; after, organizer-only; segmented bets void as one parent.
- FR7 [Growth]: propose → in-app accept handshake.

**Bet Model, Types & Basis**
- FR8 [MVP]: subjects distinct from stakeholders.
- FR9 [MVP]: two opposing stakeholders, both verified roster members; no one-sided bet (no house).
- FR10 [MVP]: a stakeholder may be any roster member, playing or not.
- FR11 [MVP]: head-to-head type (lower total wins).
- FR12 [MVP]: per-hole match-play type — (holes won − lost) × stake, pushes zero, no auto-press v1, putts basis invalid.
- FR13 [MVP]: basis net / gross / putts.
- FR14 [MVP]: h2h subjects may be cross-foursome.
- FR15 [MVP]: h2h segmented by course hole number — total, or front/back/total (3 linked children; stake each).
- FR16 [MVP-capable]: front/back/total on net/gross = Nassau; on putts = putting game.
- FR17 [MVP]: putting game = putts-basis h2h on total putts (never per-hole), configurable amount, optional front/back/total, cross-foursome.
- FR18 [Growth]: over/under (vs line, push on equality).
- FR19 [Growth]: multi-round bets.
- FR20 [MVP]: new bet types without schema migration (additive); unknown type rejected.

**Settlement**
- FR21 [MVP]: auto-settle from recorded scores.
- FR22 [MVP]: score correction re-settles affected bets.
- FR23 [MVP]: net uses leaderboard net (locked-HI aware), never re-derived.
- FR24 [MVP]: untrustworthy net stays unsettled (fail-closed).
- FR25 [MVP]: settles only when all subjects complete the depended-on holes; else live/provisional.
- FR26 [MVP]: level bet = push.

**Group Games — Snake**
- FR27 [MVP]: organizer enables Snake per group/round (starting amount + increment, participant set).
- FR28 [MVP]: putts recorded per hole only for players in an active putting game; others never asked.
- FR29 [MVP]: holder = most recent qualifying event in play sequence; same-hole tie → worst putt takes it, then scorer "last in" on a putt-count tie.
- FR30 [MVP]: escalation — first event = start + (putts−3)×incr; subsequent += (putts−2)×incr; no event = no payout.
- FR31 [MVP]: round end → holder pays final value to each other participant, netted into settle-up.
- FR32 [MVP]: viewer sees putting totals + live holder + value.

**The Action Board**
- FR33 [MVP]: consolidated Action board of event bets, live/settled.
- FR34 [MVP]: board honors money_visibility.
- FR35 [MVP]: spectators (non-roster) see no money/bets.
- FR36 [MVP]: viewer sees hole-by-hole basis of a permitted bet.

**Settle-Up & Ledger**
- FR37 [MVP]: pairwise settle-up across all settled bets, netted per stakeholder pair.
- FR38 [MVP]: settle-up includes non-playing stakeholders.
- FR39 [MVP]: push / even pair contributes nothing.
- FR40 [MVP]: Snake one-pays-all expressed as holder → each-other directional amounts.
- FR41 [Growth]: event-scoped betting ledger / history.

**Identity & Access**
- FR42 [MVP]: roster member auths via join-code/device; full betting access playing or not.
- FR43 [MVP]: both sides verified roster members; no free-text v1.
- FR44 [MVP]: creating a bet grants no scoring rights.

**Audit & Integrity**
- FR45 [MVP]: every bet write records audit (actor, before/after, ts).
- FR46 [MVP]: outcomes deterministic + reproducible from scores + config.
- FR47 [MVP]: void/adjust leaves settle-up ledger consistent.

**Lifecycle, Scope & Integrity (hardening)**
- FR48 [MVP]: bet binds at creation to a round + explicit hole set.
- FR49 [MVP]: placement cutoff — no create once an in-scope score/putt exists, except audited organizer override.
- FR50 [MVP]: each side = {stakeholder, subject}; same player not both sides.
- FR51 [MVP]: every score-dependent subject is a verified roster player on the scoped round.
- FR52 [MVP]: ungradeable bet → UNSETTLEABLE, surfaced for organizer resolution (incl. DNF/pickup).
- FR53 [MVP]: visibility stakeholder+organizer based; subject-only player not shown stake.
- FR54 [MVP]: Snake = distinct N-participant type; one per group/round; participants fixed pre-putt; settles only on complete putts; pairwise expansion.

### NonFunctional Requirements

- NFR-C1: settlement pure fn (scores+config), recompute-on-read; golden fixtures per bet type incl Snake edges.
- NFR-C2: score correction re-settles affected bets.
- NFR-C3: net/putts settlement matches hand-calc pre-trip (release gate).
- NFR-C4: void/adjust internally consistent (zero-sum pairs net to zero; Snake holder-out = sum receipts) — fast-check property test.
- NFR-C5: integer money units.
- NFR-P1: place a bet < ~2s; NFR-P2: board/settle-up render < 2s warm.
- NFR-S1: money_visibility enforced on every read path; spectators see no money.
- NFR-S2: bet writes need authenticated roster identity; both stakeholders verified roster members.
- NFR-S3: every mutation writes an audit row in the same tx.
- NFR-S4: app never holds/transfers funds (informational settle-up).
- NFR-R1: placing is online-only (not offline-queued); late/corrected score re-settles.
- NFR-R2: bet write + audit (+ activity) commit in one tx.
- NFR-U1: inherits design-system primitives, dark-mode tokens, ≥44px targets, mobile-first create.
- NFR-D1: Wolf Cup + existing Tournament suites stay green; Tournament paths only.
- NFR-D2: CI runs all suites, gates deploy on green.

### Additional Requirements (from Architecture)

- **No scaffold story.** First build artifact = **golden hand-calc fixtures** (the hard gate), then the `bets` schema. Fixtures take net-per-hole as a GIVEN input (hand-calc), independent of `netForSegment`.
- **New `bets` schema** (additive): `bets`, `bet_sides`, `snake_games`, `snake_participants`, `snake_holder_overrides`. **Never extend `individual_bets`** (P14).
- **Pure engine** `engine/bets/` (no db/Date/random — P1); settlement recompute-on-read via `bets-query.ts`.
- **`netForSegment()`** exported from `leaderboard.ts` reusing existing `allocateNetThroughHole`; settlement **never re-derives net** (P2). Validated by a **net-reconciliation** test.
- **`SettlementEdge {fromPlayerId,toPlayerId,cents,sourceBetId,sourceType}` canonical IR** (P15) — every source (h2h/per-hole/putting/segment/Snake) reduces to it; settle-up nets a flat edge list.
- **`money_visibility` chokepoint** in `bets-query.ts` (P8); enforced on every read path.
- **Audit + activity emit in the same `tx`** via inherited `writeAudit`/`emitActivity`; bet activity types extend the existing Zod discriminated union.
- **Putts:** reuse `hole_scores.putts` (exists, nullable); `putting-entry.ts` holds the logic, `scores.ts` delegates (single live-code edit); `activePuttingGames(roundId)` is the one source for "is putts needed."
- **Reversible finalize-snapshot:** freeze `finalized_outcome_json` on finalize; organizer un-finalize→correct→re-finalize. Tested by freeze/reflow.
- **One new dependency:** `fast-check` (devDep). **PORTS.md** entry for the putts "least putts" port.
- **Settle-up integrates into existing** `money-detail.ts` + `settle-up.tsx`/`my-money.tsx` (already pairwise + per-game) — no parallel money surface.
- **Build order (admin-console-first):** fixtures+schema → engine+netForSegment → admin console (floor) → player+Action board → putts+Snake+score-entry → settle-up+finalize.
- **Important per-epic specifics (from readiness gap analysis):** subject-in-round validation rule (FR51); finalize/un-finalize trigger on a late correction; confirm existing money views render bet-sourced edges.

### FR Coverage Map

- FR1→E2 · FR2→E2 · FR3→E1 · FR4→E1 · FR5→E1 · FR6→E2 · FR7→Growth · FR8→E1 · FR9→E1 · FR10→E2
- FR11→E1 · FR12→E1 · FR13→E1(net/gross)+E4(putts) · FR14→E1 · FR15→E4 · FR16→E4 · FR17→E4 · FR18→Growth · FR19→Growth · FR20→E1
- FR21→E1 · FR22→E1 · FR23→E1 · FR24→E1 · FR25→E1 · FR26→E1 · FR27→E3 · FR28→E3 · FR29→E3 · FR30→E3
- FR31→E3 · FR32→E3 · FR33→E1 · FR34→E1 · FR35→E1 · FR36→E1 · FR37→E1 · FR38→E1 · FR39→E1 · FR40→E3
- FR41→Growth · FR42→E2 · FR43→E2 · FR44→E2 · FR45→E1 · FR46→E1 · FR47→E1+E5 · FR48→E1 · FR49→E1+E2 · FR50→E1
- FR51→E1 · FR52→E1 · FR53→E1 · FR54→E3
- All FR1–FR54 mapped (Growth: FR7, FR18, FR19, FR41 deferred).

## Epic List

> **Pete-Dye priority:** Epics 1 → 2 → 3(Snake) are must-have; Epics 4 → 5 are the trim line (finalize lowest). Each epic is standalone — Epic 1 is the full admin-run floor; 2–5 each add a capability without requiring later epics.

### Epic 1: The Book Floor — Admin-Run Bets That Settle
The organizer enters h2h and per-hole-match bets (net/gross) for anyone; they auto-settle from scores, appear on the Action board, and roll into a pairwise settle-up. **This alone runs Pete Dye** (admin-entered model Wolf Cup shipped). Carries the foundation a first vertical slice needs — golden fixtures, `bets` schema, pure engine, `netForSegment`, `SettlementEdge` IR, audit. **First story = the thinnest slice: one h2h-net bet, admin-entered, settles, shows in settle-up, end-to-end;** per-hole match, gross basis, and board polish are follow-on stories.
**FRs covered:** FR3, FR4, FR5, FR8, FR9, FR11, FR12, FR13(net/gross), FR14, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR33, FR34, FR35, FR36, FR37, FR38, FR39, FR45, FR46, FR47, FR48, FR49(admin override), FR50, FR51, FR52, FR53. **NFRs:** C1–C5, S1–S4, R2, D1–D2.

### Epic 2: Player Self-Serve Betting (The Open Book)
Any joined roster member places their own bets against others from their phone — trust model, live immediately — including non-playing backers (the Kyle case). Builds the player create surface + open-book stakeholders on Epic 1's engine/board.
**FRs covered:** FR1, FR2, FR6, FR10, FR42, FR43, FR44, FR49(player cutoff).

### Epic 3: Putts Foundation + Snake
The loved Pete-Dye game. Conditional putts entry (`putting-entry.ts`; `scores.ts` delegates) lands here with its most-wanted consumer; Snake is a distinct N-participant settlement type — escalating, worst-putt-takes-it (scorer "last-in" tiebreak), holder-pays-all, completeness gate — expanding into the pairwise ledger.
**FRs covered:** FR27, FR28, FR29, FR30, FR31, FR32, FR40, FR54.

### Epic 4: Segmented Bets & The Putting Game
Front/back/total segmentation (Nassau on strokes; a putts-basis putting game on total putts), reusing Epic 3's putts infrastructure. Nassau is stroke-only and independent of putts.
**FRs covered:** FR15, FR16, FR17, FR13(putts).

### Epic 5: Finalize & Settle-Up Hardening
Reversible finalize-snapshot freezes settled money so a later net change can't move it; organizer can un-finalize → correct → re-finalize. Refines Epic 1's settle-up. *Lowest priority / first to trim.*
**FRs covered:** FR47(reinforced), finalize (architecture D3).

### Growth (post-MVP, not scoped here)
Over/under (FR18), multi-round (FR19), verified propose→accept handshake (FR7), event-scoped ledger (FR41), in-app Action toasts/banners.

---

# Epics & Stories

## Epic 1: The Book Floor — Admin-Run Bets That Settle

The organizer enters h2h and per-hole-match bets (net/gross) for any roster members; bets auto-settle from recorded scores, appear on the Action board, and roll into a pairwise settle-up. This epic alone runs Pete Dye on the admin-entered model Wolf Cup shipped. It carries the foundation: golden hand-calc fixtures (the hard gate), the `bets` schema, the pure recompute-on-read engine, `netForSegment()`, the `SettlementEdge` IR, and audit. Stories are dependency-ordered; each builds only on its predecessors.

### Story 1.1: Walking skeleton — one admin-entered h2h-net bet that settles into settle-up

As an organizer,
I want to enter a single head-to-head net bet between two roster members and have it auto-settle from recorded scores into the pairwise settle-up,
So that the group can run real money on the app at Pete Dye end-to-end, on math we have proven by hand.

**Acceptance Criteria:**

**Given** no settlement code exists yet
**When** Story 1.1 begins
**Then** the first build artifact is a hand-authored, hand-approved golden fixture file for the h2h-net bet type (input net-per-hole given by hand, independent of `netForSegment`), and no settlement engine code is written or committed before that fixture set is approved
**And** the work is confined to `apps/tournament-api` and `apps/tournament-web` (Tournament paths only)

**Given** the additive schema requirement
**When** the bet model is created
**Then** new tables `bets` and `bet_sides` are added by migration (never extending `individual_bets`, per P14)
**And** a `bet` binds at creation to a specific `round_id` and a `hole_scope` value from the **4-value enum** `front | back | total | full18` (arbitrary hole sets per FR48 are DEFERRED per architecture D1 — NOT v1)
**And** the `bets` table carries a canonical `state` enum `live | provisional | settled | push | void | unsettleable | finalized` as the **single source of truth** (P4); transitions live in code, and `resolution_json` / `finalized_outcome_json` / `voided_at` are payloads validated against `state`, never independent truth
**And** money is stored in integer cents (NFR-C5)

**Given** two opposing stakeholders
**When** an organizer creates an h2h-net bet
**Then** each side is `{stakeholder, subject}`; both stakeholders are verified roster members (FR9), subjects are distinct from stakeholders (FR8), and the same player cannot occupy both sides (FR50)
**And** every score-dependent subject is a verified roster player on the scoped round (FR51)
**And** the create writes an audit row (actor, before/after, timestamp) and an activity row in the same transaction (FR45, NFR-S3, NFR-R2)
**And** the new activity event types (`bet.created`, `bet.settled`, `bet.voided`, `bet.finalized`) are registered in the existing activity Zod discriminated union (else `emitActivity` rejects them — architecture D8 known integration)

**Given** a created h2h-net bet and recorded scores
**When** settlement is computed
**Then** the pure engine in `engine/bets/` (no db/Date/random) returns a list of `SettlementEdge {fromPlayerId, toPlayerId, cents, sourceBetId, sourceType}` (P15)
**And** net comes from `netForSegment()` exported from `leaderboard.ts` (reusing `allocateNetThroughHole`); settlement never re-derives net (P2, FR23)
**And** a separate net-reconciliation test proves `netForSegment()` matches the leaderboard's net for the same player/segment — validating the *input* to settlement, independent of the golden fixtures (which take net as a given)
**And** each settled outcome records the **net-calc version** it was computed under, so a later leaderboard net-calc change cannot silently re-settle an already-banked bet — a version mismatch is surfaced for organizer review, never applied silently (architecture key-deliverable + cross-cutting concern #1; this guard is independent of Epic 5's stronger finalize-snapshot, so banked money stays protected even if Epic 5 is trimmed)
**And** a level bet is a push contributing nothing (FR26)
**And** the bet settles only once all subjects have completed the depended-on holes; otherwise it stays live/provisional (FR25, FR21)
**And** outcomes are deterministic and reproducible from scores + config (FR46, NFR-C1)

**Given** an h2h bet
**When** the organizer picks subjects
**Then** the two subjects may be in different foursomes (cross-foursome h2h, FR14) — the engine reads each subject's net for the scoped segment regardless of grouping

**Given** a settled h2h-net bet
**When** the pairwise settle-up is rendered
**Then** the bet's `SettlementEdge`s net into the existing `money-detail.ts` pairwise ledger / `settle-up` view (no parallel money surface), netted per stakeholder pair (FR37)
**And** a stakeholder who is not playing the round is still included in settle-up (FR38)
**And** a push or even pair contributes nothing to settle-up (FR39)
**And** a `fast-check` property test proves the ledger invariant (zero-sum pairs net to zero) — NFR-C4
**And** net/putts settlement matches the approved hand-calc fixtures (NFR-C3 release gate)
**And** the existing viewer money pages — `my-money.tsx`, `money.tsx`, and `settle-up.tsx` — render the bet-sourced edges (verified by test, not assumed); the architecture marks all three `~MOD` (readiness open-item #3)

> **Sizing note (single, per Josh's call):** 1.1 is the deliberate walking skeleton and is large. If it stalls mid-build, the recorded fallback split is **1.1a** (golden fixtures + `bets`/`bet_sides` schema + `state` enum + pure h2h-net engine + `SettlementEdge` IR + `netForSegment` + net-reconciliation — no live wiring) and **1.1b** (admin create endpoint + UI + settle-up integration + audit/activity). Prefer whole; split only if blocked.

### Story 1.2: Per-hole match-play bet type

As an organizer,
I want to enter a per-hole match-play bet between two roster members,
So that the group can settle the common "match" format, not just total-score head-to-head.

**Acceptance Criteria:**

**Given** the engine and IR from Story 1.1
**When** a per-hole match-play bet settles
**Then** the outcome is (holes won − holes lost) × stake, a tied hole pushes (contributes zero), with no auto-press in v1 (FR12)
**And** the result reduces to the same `SettlementEdge` IR and nets into settle-up with no spine changes
**And** a putts basis is rejected as invalid for this type (FR12)

**Given** the additive-types requirement
**When** the per-hole match type is added
**Then** it is added without a schema migration (additive type, per FR20); an unknown bet type is rejected **at creation**
**And** if an unknown/unsupported type or basis is ever reached **at settlement**, the engine returns a typed `unsupported` outcome — never a silent push or $0 (P6 fail-loud)
**And** approved golden hand-calc fixtures for per-hole match (win/loss/push hole mixes) exist before its settlement code

### Story 1.3: Gross basis for head-to-head

As an organizer,
I want to choose a gross basis for a head-to-head bet,
So that scratch/gross matches settle correctly alongside net ones.

**Acceptance Criteria:**

**Given** net basis shipped in Story 1.1
**When** an organizer creates an h2h bet with basis = gross
**Then** settlement uses gross strokes for the scoped segment (FR13 gross) and reduces to the same `SettlementEdge` IR
**And** approved golden hand-calc fixtures cover the gross case
**And** net-basis behavior from Story 1.1 is unchanged (regression-safe)

### Story 1.4: Organizer edit & void with ledger consistency

As an organizer,
I want to edit a bet's parameters or void it,
So that I can fix mistakes and cancel bets without corrupting the settle-up.

**Acceptance Criteria:**

**Given** an existing bet
**When** the organizer edits its parameters
**Then** the outcome recomputes from scores + new config (FR4) and the settle-up reflects the change
**And** the edit writes an audit row (before/after) and activity in the same transaction

**Given** an existing bet
**When** the organizer voids it
**Then** the bet no longer contributes to settle-up, its audit history is preserved (FR5), and the settle-up ledger remains internally consistent — zero-sum pairs still net to zero (FR47, NFR-C4)
**And** an organizer may create or correct a bet after an in-scope score/putt exists only via an explicitly audited override (FR49 admin override)

### Story 1.5: The Action board

As a roster member,
I want a consolidated board of the event's bets showing live and settled state,
So that everyone can see what action is on and how each bet is tracking.

**Acceptance Criteria:**

**Given** roster identity (the betting surface requires an authenticated roster member)
**When** a member opens the Action board
**Then** it lists the event's bets with live vs settled state (FR33)
**And** non-roster spectators cannot reach the betting surface and see no money or bets (FR35)

**Given** a bet the viewer is permitted to see
**When** the viewer opens its detail
**Then** the hole-by-hole basis of the bet is shown (FR36)
**And** the board renders within the performance budget (NFR-P2, < 2s warm)

### Story 1.6: Settlement robustness — corrections, completeness, fail-closed

As an organizer,
I want bets to re-settle correctly when scores change and to refuse to settle on untrustworthy or incomplete data,
So that the money is never wrong and bad data is surfaced rather than silently mis-paid.

**Acceptance Criteria:**

**Given** a settled or live bet
**When** an in-scope score is corrected
**Then** the affected bets re-settle from the corrected scores (FR22, NFR-C2) and the settle-up updates
**And** an integration test corrects a recorded score and asserts the settle-up amount actually changes (not merely that recompute ran)

**Given** net that the leaderboard cannot vouch for (untrustworthy/locked-HI gaps)
**When** settlement runs
**Then** the bet stays unsettled (fail-closed, FR24) rather than settling on a guess

**Given** a bet whose outcome cannot be graded (DNF, pickup, missing required holes)
**When** settlement runs
**Then** the bet is marked UNSETTLEABLE and surfaced for organizer resolution (FR52), not silently dropped
**And** a bet settles only when all subjects complete the depended-on holes (FR25)

**Given** an UNSETTLEABLE bet
**When** the organizer resolves it
**Then** the organizer has an explicit **resolve action** — fix the tee/HI, enter a manual settlement value, or void — which writes `resolution_json` and transitions `state` accordingly (FR52, architecture durable-state #2); DNF/pickup handling per basis is the organizer's decision, never a silent default
**And** the resolve action writes audit + activity in one transaction and leaves settle-up consistent

### Story 1.7: Money-visibility tiers *(lowest priority — trim-able; not a Pete Dye blocker)*

As a roster member,
I want the board to honor money-visibility rules,
So that a player who is only a bet's subject (not a stakeholder) isn't shown stakes they have no money in.

**Acceptance Criteria:**

**Given** the `money_visibility` chokepoint in `bets-query.ts` (P8)
**When** any read path returns bet/money data
**Then** visibility is enforced at that single chokepoint on every read (NFR-S1, FR34)

**Given** a player who is a bet's subject but not a stakeholder
**When** they view the bet
**Then** they are not shown the stake; stake detail is visible to stakeholders and the organizer only (FR53)

> **Pete Dye note:** money visibility is not a launch blocker for the member-guest trip (closed roster, friendly open book). Ship if ready; safe to defer to Growth otherwise.

## Epic 2: Player Self-Serve Betting (The Open Book)

Any joined roster member places their own bets against others from their phone — trust model, live immediately — including non-playing backers (the "Kyle" case). Builds the player create surface and open-book stakeholder semantics on Epic 1's engine, board, and settle-up; adds no new settlement spine.

### Story 2.1: Player places their own bet (open book)

As a roster member,
I want to place my own bet against another roster member from my phone,
So that I can get action going without waiting for the organizer.

**Acceptance Criteria:**

**Given** a roster member authenticated via join-code/device
**When** they open the betting surface
**Then** they have full betting access whether or not they are playing the round (FR42)
**And** the create route gate keys on **event-roster membership, NOT foursome/playing assignment** — a roster member who is not in any foursome (the non-playing backer "Kyle") passes the gate (resolves architecture D7's "event participant" ambiguity per Josh: anyone on the trip is on the roster; anyone who wants to bet must be on the roster)
**And** the surface is mobile-first, inherits the design-system primitives and dark-mode tokens, and uses ≥44px tap targets (NFR-U1)

**Given** an authenticated roster member
**When** they create a bet
**Then** they pick the subject(s), type, basis, stake, and the opposing stakeholder (FR1)
**And** both stakeholders must be verified roster members — no free-text outsiders (FR43)
**And** a stakeholder may be any roster member, playing or not (the open-book / non-playing backer "Kyle" case, FR10)
**And** the bet goes live immediately with no acceptance step (trust model, FR2)
**And** creating a bet grants no scoring rights (FR44)

**Given** a player-created bet
**When** it is saved
**Then** it reuses the Epic 1 engine/board/settle-up unchanged — it appears on the Action board and settles identically to an admin-entered bet
**And** the write commits the bet + audit + activity in one transaction (NFR-R2, NFR-S3)
**And** placing a bet completes in < ~2s (NFR-P1) and is online-only, not offline-queued (NFR-R1)

### Story 2.2: Creator self-void/correct with placement cutoff

As a roster member who created a bet,
I want to void or fix my own bet before it has any scores,
So that I can correct mistakes myself without bugging the organizer — but never once money is in play.

**Acceptance Criteria:**

**Given** a bet the member created, with no in-scope score or putt yet recorded
**When** the creator voids or corrects it
**Then** the action succeeds and writes an audit row (before/after) + activity in one transaction; settle-up stays consistent (FR6)

**Given** a bet with at least one in-scope score or putt recorded
**When** the creator attempts to void or correct it
**Then** the action is refused for the creator; only the organizer may change it thereafter (FR6)

**Given** any roster member (creator or organizer)
**When** they attempt to create a new bet whose scope already has a recorded score or putt
**Then** creation is blocked, except via an explicitly audited organizer override (placement cutoff, FR49)

> **Forward note (no dependency):** FR6's "segmented bets void as one parent" rule is a constraint Epic 4 must honor when segmentation exists — a void targets the parent and cascades to its child segments. It is not a Story 2.2 deliverable.

## Epic 3: Putts Foundation + Snake

The loved Pete-Dye game. Conditional putts entry lands here with its most-wanted consumer; Snake is a distinct N-participant settlement type — escalating, worst-putt-takes-it (scorer "last-in" tiebreak), holder-pays-all, completeness-gated — expanding into the pairwise settle-up ledger.

### Story 3.1: Conditional putts entry foundation

As a scorer,
I want to be asked for a player's putts only when that player is in an active putting game,
So that putts are captured for the games that need them without burdening every score entry.

**Acceptance Criteria:**

**Given** a round with no active putting game for a player
**When** the scorer enters that player's hole score
**Then** putts are never requested for that player (FR28)

**Given** a round with an active putting game including a player
**When** the scorer enters that player's hole score
**Then** putts are requested and stored per hole, reusing the existing `hole_scores.putts` field (nullable)
**And** a null `hole_scores.putts` means **not entered** (feeds the completeness gate) — it is never coerced to 0 or treated as a 3-putt (architecture D5)
**And** `activePuttingGames(roundId)` is the single source of truth for whether putts are needed
**And** the putts logic lives in `putting-entry.ts` and `scores.ts` delegates to it (the single live-code edit pattern, P-aligned)
**And** a PORTS.md entry records the "least putts" port
**And** the change is confined to Tournament paths and leaves the existing scoring suites green (NFR-D1)

### Story 3.2: Snake game setup

As an organizer,
I want to enable a Snake game for a specific group and round with a starting amount, increment, and participant set,
So that the group's 3-putt game is configured before any putts are recorded.

**Acceptance Criteria:**

**Given** a round and a group
**When** the organizer enables Snake
**Then** they set a starting amount, an increment, and the participant set (FR27)
**And** Snake participants must be verified **playing** roster members (FR54) — a non-playing roster member cannot be a participant (no putts would ever arrive, stranding the completeness gate); this differs from h2h stakeholders, who may be non-playing (FR10)
**And** new tables `snake_games` and `snake_participants` are added by migration (additive; never extending `individual_bets`)
**And** at most one Snake game exists per group per round (FR54)
**And** once any putt has been recorded for the game, the participant set is fixed (participants fixed pre-putt, FR54)
**And** the setup writes audit + activity in one transaction

### Story 3.3: Snake holder + escalation engine

As the system,
I want to deterministically compute the current Snake holder and the game's value from recorded putts,
So that the loved game is settled on math we have proven by hand, with the tiebreaks the group actually uses.

**Acceptance Criteria:**

**Given** no Snake settlement code exists yet
**When** Story 3.3 begins
**Then** the first build artifact is a hand-authored, hand-approved golden fixture set covering every Snake edge (first-event value, subsequent escalation, same-hole ties, last-in tiebreak, no-event round) — no Snake engine code is committed before those fixtures are approved (the hard gate)

**Given** recorded putts for a Snake game
**When** the engine computes value
**Then** the first qualifying 3-putt event sets value = start + (putts − 3) × increment; each subsequent qualifying event adds (putts − 2) × increment; a round with no qualifying event yields no payout (FR30)
**And** a null putt count is not a qualifying event — it is not-entered, never coerced to 0 or 3 (architecture D5)
**And** the engine is pure (`engine/bets/`, no db/Date/random)

**Given** recorded putts for a Snake game
**When** the engine determines the holder
**Then** the holder is the most recent qualifying event in play sequence (FR29)
**And** the hole **play-sequence** is passed into the engine as an explicit input, **never inferred from hole number** (P16) — so a shotgun or front/back-split start orders qualifying events correctly *(Pete Dye 2026 is a standard sequential start, so this has no effect this trip; it keeps the engine correct for future shotgun events)*
**And** when two players in the group qualify on the same hole, the worse putt count takes it; on an equal putt count, the scorer-recorded "last in" breaks the tie (FR29)
**And** the last-in tiebreak is captured via `snake_holder_overrides` (added by migration) because it cannot be inferred from putt totals; the engine reads it
**And** outcomes are deterministic and reproducible from putts + config (FR46) and match the approved fixtures (NFR-C3)

### Story 3.4: Snake settlement + live view

As a roster member,
I want the Snake to pay out at round end and to watch it live during the round,
So that the holder pays everyone correctly and the table can follow who's holding the Snake.

**Acceptance Criteria:**

**Given** a Snake game whose required putts are all recorded
**When** the round ends and settlement runs
**Then** the final holder pays the final value to each other participant (FR31), expressed as directional holder → each-other `SettlementEdge`s (one-pays-all pairwise expansion, FR40, FR54)
**And** those edges net into the existing pairwise settle-up alongside h2h/per-hole edges (bet-type-blind)
**And** the Snake settles only once the depended-on putts are complete; otherwise it stays live/provisional (FR54)
**And** a `fast-check` property test proves the Snake invariant: holder's total out = sum of the other participants' receipts (NFR-C4)

**Given** an in-progress Snake game
**When** a permitted viewer opens it
**Then** they see each participant's putting totals, the live holder, and the current value (FR32)

## Epic 4: Segmented Bets & The Putting Game

Front/back/total segmentation — Nassau on strokes (net/gross) and a putts-basis Putting Game on total putts — reusing Epic 3's putts infrastructure. Nassau is stroke-only and independent of putts. Builds on Epic 1's h2h engine; adds no new settlement IR.

### Story 4.1: Segmented head-to-head (Nassau)

As an organizer or roster member,
I want a head-to-head stroke bet split into front/back/total segments,
So that we can play a Nassau where each nine and the overall match are their own bet.

**Acceptance Criteria:**

**Given** an h2h bet on a net or gross basis
**When** the creator chooses segmentation
**Then** they may pick total-only, or front/back/total (FR15)
**And** front/back/total creates a **parent + three linked child segments**; the bet's single stake **applies to each segment** (so a $20 Nassau has $20 on front, $20 on back, $20 on total = $60 total exposure, per FR15) — not three independently-configured stakes
**And** segments are fixed by **course hole number, never play order** (FR15) — contrast Snake's play-sequence ordering (P16)
**And** on a net or gross basis this is a Nassau (FR16)

**Given** a segmented bet
**When** settlement runs
**Then** the **parent is a non-settling container** (carries no outcome); only the three children settle — preventing double-counting (architecture D1)
**And** each child segment settles independently over its course-hole range (front 1–9, back 10–18, total 1–18) via `netForSegment()`, reducing to the same `SettlementEdge` IR and netting into settle-up
**And** approved golden hand-calc fixtures cover the front/back/total cases before settlement code

**Given** a segmented bet (the deferred FR6 clause from Epic 2)
**When** it is voided or corrected
**Then** the action targets the parent and cascades to all child segments as one unit (FR6 segmented), leaving settle-up consistent

### Story 4.2: Putts-basis head-to-head & the Putting Game

As an organizer or roster member,
I want a putting game scored on total putts with the same front/back/total options,
So that we can bet on putting cross-foursome, not just on strokes.

**Acceptance Criteria:**

**Given** an h2h bet
**When** the creator selects a putts basis
**Then** it grades on total putts over the segment, never per-hole (FR13 putts, FR17)
**And** a putts basis remains invalid for the per-hole match-play type (unchanged from Epic 1)

**Given** a putts-basis h2h
**When** the creator configures it
**Then** it is the Putting Game: a configurable amount, optional front/back/total segmentation reusing Story 4.1, and cross-foursome subjects are allowed (FR16 putts, FR17)

**Given** a created Putting Game
**When** it is saved
**Then** its subjects are registered so `activePuttingGames(roundId)` reports their putts as needed (Epic 3 capture path), and the scorer is prompted for those putts
**And** approved golden hand-calc fixtures cover putts-basis total and segmented cases
**And** the result reduces to the `SettlementEdge` IR and nets into settle-up

## Epic 5: Finalize & Settle-Up Hardening

Reversible finalize-snapshot freezes settled money so a later net change can't silently move it; the organizer can un-finalize → correct → re-finalize. Refines Epic 1's settle-up. *Lowest priority / first to trim.*

### Story 5.1: Reversible finalize-snapshot

As an organizer,
I want to finalize the settle-up so a later score change can't silently move settled money, and to un-finalize when I need to make a genuine correction,
So that everyone trusts the posted numbers while I retain a controlled path to fix real errors.

**Acceptance Criteria:**

**Given** a round whose bets have settled
**When** the organizer finalizes
**Then** the settled outcomes are frozen into `finalized_outcome_json` (architecture D3), and the settle-up thereafter reads the frozen snapshot rather than a live recompute

**Given** a finalized round
**When** an in-scope score or net changes
**Then** the finalized money does not move — the snapshot holds (FR47 reinforced); un-finalize is never triggered automatically, only by an explicit organizer action

**Given** a finalized round needing a correction
**When** the organizer un-finalizes, corrects, and re-finalizes
**Then** un-finalize reverts to live recompute, the correction flows, and re-finalize freezes the new outcome
**And** each finalize / un-finalize / re-finalize writes audit + activity in one transaction
**And** the settle-up ledger stays internally consistent across the cycle — zero-sum pairs net to zero (FR47, NFR-C4)

**Given** the freeze/reflow guarantee
**When** the behavior is tested
**Then** a freeze/reflow test proves: post-finalize a corrected score does not change settle-up, and after un-finalize → re-finalize the settle-up reflects the correction
