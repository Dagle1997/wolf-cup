---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md
  - _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md
  - _bmad-output/planning-artifacts/tournament/architecture-betting-action.md
  - _bmad-output/planning-artifacts/tournament/epics-betting-action.md
  - _bmad-output/brainstorming/brainstorming-session-2026-06-16.md
  - _bmad-output/planning-artifacts/tournament/HANDOFF-f1-rules-games.md
outputFolder: '_bmad-output/planning-artifacts/tournament/'
scope: 'Epics & stories for Tournament F1 "Rules & Games" (Guyan real-money engine, FR1–FR45). Brownfield; Tournament paths only. Feature-scoped file — does NOT clobber epics-phase1.md or epics-betting-action.md.'
status: 'WIP 2026-06-21 — Step 1+2 COMPLETE. Step 3 IN PROGRESS: Epic 1 storied+director-reviewed (MINOR-FIXES folded). Epics 2–6 drafted (27 stories). GATE PIPELINE (party + codex/gemini director + fold + re-review per epic): Epic 2 DONE & CLEAN (Josh confirmed FR2=event-level; domain corrections folded: greenie=binary yes/no claim + par-3 carryover, sandie=gross par-or-better default, cap=per-game-instance 2v2-only). Epic 3 DONE & CLEAN (Josh confirmed per-player-buy-in WTA + 2-man teams; reordered 3.3 pin before 3.4 pot; reuse computeTeamStandings; +Story 3.5 buy-in tracker/pot-total). Epic 4 DONE (forward-effective/FR31 DEFERRED post-MVP; finalize via ADD COLUMN; canonical assertNotFinalized; correction captures pre-edges in-tx; non-additive pot reconciliation). Epic 5 DONE (additive cutover_state column resolves the routing-invariant contradiction; backfill fail-closes on presses; flip-time recompute + reversible rollback). Epic 6 DONE (self-report = idempotent cell upsert, 2.1 unchanged; cross-group = dedicated f1_cross_group namespace + reads finalized per-player results; requireFoursomeMember gate; per-foursome pin keyed by pairing_id). ALL epics gated (party+director+fold+re-review). Step 4 final validation COMPLETE — all 45 FRs mapped (FR31 deferred post-MVP), additive-DB-when-needed, dependency-clean (E3 reordered pin-before-pot, E4 4.3 deferred). WORKFLOW COMPLETE — epics-f1-rules-games.md ready for build (hard gate downstream = golden hand-calc fixtures first, NFR-C1). Presses-OFF RATIFIED. UNCOMMITTED. Open (non-blocking): Epic 5 may be speculative (no real legacy events yet); Epic 6 6.3 cross-group golden spec for Josh. NOTE: doc >100KB → director MCP needs a section extract.'
---

# Tournament F1 "Rules & Games" — Epic Breakdown

## Overview

This document provides the epic and story breakdown for **Tournament F1 — the unified "Rules & Games" configuration model + Guyan real-money settlement engine**, decomposing PRD `prd-f1-rules-games.md` (FR1–FR45 + NFRs) and architecture `architecture-f1-rules-games.md` (decisions D1–D7, 18 patterns) into implementable stories. **Status:** epic structure complete + director-reviewed (2026-06-21); **Epic 1 fully storied**, Epics 2–6 story decomposition in progress.

Brownfield on the shipped Tournament app; **`apps/tournament-api` + `apps/tournament-web` only** (FD-1/FD-2; Wolf Cup is read-only reference). Risk-sequenced per the HANDOFF build order. **Story unit = one modifier/game type = one pure resolver + one golden fixture + one story** (architecture pattern 18). **Hard gate = golden hand-calc fixtures authored BEFORE any settlement code.**

## Requirements Inventory

### Functional Requirements

**A. Rule-Set Authoring & Preset Library**
- FR1: An organizer can create an event's rule set by starting from a preset (never blank-slate).
- FR2: An organizer can enable/disable each modifier (net-birdie point, polie, sandie, greenie) and choose its variant (e.g. sandie = up-and-down for par vs any score; greenie carryover on/off).
- FR3: An organizer can set a game's point value as flat ($/pt) or a segmented schedule (e.g. $5 front / $10 back); segments map to holes explicitly (front 1–9 / back 10–18), defined for 9-hole rounds and the round's play sequence (golden-tested at the boundary, R5).
- FR4: An organizer can set a payout cap and how a capped payout resolves (e.g. "345" — $3/pt, $45 max).
- FR5: An organizer can configure team games at two MVP scopes — the **intra-foursome 2v2** (foursome-internal money) and an **event-level pot/standing** (e.g. best-ball-vs-par winner-take-all, aggregated across teams). Direct **cross-foursome head-to-head money** is FR22/FR25 (Product B).
- FR6: An organizer can name and save a rule set as a reusable preset.
- FR7: The system maintains a selectable preset library (Standard Guyan, Wolf-Cup variant, "345").

**B. Configuration Cascade & Lock**
- FR8: An organizer can set an event-wide default rule set that rounds/foursomes inherit.
- FR9: An organizer can override the rule set / team game at the round level.
- FR10: An organizer can lock/unlock foursome configuration with a single toggle.
- FR11: In a locked event, a foursome plays inherited rules with zero config taps.
- FR12: The system resolves active config for any (event, round, foursome), most-specific-wins, gated by lock state.
- FR13 **(B)**: When unlocked, a joined foursome member can adjust their own foursome's game via preset + named-modifier toggles (recognition-not-recall).
- FR14 **(B)**: A foursome's config locks once its round starts.

**C. Score & Claim Capture (the Guyan inputs)**
- FR15: A scorer can enter each player's gross score per hole.
- FR16: The round's **scorer** records per-player, per-hole **greenie / polie / sandie** claims. Claims are **accepted as entered** — the system does NOT validate eligibility (e.g. greenie-only-on-par-3) in v1; correctness is the group's (trust + audit). Claims inherit scores' single-writer + offline-dedup contract; player self-report deferred (B).
- FR17: All scores and claims attach to the **individual player** (atomic unit), independent of team/foursome — re-teaming recomputes with no re-entry.
- FR18: A scorer can record putts per player per hole (for putting-based games).
- FR19: Score/claim entry works offline and reconciles on reconnect.
- FR39: A scorer can **edit or remove** a previously recorded greenie/polie/sandie claim on a non-finalized round.

**D. Teams**
- FR20: An organizer can form teams from the roster via **manual, random, or high-low handicap-index (A/B)** selection.
- FR21: A team is a late-bound composition of players; changing membership recomputes dependent games/money with no re-entry.
- FR22 **(B)**: A team/matchup can span foursomes (cross-group), not only within one foursome.

**E. Money Settlement Engine**
- FR23: The system computes each foursome's ledger from *its own* players' scores + claims + resolved config (structural foursome-internal isolation).
- FR24: The system settles the Guyan game (low-ball / team-total / net-birdie points / modifiers) into **real money**, per round and per event.
- FR25 **(B)**: The system settles cross-group team games as **player-to-player SettlementEdges** — a distinct path that never reads another foursome's config (preserves FR23 isolation) and feeds the one shared settle-up.
- FR26: Capped games never exceed the cap; a combined ledger and its splits always sum to the identical total (loss-less, no double-pay).
- FR27: Net-scoring games compute net from the event's **locked, slope-aware course handicap**, applied consistently across every game (no per-game handicap divergence).
- FR28: Every participant in a game appears in the settle-up with their net position. (Non-playing **backers** are a betting / "The Action" concept — already shipped — not F1.)
- FR40: The system supports **stateful modifiers** whose outcome carries across holes (e.g. greenie carryover when unclaimed) — golden-tested incl. carryover onto a non-par-3.
- FR42: Every game resolves **ties / pushes / halves deterministically** per its configured rule (hole halved, point split or none, or carryover) — golden-tested.
- FR44: When required data is missing or untrustworthy (no handicap, DNF/pickup, incomplete holes), a game **fails closed** — marked unsettleable and surfaced for organizer resolution — never settled on a guess.

**F. Edit, Recompute & Provenance**
- FR29: A scored round pins **both the config revision AND the team composition** it was computed under — later rule edits or re-teaming (FR21) don't change a past round's money; a new round uses the new config/teams.
- FR30: An organizer can apply a **correction** to a non-finalized round (recomputes the whole round).
- FR31: An organizer can apply a **forward-effective** rule change mid-round (from a given hole). *(DEFERRED to post-MVP — Josh 2026-06-21; see Story 4.3.)*
- FR32: The system refuses money-changing edits to a finalized round (frozen), with an explanation; changing it needs an audited un-finalize.
- FR33: A correction surfaces a diff/notice to affected participants (nothing changes silently).
- FR43: An organizer can **finalize** a round (freezes its money) and **un-finalize** it (audited) to re-enable corrections.
- FR45: Every money-affecting input or edit (score, claim, config change, finalize/un-finalize) is **audit-logged** with actor + timestamp.

**G. Standings, Visibility & Migration**
- FR34: A viewer sees money/P&L mode when locked, scores-only (+ private My Money) when unlocked, with a mode signpost. Money/P&L is **audience-bounded to roster members of the group** (non-roster / cross-group viewers never see dollar figures — FR36).
- FR35: Every foursome can read a plain-language summary of its active rules (intent visibility).
- FR41: A viewer can see a **per-hole money/points breakdown** for a player/foursome (which scores + claims paid what) — intent-visibility + the leaderboard drill-down.
- FR36 **(note)**: Money is never public — group-bounded money vs performance-only stats stay structurally separable.
- FR37: An organizer can adopt the new config model with existing events untouched (additive); a migrated event's money is byte-identical old-vs-new before cutover.
- FR38: The Rules & Games setup flow reminds the organizer to lock handicaps as-of a date (cross-ref H1).

### NonFunctional Requirements

**Correctness & Money Integrity (defining attribute)**
- NFR-C1: Every game type + modifier ships a **golden-file fixture matching hand-calculation**; settlement is byte-identical to the fixture (engine definition-of-done).
- NFR-C2: Money is computed in **integer cents by pure functions** of (scores + claims + config); no floats; identical inputs → identical output.
- NFR-C3: **Property/fuzz invariants** hold for all configs (foursome isolation, loss-less decomposition `sum(splits)==combined`, cap-never-exceeds) — via `fast-check`.
- NFR-C4: **Adversarial fixtures** pass — greenie carryover→non-par-3, cap-on-boundary, all-push hole, plus-handicap, segmented front/back boundary.
- NFR-C5: **Zero money mutations on finalized rounds** (recompute only on non-finalized).
- NFR-C6: Settlement output is **order-independent** — invariant to map/iteration/insertion/sort order (stable sorts); property-tested.
- NFR-C7: **Rounding/remainder is explicit and deterministic** — splits and capped payouts allocate leftover pennies by a fixed rule; the total is always conserved; property-tested.
- NFR-C8: **Time-based decisions use a well-defined clock/timezone** — handicap as-of dates resolve against dated GHIN history (H1); round start / finalize / forward-effective-hole timing unambiguous across timezones.

**Auditability & Traceability**
- NFR-T1: Every settled dollar is **traceable** to the scores + claims + config that produced it; the per-hole breakdown (FR41) reconciles exactly to round + event totals.

**Durability**
- NFR-D1: Money-relevant history is **never overwritten** — pinned config + team revisions (FR29) and append-only pairings persist.
- NFR-D2: Money-affecting writes are **atomic** — a settlement, or a multi-row score/claim/config mutation, commits all-or-nothing (single transaction).
- NFR-D3: Money is **reconstructable from durable inputs** (scores + claims + config + pairings) after a restore (no separate money-state to lose); regular backup cadence.

**Migration Safety**
- NFR-M1: Existing events untouched (additive dual-read); backfilled events pass an **automated, CI-runnable** byte-identical old-vs-new money comparison before cutover; reversible.

**Performance**
- NFR-P1: Score/claim entry echoes input within ~100ms on a mid-tier phone; a hole save commits + advances without blocking the next entry.
- NFR-P2: Leaderboard / money standings render **<2s warm**; recompute-on-score-commit doesn't degrade entry responsiveness.

**Reliability & Offline**
- NFR-R1: Score/claim entry works **fully offline** and reconciles deterministically on reconnect (idempotent via clientEventId).
- NFR-R2: **Correction-recompute correctness is an automated test gate.**
- NFR-R3: **Concurrency is safe** — concurrent scoring across different foursomes is independent; within a foursome, single-writer + idempotent clientEventId dedup; a config edit during scoring resolves via edit-semantics, never a silent overwrite.

**Observability & Error Surfacing**
- NFR-O1: **Fail-closed / unsettleable games (FR44) and recompute failures are surfaced to the organizer** (never silent) and logged with diagnostic context.

**Security & Privacy**
- NFR-S1: Money/P&L is visible only to **authenticated roster members of the group**; non-roster / cross-group never receive dollar figures.
- NFR-S2: Money mutations require an **authenticated session** (Google OAuth or H1 device-binding bridge), are **CSRF-protected**, **role-authorized**, and **audit-logged with the actor**.

**Maintainability & Extensibility**
- NFR-X1: A new modifier/game type = **data + one pure resolver** (registry) — no schema or UI rewrite.
- NFR-X2: **Zero Wolf Cup regressions**; the tournament + engine + wolf-cup suites stay green (CI gate).
- NFR-X3: Net scoring reuses the **single existing slope-aware allocation** (no duplicate handicap math).

**Accessibility & On-Course Usability**
- NFR-A1: On-course UI meets the shipped floor — ≥44–48px tap targets, 16px input (no iOS zoom), AA sunlight contrast, one-handed phone use.
- NFR-A2: **Zero-math invariant** — config is paid once at setup; a locked foursome plays with **0 config taps** on course.
- NFR-A3: In an observed session, a non-technical player reads the active-rules summary (FR35) and correctly states their game without help; claim capture lives inside the score-entry flow (no second screen).

### Additional Requirements (from Architecture)

