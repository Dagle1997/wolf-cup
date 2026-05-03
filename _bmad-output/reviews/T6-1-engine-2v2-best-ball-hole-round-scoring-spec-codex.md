# Codex Review

- Generated: 2026-05-03T12:47:19.650Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md, apps/tournament-api/eslint.config.js, apps/tournament-api/src/services/handicap.ts, packages/engine/src/stableford.ts, packages/engine/package.json

## Summary

Spec is thorough on file footprint, integer-cents, and pairwise attribution, and it correctly identifies the @wolf-cup/engine import/export mismatch. However, several acceptance criteria are internally inconsistent or under-specified in ways that could cause incorrect money totals, ambiguous bonus behavior, and drift vs the referenced Wolf Cup handicap-stroke semantics. There are also likely layering/boundary concerns with engine code importing from services.

Overall risk: high

## Findings

1. [high] AC-10 defines teamTotalCents inconsistently ("sum of all positive pair cells" cannot be negative) and risks wrong round totals
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:234-242
   - Confidence: high
   - Why it matters: AC-10 says: “the sum of all positive pair cells equals perRound.teamTotalCents (signed: positive = team A net winning)” (line 237), but teamTotalCents is explicitly signed and can be negative when team B wins overall. “Sum of positive cells” is always ≥ 0, so this can’t hold in losing scenarios. The later formula (lines 239–241) correctly defines teamTotalCents as the sum of A→B directed cells, which can be negative. This ambiguity can lead to implementations that compute the wrong round total (especially if a developer tries to literally follow the “positive cells” wording).
   - Suggested fix: Rewrite AC-10 to use one unambiguous invariant, e.g. “perRound.teamTotalCents = sum over directed cross-team cells from teamA players to teamB players (A1→B1, A1→B2, A2→B1, A2→B2), which may be negative”, and separately assert anti-symmetry implies total over all directed cells is 0.

2. [high] Sandies acceptance criteria conflict on whether sandiesApplied can be true on tied holes
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:202-213
   - Confidence: high
   - Why it matters: AC-4 states on ties “sandiesApplied may still be true (informational) but does NOT add money on a tie” (line 205). AC-5 defines sandies as applying only when “a winning-team player made par (or better) from a bunker… base hole was already won by that team” (lines 208–211), implying sandiesApplied should be false on ties/losses. This is a behavioral fork: either sandiesApplied is an “occurred” flag independent of payout, or it is a “paid” flag. Without resolving, fixture expectations and telemetry counts (“sandies count”) can diverge.
   - Suggested fix: Decide and document one meaning: either (A) `sandiesOccurred` (true even on ties/losses) vs `sandiesPaid` (only on wins), or (B) keep `sandiesApplied` but explicitly define it as “paid” and require it to be false on ties/losses. Update AC-4/AC-5 accordingly and specify how perRound sandies count is computed.

3. [high] Greenie winner selection is conceptually incorrect/ambiguous ("closest-to-pin" cannot be derived from grossStrokes)
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:214-218
   - Confidence: high
   - Why it matters: AC-6 says: “When MULTIPLE winning-team players are eligible: the closest-to-pin (smallest gross-strokes) wins; ties break alphabetically by playerId” (line 217). “Closest-to-pin” is not measurable from the provided inputs; grossStrokes is not a proxy for proximity and will bias toward better putting/score rather than proximity. Implementers may interpret this differently (min gross, min putts, random, first in array), breaking determinism and/or differing from intended rules.
   - Suggested fix: Replace “closest-to-pin” with a rule derived from available inputs (e.g., “lowest putts”, or “lowest grossStrokes”, or “lowest netStrokes”), and state the exact comparator order. If true CTP is required later, add an explicit `ctpRank`/`distanceToPin` input and keep this story’s rule deterministic.

4. [medium] Inline-port of getHandicapStrokes: negative handicap (plus-handicap) behavior is explicitly listed but not specified precisely; modulo with negative CH is tricky
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:64-79
   - Confidence: high
   - Why it matters: The proposed port (lines 66–78) uses `base = Math.floor(ch / 18)` and `extra = ch % 18`. In JS, `%` preserves sign, so negative `ch` yields negative `extra`, and `strokeIndex <= extra` will almost always be false, producing a constant negative stroke count equal to `floor(ch/18)`. AC-13 includes a “negative HI (plus-handicap)” case (line 256) but says “clamped or signed per calcCourseHandicap semantics” without pinning expected outputs. That’s a recipe for untested divergence and inconsistent net scoring for plus-handicap players.
   - Suggested fix: Add explicit ACs for plus-handicap: define whether negative CH should (a) allocate negative strokes across the *hardest* holes, (b) be clamped to 0, or (c) follow Wolf Cup’s current `%` semantics exactly. Then encode that expectation in the unit tests with concrete numbers (course inputs + expected strokes for SI 1..18).

