---
stepsCompleted: [1, 2, 3, 4]
session_active: false
workflow_completed: true
technique_execution_complete: true
inputDocuments: []
session_topic: 'Tournament app — unified "Rules & games" configuration model (event-wide defaults + per-round overrides)'
session_goals: 'Open the design space before any spec: model shape, config inheritance/override semantics, organizer UX, and migration off the tenant-scoped rule_sets model. Cover polies (incl. bogey-or-better-gross variant), net-birdie point, sandies, extensible to greenies/CTP/skins. Unify the separate rule_sets editor + sub-games toggles into one coherent surface. Design pass only — defer build.'
selected_approach: 'ai-recommended'
techniques_used: ['First Principles Thinking', 'Cross-Pollination / Analogical Thinking', 'Assumption Reversal', 'Role Playing']
ideas_generated: 24
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Josh
**Date:** 2026-06-16

## Session Overview

**Topic:** Tournament app — redesign the "Rules & games" configuration model (event-wide defaults + per-round overrides), unifying today's separate rule_sets editor and sub-games toggles.

**Goals:** Open the design space before committing to a spec — explore the config model shape, inheritance/override semantics, organizer UX, and migration from the current tenant-scoped model. Design pass only; defer build.

### Context Guidance

Verified current state (code-traced 2026-06-16, Tournament app `apps/tournament-api` + `apps/tournament-web` only):

- **rule_sets / rule_set_revisions are TENANT-scoped** (one shared config for all events; immutable-revision FD-8 pattern). Config holds `sandies`, `autoPress`, `greenies`, `individualBet`, `subGames`. No event- or round-scoping. `fetchActive2v2Config()` reads the latest tenant rule_set at scoring time.
- **Sub-games** (`skins` live; `ctp`/`sandies`/`putting_contest` schema-stubbed, 501) are **event-ROUND scoped**, configured on a separate admin surface (`admin.event-rounds.$eventRoundId.sub-games`).
- **Polies and "net-birdie point" do not exist** anywhere yet.
- **Sandies/greenies are split** between the 2v2 best-ball rule_sets config and the sub-games surface — "intermixed and need a redo" (Josh).
- The admin landing shows a **non-clickable "No rule set seeded yet" card** — there is no UI to create/seed a rule set.
- The **individual-bets engine already implements** match play + auto-press (pure, tested); the gap there is player-facing UX (separate F1b track, not this session).

**Desired end state:** (1) event-wide rule DEFAULTS with per-round OVERRIDES; (2) per-round toggles for polies (variant: bogey-or-better-gross vs any), net-birdie point, sandies, extensible to greenies/CTP/skins modes; (3) ONE coherent "Rules & games" setup unifying the rule_sets editor + sub-games toggles.

**Constraints:** Tournament app only; preserve the immutable `rule_set_revisions` pattern (FD-8); evidence-first; design pass only.

### Session Setup

Scope chosen by Josh: **Rules-config foundation** (the architectural blocker the rest of the F-series hangs off). Flow chosen: **Brainstorm first** — open the space before a spec.

## Technique Selection

**Approach:** AI-Recommended Techniques

**Recommended sequence (foundational → human):**

- **Phase 1 — First Principles Thinking:** strip "rule" / "game" / "config" to atoms before modeling — get the irreducible vocabulary right.
- **Phase 2 — Cross-Pollination / Analogical Thinking:** steal defaults+override inheritance patterns from solved domains (CSS cascade, Helm values, feature flags, tax brackets, handicap allocation).
- **Phase 3 — Assumption Reversal:** flip load-bearing assumptions (no event default? all rules per-hole? players configure? two games per round?) to surface edge cases before spec.
- **Phase 4 — Role Playing:** embody the organizer setting this up the night before the trip — derive the UX shape + tap-count constraints.

**AI Rationale:** Structured systems-design problem with a real data model + immutable-revision constraint; wins come from nailing the abstraction then stress-testing it, not pure wild divergence.

---

## Ideas Generated

### Phase 1 — First Principles (atoms)

