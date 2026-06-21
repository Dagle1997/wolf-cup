# Codex Review

- Generated: 2026-06-21T17:54:00.893Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

## HOLD — Epic 3 (Stories 3.1–3.4) has money-integrity blockers

### MUST-FIX
- **Story 3.3 AC (lines 678–686): pot funding is undefined.** You require exact `SettlementEdge[]` in the golden, but the spec never defines a **buy-in/stake** (per player? per team? per round?) or where it lives in `config_json`, so cents are **not derivable**.
- **Story 3.3 AC (lines 682–685): cross-round aggregation read-path is underspecified and likely incompatible with the engine’s per-foursome compute.** “Reusing the per-hole results the engine already computes” is not a concrete interface. The shipped context mentions an existing standings aggregator (`computeTeamStandings` / `computeFoursomeResults`), but Epic 3 does not commit to reusing it or define a new canonical aggregation API.
- **Story 3.3 + 3.4 AC (lines 684–685, 696–700): pot reads “global teams (3.1)” but pinning is only specified later and only per-round.** As written, 3.3 can ship reading **live** `teams/team_members`, violating **FR29 pinned snapshot** expectations and enabling retroactive drift.
- **Story 3.4 AC (lines 696–700): the pinned team snapshot storage shape is not specified.** It must be **by-value** (not FK to live rows) and deterministic (ordering), but the AC only says “populates that seam.”
- **Story 3.1 AC (lines 641–654): teams schema and invariants are undefined.** No columns, uniqueness constraints, team size (2-man vs N), one-team-per-player-per-event rule, reconciliation with the existing `teamKey = sorted playerIds` convention, or how “random” is persisted (one-time draw).
- **Story 3.3 AC (lines 680–686): tie/split rule is claimed “named” but not actually named/configured.** Also missing deterministic remainder-penny allocation rule for splits.
- **Story 3.3 AC (lines 685–686): fail-closed behavior for incomplete rounds/DNF is missing.** FR44 requires fail-closed for missing/untrustworthy inputs; the pot is inherently cross-round and needs explicit policy.

### SHOULD-FIX
- **Story 3.2 AC (lines 664–668): override scope is ambiguous** (does it change only pot rules? does it affect team membership? what UI/endpoint surfaces it?), and there’s no explicit assertion that overrides don’t create a second settlement path/double-count.
- **Story 3.3 AC (line 685): “capped/uncapped sums are conserved” references caps but no pot-cap config exists.** Either add a cap field + property tests, or remove cap language.
- **Ordering:** strongly consider **3.4 (pin teams) before 3.3 (settle pot)** to prevent any implementation that reads live teams.

### QUESTIONS
- Are global teams strictly **2-player** in Product A (needed for best-ball team pot and compatibility with existing standings), or can they be N-ary? If N-ary, how do you compute best-ball-vs-par and split winnings deterministically?
- If teams change mid-event, does the **team identity** persist (teamId stays same, membership changes) and standings use **per-round pinned rosters**, or does a membership change create a **new team identity**?

Verdict: **HOLD** until MUST-FIX items are specified, because real-money `SettlementEdge` cents, provenance (FR29), and fail-closed (FR44) are currently not implementable from the ACs without inventing rules ad hoc.


Overall risk: high

## Findings

1. [critical] Story 3.3 AC: Event pot has no stake/buy-in source → SettlementEdge cents are underivable
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:670-686
   - Confidence: high
   - Why it matters: A winner-take-all pot must have a defined monetary principal (buy-in/stake). The AC requires a golden fixture asserting exact `SettlementEdge[]` (line 680), but there is no config field or funding rule described anywhere in Story 3.3 to determine the pot’s cents. Implementers will be forced to invent a rule, which is unacceptable for real-money settlement and breaks NFR-C1/NFR-T1 traceability.
   - Suggested fix: Add explicit pot funding semantics and config shape in Story 3.3 AC: e.g. `teamPot: { enabled, buyInCentsPerPlayer | buyInCentsPerTeam | buyInCentsPerRound, settleWhen: 'final_round'|'each_round', payout: 'winner_take_all'|'split', tieRule: ... }`. Define exactly which participants fund the pot and how (including odd team sizes and missing players). Golden fixtures must cover funding + payout + remainder allocation.