5. [medium] Spec implies skipping holes with missing player scores, but this behavior is not in Acceptance Criteria and conflicts with input contract wording
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:163-165
   - Confidence: high
   - Why it matters: Input is described as `holeScores: ... // every player's every hole` (line 164), but later the spec states the per-hole loop “SKIPS holes where any of the 4 ... players has no hole_scores row” (lines 346–347). Skipping vs throwing vs emitting partial results materially affects money, perHole length, and determinism (especially when score entry is in-progress). If not nailed in ACs and fixtures, different developers may implement different behavior.
   - Suggested fix: Add an AC that explicitly defines behavior when any of the four players is missing a score for a hole: skip, throw, or treat missing as DQ/max strokes. Add at least one fixture/test for the chosen behavior (even if minimal).

6. [medium] Types for HoleResult/RoundResult/PairLedger are referenced but not defined exactly, increasing fixture/implementation drift risk
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:171-175
   - Confidence: high
   - Why it matters: AC-1 defines the top-level output shape but not the exact TypeScript types for `HoleResult`, `RoundResult`, `PairLedger`, or the greenie award object type. AC-3/6 show example literals, but example-by-example specs tend to drift: developers may add extra fields (breaking golden fixtures) or omit expected telemetry fields (sandies/greenies counts) because their shape is not pinned.
   - Suggested fix: Add explicit type definitions in AC-1/AC-2 for `HoleResult`, `RoundResult`, `GreenieAward`, and `PairLedger` (including whether zero-value cells must be present, and whether both directions must be explicitly present to satisfy anti-symmetry checks).

7. [medium] Engine/service layering: best-ball spec allows importing ../../services/handicap.js from engine code, which is a cross-layer dependency
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:176-179
   - Confidence: medium
   - Why it matters: The story frames `src/engine/**` as a pure, reusable rules engine. AC-1 explicitly allows imports from `../../services/handicap.js` (line 178), and `handicap-strokes.ts` imports from `../services/handicap.js` (line 67). Even if `services/handicap.ts` is currently pure, this creates a fragile coupling: future service-layer changes (logging, config, DB access) could silently contaminate engine purity and violate FD-1/FD-2 intent.
   - Suggested fix: Prefer keeping engine independent of `src/services/**`: either (a) move the pure handicap math into `src/engine/` (a local copy of calcCourseHandicap) and have services import engine, or (b) define a tiny pure module in `src/engine/` that both can share. If you keep the dependency, add an explicit architectural note/AC that `services/handicap.ts` must remain pure/no-IO and is treated as engine-safe.

8. [medium] Sandies rule is under-specified given available inputs: must clarify whether “par or better” is gross or net and how sandyFromBunker is validated
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:115-133
   - Confidence: high
   - Why it matters: The input only provides `sandyFromBunker?: boolean` plus gross strokes and hole par (lines 123–132). The spec says “made par (or better) from a bunker” (line 115) but doesn’t explicitly state whether that’s gross par/better (traditional sandy) vs net par/better. Implementations could mistakenly pay sandies on a gross bogey that becomes net par via strokes, which changes payouts and will be hard to detect without explicit tests.
   - Suggested fix: Add an AC stating the exact condition, e.g. `sandyFromBunker === true && grossStrokes <= par` (gross-based) or net-based if intended. Add at least one fixture that would differ under the two interpretations.

9. [low] Import-boundary discussion is correct, but AC-1’s allowed-import list includes node:assert in production module which is unusual and may hinder reuse
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:176-179
   - Confidence: medium
   - Why it matters: AC-1 allows `node:assert` to be imported by `best-ball-2v2.ts` (line 178). If the engine is meant to be portable across runtimes or reused in non-node contexts, pulling in node-only modules is a constraint. Even within node, using assert in runtime code can produce less controlled errors than explicit validation exceptions.
   - Suggested fix: Keep `node:assert` usage confined to test files; in runtime engine code, throw `TypeError`/`RangeError` with explicit messages (as the spec already mentions at line 324). If assert is required, document that engine runtime is Node-only.

## Strengths

- Clear identification of the eslint allowlist vs package exports mismatch and a practical ALLOWED-only mitigation (inline-port) (spec lines 38–52; eslint config lines 14–23; engine package.json lines 6–11).
- Explicit integer-cents invariant and planned integer assertions (spec lines 83–92, 243–247, 326–331).
- Pairwise attribution and anti-symmetry are explicitly called out as an epic-wide convention and tested (spec lines 93–113, 229–233).
- Golden-fixture approach (6 fixtures) plus determinism replay test provides strong regression protection if the ambiguous parts above are clarified (spec lines 258–284).

## Warnings

None.