**Build-discipline / gating (non-negotiable):**
- **No scaffold story.** First build artifact = **golden hand-calc fixtures** (the hard gate) for the four mechanics — Standard Guyan · Wolf Cup variant · Madden's "345" cap ($3/pt, $45 max) · segmented ($5 front / $10 back) — plus adversarial (carryover→non-par-3, cap-on-boundary, all-push, plus-handicap, segment boundary). No settlement code merges without its fixture (CI gate).
- **Zero new dependencies.** Reuse the pinned stack (`fast-check` already present from betting). Optional niceties allowed only if they earn their place.
- **Story unit = one modifier/game type = one pure resolver + one golden fixture + one story** (pattern 18).

**Engine (D1/D2/D5, patterns 1–7,9,10,16):**
- Pure engine at `apps/tournament-api/src/engine/games/` (no db/I/O; deps-in; mirrors `engine/bets/`): `types.ts`, `registry.ts`, `resolver.ts` (cascade deep-merge, most-specific-wins, lock-gated), `compute-foursome.ts`, `ledger-to-edges.ts`, `modifiers/{greenie,polie,sandie,net-birdie}.ts`, `games/{guyan-2v2,team-pot}.ts`.
- Money = **integer cents, no floats, deterministic + order-independent** (stable sorts; no Map-iteration-order).
- **Modifier/game registry:** `register(type, resolver)`; resolvers pure `(holeState, config) → contribution`; stable application order; `config` carries `config_version`; **unknown modifier type OR config_version newer than engine → FAIL-CLOSED** (unsettleable + surfaced, FR44) — never silent-ignore.
- Net scoring imports the existing slope-aware allocation: `getHandicapStrokes` / `allocateNetThroughHole` / `calcCourseHandicap` / `buildTeeByPlayer` — **zero new allocation math** (NFR-X3).

**Settlement spine (D1/D1a, patterns 4,11,14,16):**
- **`SettlementEdge` is the single IR** — `{fromPlayerId, toPlayerId, cents, sourceType, sourceId}` (`from` PAYS `to`); reuse the shipped betting chokepoint. `sourceType` ∈ `{f1_game, betting, legacy_2v2, skins}` is the **producer namespace** so producer-disjointness (D1a) is mechanically checkable.
- **Per-event dual-read routes to EITHER legacy `money.ts` OR the F1 engine — never both** (no double-count). An event is **F1 iff it has an EVENT-LEVEL `game_config` row** with **`cutover_state ∈ {native, active}`** (fresh F1 events default `native`; Story 5.1 adds `cutover_state` so a *backfilled* event can hold the row in `staged` without routing to F1 until Story 5.2 flips it). Reject orphan lower-level config without an event-level row; once F1, ALL rounds use the F1 engine.
- **`services/games-money.ts` is the SINGLE F1 settlement chokepoint** — money/leaderboard/settle-up read F1 money only through it.
- **Presses OFF for F1 events in MVP** (**RATIFIED by Josh 2026-06-21**; presses ride legacy 2v2; re-home in Product B).

**Schema (D2/D3/D4/D6, additive only):**
- `game_config(level: event|round|foursome, ref_id, config_json, seed_rule_set_revision_id?, lock_state?, …ecosystem)` — one polymorphic table; unique `(tenant, level, ref_id)`; `config_json` Zod-validated; `config_version`. Ref-by-level validated **in code** (polymorphic ref_id, no per-level FK).
- `hole_claims(round_id, player_id, hole_number, claim_type, scorer_player_id, client_event_id, …ecosystem)` — sibling to `hole_scores`; upsert by (round,player,hole,claim_type); delete to remove (FR39); idempotency UNIQUE `(round,player,hole,claim_type,client_event_id)`; LWW tiebreak = server-assigned monotonic seq.
- `teams` + `team_members` — persistent/global event-level store (D3b); intra-foursome 2v2 stays derived from pairing slots (D3a).
- `round-pins` — pins the **fully-RESOLVED config snapshot** (merged cascade, NOT just seed rev) + seed-rev FK + pairings (append-only) + global-team snapshot + **effective-HI snapshot (per-player HI + computed CH; locked-as-of-date HI if locked, else most-recent GHIN) + course-rev/tee** (the full deterministic net inputs). Pin **atomically + idempotently** at the round lifecycle transition to `in_progress`; only a *correction* re-pins.
- Drizzle additive migrations only (`ADD COLUMN`/`CREATE TABLE`, statement-breakpoints, **no CHECK-driven rebuilds** — T13-4 gotcha); `ecosystemColumns()` (tenant_id 'guyan' + context_id).

**Recompute & provenance (D4/D5, patterns 5,9,13):**
- **Recompute-on-read** over pinned inputs — never store derived money; computed each read from pinned snapshots within one consistent read snapshot. **Finalized-frozen = input immutability** (pinned config-rev + frozen scores/claims).
- Edit semantics (ADR-F1-2): **correction** re-pins + recomputes (non-finalized only); **finalized** rejects edits (NFR-C5). *(**forward-effective** — applying from `effective_from_hole` — is DEFERRED to post-MVP; see Story 4.3.)*
- **Recompute trigger fans out on CLAIM changes too**, not just scores (a sandie tap must recompute), extending the post-score-commit path.

**Writes / audit / activity (patterns 8,12, NFR-D2/S2):**
- Claim/score writes = one tx with `writeAudit` + `emitActivity`. New **distinct `game.*` activity types** in `activity-events.ts` (Zod union) + `GAME_*` audit types — never reuse a taken name.
- Claim capture writes through the **score-entry mutation + offline queue** (a `claim` kind beside `hole_score`) — never a separate screen (pattern 15).

**Migration harness (NFR-M1):**
- A **byte-identical old-vs-new money comparison harness** (`services/migration-compare.ts`) — a CI-runnable script/test, distinct from the unit goldens.

**Test homes (pattern 17, checkable gates):**
- `engine/games/*.property.test.ts` (`fast-check`: isolation, loss-less, cap, order-independence) + a **producer-disjointness** integration test (D1a matrix).
- Provenance regression tests: (a) edit rule set after a round is scored → that round unchanged; (b) correction on non-finalized re-pins + recomputes; (c) finalized edit rejected.

**Build-time verifications (not blockers):** confirm `@libsql/client` + Drizzle single-transaction atomicity for multi-row money writes (NFR-D2); confirm drizzle-kit additive dual-read migration shape.

### FR Coverage Map

> All 45 FRs mapped. Product B (Growth, deferred within F1) FRs = FR13, FR14, FR22, FR25, FR16(self-report). FR36 = note-only (forward-compat, honored as a structural boundary, no standalone build). **Director-review correction (2026-06-21):** FR10 (lock/unlock toggle) and FR34 (leaderboard mode) are PRD-untagged = **Product A → Epic 1**; only the *foursome self-serve edit* unlock enables (FR13/FR14) is Product B.

- FR1→E1 · FR2→E2 · FR3→E1(point value: flat or front/back; segment-boundary golden, R5) · FR4→E2 · FR5→E1(2v2)+E3(event pot) · FR6→E2 · FR7→E2 · FR8→E1 · FR9→E3 · FR10→E1(organizer lock/unlock toggle)
- FR11→E1 · FR12→E1 · FR13→E6 · FR14→E6 · FR15→E1 · FR16→E2(scorer claim capture, ships with the modifiers that consume it)+E6(self-report) · FR17→E1 · FR18→**existing putts capture (reuse, no new F1 work)** · FR19→E1(scores)+E2(claims) · FR20→E3
- FR21→E3 · FR22→E6 · FR23→E1 · FR24→E1(base game)+E2(modifiers) · FR25→E6 · FR26→E1(loss-less)+E2(cap-never-exceeds) · FR27→E1 · FR28→E1 · FR29→E1(pairings+config-rev+effective-HI[per-player HI+CH]+course-rev pin)+E3(global-team snapshot pin) · FR30→E4 · FR39→E2(edit/remove claim)
- FR31→**post-MVP (deferred — Story 4.3)** · FR32→E4 · FR33→E4 · FR34→E1(both modes: money when locked, scores-only+private My Money when unlocked, with signpost) · FR35→E4 · FR36→E1(visibility gate, note) · FR37→E5 · FR38→E4(reminder/link to shipped H1) · FR40→E2
- FR41→E4 · FR42→E1 · FR43→E4 · FR44→E1 · FR45→E1

## Epic List

> **Priority:** Product A = Epics 1→2→3→4→5 (risk-sequenced; Epic 5 is lowest/last — new groups use fresh events, so backfill is deferrable). Epic 6 = Product B (Growth, deferred within F1). Each epic is standalone and **enables — but does not require —** later epics.
>
> **Hard gate (all epics with settlement code):** golden hand-calc fixtures authored + hand-approved BEFORE any settlement code merges (NFR-C1, CI-enforced). **Story unit = one modifier/game type = one pure resolver + one golden fixture + one story** (pattern 18).
>
> **Confirmed product decision (ratified by Josh 2026-06-21):** **presses are OFF for F1 events in MVP** (re-home in Product B). The dual-read switch routes an F1 event entirely through the F1 engine; legacy `money.ts` 2v2 + presses are OFF for that event (D1a producer-disjointness).

### Epic 1: The Rule-Set Spine — seed a game, settle it end-to-end *(walking skeleton + foundation)*
Kills the dead "No rule set seeded" card. An organizer seeds **Standard Guyan** on an event; the cascade resolves it (event-default, locked → zero-tap inherit); recorded gross scores settle the **base 2v2 low-ball + net-birdie point** (score-derived — no claims needed yet); the pure engine computes the foursome ledger, lowers it to `SettlementEdge`s, routes through the dual-read switch + the single `services/games-money.ts` chokepoint into the **existing pairwise settle-up**, shown in locked money mode. **Carries the whole foundation:** golden hand-calc fixtures (hard gate), engine skeleton (types/registry/resolver/computeFoursome/ledger-to-edges), `game_config` schema + provenance-pin storage, provenance pinning (resolved-config snapshot + pairings + locked-HI + course-rev — **not** the global-team snapshot, which arrives in E3), recompute-on-read, integer-cents purity, the `fast-check` property tests for **isolation / loss-less / order-independence**, the producer-disjointness test, audit/activity (`game.*`). **This alone crosses the demo→usable threshold for the Standard Guyan game.** *(Claim-based modifiers + inline claim capture ship in Epic 2, beside the resolvers that consume them; the `hole_claims` table is created there.)*
**FRs covered:** FR1, FR3(point value: flat or front/back), FR5(2v2 scope), FR8, FR10(lock/unlock toggle), FR11, FR12, FR15, FR17, FR18(no-regression — existing putts capture stays alive under dual-read), FR19(scores), FR23, FR24(base game), FR26(loss-less), FR27, FR28, FR29(pairings+config-rev+per-player HI+CH+course-rev pin), FR34(both leaderboard modes + signpost), FR36(visibility gate), FR42, FR44, FR45. **NFRs:** C1, C2, C3(isolation/loss-less/order-independence), C4(segment-boundary golden, R5), C5, C6, C7, C8, D1, D2, D3, O1, R1, R3, S1, S2, T1, X1, X2, X3, A1, A2. **Handicap rule:** net uses the effective handicap pinned at round-start — the locked-as-of-date HI if the organizer locked (optional), else the **most-recent GHIN handicap** (default); fail-closed only when a player has **no** handicap at all.

### Epic 2: The Full Game Vocabulary — modifiers, variants, templates & caps
Completes the **four-mechanic golden coverage** (engine definition-of-done). Lands the **inline greenie/polie/sandie claim capture** on the score-entry path (the `hole_claims` table is created here, beside its first consumers) + edit/remove; each claim-based modifier as its own resolver+fixture+story (**greenie w/ stateful carryover, polie, sandie**); the **birdie** modifier generalized to variants **`{net | gross(natural)} × {single | double bonus}`** (E1 shipped net-birdie/single; E2 adds gross/natural + double-bonus — data + one resolver, NFR-X1); the remaining **variants** (sandie par-vs-any-score; greenie carryover on/off); and the **payout cap** ("345" = $3/pt, $45 max) with the **cap-never-exceeds property test**. *(The flat-or-front/back point schedule ships in Epic 1; Epic 2 adds the modifier variants + the cap.)*
**Wolf-Cup variant = exact shipped ruleset, used as a CROSS-VALIDATION golden (Josh, 2026-06-21):** the Wolf-Cup preset flips the levers to the real Wolf Cup game — **double birdie bonus ON, birdie = natural/gross, greenie carryover OFF, sandie = up-and-down for ANY score**, etc. The golden is not just hand-calc: the F1 engine configured with the Wolf-Cup template, fed the same scores as a real Wolf Cup round, must **reproduce the money the shipped Wolf Cup app produces** (`apps/api` money rules are READ-ONLY reference — FD-1/FD-2; we cross-check output, we do not import code). This is the strongest proof of the "same engine, different variant data" thesis.
**Rules Page — template picker with live pills (Josh, 2026-06-21):** the setup page (scaffolded in E1 Story 1.3) gains a **template selector** — pick a built-in template (Standard Guyan / Wolf-Cup / "345") **or a saved custom one** — and on selection the **modifier/variant pills below update live** to that template's settings, so the organizer **visually verifies the basic rules setup** before play (recognition-not-recall; intent-visibility made interactive). The organizer can **create and save their own template** (FR6 save-preset → FR7 library).
Once variants + cap + templates exist, the preset library holds all three built-ins + custom saves. **The byte-identical old-vs-new money comparison harness lands here** (new-vs-legacy insurance as the goldens mature — the *backfill action* is Epic 5).
**FRs covered:** FR2, FR4, FR6, FR7, FR16(scorer claim capture), FR19(claims offline), FR24(modifiers), FR26(cap-never-exceeds), FR39(edit/remove claim), FR40. **NFRs:** C1, C3(cap), C4(adversarial fixtures), C7, R1, X1, M1(harness), A2/A3(template pills = recognition-not-recall, intent visibility).

