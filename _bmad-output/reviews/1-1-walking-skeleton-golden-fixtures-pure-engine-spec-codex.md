# Codex Review

- Generated: 2026-06-21T19:15:14.255Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md

## Summary

The spec is strong on intent (golden fixtures, purity, reuse of existing SettlementEdge seams, out-of-scope boundaries), but several key behaviors are still underspecified in ways that could yield incompatible yet “AC-compliant” implementations. The biggest risks are (1) the hard gate (NFR-C1) is not actually enforceable as written, (2) core Guyan money-flow semantics (team result → per-player edges, net-birdie interaction with halves) are ambiguous, and (3) the story’s own path allowlist is violated by the declared edit list.

Overall risk: high

## Findings

1. [critical] FD-1/FD-2 boundary violation: story declares edits outside apps/tournament-api while AC6 claims confinement
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:24-154
   - Confidence: high
   - Why it matters: AC6 states “All work is confined to `apps/tournament-api`” (line 24), but the “Files this story will edit” list explicitly includes `_bmad-output/...` (the spec itself) and `_bmad-output/.../sprint-status.yaml` (lines 152–154). This creates a direct contradiction and weakens the FD-1/FD-2 guarantee (a dev could reasonably treat non-tournament paths as allowed).
   - Suggested fix: Either (a) update AC6 to explicitly permit `_bmad-output/**` artifacts as an exception, or (b) remove non-`apps/tournament-api/**` files from the declared edit list and handle them outside story execution. If the intent is strict confinement, the edit list should contain only `apps/tournament-api/**` paths.

2. [high] NFR-C1 “golden-first hard gate” is not actually CI-enforceable as specified
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:17-79
   - Confidence: high
   - Why it matters: AC5 requires “No settlement engine code is written or committed before that fixture set is approved by Josh (CI-enforced)” (line 23), but the spec only describes a manual pause (Task 1 bullet, lines 69–70) and `_handCalc` as an “approval artifact” (lines 83–85). There is no concrete, machine-checkable criterion for “approved by Josh” nor a CI rule that prevents commits touching `engine/games/*.ts` before fixtures are approved. In practice, this gate can be bypassed while still claiming compliance.
   - Suggested fix: Make the gate mechanically enforceable. Examples: require a fixture field like `approvedBy` + `approvedAt` (or a signed checksum) and a CI check that blocks changes under `apps/tournament-api/src/engine/games/**/*.ts` unless all fixtures in the PR contain approval metadata; or require two PRs with branch protection (fixtures-only PR must merge first), documented as an explicit AC with a CI rule.

3. [high] Core settlement semantics are ambiguous: team-low result and net-birdie points do not uniquely determine per-player SettlementEdge[]
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:19-109
   - Confidence: high
   - Why it matters: The spec defines (a) team-low-net decides the hole-win point (lines 20, 105–107) and (b) net-birdie is per-player net vs par (lines 11, 107–108), but it does not uniquely specify how to convert those facts into per-player money transfers. Several incompatible interpretations exist that would all seem “reasonable”:
- If Team A wins the hole, do both losers each pay the full point value to the team, or half, or do losers pay only to the low player, or split among winners?
- If both winners tie for team-low within the team, who receives the hole-win point value (split? remainder rule?)
- Net-birdie: does it pay from both opponents to that player, from the opposing team as a lump split, or only if the player is the team-low? Can both teammates earn net-birdie on the same hole (seems yes from line 107, but not explicit)?
- If the hole is halved (line 20, 106–107), do net-birdie bonus points still apply, or are they suppressed by the “push”?
Because AC3 asserts edges (line 21), the fixtures can paper over ambiguity, but the story goal explicitly calls out ambiguity avoidance; without explicit rules, later fixtures/variants can diverge or refactors can “break” without a clear spec violation.
   - Suggested fix: Add explicit, named money-flow rules for both components:
- Define the exact payer/payee topology for a hole-win (e.g., “each losing player pays (pointValue/2) to each winning player” or “each losing player pays pointValue/2 to the team pot which is split among winners by rule X”).
- Define within-team tie handling for selecting the “low” and how payouts split.
- Define net-birdie payout topology and whether it is independent of hole result/halves.
- Define whether net-birdie uses the same per-hole pointValue schedule or a separate value/schedule.

4. [high] Remainder-penny rule is named but application points are underspecified (can change outcomes)
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:39-109
   - Confidence: high
   - Why it matters: AC15 says remainder pennies allocate by “lowest-playerId-first” (line 39), but does not define where/when splits happen. Different split topologies (team→players then opponents→winners vs. per-edge splitting directly) and different rounding stages can yield different edge sets even with the same total. Since AC3 pins exact edges, the engine must match the exact same splitting/rounding pipeline used in the hand-calcs; without a specified pipeline, two devs could implement differently and both appear to satisfy the high-level rules.
   - Suggested fix: Specify a single canonical splitting pipeline (and apply the remainder rule at defined stages). Example: “Compute per-hole amounts in cents; for each hole, compute per-player deltas; then convert deltas to edges via netPairwise; remainder rule applies only when splitting an integer cent amount across N recipients/payers at stage S.” Include this pipeline in AC15/Dev Notes and mirror it in `_handCalc` templates.

