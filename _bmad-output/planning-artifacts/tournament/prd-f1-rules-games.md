---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping']
status: 'PAUSED at step 8/11 (2026-06-16) — pivoted to tactical Pete Dye build; resume at step-09-functional'
inputDocuments:
  - _bmad-output/brainstorming/brainstorming-session-2026-06-16.md
  - _bmad-output/planning-artifacts/tournament/prd.md
  - _bmad-output/planning-artifacts/tournament/architecture.md
  - _bmad-output/planning-artifacts/tournament/product-brief.md
  - _bmad-output/planning-artifacts/tournament/event-setup-ux-backlog.md
  - _bmad-output/planning-artifacts/tournament/multi-organizer-design-proposal.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 1
  projectDocs: 2
workflowType: 'prd'
projectType: 'tournament-app'
scope: 'F1 — unified Rules & games configuration model'
outputFolder: '_bmad-output/planning-artifacts/tournament/'
classification:
  projectType: 'PWA + Hono/SQLite API (brownfield feature addition)'
  domain: 'sports / golf scoring (rules + money engine)'
  complexity: 'high'
  projectContext: 'brownfield'
  dataMigrationRisk: 'high'
  notes: 'Feature addition layered on the shipped Tournament v1. Tournament app only (apps/tournament-api, apps/tournament-web). Must preserve immutable rule_set_revisions (FD-8) and reconcile with the existing forward-effective mid-event rule-edit machinery (FD-13 / FR-H1). PARTY-MODE REFINEMENTS (2026-06-16): (1) The real hazard is brownfield DATA risk — migrating live events off tenant-scoped rule_sets + reconciling retroactive recompute vs FD-8 immutable revisions + FD-13 forward-effective edits — NOT the cascade itself (a solved pattern). (2) F1 has a natural A/B phasing: Product A = admin can create/seed a rule set ("Standard Guyan Game") + lock toggle (kills the dead "No rule set seeded" card; must-ship spine; carries the migration); Product B = per-foursome self-service unlock where joined members edit their own 2v2 (phase 2, behind A). Must-not-break: zero-tap inherit default (the "Mark test"); player self-setup leans entirely on H1 join identity; leaderboard money/scores mode-switch needs signposting.'
---

# Product Requirements Document — Tournament F1: Unified "Rules & Games" Configuration Model

**Author:** Josh
**Date:** 2026-06-16
**Scope:** F1 (Rules-config foundation). F1b (player-driven 1v1 bets) and F2/F3 are separate tracks, out of scope here.

## Foundation Decisions & Risk (pre-discovery — from advanced elicitation 2026-06-16)

These are inherited as LOCKS by later PRD steps, not re-opened.

### ADR-F1-1 — Config model is additive; `rule_sets` becomes the preset library
New event/round/foursome **config tables** carry the cascade. The existing tenant-level `rule_sets` / `rule_set_revisions` stay intact as the **seed/preset library** (e.g. "Standard Guyan Game"). Event config *references a rule_set revision id* as its seed; an edit creates a new revision (FD-8 immutability preserved) and re-points. No destructive change to existing rows.