### Epic 3: Teams & the Event Pot
Organizer forms teams from the roster (**manual / random / high-low handicap-index A/B**); a team is a late-bound composition that recomputes dependent games/money with no re-entry; the **event-level pot/standing** (best-ball-vs-par) settles on the F1 spine; round-level override lets the daily team game change. **Adds the global-team-composition snapshot to the round pin** (completing FR29 for global teams; D3b/D4).
**FRs covered:** FR5(event-pot scope), FR9, FR20, FR21, FR29(global-team snapshot pin). **NFRs:** C1, C3, D1, X1.

### Epic 4: Correct, Finalize & Trust the Money
The recompute-safety + transparency layer (Journeys 4 & 5). Mid-round **correction** (recompute, non-finalized), **finalize / audited un-finalize**, **finalized-frozen refusal** with explanation, **diff notice** on correction, the **per-hole money breakdown** drill-down, the **plain-language active-rules summary** (the "Mark test" intent-visibility line), and the **handicap-lock setup reminder** (a link to the shipped H1 lock page — no new handicap logic). **Forward-effective (FR31) is DEFERRED to post-MVP** (Josh 2026-06-21 — no real use case with a locked-in game; front/back point value is setup-time, Nassau is betting; correction covers error-fixing). See Story 4.3.
**FRs covered:** FR30, FR32, FR33, FR35, FR38, FR41, FR43 (**FR31 deferred → post-MVP**). **NFRs:** C5, R2, T1, O1, S2, A3.

### Epic 5: Migration & Cutover *(highest data-risk; last in Product A)*
Backfills a live event onto the F1 config model, gated by the comparison harness built in Epic 2 — a backfilled event's money must be byte-identical old-vs-new before cutover; reversible. Sequenced last because correctness is proven on new data first and new groups use fresh events.
**FRs covered:** FR37. **NFRs:** M1(cutover), D1, X2.

### Epic 6: Per-Foursome Self-Serve & Cross-Group *(Product B — Growth, deferred within F1)*
What an *unlocked* event enables: the player-facing **"Adjust Guyan Game Rules"** recognition-not-recall UI (H1-identity-gated), writing **foursome-level `game_config` rows** (the single polymorphic table, D2) that **lock once their round starts** (FR14), **cross-group team games via SettlementEdges** (preserving foursome isolation), and player **self-reported claims**. *(The lock/unlock toggle itself and both leaderboard modes ship in Epic 1 — Product A; Epic 6 builds the behavior unlock turns on.)*
**FRs covered:** FR13, FR14, FR16(self-report), FR22, FR25. **NFRs:** S1, S2, X1.

### Growth (post-MVP, not scoped here)
Container-agnostic **Season** (the Sunday group) on the same config tables · new modifier/game types via the registry (add = data + one resolver) · F1b player-driven 1v1 bets surfacing · public/private profiles (money-never-public) · cross-event stats · rule-set sharing across groups.

---

# Epics & Stories

## Epic 1: The Rule-Set Spine — seed a game, settle it end-to-end

Kills the dead "No rule set seeded" card and proves the entire F1 money spine end-to-end on the **base 2v2 Guyan game** (low-ball + net-birdie point — both score-derived, no claims yet). It carries the foundation every later epic inherits: the golden hand-calc fixtures (hard gate), the pure recompute-on-read engine + cascade resolver + modifier/game registry, the `SettlementEdge` IR lowering, the `game_config` schema + provenance-pin storage, the dual-read switch, the single `services/games-money.ts` settlement chokepoint, and the `fast-check` property tests for isolation / loss-less / order-independence. Stories are dependency-ordered; each builds only on its predecessors. **Pure engine first (1.1), schema (1.2), seed UI (1.3), then the live settlement wiring (1.4).**

### Story 1.1: Walking skeleton — golden fixtures + pure engine for the base Guyan 2v2 game

As the F1 platform (foundation),
I want hand-approved golden fixtures and a pure settlement engine for the base 2v2 Guyan game (low-ball + net-birdie point) that matches them,
So that all later F1 money is built on a hand-proven, deterministic core with zero live-data risk.

**Acceptance Criteria:**

**Given** no settlement code exists yet
**When** Story 1.1 begins
**Then** the first build artifact is a hand-authored, hand-approved golden fixture set (`apps/tournament-api/src/engine/games/__fixtures__/*.json`) for the base 2v2 game, supplying as GIVEN inputs per hole: **par**, each player's **net** (hand-calc, independent of the allocation wired in 1.4), and the **intra-foursome team split** (which two players are a team)
**And** the fixture **pins the base-game counting rule explicitly** — Guyan 2v2 plays **off the low** (team low-net per hole), the hole-win **point**, the **net-birdie bonus point**, and the **tie/push rule** (a halved hole = no point, no carry, per FR42) — named, not implied
**And** the fixture asserts not just a money total but the **exact `SettlementEdge[]`** (`{fromPlayerId, toPlayerId, cents}`) — so a `ledger-to-edges` rounding error or a wrong payee can't pass (it's the cash, not the total, that's hand-approved)
**And** the fixture set covers **both point-value shapes** — a single value all round AND a **front/back segmented** schedule ($5 front / $10 back) — including a **segment→hole boundary** case; segments map by **course hole number** (front 1–9 / back 10–18), and the **9-hole-round** case is covered (FR3, R5)
**And** no settlement engine code is written or committed before that fixture set is approved (NFR-C1 hard gate, CI-enforced)
**And** all work is confined to `apps/tournament-api` (Tournament paths only; FD-1/FD-2)

**Given** the pure-engine constraint (pattern 1)
**When** the engine modules are built
**Then** `engine/games/` contains `types.ts` (the game shape `{scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[]}` where **`pointValue-schedule` expresses flat OR front/back segmented**; `modifier {type, enabled, variant}`; `holeState` **carrying par + per-player net + the team split**; `ledger`; `contribution`), `registry.ts` (`register(type, resolver)`, stable application order), `resolver.ts` (cascade deep-merge, most-specific-wins, lock-gated), `compute-foursome.ts`, `ledger-to-edges.ts`, `modifiers/net-birdie.ts`, and `games/guyan-2v2.ts`
**And** none of them import db, `Date`, or random (deps-in; callers pass scores/net/par/team-split/config)

**Given** per-player **net** (already allocated), par, and the team split as inputs to a resolved config
**When** `computeFoursome(itsOwnConfig, itsOwnInputs)` runs
**Then** it returns a foursome ledger settling 2v2 **team-low-net** + net-birdie in **integer cents** (NFR-C2), applying the point value **per hole** (flat or front/back per the schedule), reading structurally only its own foursome's config + inputs (FR23 isolation by signature)
**And** the engine consumes **net** as a given — it does **not** take gross scores or compute allocation (gross→net is the service layer in 1.4); this keeps the engine pure and the goldens allocation-independent
**And** net-birdie is detected from **net vs par** (par is required — hence it is in `holeState`)
**And** the **team split is an explicit engine input** (slots 1&2 vs 3&4); the engine never reads `pairings` — 1.4 feeds the split from the shipped `resolveFoursomeTeams` (`services/foursome-teams.ts`)
**And** output is **order-independent** — invariant to map/iteration/insertion order, via stable sorts, no `Map`-iteration-order dependence (NFR-C6)
**And** ties / pushes / halves resolve deterministically per the configured rule (FR42)
**And** remainder pennies on any split allocate by a **fixed, named, total-conserving rule — lowest-`playerId`-first** (NFR-C7); this is the single rule every later split path (including the Story 2.6 cap collapse) references, so the paths cannot diverge
**And** the **segment→hole boundary** is golden-tested (front/back point value applies to the right holes; R5)

**Given** a computed foursome ledger
**When** it is lowered to edges
**Then** `ledger-to-edges.ts` emits `SettlementEdge {fromPlayerId, toPlayerId, cents, sourceType: 'f1_game', sourceId}` (`from` PAYS `to`), and the edge sum reconciles loss-lessly to the ledger total (NFR-C3)

**Given** the cascade resolver
**When** it resolves config for an (event, round, foursome)
**Then** it deep-merges most-specific-wins (Foursome→Round→Event), gated by `lock_state`, and is golden-tested **including the lock gate** (R6)
**And** the resolver is **level-parameterized from day one** (consumes config rows keyed by `level` ∈ event|round|foursome) so that adding **foursome-level** rows in Epic 6 composes with no engine change (in E1 only event/round levels are populated)
**And** an unknown modifier `type`, or a `config_version` newer than the engine supports, **fails closed** (returns unsettleable + surfaced) — never silent-ignored (pattern 6, FR44)

**Given** the money-correctness invariants
**When** the property suite runs
**Then** `engine/games/*.property.test.ts` (`fast-check`) proves, for arbitrary configs: **foursome isolation** (changing foursome B's config never moves foursome A's ledger), **loss-less decomposition** (`sum(splits) == combined`), and **order-independence** (NFR-C3/C6)
**And** **cap-never-exceeds** is explicitly deferred to Epic 2 (the cap mechanic does not exist yet)

**Given** the four-mechanic golden goal
**When** 1.1 closes
**Then** the **Standard Guyan base** fixture is green; the Wolf-Cup-variant / "345"-cap / segmented fixtures are authored in Epic 2 with their mechanics

> **Sizing note (deliberate, per the betting precedent):** 1.1 is the walking-skeleton foundation — large, but **pure** (no db, no routes, no UI). If it stalls mid-build, the recorded fallback split is **1.1a** (golden fixtures + `types`/`registry`/`resolver` + the isolation/loss-less/order-independence property tests) and **1.1b** (`computeFoursome` + `net-birdie` + `guyan-2v2` + `ledger-to-edges`, goldens green). Prefer whole; split only if blocked.

### Story 1.2: Additive schema — `game_config` + provenance-pin storage

As an organizer (platform),
I want the additive config + provenance tables,
So that an event can carry a rule set and a scored round can pin exactly the inputs it was computed under.

**Acceptance Criteria:**

**Given** additive-only migration discipline (T13-4 gotcha)
**When** the config table is added
**Then** `game_config(level: event|round|foursome, ref_id, config_json, seed_rule_set_revision_id?, lock_state?, config_version, …ecosystemColumns)` is created with **UNIQUE (tenant, level, ref_id)**; `config_json` is **Zod-validated on write** against the game shape; ref-by-level is validated **in code** (polymorphic `ref_id`, no per-level FK) (D2)
**And** the migration is `CREATE TABLE` only (no CHECK-driven table rebuild), with `--> statement-breakpoint` between statements, generated via drizzle-kit and renumbered

**Given** recompute-on-read needs frozen inputs (D4/D5)
**When** the provenance-pin storage is added
**Then** a round-pin store records, for a scored round, the **fully-RESOLVED config snapshot** (the merged Event→Round→Foursome result) + the `seed_rule_set_revision_id` FK + the **effective-handicap snapshot** + the `course_revision_id` / tee
**And** the **effective-handicap snapshot is whatever HI was in effect at round-start** — the **locked-as-of-date HI** if the organizer locked handicaps (optional, the shipped H1 path), **else the most-recent GHIN handicap** (the default); either way it is **pinned at round-start** so recompute is deterministic without requiring an explicit lock
**And** the pin stores, **per player on that round, BOTH the Handicap Index (HI) AND the computed Course Handicap (CH)** used that day — so opening the round later shows the exact HI + CH each player played off (durable provenance, NFR-T1); recompute reads the pinned CH, never re-derives it from a live HI
**And** `pairings` remain append-only (existing — no change)
**And** a **global-team-composition snapshot seam** exists in the pin store but is left unpopulated (no global teams until Epic 3)

**Given** the "create tables only when needed" principle
**When** this story's schema is created
**Then** ONLY `game_config` + the round-pin store are created; `hole_claims` (Epic 2) and `teams`/`team_members` (Epic 3) are **not** created here

**Given** rules-as-data extensibility
**When** `config_json` is read or written
**Then** a Zod schema validates the game shape + modifier list + `config_version`; an unknown or too-new `config_version` is rejected at write and fails closed at read (NFR-X1, FR44)
**And** in Epic 1 the schema constrains `modifiers` to **empty (`[]`)** — claim-based modifier types arrive in Epic 2; an unknown modifier type is rejected at write (so an unsupported config can never silently compute)

**Given** the round-start pin is money-load-bearing (NFR-D2/R3)
**When** the pin is created at the lifecycle transition to `in_progress`
**Then** the resolved-config snapshot + per-player effective HI + CH + course-rev are written in **one transaction under a unique `round_id` pin** — **atomic and idempotent**, so a PWA retry or a second device cannot split-brain or partially backfill the snapshot

**Given** the additive guarantee
**When** the migration runs against the existing prod schema shape
**Then** existing tables (`rounds`, `hole_scores`, `pairings`, `event_handicaps`, `sub_games`, …) are untouched; table + Zod round-trip + unique-constraint tests pass; the tournament + wolf-cup suites stay green (NFR-X2)

### Story 1.3: Admin seed "Standard Guyan" + event-wide default (kills the dead card)

As an organizer,
I want to seed the Standard Guyan rule set as my event's default from a preset,
So that the dead "No rule set seeded" card becomes a working setup and every foursome inherits the game with zero further taps.

**Acceptance Criteria:**

**Given** the dead "No rule set seeded yet" card on the event admin page
**When** the organizer opens event admin after this story
**Then** the dead card is replaced by a working **"Set up Rules & Games"** entry (the headline success signal — the dead card is gone)

**Given** preset-first authoring (never blank-slate)
**When** the organizer seeds the rule set
**Then** they start from the **Standard Guyan** preset (FR1), and the seed writes an **EVENT-LEVEL `game_config` row** with `lock_state` defaulting to **locked**, referencing the seed `rule_set_revision_id`
**And** the write commits the row + an audit row + a `game.config_seeded`-style activity row in **one transaction** (NFR-S2/D2), with the new `game.*` activity type registered in the existing Zod discriminated union (else `emitActivity` rejects it — pattern 12)

**Given** an event with a seeded event-wide default and no round/foursome override
**When** the cascade resolver is asked for any (round, foursome)'s config
**Then** it returns the event default (FR8); a **locked** event yields a foursome's config with **0 config taps** (FR11 zero-tap inherit); resolution is most-specific-wins (FR12)