2. [critical] Story 3.3 AC: Cross-round aggregation path is undefined and conflicts with the per-foursome compute model
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:682-685
   - Confidence: high
   - Why it matters: The engine described earlier is centered on `computeFoursome(itsOwnConfig, itsOwnInputs)` (per-foursome/per-hole). Story 3.3 says the pot “aggregates … across the event’s rounds (reusing the per-hole results the engine already computes)” but does not define what reusable per-hole artifact exists or how it is obtained without reimplementing scoring logic. This is a correctness and regression risk, especially given the locked context that a shipped `computeTeamStandings` already exists and is used by a live web page; Epic 3 currently neither references nor mandates reuse of that proven aggregator.
   - Suggested fix: Make the aggregation interface explicit in AC: either (A) reuse the shipped standings pipeline (name it and make it the single source of best-ball-vs-par results) and then apply pot funding/payout on top, or (B) introduce a pure `computeEventStandings(inputsByRoundByPlayer, teamsSnapshotByRound)` function in `engine/games/` (event-scope) and specify how `games-money.ts` collects inputs. Add golden fixtures asserting cross-round aggregation and a property test for order-independence across rounds.

3. [critical] Story 3.3/3.4 AC: Pot can ship reading live teams; pinned snapshot is not referenced by the pot story (FR29 risk)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:682-700
   - Confidence: high
   - Why it matters: Story 3.3 explicitly says the pot “reads global teams (3.1)” (line 685). Story 3.4 later says recompute reads the pinned team composition, not live rows (lines 698–700). As written, Story 3.3 can be implemented before the pinning guarantee exists, and nothing in 3.3 forces use of pinned snapshots. This violates the planning spec’s FR29 pinning expectation for money provenance and enables retroactive drift when organizers re-team.
   - Suggested fix: Change Story 3.3 AC to require reading **per-round pinned team snapshots** (not `teams/team_members`) for any round included in the pot computation. Reorder stories so **3.4 precedes 3.3**, or explicitly add a dependency in 3.3: “must not ship until pinned team snapshot is populated and used.” Add a regression test: team edit after pin does not change pot/standings for pinned rounds.

4. [high] Story 3.4 AC: Team snapshot storage is underspecified; must be by-value and deterministic
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:688-700
   - Confidence: high
   - Why it matters: The AC says the pin “populates that seam” (lines 696–699) but never defines the storage shape. If the snapshot is stored as foreign keys to `team_members`, later edits will mutate past rounds (data loss / provenance break). If it’s stored as JSON but without deterministic ordering, order-independence and stable hashing/comparison becomes fragile.
   - Suggested fix: Specify in Story 3.4 AC that the round pin stores a **by-value snapshot** such as `{ teamId: string, playerIds: string[] }[]` (or a canonical `teamKey`), with playerIds sorted, and includes any team display metadata needed for UI. Require a test that deleting/adding team_members does not change pinned snapshots and does not affect recompute for that round.

5. [high] Story 3.1 AC: `teams`/`team_members` schema lacks required uniqueness and semantic constraints (FR20/FR21 correctness risk)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:641-654
   - Confidence: high
   - Why it matters: Story 3.1 only states “`teams` + `team_members` are created” (lines 641–644) but does not define columns or invariants critical to settlement correctness: team size (2-man vs N), whether a player can be in multiple teams per event, uniqueness constraints, whether teams are per-event or per-tenant, and how this reconciles with an existing derived `teamKey = sorted playerIds` convention mentioned in context. Without this, both data integrity and deterministic recompute are at risk.
   - Suggested fix: Add explicit schema requirements to the AC: at minimum `teams(id, event_id, name?, created_by, created_at, …ecosystem)` and `team_members(team_id, player_id, event_id, position?, …)` with uniques like `(event_id, player_id)` to enforce one team per player, and `(team_id, player_id)` to prevent duplicates. If teams are strictly 2-man in Product A, enforce it at write-time validation. Define a canonical `teamKey` (sorted ids) and whether it’s stored or derived.

