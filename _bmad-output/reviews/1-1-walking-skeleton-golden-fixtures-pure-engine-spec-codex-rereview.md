# Codex Review

- Generated: 2026-06-21T19:21:32.880Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md

## Summary

Most of the 9 prior findings appear addressed in the revised spec: AC6 now cleanly scopes code confinement to `apps/tournament-api` with only BMAD tracking artifacts outside; AC5 is split into a human approval gate + a CI-checkable golden-test invariant; AC2a and AC2c substantially pin the base hole-point money flow and point→cents; AC15 now correctly scopes the remainder-penny rule to the first real split use; AC1 now requires per-hole `holeNumber` and clarifies team split is once-per-foursome; AC17 makes `sourceId` caller-supplied; AC18 makes resolver semantics materially more precise; and `pointValueSchedule` is mostly corrected.

Two material ambiguities remain (net-birdie edge distribution and resolver merge order wording), and one minor regression exists (Task 2 still references the old invalid `pointValue-schedule` name).

Overall risk: medium

## Findings

1. [high] AC2b still leaves a concrete per-player-edge ambiguity for net-birdie (2 edges vs 4 edges; who receives when only one player birdies)
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:26-27
   - Confidence: high
   - Why it matters: You explicitly fixed the base hole-point distribution in AC2a, but AC2b still permits two materially different settlement interpretations:
- (A) “team bonus point” distributed like AC2a (4 cross-pair edges): both teammates receive from both opponents, even if only one player made net-birdie.
- (B) “player earns” interpreted as per-player bonus (2 edges): only the birdie-making player receives from each opponent.

The phrase “same pairwise rule as 2a” suggests (A), but “pays … to each net-birdie maker’s team side” + the open question (ii) (“both players … counts once per team”) leaves it unclear what happens when exactly one teammate birdies: does the non-birdie teammate still collect?

This is precisely the kind of ambiguity that can produce a correct-looking total but wrong `SettlementEdge[]` payees, undermining AC3’s ‘exact edges’ goal and making Josh sign-off harder (since hand calcs depend on the precise edge fan-out).
   - Suggested fix: Make AC2b state the edge fan-out explicitly. Example:
- If net-birdie is a TEAM bonus point: “A net-birdie bonus point is a team point; when awarded, it produces exactly 4 edges of `pointValueCents` (each player on the bonus team receives `pointValueCents` from each opponent), regardless of which teammate made the birdie.”
OR
- If net-birdie is a PLAYER bonus: “A net-birdie bonus point is individual; it produces exactly 2 edges of `pointValueCents` from each opponent to the birdie-making player.”

If you intend to keep it open pending Josh, add this as explicit open sub-question (iv) instead of implying a rule.

2. [medium] Resolver merge order wording is internally confusing (“Foursome→Round→Event” vs “most-specific-wins”)
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:57-58
   - Confidence: high
   - Why it matters: AC18 says “deep-merges most-specific-wins (Foursome→Round→Event)”. Read literally as an application order, that would apply Event last, causing the least-specific level to override more-specific levels—the opposite of “most-specific-wins.”

You likely mean the specificity hierarchy (Event < Round < Foursome) rather than merge application order, but this is a common source of implementation bugs in cascade resolvers.
   - Suggested fix: Rewrite to remove ordering ambiguity, e.g.:
- “Resolution starts from event config, overlays round, then overlays foursome (most-specific wins).”
Also align the parenthetical everywhere it appears (AC18 and Task 4).

3. [medium] Naming regression: Task 2 still references `pointValue-schedule` after AC7 corrected to `pointValueSchedule`
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:80-81
   - Confidence: high
   - Why it matters: The acceptance criteria correctly standardize on `pointValueSchedule` (AC7, line 37), but Task 2 says “`pointValue-schedule` (flat | front/back segmented)” (line 80). This reintroduces the exact drift risk you were eliminating: a dev could follow the task list and accidentally create a mismatched TS/JSON contract or invalid TS identifier.
   - Suggested fix: Update Task 2 text to `pointValueSchedule` (and optionally grep the spec for any remaining `point-value-schedule` / `pointValue-schedule` phrasing that could be misconstrued as the literal field name).

4. [low] Team split is described as once-per-foursome, but AC7 also implies it lives inside `holeState`
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:19-20
   - Confidence: medium
   - Why it matters: AC1 clearly says the team split is “once per foursome (constant across holes)” (line 19). AC7 then describes `holeState` as carrying “holeNumber + par + per-player net + the team split” (line 37). That can be implemented either way, but the spec currently implies both: team split as a per-foursome input and as part of the per-hole structure, which can lead to duplicated data in fixtures/types and accidental inconsistency checks later.
   - Suggested fix: Clarify the intended shape: either (a) `inputs.teamSplit` separate from `holes[]`, or (b) explicitly state that fixtures may repeat the same team split per hole for convenience but it must be identical across holes (validated).

5. [low] AC5’s “CI-mechanizable invariant” still implies an extra enforcement mechanism without specifying how it’s made true
   - File: _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md:32-33
   - Confidence: medium
   - Why it matters: AC5(b) claims: “a CI job fails if `engine/games/` settlement code exists with no passing golden test referencing it.” That outcome does not happen automatically in CI unless you add an explicit check (e.g., a test that asserts fixture presence, or a convention check that fails when `engine/games/**/*.ts` exists without `engine/games/**/*.test.ts`). As written, it’s directionally correct, but still underspecified as a guarantee.
   - Suggested fix: Specify the mechanism briefly, e.g.:
- “Add `engine/games/fixtures.smoke.test.ts` that loads all `__fixtures__/*.json` and fails if none exist, and the suite imports the `engine/games` entrypoints so missing/incorrect implementations fail.”
Or add a lint/test convention check in the test suite.

## Strengths

- AC6 now cleanly satisfies the boundary requirement and the ‘Files this story will edit’ list is confined to `apps/tournament-api/**` plus the two BMAD tracking artifacts (lines 145–165). No `apps/api`, `apps/web`, or `packages/engine` edits are listed.
- AC2a materially resolves the base hole-point per-player-edge ambiguity by explicitly requiring 4 cross-team pair edges per hole point and grounding it in the cited shipped convention (lines 24–25).
- AC2b is now explicitly labeled as PROPOSED and gated on Josh ratification + golden approval (lines 26–27, plus Task 1 line 74), avoiding “silently invented” semantics.
- AC15 now correctly scopes the remainder-penny rule to the actual division case (`amount % N != 0`) and explicitly notes it is inert for this base game (line 48), preventing accidental early application.
- AC17 makes `sourceId` a caller-provided input to `ledgerToEdges`, preserving purity and deterministic fixtures (line 53).
- AC18 substantially improves resolver precision (merge-by-modifier-type + lock gate) and requires both branches be golden-tested (line 57).

## Warnings

None.