**Given** the dual-read routing contract (pattern 14)
**When** an event has an event-level `game_config` row
**Then** it is classified an **F1 event** (the routing check — a fresh event's row defaults `cutover_state = native` = active; Story 5.1 extends this to `row-exists AND cutover_state ∈ {native, active}` so a backfilled event can stage the row without routing)
**And** an orphan round/foursome `game_config` row **without** an event-level row is rejected

**Given** organizer-only authority
**When** the game-config endpoints are called
**Then** they require `requireSession` + `requireOrganizer` + the event-scoped `isEventOrganizerByEventId` gate; endpoints are `GET`/`PUT /api/admin/events/:eventId/game-config` and `GET …/events/:eventId/resolved-config` (mirroring the `admin-context` route shape)

**Given** the Guyan point value (FR3)
**When** the organizer sets it during setup
**Then** they can choose **a single value per point for the whole round** (e.g. $5) **or a front/back split** (e.g. $5 front / $10 back); the choice writes into the event-level `game_config` `pointValue-schedule` and the engine applies it per hole (the schedule the 1.1 fixtures already cover)
**And** presses remain **OFF** for F1 events (confirmed; front/back-or-single is the norm)

**Given** the lock/unlock toggle (FR10 — Product A per the PRD)
**When** the organizer flips it
**Then** a **single toggle** sets the event-level `game_config.lock_state` between `locked` (default) and `unlocked`, audited in one tx
**And** in Product A, `unlocked` changes only the **leaderboard mode** (FR34, Story 1.4) — the *foursome self-serve edit* that unlock will eventually enable is Epic 6 (FR13/FR14); the toggle ships now so the state + leaderboard behavior exist from Epic 1

**Given** the on-course / admin UI floor
**When** the setup page renders
**Then** `admin.events.$eventId.game-config.tsx` is preset-first, exposes the point-value control (single or front/back), is built from the shipped Button/Card/FormField primitives with dark-mode tokens and ≥44–48px targets (NFR-A1), and `admin.events.$eventId.index.tsx` replaces the dead card with the link

> **Scope note:** the **point value (flat or front/back) IS editable here** (FR3). What waits for Epic 2 is the **modifier set + their variants** (greenie/polie/sandie) and the **payout cap**; the Wolf-Cup / "345" presets appear once those exist. The `lock_state` defaults **locked**; the *functional* unlock toggle is Epic 6 (Product B). Locking handicaps as-of a date is **optional** (the shipped H1 page) — when not locked, net defaults to the most-recent GHIN handicap (pinned at round-start). The setup-flow *reminder* to lock is Epic 4 (FR38).

### Story 1.4: Settle the F1 event into the pairwise settle-up (dual-read + chokepoint + money mode)

As a roster member,
I want my foursome's Guyan game to settle from recorded scores into the existing settle-up,
So that the group can run real money on a configured game end-to-end, on math proven by hand.

**Acceptance Criteria:**

**Given** an F1 event with a seeded config and recorded scores
**When** money is computed
**Then** `services/games-money.ts` — the **single F1 settlement chokepoint** (pattern 16) — reads the **pinned** resolved-config snapshot + scores + the **pinned effective-HI + CH snapshot** + course-rev, calls the pure engine, and returns namespaced `SettlementEdge`s; money / leaderboard / settle-up read F1 money **only** through it (never inline)

**Given** net scoring split across pin-time and read-time (the director-review money-safety fix)
**When** the round is pinned at round-start
**Then** each player's **Course Handicap (CH)** is computed **once** from the effective HI via `calcCourseHandicap` + `buildTeeByPlayer` and **pinned** (Story 1.2); the **effective HI** = the locked-as-of-date HI if locked (optional), else the most-recent GHIN (default)
**And** at **read / recompute** time, `games-money.ts` derives per-hole net from the **pinned CH** via `getHandicapStrokes` / `allocateNetThroughHole` — it does **NOT** call `calcCourseHandicap` / `buildTeeByPlayer` on read, so a later course rating/slope edit can never silently move a pinned round's money; **zero new allocation math** (FR27, NFR-X3)
**And** the **intra-foursome team split** fed to the engine comes from the shipped `resolveFoursomeTeams` (`services/foursome-teams.ts`, slots 1&2 vs 3&4) — not re-derived
**And** a **net-reconciliation test** proves the net `games-money.ts` feeds the engine matches the leaderboard's net for the same player/segment (validates the settlement *input*, independent of the goldens which take net as given)

**Given** the dual-read switch (D1a producer-disjointness)
**When** an event is F1
**Then** **all** its rounds route through the F1 engine (inherit when no override); legacy `money.ts` 2v2 + **presses are OFF** for that event (confirmed product decision)
**And** a **producer-disjointness integration test** proves no `(debtor, creditor, reason)` edge is emitted by two producers (the D1a matrix)

**Given** recompute-on-read (D5)
**When** a score is committed
**Then** the write **only persists the input** — there is **no stored money to recompute**; money is **derived on every read** through the chokepoint, so a finalized round derives the same number because its pinned inputs are immutable (explicit finalize is Epic 4)
**And** a derived-money cache (with commit-time invalidation) is added **only if** NFR-P2 (<2s warm) demands it — not in MVP

**Given** settled edges
**When** the pairwise settle-up renders
**Then** F1 edges net into the existing `money-detail.ts` pairwise ledger and the `settle-up` / `my-money` / `money` views (no parallel money surface), netted per stakeholder pair; every participant appears with their net position (FR28)
**And** a `fast-check` property test proves the ledger invariant — zero-sum pairs net to zero (NFR-C3) — and the settled output matches the approved goldens (NFR-C1 release gate)
**And** the existing viewer money pages render the F1-sourced edges (verified by test, not assumed)

**Given** missing or untrustworthy inputs
**When** a required input is genuinely absent — a player has **no handicap at all** (no HI/GHIN), or DNF / pickup / incomplete holes
**Then** the game **fails closed** — marked unsettleable and surfaced to the organizer (FR44, NFR-O1) — never settled on a guess
**And** an **unlocked** handicap is **not** a fail-closed case — net simply uses the most-recent GHIN handicap (the default)
**And** a **minimal non-crashing surface** renders in settle-up — "Calculation paused — unsettleable: [reason, e.g. missing handicap for {player}]" — so the money view never crashes or silently empty-renders before the richer Epic 4 transparency UI ships

**Given** the leaderboard mode (FR34 — both halves, Product A)
**When** the leaderboard renders
**Then** a **locked** event shows **money / P&L mode**; an **unlocked** event shows **scores-only + private My Money**, each with a visible **mode signpost** so the viewer knows which mode they're in
**And** audience-bounded money visibility holds in either mode (NFR-S1): a non-roster / cross-group viewer never receives dollar figures (FR36 boundary)
**And** FR18 **no-regression**: enabling F1 (the dual-read switch) does **not** disable the existing per-hole putts capture for F1 rounds (verified by test)

**Given** provenance pinning (patterns 9 & 13)
**When** a round transitions to `in_progress`
**Then** it pins the resolved-config snapshot + pairings + the effective-HI snapshot (**per-player HI + CH**) + course-rev; recompute reads **only** these pinned snapshots, never live `game_config` rows or a live HI (FR29)
**And** every money-affecting input or edit is audit-logged with actor + timestamp (FR45)

**Given** the durable per-round handicap (Josh's requirement)
**When** a viewer opens a past round
**Then** the round shows **each player's HI and CH from that day** (read from the pin), so the handicaps the money was computed off are always visible after the fact (NFR-T1; the full per-hole money breakdown is Epic 4 / FR41)

> **Sizing note:** 1.4 is the integration story and is heavy. If it stalls, the recorded fallback split is **1.4a** (the `games-money.ts` chokepoint + net reuse + `resolveFoursomeTeams` feed + net-reconciliation + pin + money mode + settle-up integration — the happy path) and **1.4b** (the hardening: dual-read/presses-OFF + producer-disjointness test + fail-closed + audience-bounded visibility). Prefer whole; split only if blocked.

---

## Epic 2: The Full Game Vocabulary — modifiers, variants, templates & caps

Completes the **four-mechanic golden coverage** (engine definition-of-done) on the Epic 1 spine. Lands the **inline greenie/polie/sandie claim capture** on the score-entry path (the `hole_claims` table is created here, beside its first consumers) + edit/remove; each claim-based modifier as **its own resolver + golden fixture + story** (pattern 18); the **birdie** modifier generalized to variants; the **payout cap** ("345") with its cap-never-exceeds property test; the **template picker with live pills** + save-your-own preset; and the **Wolf-Cup cross-validation golden + comparison harness**. Every story builds only on Epic 1 (the engine/registry/`game_config`/pin/chokepoint exist) and its own predecessors. **Each modifier story is gated by its golden** — no resolver merges without a hand-approved fixture (NFR-C1).

> **Registry discipline (all stories in this epic):** every new modifier registers via `register(type, resolver)` with a pure `(holeState, config) → contribution` signature, a stable application order, and a `config_version` bump where the shape changes; an unknown type or too-new `config_version` **fails closed** (FR44, pattern 6). Adding a modifier is **data + one resolver** — no schema or UI rewrite (NFR-X1). Claims feed the resolvers as **given inputs** (the engine stays pure; `compute-foursome` reads claims from `holeState`, never the db).

### Story 2.1: Inline claim capture — `hole_claims` table + scorer greenie/polie/sandie entry (offline, edit/remove)

As a scorer,
I want to record (and later edit or remove) each player's greenie/polie/sandie claims inside the score-entry flow,
So that the Guyan modifiers have their inputs without a second screen, and a mistaken claim can be corrected before finalize.

**Acceptance Criteria:**

**Given** additive-only migration discipline (T13-4 gotcha) and the "create tables only when needed" principle
**When** the claims table is added
**Then** `hole_claims(round_id, player_id, hole_number, claim_type, scorer_player_id, client_event_id, …ecosystemColumns)` is created as a **sibling to `hole_scores`**, `CREATE TABLE` only (no CHECK-driven rebuild), with `--> statement-breakpoint`, generated via drizzle-kit and renumbered
**And** `claim_type` is a Zod-validated enum (`greenie | polie | sandie`); the table carries **TWO uniques, mirroring the shipped `hole_scores`** — a **cell-level UNIQUE `(round_id, player_id, hole_number, claim_type)`** (the claim's identity) **and** a **dedupe UNIQUE `(round_id, player_id, hole_number, claim_type, client_event_id)`**. The write is an **`INSERT … ON CONFLICT`** mirroring the shipped `hole_scores` two-unique behavior: an **identical `client_event_id`** retry hits the dedupe unique and **de-dupes (no-op)**; the scorer **editing their own claim in place** updates the cell row; a **different `client_event_id` colliding on the cell unique** (a second writer for the same claim) **ABORTs → 409** — single-writer enforced at the db, never a silent double-insert
**And** claims are **single-writer** (the foursome's designated scorer — the same contract `hole_scores` enforces), so there is **no multi-device last-write-wins to resolve**: the cell unique + `client_event_id` idempotency are sufficient and the earlier **monotonic-seq / LWW idea is dropped** (it was incompatible with delete-to-remove — a stale late write could resurrect a deleted claim). Player self-report (a second writer) is Epic 6 and carries its own concurrency rule there
**And** existing tables (`rounds`, `hole_scores`, `pairings`, …) are untouched; the tournament + wolf-cup suites stay green (NFR-X2)

**Given** claim capture must live inside the score-entry flow, never a separate screen (pattern 15, NFR-A3)
**When** the scorer records a claim for a player on a hole
**Then** it writes through the **same score-entry mutation + offline queue** as `hole_score`, as a new **`claim` `MutationKind`** — which requires the explicit, named edits to the **closed** queue contract: add `claim` to the `MutationKind` union **and** the runtime `VALID_KINDS_INTERNAL` set in `apps/tournament-web/src/lib/offline-queue.ts` (the two-place change behind `isValidKind()`), wire its `url`+`body` dispatch + terminal-error registration, and add the **server route/handler** it posts to (a new `routes/claims.ts` reusing the scorer single-writer gate — **not** a silent piggyback on `routes/scores.ts`) — committed in one tx with `writeAudit` + `emitActivity`, using a new distinct `game.claim_recorded`-style activity type registered in the existing Zod discriminated union (else `emitActivity` rejects it — pattern 12) and a `GAME_*` audit type (never a reused name)
**And** the claim is **accepted as entered** — the system does **not** validate eligibility (e.g. greenie-only-on-par-3) in v1; correctness is the group's (trust + audit) (FR16)
**And** entry works **fully offline** and reconciles deterministically on reconnect, idempotent via `client_event_id` (FR19, NFR-R1) — a PWA retry or a second scorer device cannot double-insert
**And** claims inherit the **single-writer** contract scoring already enforces (NFR-R3); player self-report is deferred to Epic 6 (FR16(B))

**Given** the pure engine receives claims as inputs (it never reads the db)
**When** the engine `types.ts` `holeState` is extended
**Then** **Story 2.1 owns** adding a **`claims` field** (the per-player claim set for the hole) **and an explicit `holeNumber` / hole ordinal** to the Epic-1 `holeState` type — the ordinal makes the Story 2.2 stateful-carryover fold deterministic and order-independent (it sorts by ordinal, never by map/insertion order); `compute-foursome` populates `holeState.claims` from the persisted `hole_claims` at the **service layer**, keeping resolvers pure (Stories 2.2–2.4 consume this field, so it must exist first)

**Given** a previously recorded claim on a **non-finalized** round (FR39)
**When** the scorer edits the claim's value in place or removes it
**Then** changing a claim's value in place (e.g. toggling it, or correcting the `claim_type`) **upserts** the cell row, and removing it **deletes** the row (delete-to-remove); **reassigning a claim to a different player is a remove + add** (delete the old cell, insert the new) — **not** an in-place edit, because `player_id` is part of the cell key
**And** because money is **recompute-on-read** (no stored money, no recompute trigger — Story 1.4), a claim write/edit/delete's obligation is **durable persistence within the read snapshot** so the **next money read reflects it** — it does **not** "fire a recompute" (there is none to fire); if the optional 1.4 derived-money cache is ever added, a claim write invalidates it, but the MVP has no cache
**And** a claim write/edit/remove on a **finalized** round is rejected with an explanation — an **interim local finalized-check** ships here (Epic 2) and is **explicitly testable** (a claim write to a finalized round returns a refusal, asserted by test); Epic 4 / Story 4.1 later routes this through the canonical frozen-boundary check (a deliberate seam, not throwaway logic)
**And** the **inert-vs-fail-closed distinction is a testable AC** (not just prose): a recorded claim whose modifier is **`enabled:false`** in the resolved config produces **zero edges** (inert — the safe default before its resolver ships), whereas an **unknown modifier `type`** in config **fails closed** (unsettleable + surfaced, FR44)

**Given** the on-course UI floor (NFR-A1)
**When** the claim controls render in the score-entry view
**Then** the claim control **renders within the existing per-hole score-entry route/component** (the `scores` / score-entry view) — introducing **no new route, modal, or full-screen overlay** (verified by a web test asserting the control is present in the score-entry render tree) — built from the shipped primitives with dark-mode tokens and the **full NFR-A1 floor: ≥44–48px tap targets, 16px inputs (no iOS zoom), AA sunlight contrast, one-handed (thumb-reach) operation**
**And** at 375px with up to **4 players × 3 claim types**, claims surface via **progressive disclosure that stays inside the score view** (e.g. claim chips under the active player's score row; only the player being scored shows claim controls) with **no horizontal page overflow** and no sub-44px targets (the T12-2 overflow precedent)
**And** **lock state gates *config*, never *claim capture*** — a scorer in a **locked** foursome still records greenie/polie/sandie claims (a claim is scoring input, not a config tap; NFR-A2's zero-*config*-taps is preserved)

> **Scope note:** 2.1 ships only the **capture + storage + recompute-fanout** for claims — the **resolvers that consume them** (greenie/polie/sandie) are Stories 2.2–2.4, each behind its own golden. Recording a claim before its resolver exists is inert (no money effect), which keeps this story independently shippable.

### Story 2.2: Greenie modifier (stateful carryover) + golden

As the F1 engine,
I want a pure greenie resolver — including the **carryover** stateful behavior — matched to a hand-approved golden,
So that closest-to-the-pin money settles deterministically, including the case where an unclaimed greenie carries to the next hole.

**Acceptance Criteria:**

**Given** the NFR-C1 hard gate
**When** Story 2.2 begins
**Then** the first artifact is a hand-authored, hand-approved golden fixture (`engine/games/__fixtures__/greenie-*.json`) asserting the exact `SettlementEdge[]` for a greenie sequence on **par-3s** (greenies are contested **only on par-3s**) that **includes a carryover to the next par-3** — an unclaimed par-3 greenie rolling to the **next par-3**, with the **intervening non-par-3 holes skipped, never landed on** (the corrected NFR-C4 adversarial: the pot does not roll onto a par-4/5) — **and the multi-par-3 accumulation rule**: unclaimed on the 1st and 2nd par-3s, the **3rd par-3 greenie is worth 3 points** (base + 2 carried, per Josh); no resolver code merges before the fixture is approved

**Given** the registry contract
**When** `modifiers/greenie.ts` is built
**Then** it registers a pure resolver `(holeState, config) → contribution` reading the greenie **claim** from `holeState` (fed by 2.1) and the `{enabled, variant}` config, where `variant` carries **carryover on/off** — **the only greenie config lever** (FR2). The greenie itself is a **binary yes/no claim**: the real-world rule (**hit the green and two-putt** on the par-3) is **NOT system-validated** — there is no way to automate it (Josh), so the scorer simply marks it, and a player who didn't earn it just isn't marked; claims are **accepted as entered** (FR16), exactly like every other claim
**And** the resolver is **stateful across par-3s** — an unclaimed greenie with carryover-on accumulates to the **next par-3's** pot (it identifies par-3s from `holeState.par`, skipping non-par-3 holes); with carryover-off it expires at each par-3 (FR40); the carryover fold runs over holes **sorted by the `holeState` ordinal** (Story 2.1), so it is **invariant to input / iteration / insertion order for a fixed hole sequence** (the precise reading of NFR-C6 — *not* invariant to hole order itself, which a carryover inherently respects) and total-conserving (NFR-C7)
**And** a **`fast-check` property proves carryover-pot conservation** over arbitrary claimed/unclaimed sequences (no pennies created or lost across the accumulation) — the stateful analogue of the cap property, since carryover is the one path where a pot accumulates across holes
**And** the greenie golden is green and the `compute-foursome` ledger including greenie lowers loss-lessly to edges (NFR-C3)
**And** an unknown greenie `variant` fails closed (FR44)

### Story 2.3: Polie modifier + golden

As the F1 engine,
I want a pure polie resolver matched to a hand-approved golden,
So that putt-length ("polie") money settles deterministically per the configured variant.

**Acceptance Criteria:**

**Given** the NFR-C1 hard gate
**When** Story 2.3 begins
**Then** a hand-approved golden (`engine/games/__fixtures__/polie-*.json`) asserts the exact `SettlementEdge[]` for a polie sequence (incl. the Standard-Guyan "polie on anything" variant) **and homes the orphaned NFR-C4 *all-push hole* adversarial case** — a hole where every player pushes (no net winner, no claim) must produce an **empty / zero `SettlementEdge[]`** (not a crash, not a phantom split) — before any resolver code

**Given** the registry contract
**When** `modifiers/polie.ts` is built
**Then** it registers a pure resolver reading the polie **claim** from `holeState` + its `{enabled, variant}` config (FR2); the polie golden is green; the ledger including polie lowers loss-lessly to edges (NFR-C3); an unknown variant fails closed (FR44)
**And** polie is **stateless** (no carryover) — each hole resolves independently, order-independent (NFR-C6)

### Story 2.4: Sandie modifier + par-vs-any-score variant + golden

As the F1 engine,
I want a pure sandie resolver with its score-eligibility variant matched to a hand-approved golden,
So that up-and-down-from-the-sand money settles deterministically, whether the variant pays on par-only or on any score.

**Acceptance Criteria:**

**Given** the NFR-C1 hard gate
**When** Story 2.4 begins
**Then** a hand-approved golden (`engine/games/__fixtures__/sandie-*.json`) asserts the exact `SettlementEdge[]` for **both** sandie variants — **up-and-down for par or better** (the common default) and **up-and-down for ANY score** (Wolf's unusual variant) — before any resolver code

**Given** the registry contract
**When** `modifiers/sandie.ts` is built
**Then** it registers a pure resolver reading the sandie **claim** from `holeState` + its `{enabled, variant}` config where `variant ∈ {par_or_better, any_score}`, **default `par_or_better`** (most groups require the sand save to yield **par or better**; Wolf's `any_score` is the unusual one) (FR2); a sandie is a **gross** up-and-down from sand, so eligibility is **gross / natural score vs par** (the Standard-Guyan sandie is **gross** — *not* net-vs-par), and since claims are accepted-as-entered (2.1) the resolver pays per the variant on the recorded claim against the player's **gross** result for the hole; the sandie golden(s) are green; the ledger lowers loss-lessly to edges (NFR-C3); an unknown variant fails closed (FR44)
**And** the fixture includes the **par-or-better-vs-any divergence hole** — a single hole where the player made **bogey after an up-and-down from sand**: `par_or_better` pays nothing, `any_score` pays — proving the variant lever actually changes the payout on the *same* input (mirroring 2.5's net-vs-gross divergence hole)

### Story 2.5: Birdie modifier generalized — `{net | gross(natural)} × {single | double bonus}` + golden

As the F1 engine,
I want the birdie modifier generalized to its four variants matched to hand-approved goldens,
So that net-vs-natural birdies and single-vs-double bonuses all settle from one resolver (data + one resolver, no rewrite).

**Acceptance Criteria:**

**Given** Epic 1 shipped **net-birdie / single** as the base game's point
**When** Story 2.5 begins
**Then** a hand-approved golden (`engine/games/__fixtures__/birdie-*.json`) asserts the exact `SettlementEdge[]` for the **new** variants — **gross (natural) birdie** and **double bonus** — including a hole where net-birdie and gross-birdie diverge (a stroke-hole birdie), before resolver changes

**Given** the registry contract and NFR-X1 (new variant = data + one resolver)
**When** `modifiers/net-birdie.ts` is generalized **in place** (keep the registered modifier `type` string `net-birdie`; add `variant.basis` / `variant.bonus` — **do not** introduce a superseding `birdie.ts`, which would force re-pointing `games/guyan-2v2.ts` and the Epic-1 config mapping)
**Then** the single resolver takes `variant: {basis: 'net' | 'gross', bonus: 'single' | 'double'}` (FR2) — `basis: 'gross'` detects the birdie from **natural/gross vs par** (no handicap), `bonus: 'double'` doubles the point — gated by a **`config_version` bump**, with an explicit **backward-compat default**: a pre-2.5 / absent birdie config resolves to `{basis:'net', bonus:'single'}` (the Epic-1 behavior) and is **NOT** tripped by the fail-closed too-new-`config_version` path (legacy rows stay valid)
**And** **non-regression is enforced by re-running the Epic-1 base-game (net-birdie/single) golden, unchanged (zero fixture edits), against the generalized resolver and asserting byte-identical `SettlementEdge[]`** — this is the one place a refactor can silently move real money, so the test is explicit
**And** the fixture **homes the orphaned NFR-C4 *plus-handicap* adversarial case** — a better-than-scratch (plus) index where strokes are given back and net-vs-gross birdie eligibility diverges — asserting the exact `SettlementEdge[]` (the engine takes the plus-derived net + gross as given; the allocation side is covered by Story 1.4's net-reconciliation)
**And** the four-variant goldens are green; the ledger lowers loss-lessly to edges (NFR-C3); an unknown variant fails closed (FR44)
**And** the change is **data + the one resolver** — no schema migration, no new table, no UI rewrite (NFR-X1)

### Story 2.6: Payout cap ("345") + cap-never-exceeds property test + golden

As the F1 engine,
I want a configurable payout cap matched to a hand-approved golden and a fast-check property,
So that a capped game (e.g. "345" — $3/pt, $45 max) never overpays and a capped ledger still sums loss-lessly.

**Acceptance Criteria:**

**Given** the NFR-C1 hard gate
**When** Story 2.6 begins
**Then** a hand-approved golden (`engine/games/__fixtures__/cap-345-*.json`) asserts the exact `SettlementEdge[]` for the **"345"** configuration ($3/pt, $45 cap), including a **cap-on-the-boundary** case where the uncapped total would exceed $45 and resolves to exactly the cap (NFR-C4), **plus the modifier-composition coverage no other story owns** — a **no-cap Standard-Guyan all-modifiers-enabled hole-set** (the realistic round: low-ball + net-birdie + greenie + polie + sandie all firing, proving modifier composition) **and a capped variant** where the cap then truncates that composition — each asserting **both** correctness **and** loss-less decomposition (`sum(splits)==combined`); truncate-then-resplit is exactly where pennies leak — before any cap code

**Given** the game shape carries `cap?` + a cap-resolution rule (FR4)
**When** `compute-foursome` applies the cap
**Then** a capped game **never exceeds the cap** (FR26) and the **cap-resolution rule is named explicitly** (not "per 345"): when the uncapped 2v2 ledger would pay more than the cap, the payout is **truncated to the cap and collapsed onto the single net payer→payee edge** (the "345" one-payment shape — the losing pair's net obligation to the winning pair, capped); remainder pennies allocate by the **same fixed, lowest-`playerId`-first total-conserving rule used in Story 1.1** (NFR-C7 — named identically so the two split paths cannot diverge)
**And** the cap binds **only its own game instance** (Josh): the "345" **$45 cap applies to the 2v2 foursome game ONLY** — a player's **other games** (1v1 peer bets via "The Action", an event-pot / team game) settle **independently and are NOT subject to the 2v2 cap**; the cap is **per-game, never a per-player cross-game aggregate** — golden-tested with a player who hits the 2v2 cap **and** has a separate uncapped game, asserting the two settle independently and the cap never bleeds across games
**And** a **`fast-check` property test proves cap-never-exceeds** for arbitrary configs (the property explicitly deferred from Epic 1, which had no cap mechanic) — joining the isolation / loss-less / order-independence properties (NFR-C3) — and the property covers **every registered game/modifier that declares `cap?`** (each cap binds its own game instance only), so the Epic-3 event pot can carry its own cap without inheriting the 2v2's
**And** the cap golden is green and the capped ledger lowers loss-lessly to edges (NFR-C3)

### Story 2.7: Rules-page template picker with live pills + save-your-own preset

As an organizer,
I want to pick a built-in or saved template and see the modifier/variant pills update live, and save my own setup as a named preset,
So that I can visually verify the exact game before play (recognition-not-recall) and reuse a configuration across events.

**Acceptance Criteria:**

**Given** the Rules & Games setup page scaffolded in Epic 1 / Story 1.3 (`admin.events.$eventId.game-config.tsx`)
**When** the organizer opens the template selector
**Then** they can pick a **built-in** template (Standard Guyan / Wolf-Cup / "345") **or a saved custom** one; on selection the **modifier/variant pills below update live** (client-side, **no page reload**) to that template's settings (greenie carryover on/off, sandie par-or-better/any, birdie net/gross × single/double, point value, cap) so the organizer **visually verifies** the rules before play (FR7, NFR-A2/A3 recognition-not-recall)
**And** pill labels use **familiar group language** — e.g. the net-birdie point is framed as **"Skin for Net Birdie"** (Josh: the simplest, most recognizable pill dialog) rather than engine jargon
**And** the pills render from the **same `resolved-config` endpoint / shared resolver the engine settles from** (Story 1.3) — **not** a separate UI-side mapping; a test asserts `pills(resolvedConfig) ⇔ engine-consumed config` for each built-in, so "what is shown is what settles" is **falsifiable**, not prose

**Given** FR2 — an organizer can **enable/disable each modifier and choose its variant**, not only adopt a whole template
**When** the organizer toggles a modifier on/off or picks a variant on a pill
**Then** the pill is an **interactive control** that writes the change into the **event-level `game_config`** (one audited tx) and the live pills re-render from the **re-resolved** config, so the authored result is exactly what the engine settles — this is the FR2 authoring surface at **event** scope (the per-**foursome** self-serve version is Epic 6 / FR13). *(Confirmed by Josh 2026-06-21: FR2 authoring lives here in E2 at event scope; per-foursome self-serve stays Epic 6.)*

**Given** preset-save (FR6 → FR7)
**When** the organizer names and saves the current configuration
**Then** it persists into the **existing `rule_sets` + `rule_set_revisions` tables** (`db/schema/rules.ts` — `rule_sets{id, name, …ecosystemColumns}` + a `rule_set_revisions` row holding `config_json`), **tenant-scoped** via `ecosystemColumns()`; **no new table is created** (zero migration — pure reuse of the shipped preset-library store), and it appears as a **saved custom** option in the picker for future events
**And** the **save affordance is discoverable** — a "Save as preset" Button surfaces beside the pills once the current config **differs from a built-in** (recognition-not-recall for the organizer, not a hidden capability)
**And** the save + any template selection / modifier edit write the event-level `game_config` in one audited tx (NFR-S2); endpoints stay organizer-gated (`requireSession` + `requireOrganizer` + event-scoped gate), mirroring Story 1.3

**Given** the Wolf-Cup and "345" built-ins require the modifiers + cap from 2.2–2.6
**When** those built-ins are offered in the picker
**Then** they are only selectable once their underlying mechanics exist (this story sequences **after** 2.2–2.6) — no forward dependency; the picker shows exactly the mechanics already implemented
**And** a **saved custom preset that references a variant not yet implemented** is handled gracefully — validated on save (rejected/clamped) or rendered showing only implemented mechanics with a signpost — never silently settling fewer modifiers than its name implies (the unknown-variant pill case)

**Given** the UI floor (NFR-A1)
**When** the picker + pills render
**Then** they use the shipped Button/Card/FormField primitives, dark-mode tokens, ≥44–48px targets, one-handed phone use

### Story 2.8: Comparison harness + Wolf-Cup cross-validation golden

As the F1 platform,
I want a CI-runnable comparison harness whose first application proves the F1 engine, configured with the Wolf-Cup template, reproduces the money the shipped Wolf Cup app produces,
So that the "same engine, different variant data" thesis is proven against a real reference, and Epic 5's backfill has its byte-identical gate ready.

**Acceptance Criteria:**

**Given** the Wolf-Cup preset = the **exact shipped Wolf Cup ruleset** (double-birdie bonus ON, birdie = natural/gross, greenie carryover OFF, sandie = up-and-down for ANY score, etc.) now expressible from the 2.2–2.6 mechanics
**When** the cross-validation fixture is authored
**Then** it takes the **same scores as a named, recorded real Wolf Cup round** (a specific round identified in the fixture) and the F1 engine configured with the Wolf-Cup template must **reproduce that round's money** — asserted on the exact `SettlementEdge[]`, not just the total
**And** the reference money is a **frozen, checked-in fixture** (the expected `SettlementEdge[]` hand-extracted once from the Wolf Cup rules and committed into the Tournament repo) — **never a live read or runtime invocation of the Wolf Cup app/DB at CI time** (that would cross FD-1/FD-2 at runtime and couple Tournament CI to Wolf Cup internals); re-baselining the snapshot is a deliberate, reviewed act
**And** `apps/api` Wolf Cup money rules are **READ-ONLY reference** (FD-1/FD-2) — the fixture **cross-checks output**, it does **not** import Wolf Cup code; the exact levers are extracted from the Wolf Cup money rules to **author** the fixture once, then the comparison runs against the recorded expected money

**Given** migration insurance must mature as the goldens do (NFR-M1)
**When** the comparison harness is built
**Then** `services/migration-compare.ts` provides a **CI-runnable** byte-identical money comparison — F1-engine output vs a **trusted, frozen reference dataset** (the recorded Wolf Cup money here; legacy `money.ts` output for an event in Epic 5) — distinct from the unit goldens. It first **normalizes both sides to a canonical form** — the set of `(fromPlayerId, toPlayerId, cents)` tuples **sorted deterministically, pennies reconciled, self-edges (`from==to`) dropped, zero-cent edges removed** — because the Wolf Cup money output shape is **not** `SettlementEdge[]`; the comparison runs over that canonical form, and **any non-empty diff fails CI (non-zero exit)** — never a logged-and-passed warning
**And** the harness is **reused by Epic 5's backfill cutover gate** (FR37) — built here so the comparison exists before any live-event migration is attempted (this story creates the *harness + the Wolf-Cup application*; the *backfill action* is Epic 5)
**And** the **harness mechanism lands green independently of the Wolf-Cup reconciliation succeeding** — its plumbing is proven against a trivial known-good dataset, so Epic 5's cutover gate is **not blocked** if the Wolf-Cup cross-validation surfaces a genuine discrepancy to chase down (mechanism and cross-validation result are decoupled)
**And** the Wolf-Cup cross-validation is **expected to pass and is the proof** of the variant-data thesis — a failure is a **real F1-engine discrepancy to fix before the Wolf-Cup preset ships**, *not* a harness defect; and because **Epic 5's cutover gate compares F1 vs legacy `money.ts` for the migrated event** (a different reference dataset, not Wolf Cup), a Wolf-Cup discrepancy **never blocks Epic 5** — that is the precise sense in which the harness mechanism and the cross-validation result are decoupled; the tournament + wolf-cup suites stay green (NFR-X2)

---

## Epic 3: Teams & the Event Pot

Organizer forms teams from the roster (**manual / random / high-low handicap-index A/B**); a team is a **late-bound 2-man** composition that recomputes dependent money on read with no re-entry. **Story order is dependency-clean: 3.1 teams → 3.2 round override → 3.3 pin-by-value → 3.4 event pot → 3.5 buy-in tracker** — the pin precedes the pot so the pot never reads live teams. The **event-level pot** (**per-player buy-in, best-ball-vs-par, winner-take-all** — Josh) **reuses the shipped `computeTeamStandings` cross-round aggregation** (`services/team-standings.ts`) and settles on the F1 spine through the one `games-money.ts` chokepoint. Completes **FR29 for global teams** by pinning the global-team composition. Builds only on Epics 1–2. **Each settling game ships its golden** (NFR-C1).

### Story 3.1: Form teams — `teams`/`team_members` schema + manual/random/high-low A/B + late-bound recompute

As an organizer,
I want to form teams from the roster and re-team without re-entering scores,
So that team-dependent games recompute automatically and I can fix a mis-assignment cheaply.

**Acceptance Criteria:**

**Given** additive-only migration discipline and "create tables only when needed"
**When** the team store is added
**Then** `teams(id, event_id, name?, …ecosystemColumns)` + `team_members(team_id, player_id, …ecosystemColumns)` are created as a **persistent/global event-level store** (D3b), `CREATE TABLE` only (no CHECK-driven rebuild), `--> statement-breakpoint`, drizzle-kit-generated + renumbered
**And** the keys/invariants are explicit: `teams` is scoped by `event_id`; `team_members` carries **UNIQUE `(team_id, player_id)`** (no player twice on a team) and enforces **one global team per player per event** (in code — a player on two event-level teams is rejected); **teams are exactly 2 players in F1 MVP** (Josh — matches Pete Dye; N-ary is post-MVP)
**And** the new store **reconciles with the shipped `teamKey = sorted playerIds` convention** (`services/team-standings.ts`): a global team's identity maps to the same `teamKey` the shipped `computeTeamStandings` + live Pete Dye standings page already use, so the event pot (Story 3.4) and that page **agree on team identity** (no divergent keying)
**And** the **intra-foursome 2v2 stays derived** from pairing slots via the shipped `resolveFoursomeTeams` (D3a) — this story does **not** change the foursome-internal path; `teams`/`team_members` are for **global/event-level** teams (FR20)
**And** existing tables untouched; suites stay green (NFR-X2)

**Given** roster-based team formation (FR20)
**When** the organizer forms teams
**Then** they can build teams via **manual**, **random**, or **high-low handicap-index (A/B)** selection, each producing a **reviewable proposed roster** (player + HI shown per team) the organizer can **swap/edit before a single commit tx** — nothing persists until confirm (recognition-not-recall)
**And** **random is a one-time draw that is persisted** (the drawn composition is written + audited) — it is **NOT re-rolled on read/recompute** (else a recompute would reshuffle teams and move money)
**And** **high-low** sorts the roster by HI, splits into A-pool (low) / B-pool (high), pairs A↔B by rank; at **team-formation time (pre-pin)** the HI source is the **H1 locked-as-of-date HI if set, else most-recent GHIN HI**; **ties in HI break by lowest `playerId`** (the NFR-C7 named convention); **odd-roster / no-HI players are surfaced for manual placement** (never silently mis-paired); a test proves high-low is **deterministic across input orderings** (incl. all-equal-HI + duplicate-HI fixtures)
**And** team formation is organizer-gated (`requireSession` + `requireOrganizer` + event-scoped gate), the commit is one audited tx (NFR-S2), built from shipped primitives (NFR-A1)

**Given** a team is a **late-bound composition** of players (FR21)
**When** team membership changes
**Then** because scores/claims attach to the **individual player** (FR17) and money is **recompute-on-read** (no stored money), the **next read of any team-dependent game reflects the new composition with no score re-entry** — the edit only persists membership; nothing recomputes eagerly
**And** **team identity persists** across a membership change (the `team_id` stays; its members mutate) — a re-team is **not** a new team identity (FR21 late-binding)
**And** within 3.1's own scope the testable acceptance is structural: a membership edit **persists and rebinds the team's members** (the `team_members` rows change) and the **already-live event-level standing read reflects it** (the shipped `computeTeamStandings` recomputes from the new members on next read — no score re-entry); 3.1 needs no later story to be verifiable

> **Forward note (NOT a 3.1 acceptance gate):** the *money* consequences of re-teaming — (a) an un-pinned round's pot recomputes to the new composition, and (b) an **already-pinned** round's money stays **unchanged** — are exercised where the first team-*money* game and the pin exist (Story 3.3 pin, Story 3.4 pot). They are gated there, not here, so 3.1 carries no same-epic forward dependency.

### Story 3.2: Round-level override of the rule set / team game

As an organizer,
I want to override the event-default rule set or team game for a specific round,
So that the daily game can differ from the event default without disturbing other rounds.

**Acceptance Criteria:**

**Given** the cascade resolver (most-specific-wins, Epic 1) and the polymorphic `game_config` table
**When** the organizer sets a round-level override
**Then** the override changes the round's **rule set / game `config_json`** (the *rules* that round plays — e.g. a different point value or modifier set) — it does **NOT** change global team *membership* (re-teaming is Story 3.1; the override reuses the event's teams); the scope is **rules, not roster**
**And** a **round-level `game_config` row** (`level: round`, `ref_id: round_id`) is written and the resolver returns it over the event default for that round only (FR9); other rounds continue to inherit the event default (FR8)
**And** an orphan round-level row is still rejected unless an **event-level** row exists (the F1 routing invariant from Story 1.3 holds)
**And** the override **reuses the Story 1.3 game-config endpoint with `level=round` + `round_id`** (`PUT /api/admin/events/:eventId/game-config`), set from the round's admin page — no new top-level route; organizer-gated + one audited tx (NFR-S2); the round-level config is pinned at that round's `in_progress` transition (Story 1.2 pin mechanism — no new pin code)
**And** a **settling assertion** proves an **overridden round settles via the override config** while a sibling **non-overridden round is byte-identical to its event-default settlement** (the override moves only its own round's money)

### Story 3.3: Pin the global-team composition by value (completes FR29 for global teams)

As the F1 platform,
I want the round pin to capture — by value — the global-team composition it settled under,
So that re-teaming later never moves a past round's money, and the event pot (Story 3.4) reads a frozen composition, not live rows.

**Acceptance Criteria:**

**Given** the round-pin store from Story 1.2 left a **global-team-composition snapshot seam** unpopulated, and this story **precedes the event pot (Story 3.4)** so the pot never ships reading live teams
**When** a round with global teams transitions to `in_progress`
**Then** the pin **populates that seam atomically** within the existing one idempotent pin tx (no new pin transaction) alongside the resolved-config snapshot + effective-HI/CH + course-rev + pairings, completing FR29 for global teams
**And** the snapshot stores composition **by value** — `{teamKey/teamId → [playerId, …]}` captured into the pin — **NOT** an FK to the live `team_members` rows (a read-through FK would defeat the pin); the stored form is deterministic (members sorted, the shipped `teamKey` convention)
**And** the snapshot captures the **resolved** composition for that round (post any Story 3.2 round override), not the event-default teams
**And** recompute reads the **pinned** composition, never the live `teams`/`team_members` rows — editing a team after the round is pinned leaves that round's money unchanged (D3b/D4); a new round picks up the new composition
**And** a **provenance regression test** proves the **pinned snapshot is immutable**: form teams → pin round → change live team membership → the round's **pinned composition is unchanged** (the by-value snapshot does not read through to the mutated live rows), and the pin is re-written **only** by a **correction** (Epic 4). *(The downstream assertion that this immutability keeps a pinned round's **money** unchanged is exercised in Story 3.4, where the event pot — the first global-team money game — actually reads the pinned composition.)*

### Story 3.4: Event pot — per-player buy-in, best-ball-vs-par, winner-take-all + golden

As an organizer and a roster member,
I want an event-level pot funded by a per-player buy-in that pays the best-ball-vs-par winning team, settled on the F1 spine,
So that the cross-round team competition pays out real money through the one settle-up.

**Acceptance Criteria:**

**Given** the NFR-C1 hard gate and the pot's money model (Josh: **per-player buy-in, winner-take-all**)
**When** Story 3.4 begins
**Then** a hand-approved golden (`engine/games/__fixtures__/event-pot-*.json`) asserts the exact `SettlementEdge[]` for a **per-player-buy-in, best-ball-vs-par, winner-take-all** pot across **2-man teams** — the pot = **buy-in × number of players**, paid to the **winning team's players** (each winner nets `+(pot − own buy-in)`, each non-winner nets `−buy-in`) — with the **tie/split rule named**: an N-way tie for first **splits the pot evenly across the tied teams' players**, remainder pennies by the **lowest-`playerId`-first rule** (Story 1.1) — before any pot resolver code
**And** the **buy-in amount is a config field** on the event-pot game in `game_config.config_json` (e.g. `$50/man`) — the single source of the pot's cents — **set via this story's own organizer control** on the event-pot setup (the Rules & Games / event admin page); it is **not** a Story 2.7 modifier pill (a buy-in is a pot stake, not a modifier). Without it the pot is unconfigured + inert

**Given** the event-pot game type (FR5) and that the F1 per-foursome engine cannot aggregate across rounds
**When** `games/team-pot.ts` is built
**Then** the **service layer** (`services/games-money.ts`) performs the cross-round aggregation by **reusing the shipped `services/team-standings.ts` `computeTeamStandings`** (over `computeFoursomeResults`) to rank each 2-man team's best-ball-vs-par across the event's rounds (**no reinvented aggregator**), and feeds the resolved standing + buy-in **as given inputs** into the **pure** `games/team-pot.ts` resolver, which maps the winning team to `SettlementEdge`s — the engine resolver stays **pure** (no service/db import; the standing arrives as input, mirroring how claims feed `holeState`); settlement flows through the **single `games-money.ts` chokepoint** (no parallel money surface)
**And** the pot is a **second event-level money producer**: a **producer-disjointness integration test** (the D1a matrix) proves no `(debtor, creditor, reason)` edge is emitted by both the pot and the intra-foursome 2v2 — the pot's edges carry a distinct `sourceType`/`sourceId` namespace, so the two never double-pay into the shared settle-up
**And** the pot reads global teams via the **pinned snapshot** (Story 3.3), never live `teams`/`team_members` at read time, so re-teaming never moves a settled pot (FR29)
**And** the pot consumes only **per-player best-ball-vs-par results + global team membership** — never another foursome's ledger or `game_config`; this is the **legitimate event-aggregate cross-foursome edge**, distinct from the ad-hoc cross-group *head-to-head* matchup deferred to Epic 6 (FR22/FR25)

**Given** money-correctness
**When** the pot settles
**Then** the pot golden is green; the pot ledger lowers **loss-lessly** to edges (`sum(splits)==combined`, NFR-C3); the pot is **uncapped in MVP** (winner-take-all of a fixed buy-in pool needs no cap) — if a cap is ever configured it is the pot's **own per-instance `cap?`** inheriting the Story 2.6 cap-never-exceeds property (it never shares the 2v2's cap)
**And** the pot **fails closed** (unsettleable + surfaced, FR44/NFR-O1) when any contributing round/team is **incomplete** (an unscored round, a DNF/pickup, a team missing a player) — it never crowns a winner on partial best-ball-vs-par data
**And** the pot scores each team **independently vs par** (a per-hole tie between teams is immaterial to the standing); every participant appears in the settle-up with their net position (FR28)
**And** the pot standing is **audience-bounded** (NFR-S1/FR36): roster members see dollar figures, non-roster/cross-group see performance-only; the viewer page uses shipped primitives + the on-course floor (≥44–48px, dark-mode, no 375px overflow) and is **labeled distinctly from the intra-foursome pairings UI** so the two team concepts aren't conflated

### Story 3.5: Buy-in payment tracker + pot total on the leaderboard

As an organizer and a roster member,
I want to mark who has paid their event-pot buy-in and see the running pot total on the leaderboard,
So that collection is tracked at a glance and the stakes build excitement during play.

**Acceptance Criteria:**

**Given** the event pot has a per-player buy-in (Story 3.4) and additive-only migration discipline
**When** the payment tracker is added
**Then** an additive `event_pot_buyins(event_id, player_id, paid, paid_at?, marked_by_player_id, …ecosystemColumns)` table is created (`CREATE TABLE` only, statement-breakpoint, `ecosystemColumns()`) with **UNIQUE `(event_id, player_id)`**; existing tables untouched (NFR-X2)

**Given** the organizer collects buy-ins
**When** they open the buy-in checklist on the event admin page
**Then** they see every entrant with a **paid / unpaid toggle**; marking paid writes the row in one audited tx (NFR-S2), organizer-gated; the control uses shipped primitives + the on-course floor (≥44–48px, dark-mode, no 375px overflow)
**And** the tracker is **operational only — it never feeds settlement**: Story 3.4's pot math is independent of who has physically paid (a player owes/wins per the *result* regardless of collection state), so there is **no money-correctness coupling and no golden** is required

**Given** the stakes drive excitement (Josh)
**When** the leaderboard / event home renders for a roster member
**Then** it surfaces the **pot total** — both the **full pot at stake** (`buy-in × entrants`, the exciting headline number) and the **collected-so-far count** (`N / M paid`)
**And** the pot total is **audience-bounded** (NFR-S1/FR36): roster members see the dollar figure; non-roster / cross-group viewers see a performance-only view (no dollars), consistent with Story 3.4
**And** an individual's **paid/unpaid status is visible only to the organizer + that player** (not broadcast to the whole roster) — the leaderboard shows the **aggregate `N/M` count**, never a public unpaid-shame list

---

## Epic 4: Correct, Finalize & Trust the Money

The recompute-safety + transparency layer (Journeys 4 & 5). Mid-round **correction** (audited, recomputes the round), **finalize / audited un-finalize** with **finalized-frozen refusal**, the **diff notice** on correction, the **per-hole money breakdown** drill-down, the **plain-language active-rules summary**, and the **handicap-lock setup reminder**. Builds only on Epics 1–3 (the pin, recompute-on-read, and chokepoint exist). **Finalize comes first** — it defines the frozen boundary every other story respects. **Forward-effective (FR31, Story 4.3) is DEFERRED to post-MVP** (Josh 2026-06-21): with a locked-in game there is no real use case for changing the *game* live mid-round; the front-$5/back-$10 split is a **setup-time** `pointValue-schedule` (Story 1.1), not a live change, and Nassau front/back/total is a **betting** concept (shipped "The Action") — neither needs forward-effective. **Correction (4.2) with an audit log covers the real need.**

### Story 4.1: Finalize / un-finalize a round (audited) + finalized-frozen refusal

As an organizer,
I want to finalize a round to freeze its money and un-finalize it (audited) to re-enable corrections,
So that settled money can't drift after the group has settled up, while a genuine mistake can still be reopened on the record.

**Acceptance Criteria:**

**Given** recompute-on-read over pinned inputs (Epic 1), **finalized-frozen = input immutability**, and additive-only migration discipline (T13-4: no CHECK-driven rebuild)
**When** the finalize-state store is added
**Then** finalize state is **additive `ADD COLUMN`s on `rounds`** — `finalized_at`, `finalized_by_player_id`, `finalize_reason?`, `unfinalize_reason?` (timestamp + actor; the state validated in **Zod**, not a DB CHECK, so no table rebuild) — leaving `rounds`/`round_states` otherwise untouched (NFR-X2)

**When** the organizer finalizes a round
**Then** the round is marked **finalized**; its pinned config + scores + claims become **immutable inputs** (NFR-C5 zero money mutations on finalized rounds); finalize is organizer-gated + one audited tx with actor + timestamp (FR43, FR45, NFR-S2)
**And** because money is **derived on read** from a **deep by-value pin** (Story 1.2/1.4 — recompute reads only pinned snapshots, never live HI/config/teams), a finalized round derives the **same** number every time, and **even an indirect edit** (a global rule_set, a course-rating, the H1 lock page) **cannot move it** — finalize freezes the **inputs**, and the pin's by-value depth covers indirect drift, not just the direct write paths

**Given** a finalized round (FR32)
**When** a **round-scoped, money-changing edit that would re-pin THAT round** is attempted (a score/claim on it, a round-level `game_config` override on it, or a correction of it)
**Then** the system **refuses** it with a clear explanation (never a silent no-op), surfaced to the organizer (NFR-O1), via a **single canonical predicate `assertNotFinalized(roundId, tx)`** (one module) that **every** such path calls — `routes/scores.ts`, `routes/claims.ts` (replacing Story 2.1's interim local check), the Story 3.2 round-config write, and the 4.2 correction path — the call sites are the testable surface
**And** the refusal does **NOT** over-reach: a **global team edit (Story 3.1) or event-level config edit** stays **allowed** — the finalized round pins teams + config **by value**, so those edits are **inert on it** (they affect only future / non-finalized rounds); blocking them would wrongly freeze the whole event off one finalized round
**And** a **regression test** attempts each of {round score, round claim, round-level config, correction} on a finalized round → **refusal + zero input mutation** (NFR-C5), and confirms a global team/event-config edit **succeeds** and leaves the finalized round byte-identical
**And** presses cannot reach a finalized F1 round (presses are OFF for F1 — no press write path exists to bypass the boundary)

**Given** a genuine post-finalize mistake (FR43)
**When** the organizer un-finalizes the round
**Then** un-finalize is a **distinct audited action** (actor + timestamp + reason) re-enabling corrections; the audit trail shows the **finalize → un-finalize → (correct) → re-finalize** sequence so nothing reopens silently (FR45)
**And** un-finalizing a **settled** round **surfaces a notice to affected participants** (parity with the 4.2 correction diff — reopening already-settled money is higher-stakes, so it is never silent, FR33)
**And** a lifecycle test asserts finalize → un-finalize → correct → re-finalize leaves a complete ordered audit chain and **re-derives identical money** when inputs are unchanged (the pin is byte-stable across the round-trip)

### Story 4.2: Mid-round correction (recompute) + diff banner to affected participants

As an organizer,
I want to correct a non-finalized round and have everyone see what changed,
So that a fixed score or claim re-settles the whole round and nothing changes silently.

**Acceptance Criteria:**

**Given** edit semantics (ADR-F1-2) and a **non-finalized** round
**When** the organizer applies a correction (fixes a score or claim)
**Then** the correction **re-pins + recomputes the whole round** in one atomic tx (NFR-D2): it **overwrites the existing unique `round_id` pin row by value** (Story 1.2 — not an insert, which would violate the unique constraint, and not a second pin row, which would split-brain recompute-on-read), then money is derived on read through the chokepoint; **correction is the only path that re-pins** (per Story 3.3 / 1.2)
**And** **correctness is an automated test gate** (NFR-R2): a **hand-approved golden** asserts the corrected input → the **exact expected** round (and event) money — not merely "recompute ran" — ties deterministic (FR42)
**And** a finalized round cannot be corrected without first un-finalizing (Story 4.1) — the correction path calls `assertNotFinalized`

**Given** nothing changes silently (FR33) and there is **no stored money** to diff against (recompute-on-read)
**When** a correction changes any participant's money
**Then** the correction path **captures the pre-correction `SettlementEdge[]` in the same tx BEFORE re-pinning**, recomputes, and **persists the before→after delta** (a durable notice row — not a transient toast), delivered **per-recipient** to each player whose net moved as a **persistent, dismissable notice on their My Money / leaderboard view that survives app reopen until acknowledged**; audit-logged with actor + timestamp (FR45)
**And** the notice is **audience-bounded** (NFR-S1/FR36 — roster-only, each player sees their own delta, never a public broadcast of dollars) and meets the **on-course floor** (NFR-A1: ≥44–48px ack target, AA contrast, dark-mode, no 375px overflow)
**And** a test asserts the displayed before→after delta **equals the actual recompute move** per participant (a wrong notice on real money is a trust failure)
**And** when a round correction **flips the cross-round event-pot winner** (Epic 3), the **event total re-reconciles** and the **pot-winner flip also surfaces** (a swing larger than the round delta must not change silently — FR33); a golden covers correct-round → event-pot recompute

### Story 4.3: Forward-effective rule change from a hole — *DEFERRED to post-MVP*

> **DEFERRED (Josh 2026-06-21).** Forward-effective = changing the **game itself** live mid-round from hole N (e.g. "double the points from hole 10"). With a **locked-in game there is no real use case**, and the cases that resemble it are already handled: the **front-$5 / back-$10** split is a **setup-time** `pointValue-schedule` (Story 1.1), not a live change; **Nassau** (front/back/total) is a **betting** concept in the shipped "The Action," not F1. **Correction with an audit log (Story 4.2) covers the real need** (fixing errors). FR31 is therefore **post-MVP**; if a concrete use case emerges it would need a segmented `(effective_from_hole → resolved_config)` pin model (an ordered segment list the single-snapshot pin doesn't carry).
>
> *FR coverage impact:* **FR31 → post-MVP (deferred)** — no MVP story implements it. All other Epic 4 FRs (FR30/32/33/35/38/41/43) remain in MVP.

### Story 4.4: Per-hole money/points breakdown drill-down

As a roster member,
I want to see, per hole, which scores and claims paid what,
So that I can trace every settled dollar and trust the total reconciles.

**Acceptance Criteria:**

**Given** traceability (NFR-T1) and the leaderboard drill-down (FR41)
**When** a viewer opens the per-hole breakdown for a player/foursome
**Then** it shows, per hole, **which scores + claims produced which money/points**, reading the per-hole decomposition the engine **already** produces (Story 1.1's `holeState`→ledger — no new parallel attribution pass), **only** through the `games-money.ts` chokepoint, by **extending the existing `services/money-detail.ts` / My Money surface** (not a parallel route)
**And** **reconciliation is a test gate** (NFR-T1): `sum(per-hole game money) == the round total` (property/fuzz, per NFR-C3) — but the **cross-round event pot (Epic 3) is NON-additive** (best-ball-vs-par winner-take-all has no per-hole attribution), so it shows as a **separate event-level line** that reconciles into the **event total** but is **NOT** summed into any hole; the invariants are `sum(per-hole)==round` for additive game money, and `round money + non-additive pot == event total` separately
**And** the breakdown is **audience-bounded** (NFR-S1): a non-roster / cross-group viewer never sees dollar figures (FR36 boundary)
**And** it renders via the shipped **`ScrollableTable`** primitive (18 holes × players is dense — no 375px horizontal page overflow, the T12-2 precedent), ≥44–48px targets, dark-mode, <2s warm (NFR-A1/P2), with the per-hole figures **visibly summing to the shown total** so the player sees it reconcile

### Story 4.5: Plain-language active-rules summary + handicap-lock setup reminder

As a foursome member and an organizer,
I want a plain-language summary of the active rules and a reminder to lock handicaps as-of a date,
So that any player can state their game without help, and the organizer doesn't forget the handicap basis.

**Acceptance Criteria:**

**Given** intent-visibility (FR35, NFR-A3 the "Mark test")
**When** a foursome member opens the active-rules summary
**Then** it reads the **resolved** config in **plain language** (e.g. "2v2 off the low, $5/pt front $10/pt back, net birdies double, polie on anything, greenie no carryover, sandie any score") — what is summarized is what settles — with a **tappable plain-language gloss** for group jargon (a "what's a polie / sandie / off the low?" definition layer) so a non-technical reader isn't blocked by terms (clears NFR-A3 without help)
**And** in an observed session a non-technical player reads the summary and **correctly states their game without help** (NFR-A3); the summary uses shipped primitives + the on-course UI floor (NFR-A1)

**Given** the handicap basis matters for net money (cross-ref H1, FR38)
**When** the organizer is in the Rules & Games setup flow
**Then** a **reminder** prompts them to **lock handicaps as-of a date**, **linking to the shipped H1 lock page** (`/admin/events/:id/lock-handicaps`) — **no new handicap logic** (locking stays optional; unlocked defaults to most-recent GHIN, per Epic 1)
**And** the reminder is a **non-blocking** signpost (the organizer can proceed unlocked) that **re-surfaces while handicaps remain unlocked and the event is pre-play, and clears once locked** — so "don't forget" is enforced by recurring visibility, not a single skippable banner (consistent with the Epic 1 handicap rule)

---

## Epic 5: Migration & Cutover *(highest data-risk; last in Product A)*

Backfills a live event onto the F1 config model, **gated by the comparison harness built in Epic 2** — a backfilled event's money must be **byte-identical old-vs-new** before cutover, and the move is **reversible**. Sequenced last because correctness is proven on new data first and new groups use fresh events. Builds only on Epics 1–4. **Additive only** — existing events are untouched until an organizer opts a specific event in.

### Story 5.1: Backfill an existing event onto the F1 config + pin model (additive, money untouched)

As an organizer,
I want to generate F1 config + provenance pins for an existing (legacy) event without changing its current money,
So that the event is *ready* to cut over to the F1 engine while its live money keeps reading the legacy path until I flip it.

**Acceptance Criteria:**

**Given** the additive dual-read guarantee (NFR-M1) and the routing invariant — **amended here**: an event is F1 iff it has an event-level `game_config` row **whose `cutover_state ∈ {native, active}`** (a fresh F1 event defaults `native`; a backfilled-but-not-cut-over event sits in `staged` and does **not** route to F1)
**When** the backfill runs for a chosen legacy event
**Then** an **additive `cutover_state` column** (`native` | `staged` | `active`; default `native`) is added to `game_config` (ADD COLUMN, Zod-validated, no CHECK rebuild) so the router checks **row-exists AND `cutover_state ∈ {native, active}`** — fresh F1 events (Story 1.3) default `native` (unaffected), and **backfill writes the event-level row with `cutover_state = staged`** so routing stays on legacy `money.ts` until Story 5.2 flips it (no silent cutover; the Story 1.3 "sole routing check" is updated to this two-part check — cross-referenced there)
**And** it **derives** the event-level `game_config` (+ any round overrides) and the per-round provenance pins (resolved-config + effective-HI/CH + course-rev + pairings + team composition) from the legacy event via a **deterministic, documented mapping** (legacy `sub_games` rows + 2v2-off-the-low defaults + point values → `config_json` modifiers / point-schedule) — **without mutating any existing table's data** (FR37, NFR-D1)
**And** the mapping **fails closed at backfill time** (named reason, surfaced — NFR-O1) on any **un-representable legacy feature** — most importantly **presses** (a legacy event with presses ON cannot be byte-identical under presses-OFF F1): rather than let 5.2's comparison block forever on an unactionable diff, backfill detects + refuses these events up front
**And** backfill is **idempotent** — re-running on an already-backfilled event no-ops (does not duplicate the row/pins)
**And** the backfill is organizer-gated, one atomic tx per event, fully audited (NFR-S2, NFR-D2); the tournament + wolf-cup suites stay green (NFR-X2)

### Story 5.2: Cutover gate — byte-identical comparison + reversible flip

As an organizer,
I want to cut a backfilled event over to the F1 engine only after the money matches byte-for-byte, and be able to roll back,
So that no live event changes its money on cutover and a bad cutover is reversible.

**Acceptance Criteria:**

**Given** the comparison harness from Epic 2 / Story 2.8 (`services/migration-compare.ts`)
**When** cutover is attempted for a backfilled event
**Then** the harness **recomputes the comparison at flip-time** (against this event's CURRENT pins — not a stale CI artifact, since handicaps could re-lock or a round re-score between 5.1 and 5.2), normalizing **both** legacy `money.ts` output **and** F1 output to 2.8's **canonical form** (sorted `(from,to,cents)` tuples, pennies reconciled, self/zero edges dropped — and the canonicalizer must cover the legacy pairwise-settle-up shape, not only `SettlementEdge[]`); cutover is **blocked unless the diff is empty** — a **non-empty diff fails (non-zero exit) and is surfaced legibly** (which player/round/figure differs, old→new, on shipped primitives + NFR-A1), **never auto-resolved**
**And** on a passing (empty-diff) comparison the organizer sees an explicit **"0 differences — safe to cut over"** affirmative, and cutover **flips `cutover_state` staged→active** (the routing amendment from 5.1) so the event routes entirely through F1 (legacy 2v2 + presses OFF for it — D1a), as one audited tx (FR37, FR45)

**Given** reversibility (NFR-M1), surfaced as reversible at the flip moment
**When** an organizer rolls a cutover back
**Then** rollback flips `cutover_state` active→staged so the event **returns to reading legacy `money.ts`** byte-identically (legacy inputs were never mutated — no destructive deletes — NFR-D1/D3); since a backfilled event had **no presses** (5.1 fail-closes presses-bearing events at backfill), there is no press flag to restore — rollback simply reverts `cutover_state`; audited
**And** a **positive round-trip test** asserts post-rollback `money.ts` output **== the original pre-cutover legacy money** (not merely "no double-count"); a **producer-disjointness test** confirms no double-count in **either** direction across the full D1a matrix
**And** a test asserts a **sibling legacy event not opted in still routes to `money.ts` with unchanged edges** across another event's backfill+cutover (existing events completely untouched — NFR-X2)

---

## Epic 6: Per-Foursome Self-Serve & Cross-Group *(Product B — Growth, deferred within F1)*

What an *unlocked* event enables: the player-facing **"Adjust Guyan Game Rules"** recognition-not-recall UI (H1-identity-gated) writing **foursome-level `game_config` rows** that **lock once their round starts**, **player self-reported claims**, and **cross-group team games via SettlementEdges** (preserving foursome isolation). Builds only on Epics 1–5 (the polymorphic table, the level-parameterized resolver, the claim path, and the SettlementEdge IR all exist; this epic populates the foursome level and the cross-group producer). **No engine rewrite** — the Epic 1 resolver was level-parameterized from day one for exactly this.

### Story 6.1: Player "Adjust Guyan Game Rules" self-serve config (foursome-level) + lock-on-start

As a joined foursome member (in an unlocked event),
I want to adjust my own foursome's game via preset + named-modifier toggles, locking once our round starts,
So that my group can run its own variation without an organizer, and the rules can't shift once we tee off.

**Acceptance Criteria:**

**Given** an **unlocked** event that is **already F1** (an event-level `game_config` row exists with `cutover_state ∈ {native, active}` — Story 1.3; a foursome-level row on a non-F1 / still-`staged` event is an orphan and rejected) and an H1-identity-gated foursome member
**When** the member opens "Adjust Guyan Game Rules"
**Then** they adjust **their own foursome's** game via **preset + named-modifier toggles with the live-updating pills of Story 2.7** (so the player **visually verifies the resulting rules before play** — the same recognition-not-recall bar as the organizer UI, NFR-A2/A3) plus the Story 4.5 plain-language resolved summary, writing a **foursome-level `game_config` row** where **`ref_id` = the `pairings` row id** (a "foursome" *is* a `pairings` row, slots 1–4 — there is no separate foursome entity; the Story 1.2 in-code level-validator is extended to validate a foursome `ref_id` resolves to a real pairing in this event) into the **single polymorphic table** (D2) — the level-parameterized resolver (Epic 1) composes it most-specific-wins with **no engine change**
**And** authority is gated by a **new `requireFoursomeMember`** check (none exists yet — only `requireOrganizer` / `requireEventParticipant`): it resolves the session player → a `pairing_members` row and asserts `pairing_id == ref_id` for this event; a non-member cannot edit another foursome's config (NFR-S1/S2); the write is one audited tx (FR13)

**Given** a foursome's config must not shift mid-round (FR14)
**When** that foursome's round starts (`in_progress`)
**Then** its foursome-level config **locks** — the config screen **signposts "rules lock when your round starts" BEFORE lock** (no surprise) and post-lock shows the **read-only resolved config** (not a dead/empty screen); further self-serve edits are **refused server-side against the round's CURRENT state** (a late offline-queued edit arriving after `in_progress` is rejected, never silently included)
**And** the **round pin captures the per-foursome resolved config** — since foursomes can diverge, the pin stores the resolved config **keyed by `pairing_id`** (extending the Story 1.2 per-`round_id` pin to hold N foursome configs when foursome-level rows exist), so recompute reads each foursome's pinned snapshot; a **provenance regression test** proves a post-lock foursome-config edit attempt does not move that round's money
**And** an organizer **re-locking the event** disables **further** foursome self-serve edits globally (the toggle is the master gate); **already-pinned** foursome rounds keep the config they locked under (re-lock affects only future edits, not pinned rounds)

### Story 6.2: Player self-reported claims

As a player (in an unlocked event),
I want to self-report my own greenie/polie/sandie claims,
So that my foursome's modifiers capture claims without relying solely on the designated scorer.

**Acceptance Criteria:**

**Given** the scorer claim path from Epic 2 / Story 2.1 (`hole_claims`, cell-unique `(round, player, hole, claim_type)`, accepted-as-entered, offline, audited) and that a claim's **identity is the FACT** (a greenie on hole N for player P), with the **writer recorded as provenance** (`scorer_player_id` vs a new `reporting_player_id`), **not** part of the cell key
**When** a self-identified player (H1-identity-gated) reports a claim for **themselves** (the claim's subject `player_id == the reporting player`)
**Then** the write is an **idempotent upsert on the cell** (the Story 2.1 cell-unique is **NOT** amended): if the scorer already marked that same claim, the self-report is a **no-op** (same fact — no double-insert, no 409 to the user), recording the added provenance; if **unmarked**, it **inserts** the claim (accepted-as-entered — the group/organizer corrects later via Epic 4 if contested) — so two writers on one cell resolve deterministically with **no duplicate claim and no double-pay**
**And** the **self-report control renders inside the score-entry flow** (no second screen — the Story 2.1 pattern + NFR-A1 floor) and each claim **chip shows its reporter** (self-reported vs scorer-entered) so provenance is visible; it **fans out the recompute** like any claim change and inherits edit/remove (FR39) + the **canonical finalized-frozen refusal** (Story 4.1 `assertNotFinalized`)
**And** self-report is only enabled in an **unlocked** event (Product B); a locked event keeps the scorer-only path

### Story 6.3: Cross-group team games via SettlementEdges (foursome isolation preserved)

As an organizer,
I want a team/matchup that spans foursomes to settle as player-to-player SettlementEdges,
So that cross-group money works without ever reading another foursome's config (isolation intact) and feeds the one settle-up.

**Acceptance Criteria:**

**Given** structural foursome-internal isolation (FR23) must survive cross-group play
**When** an organizer **forms a cross-group team/matchup** (FR22 — designating players in different foursomes as a team: a formation step + UI, **reusing the Story 3.1 global-`teams` store**, since a cross-group team *is* a global team spanning foursomes)
**Then** it settles as **player-to-player `SettlementEdge`s** through a **distinct producer path** that **never reads another foursome's config or ledger** (FR25) — it consumes only the **finalized per-player results** (each foursome's per-player net + that foursome's already-settled claims, via a defined per-player-results input contract) **after** intra-foursome settlement, so the same dollar can't be consumed by both an intra-foursome and a cross-group edge
**And** it emits edges with a **dedicated `sourceType: 'f1_cross_group'`** (mandatory — **NOT** the shared `f1_game`, so producer-disjointness is checkable by `sourceType`); the **producer-disjointness integration test** keys on `(debtor, creditor, sourceType, sourceId)` across the **full D1a matrix** (`{f1_game, f1_cross_group, betting, legacy_2v2, skins}`) and proves no edge is emitted by two producers (no double-count)
**And** the cross-group producer feeds the **one shared settle-up** through the `games-money.ts` chokepoint; a **hand-approved golden** asserts the exact cross-group `SettlementEdge[]` — covering **≥2 foursomes** and a case where a player owes **both intra-foursome AND cross-group on overlapping holes** (proving no *input* double-consumption, which output-edge disjointness alone won't catch); the cross-group ledger lowers loss-lessly (NFR-C1/C3)
**And** the cross-group game **fails closed** (unsettleable + surfaced, FR44/NFR-O1) when a contributing foursome's per-player result is missing/incomplete
**And** cross-group money stays **audience-bounded** — only authenticated roster members of the relevant groups see dollar figures (NFR-S1)
