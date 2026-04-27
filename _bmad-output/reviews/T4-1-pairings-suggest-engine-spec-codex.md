# Codex Review

- Generated: 2026-04-27T20:43:41.243Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md

## Summary

Spec is mostly testable, but a few key ambiguities/conflicts will block a clean implementation and make the ACs internally inconsistent (notably: how many foursomes per round is derived, how “partial grid” is represented, and whether the greedy heuristic is required to *guarantee* everyone-once for 8×4×4). Pin semantics are directionally good UX, but several edge cases are unspecified.

Overall risk: medium

## Findings

1. [high] Grid shape / foursomes-per-round is undefined, making ACs ambiguous and affecting everyone-once feasibility
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:78-127
   - Confidence: high
   - Why it matters: The input lacks “players per round” or “foursomes per round”. Yet AC#2 assumes exactly 2 foursomes/round for an 8-player roster (line 104-107), and Risk §6 references `foursomesPerRound` (line 57) which is not defined anywhere. Without a defined derivation rule (e.g., `foursomesPerRound = ceil(roster.length / foursomeSize)` vs exact division, or “each round includes all roster players exactly once”), implementations may differ and tests won’t be portable.
   - Suggested fix: Explicitly define how many foursomes exist each round and whether every player must be scheduled each round. Example: “Each round schedules every roster player exactly once; number of foursomes per round is `ceil(roster.length / foursomeSize)`; last foursome may be underfilled (and how that is represented).” Or add `numFoursomesPerRound` to input if it must be fixed.

2. [high] "partial grid" conflicts with the type contract `playerIds.length === foursomeSize`
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:86-123
   - Confidence: high
   - Why it matters: AC#6 requires returning a “partial grid” for insufficient roster (line 120-123), but the `PairingsGrid` contract states `playerIds: string[]; // length === foursomeSize` (line 91). With only 2 players and foursomeSize 4, the function cannot satisfy both. This will force either invalid typing, dummy placeholders, or divergent interpretations.
   - Suggested fix: Pick one: (a) allow underfilled foursomes: `playerIds: Array<string | null>` with fixed length, or `playerIds: string[]` with `length <= foursomeSize`; or (b) define that insufficient roster still returns a full-length array with explicit placeholder sentinel values and document them. Update AC#6 and tests accordingly.

3. [high] Everyone-once requirement (AC#2) may not be guaranteed by the specified greedy heuristic; spec says “backtracking” but steps don’t define it
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:25-35
   - Confidence: high
   - Why it matters: AC#2 mandates that for 8 players × 4 rounds × size-4, the engine must produce a grid with all C(8,2)=28 pairs met and no warnings (line 104-107). The algorithm described (“minimize the maximum pair-meeting count so far”, line 31) is a heuristic and can get trapped in a locally balanced state that leaves one pair unmet at the end, depending on tie-breaks. Risk §3 header says “greedy with backtracking” (line 25) but the numbered steps do not actually specify a backtracking/repair mechanism beyond emitting warnings (line 32). That’s a mismatch: either the algorithm must guarantee success for the canonical case, or AC#2 needs softening.
   - Suggested fix: Either (1) specify a deterministic repair/backtracking step sufficient to guarantee a solution for 8×4×4 (e.g., bounded backtracking when remaining-unmet pairs exist), or (2) use a known deterministic construction for the 8×4×4 everyone-once schedule (precomputed pattern) and fall back to greedy for other sizes, or (3) relax AC#2 to allow warnings / best-effort for everyone-once.

4. [medium] Insufficient-roster warning definition is mathematically unclear and references an undefined variable
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:52-59
   - Confidence: high
   - Why it matters: The warning text definition includes: `when roster.length < numRounds * foursomesPerRound * foursomeSize / numRounds` (line 57), which simplifies to `roster.length < foursomesPerRound * foursomeSize` but `foursomesPerRound` is not defined. The phrase “not enough players to fill any single round” implies a per-round capacity rule that is currently unspecified.
   - Suggested fix: Define `need` precisely (likely `need = foursomeSize` for “can’t fill even one foursome”, or `need = foursomesPerRound * foursomeSize` if the intent is “can’t fill a full round”). Then ensure AC#6 matches the rule (line 120-123).

5. [medium] AC#8 says “at least 5 tests” but story asks for 7+ golden-file tests; internal consistency issue
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:128-138
   - Confidence: high
   - Why it matters: The review request and earlier text calls for “7+ golden-file tests” but AC#8 says “at least 5 tests pass” (line 130) while listing A–G (7 tests). This inconsistency invites under-testing or disputes at acceptance.
   - Suggested fix: Make the minimum explicit and consistent: change AC#8 to “at least 7 tests pass” (or keep 5 but adjust the list). If golden/snapshot fixtures are required, state that explicitly as well.

6. [medium] Pin edge cases not fully specified (overflow pins, duplicate within same foursome, same player pinned multiple times in same round+foursome)
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:41-49
   - Confidence: medium
   - Why it matters: Pins are “first available slot” (line 44), and duplicate player pinned to two foursomes in same round is handled (line 46). But cases like >foursomeSize pins for the same (round,foursome), pinning the same player twice in same (round,foursome), or pinning players already placed via another pin (cross-round duplicates are allowed, line 45) are not exhaustively specified. Without this, deterministic behavior and warning enumeration can diverge between implementations.
   - Suggested fix: Add explicit rules + warnings for: (a) pin causes over-capacity in a foursome; (b) duplicate identical pin tuple; (c) a pin attempts to place a player already pinned elsewhere in the same round (even same foursome). Also state pins are processed in the given array order (implied by “first encountered”, line 46) as part of the determinism contract.

## Strengths

- Everyone-once verification approach is concrete and testable: explicitly loop over all C(8,2)=28 pairs (AC#2 line 104-107, AC#8A line 131-132).
- Determinism requirements are explicit and easy to assert (AC#3 line 108-111; Risk §4 line 37-40).
- Pin handling UX choice (drop + warning, never throw) is coherent with the stated UI goals (Risk §5 and Dev Notes line 176).
- Warning-string enumeration as a stable contract is clearly listed (Risk §6 line 50-59), which makes golden tests feasible.
- Path allowlist is explicit and narrow (Risk §7 line 61-69), and “no SHARED edits” is clear (AC#12 line 151-153).
- 1-indexed public contract is stated consistently for round/foursome fields (AC#1 line 83-94; Dev Notes line 174-175).

## Warnings

None.