**[Atom #1]: Modifier rides a base game**
_Concept_: Polies & sandies are "extra point × the bet value" — they have no standalone money. They only mean something when a base per-hole match game is active (the 2v2 inside the foursome). Confirmed by Josh: "they are nothing without a base game."
_Novelty_: Kills the flat-toggle-list model. A modifier is not a peer of a game; it's a child of one. Net-birdie point + greenie are the same shape (conditional per-hole point on the base match).

**[Atom #2]: TWO distinct base/standalone games at DIFFERENT scopes**
_Concept_: (a) the intra-foursome 2v2 match (today), and (b) a whole-group **team game** — foursome-vs-foursome-vs-foursome. These are different competition SCOPES, not the same game.
_Novelty_: The current model only knows the 2v2. The group team game has never existed in the data model.

**[Atom #3]: A "team game" is a counting-rule + a settlement**
_Concept_: The team game needs a configurable counting method — best 1 of 4, best 2 of 4, 1 gross + 1 net, best-N-by-par (1 on par5 / 2 on par4 / 3 on par3), etc. Josh's group default: lowest aggregate team score wins, $20/man, each losing player pays each of the 4 winners.
_Novelty_: "How you score a team's hole/round" is a reusable PARAMETER, not a hardcoded format. Same parameter could describe the 2v2 (best 1 of 2).

**[Atom #4]: Settlement model is its own axis**
_Concept_: Games settle differently — per-hole match (2v2, +modifiers), aggregate-stroke-wins-pot (team game: low total → losers pay winners $/man), skins-pot, closest-to-pin. The "who pays whom" is separate from "how we score."
_Novelty_: Separating scoring from settlement lets one engine serve many games.

### Phase 1 — First Principles (refined: the unification PARTIALLY breaks)

**[Atom #5]: Team game ≠ 2v2 game — modifiers bind to ONE specific base game**
_Concept_: Josh: "the Team game can be different than the 2-man game." Team game is usually plain **per-hole win/lose** (foursome-vs-foursome match). The 2v2 inside the foursome is where ALL the point modifiers live (net birdies, polies, sandies, greenies). So a modifier is bound to a *specific* base game (the 2v2), NOT "any active per-hole match."
_Novelty_: Confirms modifiers are children of a named base game, not free-floating event toggles. The proposed "one engine, scope+counting param" unification may still hold at the SCORING layer, but the two games are configured independently and only the 2v2 carries modifiers.

**[Atom #6]: "Standard Guyan Game" = a NAMED rule preset (the missing rule-set concept)**
_Concept_: The 2v2 game has a name — "Standard Guyan Game" — and is a reusable bundle: base 2v2 match + a specific set of modifiers + each modifier's variant. This IS the "rule set" the admin landing says is unseeded.
_Novelty_: Directly answers the "No rule set seeded yet / no UI to create one" gap. A rule set = a named, editable game+modifier bundle the organizer picks per event. Ships a real default ("Standard Guyan Game") instead of an empty card.

**[Atom #7]: Each modifier has a VARIANT parameter (not just on/off)**
_Concept_: Standard Guyan Game modifiers as Josh specified them:
- **Net birdies** → pay a point.
- **Polie** → variant = "on anything" (vs the alternative "bogey-or-better gross"). Standard = on anything.
- **Sandie** → "up and down for par, GROSS" (gross sandie: bunker → up-and-down saving par).
- **Greenie** → carryover ON.
_Novelty_: A modifier isn't a boolean; it's (enabled, variant). The config node is `{ type, enabled, variant/params }`.

**[Atom #8]: Greenie carryover is a stateful cross-hole rule (engine spec, not a toggle)**
_Concept_: If no one wins the last par-3's greenie, it carries: the NEXT hole's green-in-regulation + 2-putt wins any unwon greenies. Carryover ACCUMULATES across all unwon par-3 greenies and can land on a NON-par-3 hole. Josh's example: if all 4 par-3s went unwon, a subsequent par-4 GIR+2-putt would pay **4 additional greenie points**.
_Novelty_: The greenie modifier needs running cross-hole state + a "GIR+2-putt on the next hole after an unwon par-3" resolver — including paying out on non-par-3 holes. Far richer than the current `greenies.carryover` boolean.

### Phase 1→2 — The scope hierarchy is THREE levels + a permission gate

**[Atom #9]: Three inheritance levels, not two: Event → Round → Foursome**
_Concept_: Reality has 3 config scopes. (1) **Event-wide default** = the rule set (e.g. Standard Guyan Game) + trip-long stakes. (2) **Per-round/day** = admin sets the team game (may change daily) and re-pairs teams/players (always changes). (3) **Per-foursome** = in casual trips, individual foursomes run DIFFERENT 2v2 rules inside their own group.
_Novelty_: The design goal said "event defaults + per-round overrides" (2 levels). The real model is 3 levels, and the leaf (foursome) is where the 2v2 + its modifiers actually resolve. Teams/players already change per round via pairings; foursome config attaches to a round's pairing.

**[Atom #10]: Override is GATED by the admin (authorization layer on the cascade)**
_Concept_: Admin decides per round whether each 2v2 is uniform (locked to the event rule set) OR whether "the group has option to modify the rule settings." So inheritance isn't just most-specific-wins — each level can LOCK the level below.
_Novelty_: This is config inheritance + an authorization gate (like CSS `!important` / OS group-policy "users may not override"). The cascade resolver must respect a lock flag, not just specificity.

**[Atom #11]: Members self-configure their OWN foursome (guided, dead-simple UI)**
_Concept_: When the admin opens the gate, the non-organizer MEMBERS who joined set up their own foursome's games + rules themselves — "an easy guided UI for the members ... to setup their own foursome and the games and rules inside of it." Admin sets team games each day + the uniform-vs-open decision; players handle their own foursome's 2v2.
_Novelty_: Distributes config authoring to participants (ties straight into the H1 join-code device identity — a joined player can act for their foursome). New surface: a player-facing "our foursome's game" setup, NOT organizer-only.

**[Atom #12]: "Too many options = messy" is the central design risk → default-to-inherit**
_Concept_: Josh's own flag: ":( this is when things get too messy with too many options." The model must make the common case trivial (everyone inherits the event rule set, zero taps) and only expose per-foursome tweaking when the admin explicitly opens it. Progressive disclosure is a hard requirement, not polish.
_Novelty_: The model's success metric is "how few choices the median foursome sees," not "how many rules it supports." Power lives under a gate that defaults closed.

### Phase 2/3 — Money mechanics: point value, segments, caps, recompute

**[Atom #13]: Point value lives on the GAME; modifiers just yield points**
_Concept_: Polies/sandies/greenies/net-birdie are each "1 point." The dollar conversion is a GAME-level property: Standard Guyan Game = $5/point. So modifiers are point-producers; the base game owns points→dollars.
_Novelty_: Decouples "what scores a point" (modifier) from "what a point is worth" (game). Current model conflates these.

**[Atom #14]: Point value can be SEGMENTED (e.g. $5 front 9 / $10 back 9)**
_Concept_: Some groups play $5/point front, $10/point back. So point value is not a scalar — it's a per-segment schedule (at minimum front/back; possibly arbitrary hole ranges).
_Novelty_: Money is hole-range-aware. The engine must apply a point→$ rate that varies by hole. New axis the current `basePerHoleCents` scalar can't hold.

**[Atom #15]: Optional CAP / max with non-obvious settlement ("345" = $3/pt, $45 cap)**
_Concept_: Madden's "345" game: $3/point, $45 cap. Subtle rules: (1) the running tally is UNCAPPED and can swing — down $95, win the last hole, recover to -$86; (2) the final PAYOUT is clamped to the cap ($45); (3) it's paid ONE time to ONE counterparty — "I pay Ben, you pay Chris" — NOT multiplied across all opponents ("you don't lose it x2").
_Novelty_: Cap is on the *settled payout*, not the running score. And settlement is directional single-counterparty, distinct from the 2v2 pairwise-ledger. Implies game "type" carries its own SETTLEMENT model, not just a counting rule.

**[Atom #16]: Retroactive rule edit → automatic recompute (mid-game or end)**
_Concept_: "If you realize I meant to turn off net birdie points I can and the money/points recalculate." Config is editable during/after a round and everything recomputes. Josh wants correction, not just forward-effective change.
_Novelty_: The pure engines already recompute from (scores + config), so this is natural — BUT it must reconcile with the immutable rule_set_revisions (FD-8) pattern: a correction = new revision, recompute against current, old revision retained for audit. Need to decide "correct retroactively" vs the existing "effective_from_round/hole" forward-change machinery.

**[Atom #17]: Multiple SETTLEMENT models → "game type" is a first-class plug**
_Concept_: At least three settlement shapes now: (a) 2v2 team pairwise per-hole match ($/point, optional cap); (b) foursome-team aggregate → losers pay winners $/man; (c) capped individual directional ("345"). 
_Novelty_: A "game" = scope (sides) + counting rule + point-value schedule + optional cap + settlement model. Settlement is pluggable, not one hardcoded matrix. This is the real generalization the engine needs.

### Phase 3 — Lock model + a key architectural simplification

**[Atom #18]: "345" is a 2v2 VARIANT, not a new game type — settlement is always 2v2**
_Concept_: Josh: "$45 MAX only pay to one person, it's always 2v2 — 2 losers pay 2 winners." So Madden's 345 = the standard 2v2 with `pointValue=$3` + `cap=$45`. The cap applies per loser→winner pairing (each loser pays one winner, max $45). No separate "individual capped" settlement needed.
_Novelty_: Collapses Atom #17's third settlement model into the 2v2 with (pointValue, cap) params. Only TWO settlement engines remain: 2v2 pairwise (foursome-internal) + foursome-team aggregate (losers-pay-winners $/man).

**[Atom #19]: Lock = a single toggle set when configuring the standard 2v2**
_Concept_: In event rules setup, when you define the default/standard 2v2 there's a button: "foursomes LOCKED to admin" vs "UNLOCKED." Locked (default) = every foursome inherits the event 2v2. Unlocked = foursomes may self-edit.
_Novelty_: Coarse, single binary at the event level — not per-rule granular gating. Keeps the admin UX to one decision. (Resolves the deferred a/b question → effectively (a) coarse, with the safety coming from Atom #21, not from per-rule locks.)

**[Atom #20]: Player-facing "Adjust Guyan Game Rules" flow, gated by unlock + identity**
_Concept_: If unlocked, when a player opens the app and links their name to their group + handicap (the H1 join flow), they get an option like "Adjust Guyan Game Rules" / "2v2 rules/points" for THEIR foursome.
_Novelty_: New player-facing config surface, authorized by (event unlocked) AND (player joined + linked to a foursome). Directly reuses the H1 join-code device identity — a joined player edits only their own foursome's 2v2.

**[Atom #21]: Per-foursome variation is SAFE because 2v2 money is foursome-internal**
_Concept_: The 2v2 (and its modifiers/points/cap) settles entirely WITHIN a foursome — 2 losers pay 2 winners, money never crosses foursomes. So foursome A on $5 Standard Guyan and foursome B on $10 + sandies-off do not conflict — no cross-foursome settlement consistency is required. The only group-wide game (foursome-vs-foursome team game) stays admin-controlled + uniform.
_Novelty_: THIS is why "everyone plays different rules" doesn't break the money model — and why the unlock is architecturally safe rather than chaotic. The scope boundary (foursome-internal vs group-wide) is the real invariant that contains the mess.

### Phase 3 — Lock state DRIVES the leaderboard mode (config → output coupling)

**[Atom #22]: Locked 2v2 → money leaderboard; Unlocked → scores-only leaderboard**
_Concept_: If the 2v2 is LOCKED (uniform rules trip-wide), a full standings leaderboard is meaningful — money won/lost, net scores, comparable across all foursomes. If UNLOCKED (each foursome on different rules/stakes), pulling money into a unified leaderboard is NOT meaningful (can't compare $ across different games); the leaderboard should instead show gross/net scores per hole (per-day + trip).
_Novelty_: Lock state isn't just an edit gate — it's the switch between two leaderboard MODES. Money is only globally comparable when the game is uniform. This falls straight out of Atom #21 (unlocked = money is foursome-private).

**[Atom #23]: Leaderboard has (at least) two modes, selected by lock state**
_Concept_: (a) MONEY mode (locked) — trip-wide P&L standings + net scores, aggregating the uniform 2v2 + team game + contests. (b) SCORES mode (unlocked) — gross/net per hole, per-day + trip standings, NO global money column; per-foursome money stays in the existing viewer-centric "My Money" board (T13-5).
_Novelty_: The public leaderboard adapts to the config. Even unlocked, a player still sees their OWN foursome's money via My Money — but global money standings are suppressed because they'd be apples-to-oranges.

**[Atom #24]: Extensibility is a first-class requirement — modifiers/games are a registry**
_Concept_: Josh's converge condition: "if we can still add point modifier rules etc later." New modifiers (and new game types / contests) must be addable later WITHOUT redesign. The `{type, enabled, variant}` modifier shape + pluggable game-type/settlement model make this a registry pattern: add a new modifier = register its type + a per-hole scoring resolver; add a new game = register its scope+counting+settlement. Cascade, lock gate, and leaderboard are untouched.
_Novelty_: The design's durability test is "can a new side-game rule be added as data + one resolver, not a schema migration + UI rework." This is the acceptance bar for the model.

---

## Idea Organization & Synthesis

**24 atoms → 5 themes + the unified model.**

### Theme A — The atomic vocabulary (what things ARE)
- 3 distinct kinds: **modifiers** (ride a base game, point-producers, worthless alone) [#1], **games/contests** (own pot/winner/participants) [#2,#4], **peer bets** (1v1, deferred F1b).
- A **modifier** = `{ type, enabled, variant }` and binds to ONE specific base game [#5,#7].
- A **game** = `{ scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[] }` — one shape, many instances [#3,#13,#17→collapsed by #18].
- **Extensibility is the acceptance bar**: new modifier = register type + per-hole resolver; new game = register scope+counting+settlement. No schema/UI rework. [#24]

### Theme B — Money mechanics
- **Point value is game-level**, modifiers just yield points (usually 1) [#13].
- Point value is a **segmented schedule** ($5 front / $10 back; arbitrary ranges) [#14].
- Optional **cap** with "345" semantics: running tally uncapped + recoverable; payout clamped to cap; **always 2v2, 2 losers pay 2 winners**, capped per loser→winner pairing (max to one person) [#15,#18].
- Only **two settlement engines** survive: 2v2 pairwise (foursome-internal) + foursome-team aggregate (losers pay winners $/man) [#18].

### Theme C — The cascade (Event → Round → Foursome) + lock gate
- 3 inheritance levels; teams/players already change per round via pairings; 2v2 + modifiers resolve at the **foursome leaf** [#9].
- A **single admin lock** ("foursomes LOCKED to admin / UNLOCKED"), set when defining the standard 2v2 — coarse, not per-rule [#10,#19].
- **Default everything inherits → zero taps** is a hard requirement; power under a gate that defaults closed [#12].
- **Per-foursome variation is safe** because 2v2 money is foursome-internal — no cross-foursome reconciliation needed. The scope boundary is the invariant that contains the mess [#21].

### Theme D — Player self-service
- "Standard Guyan Game" = a real **seeded, editable named preset** (kills the dead "No rule set seeded" card) [#6].
- If unlocked, joined members get **"Adjust Guyan Game Rules"** for their own foursome, gated by (event unlocked) AND (player linked to a foursome via the H1 join flow) [#11,#20].

### Theme E — Output coupling
- Lock state selects the **leaderboard mode**: LOCKED → money/P&L + net standings (comparable trip-wide); UNLOCKED → gross/net score standings (per-day + trip), money stays private in each foursome's "My Money" board [#22,#23].

### The unified model (one diagram)
```
TWO settlement engines:
  • 2v2 pairwise   → foursome-INTERNAL · carries modifiers · pointValue(segmented) + optional cap
  • team aggregate → foursome-vs-foursome · per-hole win/lose · losers pay winners $/man · no modifiers
  + standalone contests → skins / CTP / putting (own pot)
  + peer bets (1v1)     → deferred to F1b

ONE config cascade, gated by a single admin lock:
  EVENT     seed "Standard Guyan Game" (2v2+modifiers+$/pt+cap) · LOCKED↔UNLOCKED toggle
   └ ROUND  admin sets daily team game · re-pairs foursomes
      └ FOURSOME  2v2 resolves · if unlocked, members "Adjust Guyan Game Rules"

game     = { scope, countingRule, pointValue-schedule, cap?, settlement, modifiers[] }
modifier = { type, enabled, variant }   // point-producer riding ONE base game
edits recompute (pure engines) · reconcile with immutable rule_set_revisions
leaderboard mode = locked ? MONEY+net : SCORES-only(+private My Money)
```

### Locked vs Unlocked — decision table
| | LOCKED (default) | UNLOCKED |
|---|---|---|
| 2v2 rules/stake | uniform from event rule set | each foursome may self-edit |
| Who edits | admin only | joined members, their own foursome |
| Money comparable across foursomes | yes | no (foursome-private) |
| Leaderboard | money/P&L + net standings | gross/net scores (per-day + trip) |
| My Money board | yes | yes (still per-foursome) |

### Open spec questions (for the PRD/architecture pass — prioritized)
1. **(BUILD-BLOCKER) Migration** off tenant-scoped `rule_sets` → Event/Round/Foursome config without breaking existing events.
2. **(BUILD-BLOCKER) Recompute ↔ immutable revisions**: retroactive "I made a mistake" correction vs the existing `effective_from_round/hole` forward-change machinery — which applies when.
3. Exact engine scoring defs: net-birdie point, gross sandie (up-and-down for par), greenie carryover (GIR+2-putt, accumulates across unwon par-3s, can pay on a non-par-3 hole) [#8].
4. Foursome-team game settlement details + whether it can ever carry modifiers (default: no).
5. Standalone contests (skins/CTP/putting) placement inside the unified "Rules & games" UI.
6. Data model: where foursome-level config rows live (attach to a round's pairing) + how the cascade resolver reads them.

### Recommended next step
Run **`/bmad-bmm-create-prd`** (or quick-spec for a thinner pass) scoped to **F1 — unified "Rules & games" config model**, using this doc as the input. Sequence the build: (1) config data model + cascade resolver + migration → (2) "Standard Guyan Game" seeded preset + admin rule-set create/edit UI + lock toggle → (3) modifier/game engine generalization (point-value schedule, cap, settlement plug) → (4) per-foursome self-service + leaderboard mode switch. F1b (player-driven 1v1 bets) and F2/F3 stay separate tracks.

## Session Summary & Insights

**Key achievements:**
- Reframed "add a rule_set_id column" into a principled 3-layer model (modifiers / games / peer-bets) with a registry-based extensibility bar.
- Discovered the **scope boundary (foursome-internal 2v2 vs group-wide team game)** is the invariant that makes per-foursome rule variation safe — no cross-foursome money reconciliation.
- Collapsed three apparent settlement models into **two engines** (the "345" cap is just a 2v2 with point-value + cap).
- Connected config → output: the admin **lock toggle drives the leaderboard mode** (money vs scores-only).
- Identified the real build-blockers (migration, recompute-vs-immutable-revisions) as spec work, not design unknowns.

**Session reflection:** Brainstorm-first was the right call — the domain detail Josh supplied (Standard Guyan Game, "345", greenie carryover, unlocked-trip leaderboards) reshaped the model three times in ways a straight-to-PRD pass would have missed.