### ADR-F1-2 — Recompute has three edit semantics (reconciles "fix my mistake" with FD-8/FD-13)
- **(a) Correction** — retroactive, allowed ONLY while a round is `in_progress` / `complete_editable`; recomputes the whole round. (Josh's "I meant to turn off net-birdie, recalculate.")
- **(b) Forward-effective** — the existing FD-13 `effective_from_hole` mid-round change machinery (FR-H1).
- **(c) Finalized = frozen** — neither (a) nor (b) touches settled money; changing a finalized round requires an explicit, audited un-finalize (organizer).
- _Rejected: "recompute always (incl. finalized)" — fails data safety; "forward-effective only" — fails the fix-my-mistake requirement._

### Migration — additive dual-read (Path 2) + golden-output backfill gate
New config tables added alongside; events with no new config fall back to today's tenant-rule_set behavior (existing events untouched, reversible). Only new/opt-in events use the cascade. Any event that IS backfilled must pass a **golden-output comparison** (old vs new compute produce byte-identical money) before cutover.

### Scope phasing (promoted from note to decision)
- **Product A (must-ship spine):** admin creates/seeds a rule set ("Standard Guyan Game") + lock toggle; kills the dead "No rule set seeded" card; carries the migration. Locked-trip path = zero-tap inherit.
- **Product B (deferred within F1):** per-foursome self-service unlock + player-facing "Adjust Guyan Game Rules" UI (gated by H1 join identity). Ship when a casual trip actually needs it.

### Risk register (from pre-mortem)
| # | Failure | Prevention |
|---|---|---|
| R1 | Retroactive recompute rewrites a FINALIZED round's settled money | Finalized = frozen (ADR-F1-2c); recompute only on non-finalized |
| R2 | Migration backfill silently changes a live event's 2v2 params | Additive dual-read (existing events untouched) + golden-output gate |
| R3 | Per-foursome unlock changes stake MID-round → earlier holes recompute | Lock foursome config once its round starts (mirror edit-round-course's "refuses after start") |
| R4 | Cap settlement pays >1 person ("you don't lose it ×2" violated) | Loss-less decomposition invariant (same guard that caught the T13-5 half-share bug) |
| R5 | Segmented point value off-by-one at front/back boundary | Golden-fixture test the segment→hole mapping |
| R6 | Cascade resolver misreads lock flag → wrong foursome rules | Golden-fixture test the Event→Round→Foursome resolution incl. lock gate |

## Executive Summary

F1 makes the Tournament app's core wedge — *"the app remembers how this specific group plays golf"* — actually functional. Today that wedge is broken at the most basic level: the admin landing shows a dead, un-clickable "No rule set seeded yet" card, and there is no UI to create or seed a rule set. The app cannot express a group's game, so it cannot be used for real by any group whose game differs from the hardcoded default. **F1 is the demo→usable threshold: without it, Tournament works for one game; with it, a second group can adopt it.**

The job-to-be-done is not "configure rules" — it is **"let me play my real game and trust the money at the end."** The felt value is correctness without mental math, and it is already proven in production: the sibling app (Wolf Cup) demonstrates the exact reaction F1 targets — *"we just put the scores in and it sorts it all out; we're getting spoiled and people really like it."* F1 extends that relief to the math-heaviest contexts: out-of-group head-to-head games (different foursomes, no shared card), multi-round trips/events (manual math compounds), and even the in-foursome Guyan game itself ("a lot of thinking sometimes").

F1 delivers a unified **"Rules & games" configuration model**: an event-wide rule-set default that cascades **Event → Round → Foursome**, behind a single admin lock toggle. The common case is **zero-tap inherit** — the organizer seeds the group's game once (preset-first, never blank-slate) and every foursome plays it. The cascade is **container-agnostic by contract**: its top level is "a container that has rounds," so an ongoing **Season** (the Sunday-group / League shape — persistent roster, weekly rounds, season-long standings) slots onto the same config tables later *without migration*. Building the Season container is explicitly **out of F1 scope** (it is the existing League milestone); F1 only declines to foreclose it, and adds no `season_id` or polymorphic plumbing — the agnosticism lives in the seam. The Season is in fact the purest "config-once" case: rules set in week one, untouched for the year. When a casual trip needs it, the admin unlocks and joined members tune their *own* foursome's 2v2 via a guided, recognition-not-recall flow (gated by the H1 join identity). A "game" is one shape — `{scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[]}` — and a "modifier" is `{type, enabled, variant}`, so new rules are added as data + one resolver, never a schema/UI rewrite.

### What Makes This Special

The defensible moat is **not the rules editor** (any app can add one) — it is the **foursome-internal money boundary**. Because 2v2 money never leaves the foursome (2 losers pay 2 winners), the app can offer *per-group rule variation safely*, with no cross-foursome settlement reconciliation. Competitors that don't model money at foursome granularity structurally cannot offer this. The variant model is already validated by real divergence between two live rulesets: the Standard Guyan Game (sandie = up-and-down for *par*; greenie carryover *on*) and Wolf Cup (sandie = up-and-down for *any* score; greenie carryover *off*) are the *same engine, different variant data* — two presets, not two codebases.

Two invariants protect the felt value: **(1) config cost is paid once, at setup — the on-course experience stays zero-math** (Wolf Cup proved this for a *fixed* game; F1 must not let configurability leak cognitive load onto the course); and **(2) correctness is a test artifact, not a feeling** — every game type and modifier ships a golden-file fixture matching hand-calculation (inheriting NFR-C1/C2), and the same golden outputs gate the data migration.

## Project Classification

- **Type:** Brownfield feature addition to the shipped Tournament v1 (PWA `tournament-web` + Hono/SQLite API `tournament-api`).
- **Domain:** Sports / golf scoring — rules + money engine (the app's deepest domain logic).
- **Complexity:** High. **Data-migration risk: High** — the real hazard is migrating live events off the tenant-scoped `rule_sets` and reconciling retroactive recompute with FD-8 immutable revisions + FD-13 forward-effective edits; the config cascade itself is a solved pattern.
- **Context:** Brownfield; preserves FD-8 (immutable `rule_set_revisions`) and reconciles with FD-13/FR-H1. Ports Wolf Cup's proven *correctness machinery* (per-hole pure compute, golden tests), not its runtime code (FR-G2) or its app-specific rules.
- **Phasing:** Product A (admin create/seed/lock — must-ship spine, carries the migration) → Product B (per-foursome self-service unlock — deferred within F1).

## Success Criteria

### User Success
- **Self-serve seed + lock in ≤5 min** (UX guardrail) — preset-first ("start from Standard Guyan Game"), never blank-slate, and **no asking Josh**. Counts only if the seeded ruleset *reproduces the group's actual game* (golden-match a prior hand-calc).
- **Zero-tap inherit** — in a locked event a foursome plays with **0 config taps** (the "Mark test"). Counts only if the inherited rules are the ones the group actually wanted, and "0 taps" must survive Product B existing.
- **No per-hole math** — scores in → points/money out matching hand-calc, for the group's *actual* game (polies / sandies / greenies / caps / segmented stakes).
- **Intent visibility** — every foursome can see a plain-language summary of its active rules ("Standard Guyan · $5/pt · sandies on · net-birdie on") so config-intent errors are catchable. (Correctness ≠ intent.)
- **The dead "No rule set seeded" card is gone** — always a working create/seed path.
- **(Product B)** When unlocked, a joined member adjusts their *own* foursome's 2v2 via **recognition-not-recall** (pick preset + toggle named modifiers), never free-form.

### Business Success
- **Demo→usable threshold crossed:** a group whose game ≠ the hardcoded default runs a **real trip end-to-end to a settle-up everyone trusts** — the headline business signal, observed in the wild. Concrete proof: a non-default ruleset (Wolf-Cup variants, or Madden's "345" cap) configured and run.
- **Trust outcome:** **zero settle-up disputes / zero manual recalcs** at the next real trip — nobody pulls out a notepad to double-check. The felt-success signal.
- Side-project posture unchanged (no revenue).

### Technical Success
- **Four-mechanic golden coverage** = engine definition-of-done: Standard Guyan (modifiers + stateful greenie carryover), Wolf Cup (variant divergence — sandie "any score", carryover off), Madden's "345" (flat point value + payout cap, $3/pt + $45 max), segmented schedule ($5 front / $10 back). All expressible as **pure config, zero code branches**, golden-matching hand-calc.
- **Adversarial fixtures, not just happy-path:** greenie carryover cascading to a non-par-3, cap landing exactly on the boundary, all-push holes, plus-handicap.
- **Correctness = test artifact** (inherits NFR-C1/C2).
- **Migration safety:** existing events untouched (additive dual-read); any backfilled event passes a byte-identical old-vs-new money comparison before cutover.
- **Recompute safety:** 0 money mutations on finalized rounds; corrections only on non-finalized; capped settlement guarded by the loss-less decomposition invariant. **Recompute-in-the-wild:** a real mid-round correction recomputes correctly (observed, not only unit-tested).
- **Cascade correctness:** Event→Round→Foursome resolution incl. lock gate is golden-fixture tested.
- **Zero Wolf Cup regressions;** tournament suite stays green.

### Measurable Outcomes
| Metric | Target | Verified by |
|---|---|---|
| Money correctness | matches hand-calc: Guyan · Wolf Cup · "345" (flat+cap) · segmented (front/back) | golden fixtures |
| Four-mechanic coverage | all pure config, 0 code branches | golden fixtures |
| Adversarial cases | carryover→non-par-3, cap-on-boundary, all-push, plus-handicap all correct | golden fixtures |
| Migration safety | existing events byte-identical pre/post | old-vs-new comparison harness |
| Finalized-round money mutations | 0 | recompute tests |
| Recompute-in-the-wild | a real mid-round correction recomputes right | observed + recompute tests |
| Zero Wolf Cup regressions | suite green | CI gate |
| Demo→usable (business) | a 2nd group runs a real trip to a trusted settle-up | observed in the wild |
| Trust | zero settle-up disputes / zero manual recalcs | observed in the wild |
| Intent visibility | every foursome can read its active rules in plain language | observed session |
| Seed + lock a trip *(guardrail)* | ≤5 min, self-serve, reproduces actual game | observed session |
| Foursome config taps, locked *(guardrail)* | 0 (survives Product B) | observed session |

## Product Scope

### MVP — Product A (must-ship spine), built in risk-sequenced order
1. **Engine generalization** — the game shape `{scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[]}` + modifier registry `{type, enabled, variant}`. *(Golden-provable on new data, no live-data risk — built first.)*
2. **Admin create/seed a rule set** ("Standard Guyan Game") + event-wide default. *(Kills the dead card.)*
3. **Cascade resolver (Event→Round→Foursome) + single lock toggle.**
4. **Additive dual-read migration** — gated by the byte-identical golden comparison. *(Touches live events only after correctness is proven on new data.)*
5. **Leaderboard mode switch** — money/P&L (locked) vs scores-only + private My Money (unlocked).

### Growth — Product B (deferred within F1)
Per-foursome self-service unlock + player-facing "Adjust Guyan Game Rules" recognition-not-recall UI (gated by H1 join identity).

### Vision (Future)
Container-agnostic **Season** (the Sunday group) · new modifier/game types via the registry (add = data + one resolver) · F1b player-driven 1v1 bets surfacing · rule-set sharing across groups.

## User Journeys

### Journey 1 — Josh the Organizer: seed + lock a trip *(Product A, happy path)*
**Opening.** Josh is setting up the next Pinehurst-style trip. He opens the event admin and — instead of the dead "No rule set seeded yet" card — sees **"Set up Rules & Games."**
**Rising action.** He taps it. It opens **preset-first**: "Start from *Standard Guyan Game*." He confirms the modifiers (net-birdie on, polie on-anything, gross sandie, greenie carryover), sets the point value ($5/pt), names it, saves. He sets each day's **team game** (foursome-vs-foursome, per-hole win/lose, $20/man). He leaves foursomes **LOCKED to admin**. The setup also prompts a **handicap-lock reminder** ("Lock handicaps as of: ___") so he doesn't forget — he sets as-of = the Wednesday before (the H1 feature; can be set retroactively since GHIN history is dated).
**Climax.** He doesn't configure anything per-foursome. Every foursome inherits the event rule set automatically — zero further setup.
**Resolution.** Under 5 minutes, self-serve, no spreadsheet. The trip is rules-ready; the locked leaderboard will show money standings.
*Reveals:* rule-set create/seed UI (preset library), modifier config with variants, point-value, team-game config, single lock toggle, the cascade's event-default level, **a handicap-lock setup-flow reminder (cross-ref H1/H1b)**.

### Journey 2 — Madden the casual player: unlock + self-serve *(Product B)*
**Opening.** It's a loose weekend; Josh flips the event to **UNLOCKED**. Madden's foursome plays "345"; the other plays Standard Guyan.
**Rising action.** Madden opens the app (joined earlier by code — H1 identity), lands on his foursome, taps **"Adjust Guyan Game Rules."** Recognition-not-recall: he picks the **"345"** preset (flat $3/pt, $45 cap) from a list and toggles named modifiers — no free-form, no schema.
**Climax.** His foursome plays 345; the next foursome plays Standard; **neither touches the other's money** (2v2 is foursome-internal).
**Resolution.** Two foursomes, two games, one trip, no admin bottleneck, no cross-foursome reconciliation.
*Reveals:* unlock toggle, player-facing adjust flow gated by join identity, per-foursome config, recognition-not-recall preset picker, foursome-internal settlement.

### Journey 3 — Mark the reluctant player: zero-tap inherit *(the "Mark test")*
**Opening.** Locked event. Mark dreads "another app to configure."
**Rising action.** He opens the app — **no config screen ever appears.** He sees the schedule and a plain-language line: *"Your foursome: Standard Guyan · $5/pt · sandies on · net-birdie on."*
**Climax.** He plays. Scores go in, money comes out right. He never thought about rules once.
**Resolution.** The thing that removed friction *added none.*
*Reveals:* zero-tap inherit, **intent-visibility** active-rules summary, no config friction for non-organizers.

### Journey 4 — Josh mid-trip: "I meant to turn off net birdie" *(recompute safety)*
**Opening.** Day 2, mid-round, Josh realizes net-birdie shouldn't be on for this round.
**Rising action.** He edits the rule. Because the round is `in_progress`, it's a **correction** — the engine recomputes the whole round; a diff banner surfaces to participants so nothing drifts silently.
**Climax.** He tries the same edit on *yesterday's finalized* round — the app **refuses** (finalized = frozen); changing it would need an explicit, audited un-finalize.
**Resolution.** Money's corrected where it's safe, protected where it's settled. Nobody's paid-up balance silently changed.
*Reveals:* edit/correction flow, retroactive recompute (non-finalized only), finalized-frozen guard, diff banner, recompute-in-the-wild.

### Journey Requirements Summary
- **Rule-set authoring:** create/seed from a preset library; modifier config `{type, enabled, variant}`; point-value (flat + segmented) + cap; team-game config. *(J1)*
- **Cascade + lock:** Event-default → Round → Foursome resolution; single admin lock toggle; zero-tap inherit as default. *(J1, J3)*
- **Player self-service (Product B):** unlock-gated, identity-gated "Adjust Guyan Game Rules"; recognition-not-recall preset picker; foursome-internal settlement isolation. *(J2)*
- **Intent visibility:** plain-language active-rules summary per foursome. *(J3)*
- **Edit/recompute:** correction (non-finalized, retroactive) vs forward-effective; finalized-frozen guard; diff banner. *(J4)*
- **Leaderboard mode:** money standings when locked, scores-only + private My Money when unlocked. *(J1, J2)*
- **Handicap-lock setup touchpoint** *(cross-ref H1/H1b, not F1 build):* the setup flow reminds the organizer to lock handicaps as-of a date; lock is correct retroactively (GHIN dated history); future-dating needs the scheduled-lock enhancement (H1b).

## Domain-Specific Requirements

### Compliance & Regulatory
- **None.** Golf side-game scoring; no regulated data class; no in-app payments (cash settle-up off-app). Matches the v1 PRD "no regulatory burden."

### Domain Patterns (golf money engine)
- **Deterministic pure engines, integer cents** — all money computed by pure functions of (scores + config); no floats; recompute is reproducible (inherits NFR-D8 + the Wolf Cup discipline).
- **Foursome-isolation is STRUCTURAL, by signature** — the per-foursome money compute takes only *that* foursome's config + *its own* four players' scores: `computeFoursome(itsOwnConfig, itsOwnScores) → foursomeLedger`. The engine cannot read another foursome's config, so cross-foursome contamination is **unrepresentable** — the safety property the entire unlock feature relies on is enforced by the type/signature, not merely by a test.
- **Slope-aware course-handicap allocation (hard reuse pointer)** — any F1 game/modifier that computes a *net* score MUST import the existing allocation: `calcCourseHandicap` / `allocateNetThroughHole` (`services/handicap.ts`), `getHandicapStrokes` (`engine/handicap-strokes.ts`), `buildTeeByPlayer` (`services/per-player-tee.ts`). **Zero new allocation math** — reimplementing net resurrects the `Math.round(HI)`-wrong-on-non-blue-tees bug family.
- **Loss-less decomposition** — combined and split ledgers sum to the identical total; caps never double-pay (the T13-5 half-share invariant).

### Testing the Invariants (property tests, not just examples)
Golden fixtures cover *examples*; **property/fuzz tests** cover the *invariants*, across arbitrary configs:
- **Isolation:** for any two foursomes with any configs, changing foursome B's config never moves foursome A's ledger.
- **Loss-less decomposition:** `sum(splits) == combined` for all inputs.
- **Cap-never-exceeds:** settled payout ≤ cap, always.

### Technical Constraints
- Edits recompute via the pure engines; **finalized = frozen**; correction only on non-finalized (ADR-F1-2).
- **H1 non-regression:** the shipped locked-handicaps overlay (`event-handicap-overrides`) must continue to apply under the new config model — F1 must not regress handicap-lock.

### Risk Mitigations
- See the Foundation **Risk register (R1–R6)**: finalized-frozen, additive dual-read + golden gate, foursome-lock-on-start, loss-less invariant, segment/cascade golden fixtures.

## PWA + API Specific Requirements

### Data Model (additive — ADR-F1-1)
- **`rule_sets` / `rule_set_revisions`** *(existing, tenant-scoped)* → the **preset library**. Revision `config` JSON extended to the game shape `game = {scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[]}`, `modifier = {type, enabled, variant}`. Immutable-revision pattern (FD-8) unchanged.
- **`event_game_config`** *(new, Product A)* — per event: `event_id`, `seed_rule_set_revision_id`, `lock_state` ('locked'|'unlocked'), `team_game_config`, ecosystem columns (FD-6).
- **`round_game_config`** *(new, Product A)* — per-round override: the daily team game + any round-level rule overrides (admin sets the team game each day).
- **`foursome_game_config`** *(new, Product B only)* — FKs **`pairings.id`** (existing T4-2); scoped to *(round, foursome-slot)*, re-inherited each round as pairings reshuffle; **locked once the round starts** (R3).
- *(Open for architecture: `round_game_config` + `foursome_game_config` could collapse into one `(level, ref_id, config)` override table.)*
- **Dual-read migration:** events with no `event_game_config` fall back to today's tenant-`rule_sets` behavior (existing events untouched; reversible).

### Durable History & Config Provenance
- **Per-round pairings are append-only** — re-pairing for a later round never overwrites an earlier round's "who was in which foursome." (Round 6.16.100 with X; round 6.16.102 with Y — both retained forever.)
- **A scored round pins the config revision it was computed under** — exactly as rounds pin `course_revision_id` today ("course durable across re-tees"). Editing a rule set later does NOT change a past round's money; a new round picks up new config. Only a *correction* (ADR-F1-2a) re-pins. This is the spine for cross-event stats.

### Engine (pure, registry-based)
- **`resolveConfig(event, round, foursome)`** — cascade resolver, most-specific-wins (Foursome→Round→Event default), gated by `lock_state`. Golden-tested incl. lock gate (R6).
- **`computeFoursome(itsOwnConfig, itsOwnScores) → foursomeLedger`** — structural isolation (cannot read another foursome's config).
- **Modifier/game registry** — `register(type, resolver)`; add a rule = data + one pure resolver (no schema/UI change).
- Net scoring imports the existing slope-aware allocation (`calcCourseHandicap`/`allocateNetThroughHole`/`getHandicapStrokes`/`buildTeeByPlayer`) — zero new allocation math.
- **Recompute reuses the existing post-score-commit path** (press-orchestrator/money) — no new trigger.

### API Endpoints
- **Admin (organizer + event-scoped):** rule-set CRUD / list presets; `GET`/`PUT /api/admin/events/:eventId/game-config` (seed preset, lock toggle, team game); `PUT …/rounds/:roundId/game-config`; `GET …/events/:eventId/resolved-config` (mirrors the `admin-context` route shape).
- **Player (Product B, gated):** `GET`/`PUT /api/events/:eventId/foursomes/:foursomeId/game-config` — gated by **event-unlocked AND requireSession (Google or H1 device bridge) AND member-of-this-foursome AND round-not-started**.
- **Edit/recompute:** PUT applies correction (non-finalized) or forward-effective per ADR-F1-2; **finalized rounds reject WITH an explanation** ("This round is finalized — money is locked. Un-finalize to change.").

### Web UI (PWA, design-system primitives + dark-mode tokens)
- **Admin "Rules & Games" setup** — preset-first ("Start from Standard Guyan Game"), modifier toggles + variant pickers, point-value (flat + segmented), cap, team-game config, **single lock toggle**. Replaces the dead "No rule set seeded" card.
- **Intent-visibility** — plain-language active-rules summary per foursome (on the round/leaderboard view).
- **Player "Adjust Guyan Game Rules"** *(Product B)* — recognition-not-recall preset picker + named-modifier toggles; never free-form.
- **Leaderboard mode** — money/P&L (locked) vs scores-only + private My Money (unlocked), with a visible mode signpost.
- **Finalized-frozen message** — explanatory, not a bare refusal (Sally).

### Auth
- Organizer routes: `requireSession` + `requireOrganizer` + event-scoped `isEventOrganizerByEventId`.
- Player routes (Product B): `requireSession` (Google **or** H1 device binding) + event-participant + foursome-membership + unlock gate + round-not-started.

### Provenance Regression Tests (named)
- (a) Edit a rule set *after* a round is scored → that round's money is unchanged (pinned); a new round uses the new config.
- (b) Correction on a non-finalized round re-pins + recomputes.
- (c) Finalized-round edit is rejected.

### Required Clarity Artifact
The architecture/PRD must include a **diagram** of: cascade resolution (Event-default→Round→Foursome, gated by lock) + the edit-semantics decision (correction | forward-effective | frozen) + the pin/re-pin lifecycle — plus a plain-language definition of "config provenance." (Prevents the "I fixed the rule, why didn't last week's money change?" confusion — which is *correct* behavior.)

### Forward-Compatibility — NOTE ONLY, zero F1 build
These shape v1 schema (don't-foreclose), they are NOT F1 work:
- **Money is NEVER public.** Two visibility tiers: (1) **Money** — bounded to your group (FR-D9 posture), with an event/season total surfacing to another group ONLY by the player's manual per-group approval; (2) **Public/cross-user stats** — performance only (avg by par 3/4/5, birdies, …), **never any dollar figure**. The tiers must stay structurally separable.
- **Public/private profiles** — default **private**, opt-in; per-player + retroactive (flip-to-private hides history too); "who I played with" data about another player respects *their* visibility (mutual-visibility boundary). Builds on cross-event stats (v1.5+ Vision).

### Implementation Considerations
- Drizzle migration: additive tables, `--> statement-breakpoint` between every statement; plain `ADD COLUMN`/`CREATE TABLE` (no CHECK-driven table rebuilds — the T13-4 gotcha).
- Risk-sequenced build order: engine + seed → cascade + lock → migration (golden-gated) → leaderboard mode → Product B.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy
- **Approach: problem-solving MVP.** The minimum that makes the app usable by a *second group* — crossing the demo→usable threshold. Ship the smallest thing that lets a group whose game ≠ the default run a real trip to a settle-up they trust.
- **Resource model:** solo dev (Josh + Claude), port-and-generalize discipline (reuse Wolf Cup's proven correctness machinery).

### MVP Feature Set (Phase 1 = Product A)
- **Journeys supported:** J1 (organizer seed + lock), J3 (zero-tap inherit / "Mark test"), J4 (mid-trip correction). *(J2 unlock → Phase 2.)*
- **Must-have capabilities:** pure engine + modifier/game registry · admin create/seed rule-set UI (preset-first) · `event_game_config` + `round_game_config` · cascade resolver + lock toggle · additive dual-read migration (golden-gated) · leaderboard mode (money vs scores) · finalized-frozen with explanatory message · per-round config-provenance pinning · intent-visibility active-rules summary.

### Post-MVP
- **Phase 2 (Product B):** per-foursome unlock · player "Adjust Guyan Game Rules" recognition-not-recall UI · `foursome_game_config`.
- **Phase 3 (Vision):** container-agnostic **Season** (Sunday group) · new modifier/game types via the registry · F1b player-driven 1v1 bets surfacing · public/private profiles (money-never-public) · cross-event stats · rule-set sharing.

### Risk Mitigation Strategy
- **Technical:** additive dual-read + golden-output backfill gate · structural foursome isolation · reuse slope-aware allocation · finalized-frozen recompute (R1–R6).
- **Market/adoption:** the demo→usable threshold is the validation — one real trip on a non-default ruleset run to a trusted settle-up = proof.
- **Resource (solo dev):** risk-sequenced build order makes Phase 1 independently shippable + validatable before Product B; each phase stands alone.

---

> **⏸️ PRD PAUSED at Step 8/11 (2026-06-16).** Pivoted to a tactical Pete Dye Invitational build (hard deadline Jun 26–27) that does NOT rush the F1 foundation. Resume at `step-09-functional`. Pete Dye is a real-world F1 test fixture (event team-game + foursome Guyan games + handicap lock + a draw) to fold back in on resume.