6. [high] Story 3.1 AC: “random” team formation is not specified as persisted/one-time; risks reroll-on-read and audit gaps
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:646-654
   - Confidence: high
   - Why it matters: FR20 ‘random’ must produce a stable team assignment that can be audited and does not change across reads. The AC says teams can be formed via random (line 648) but does not specify persistence, seeding, or idempotency. In real-money contexts, rerolling teams implicitly changes downstream money/standings and undermines trust.
   - Suggested fix: Specify: random formation is executed once and persisted as concrete `teams/team_members` rows in a single audited tx; include an explicit `random_seed` captured in audit metadata or config snapshot for reproducibility. Add a test ensuring repeated reads do not change the team assignment.

7. [high] Story 3.3 AC: tie/split rule is asserted as “named” but the rule/options are not actually defined (determinism + remainder cents)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:678-686
   - Confidence: high
   - Why it matters: The pot golden requires a named tie/split rule (line 680), but Story 3.3 never states what the rule is (split equally across tied teams? playoff? carryover? no payout?). Without an explicit rule and remainder-cent allocation rule, implementers will choose ad hoc behavior, breaking FR42/NFR-C7 and causing disputes.
   - Suggested fix: Add explicit tie-handling semantics to 3.3 AC and config: e.g. `tieRule: 'split_evenly'|'no_payout'|'carryover'` plus deterministic remainder allocation (reuse the global lowest-playerId-first rule already established in Epic 1). Include at least one golden fixture with a tie.

8. [high] Story 3.3 AC: Event pot fail-closed rules for incomplete/DNF rounds are missing (FR44)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:682-686
   - Confidence: high
   - Why it matters: FR44 requires games to fail closed when required data is missing/untrustworthy (DNF/pickup/incomplete holes). The event pot aggregates across rounds; if any round is incomplete, you must define whether the pot excludes that round, marks the whole pot unsettleable, or marks only some teams unsettleable. The AC is silent, inviting silent partial settlement.
   - Suggested fix: Specify in 3.3 AC: which conditions cause the pot to be unsettleable (e.g. any included round unsettleable → pot unsettleable; or pot settles only over finalized/complete rounds). Add a fixture where one round is incomplete and assert fail-closed behavior + surfaced reason.

9. [medium] Story 3.2 AC: Round override is underspecified (UI/route, what exactly is overridden, and testability)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:656-668
   - Confidence: medium
   - Why it matters: FR9 is covered, but the AC only states a round-level `game_config` row is written and pinned (lines 664–668). It does not specify the admin surface/endpoint, how ‘team game’ differs from ruleset in config shape, or how this interacts with event-pot aggregation. Missing details increase the chance of inconsistent override semantics and untestable acceptance.
   - Suggested fix: Name the endpoint(s)/page(s) (mirroring Story 1.3 conventions), specify which config fields are allowed at round scope (including enabling/disabling the pot), and add at least one explicit regression assertion: round override changes only that round’s settlement inputs and does not affect other rounds.

10. [medium] Story 3.3 AC: Mentions “capped/uncapped sums” but no pot cap is defined
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:684-686
   - Confidence: high
   - Why it matters: Line 685 claims “capped/uncapped sums are conserved,” but Story 3.3 does not define a pot cap field nor a cap resolution rule for the pot. This is ambiguous and risks either shipping an untested cap behavior or falsely claiming an invariant without a mechanism.
   - Suggested fix: Either (A) remove cap language from the pot story, or (B) define pot cap config + deterministic cap resolution and add a property test analogous to Story 2.6 but scoped to the pot game instance.

## Strengths

- Epic 3 correctly preserves the architectural boundary that intra-foursome 2v2 teams remain derived (Story 3.1 AC, lines 643–645).
- Story 3.4 explicitly states recompute should read pinned composition rather than live team rows (lines 698–700), which is the right provenance direction.
- Story 3.3 keeps the golden-fixture hard gate requirement for real money (lines 678–681).

## Warnings

None.