5. [medium] Segment→hole boundary and 9-hole-round behavior depends on hole numbering, but input contract doesn’t explicitly include holeNumber
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:22-108
   - Confidence: high
   - Why it matters: AC4/Dev Notes state segmentation maps by “course hole number” (front 1–9, back 10–18) and 9-hole rounds use front only (lines 22–23, 108–109). However, AC1 describes per-hole inputs as par/net/team split (line 19) without mentioning hole number. Implementations could infer holeNumber from array index, but for a 9-hole round (or any partial/filtered set), index-based mapping can disagree with “course hole number,” especially if the input supports arbitrary hole subsets later.
   - Suggested fix: Make `holeNumber` (1–18) an explicit field in `holeState` / fixture inputs, and define 9-hole rounds as explicitly holes 1–9 (or allow specifying which 9 via holeNumber list). Ensure fixtures include holes 9 and 10 to assert boundary behavior unambiguously.

6. [medium] Resolver deep-merge and lock_state gate semantics are not defined precisely (arrays/modifiers + lock behavior)
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:48-73
   - Confidence: high
   - Why it matters: AC18–AC20 require deep-merge “most-specific-wins” plus `lock_state` gating and fail-closed behavior (lines 48–51). But key details are open:
- How are arrays merged (notably `modifiers[]`)? Replace entire array? Concat? Merge by `modifier.type`? Different strategies materially change behavior.
- What exactly does the lock gate do during resolution? Does a locked event prevent round overrides, or does it prevent resolution entirely, or does it freeze to a stored snapshot (which is DB-dependent and out-of-scope in 1.1)?
- “returns unsettleable + surfaced” (line 50) doesn’t define whether this is an exception, a tagged union, or an error list; tests can’t be written consistently without this.
These ambiguities risk forward dependency on Story 1.2 schema semantics and can lead to incompatible resolvers.
   - Suggested fix: Define:
- Merge semantics for `modifiers[]` explicitly (recommend merge-by-type with most-specific overriding fields).
- Enumerate `lock_state` values and the exact gating rule (e.g., “if event is locked, ignore round/foursome rows and surface warning X” or “if locked and override exists, fail closed with reason”).
- Define resolver return type (e.g., `{ok:true, config}` | `{ok:false, errors:[...]}`) so “fail closed” is testable without DB assumptions.

7. [medium] SettlementEdge requires sourceId but sourceId derivation/input is undefined (purity + determinism risk)
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:44-76
   - Confidence: high
   - Why it matters: AC17 requires edges include `sourceType: 'f1_game', sourceId` (line 44), but the spec never defines what `sourceId` is (game type? event/round/foursome composite? fixture name?) or how it is provided. If a dev generates it (UUID, timestamp) it violates purity/determinism (AC8/AC13). If omitted, it violates AC17. Fixtures also need to assert it if it’s part of the edge object.
   - Suggested fix: Define `sourceId` explicitly and make it a required input to `ledgerToEdges` (and/or compute) so callers supply it deterministically (e.g., `${eventId}:${roundId}:${foursomeId}:${gameType}` or a passed-in stable ID). Ensure golden fixtures assert `sourceId` exactly (or explicitly state it is excluded from equality assertions, but that weakens AC3).

8. [low] `pointValue-schedule` naming is not a valid TS identifier and may cause JSON/TS contract drift
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:28-33
   - Confidence: medium
   - Why it matters: AC7/AC9 repeatedly refer to `pointValue-schedule` (lines 28–33). If this is intended as an actual field name in TS types and JSON fixtures, the hyphen forces quoted access and increases the chance different modules choose different names (`pointValueSchedule`, `pointValue`, etc.), breaking resolver merges and fixture parsing in subtle ways.
   - Suggested fix: Pick one canonical field name (recommend `pointValueSchedule`) and state it explicitly as the contract name used in TS + fixtures. If you intend to keep hyphenated JSON, specify the mapping layer and where it lives (but that adds complexity for a foundation story).

9. [low] Team split described as per-hole input in AC1, but elsewhere implies per-foursome; clarify scope
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:19-37
   - Confidence: high
   - Why it matters: AC1 says fixtures supply “as GIVEN inputs per hole… the intra-foursome team split” (line 19), while AC12/Dev Notes imply the team split is a foursome-level structure fed by `resolveFoursomeTeams` (lines 36–37, 90–91). Per-hole team splits introduce unnecessary complexity and an easy divergence point for later variants (Epic 2 Wolf, etc.).
   - Suggested fix: Define team split as a per-foursome (round-constant) input for Story 1.1; if you want to future-proof for variants, explicitly note that per-hole split changes are out of scope for 1.1 and will be introduced later with a different game type/modifier.

## Strengths

- Clear separation of concerns and purity constraints (no db/Date/random) with explicit out-of-scope items (lines 111–113).
- Good reuse of existing, verified seams (`SettlementEdge`, fixture shape, `netPairwise`, deterministic sorting) which reduces invention risk (lines 86–90).
- Golden fixtures assert exact `SettlementEdge[]` rather than totals, which is appropriate for catching payee/direction/rounding regressions (line 21).
- Property-test intent (isolation, loss-less, order-independence) aligns with stated NFRs and helps prevent subtle regressions (lines 52–55).

## Warnings

None.
