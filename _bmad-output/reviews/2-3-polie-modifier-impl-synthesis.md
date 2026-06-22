# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-22T17:14:54.709Z
- Synthesized sources: codex-review, gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: (prior outputs only)

## Verdict

**SHIP** — confidence: high

## Executive summary

Decision: whether Story 2.3 Polie modifier implementation has a money-correctness risk due to threading `grossStrokes` into `HoleState.gross` without a runtime type guard. Based on the critiques, the only alleged issue is effectively defense-in-depth: existing schema + arithmetic usage + an end-to-end test make a reachable money bug unlikely. Verdict: ship now; consider an optional guard/coercion follow-up.

## High-confidence findings (consensus)

1. [low] End-to-end test coverage demonstrates gross is threaded and the polie gate behaves as intended
   - File: games-money.polie.test.ts (mentioned in critiques)
   - Affirming sources: codex-critique-of-gemini, gemini-critique-of-codex
   - Summary: Both critiques assert the existing end-to-end test proves `gross` is threaded through the relevant compute path and the bogey-or-better gate yields the expected payouts/voiding behavior. This undercuts the notion of a currently reachable correctness gap in the shipped behavior.
   - Recommended action: No blocking action. Ensure the referenced test remains in CI and covers the intended scenarios (eligible polie pays, double-bogey voids, gate-off counts, disabled neutral).

## Divergent findings (need resolution)

1. Missing runtime type guard on grossStrokes could fail-closed and void all gated polies if non-number leaks in
   - Codex-review flagged a Medium risk: service copies `grossStrokes` into `HoleState.gross` without runtime validation; if `grossStrokes` were non-numeric, the bogey-or-better check could fail-closed and void gated polies. Gemini’s critique says the scenario is effectively unreachable due to schema + arithmetic context, making a guard redundant; codex’s critique narrows it to an unlikely numeric-string edge and downgrades to optional defense-in-depth.
   - Positions:
     - **codex-review** (raise): “1 Medium: Service→engine gross threading is brittle to non-number grossStrokes and could silently void all gated polies (fail-closed). settleFoursome copies s.grossStrokes into HoleState.gross without a runtime assertion. Suggested fix: validate grossStrokes is a finite number in the service + add a service test proving a gated polie survives computeF1EventEdges.”
     - **gemini-critique-of-codex** (disagree): “DISAGREES with codex's Medium: the concern ignores the database schema guarantees (integer column) and the surrounding arithmetic context (grossStrokes used in net = grossStrokes - strokes) that make a runtime type check redundant.”
     - **codex-critique-of-gemini** (downgrade): “Remaining risk is narrower + non-blocking: a numeric-STRING grossStrokes would let base net work (JS - coercion) but void the polie gate (typeof check). Schema integer column makes this unlikely → optional defense-in-depth, not a blocking gap.”
   - Synthesizer lean: Lean: non-blocking/optional. Given (a) schema is an integer column, (b) `grossStrokes` is used arithmetically immediately adjacent (which would already surface/type-coerce issues), and (c) an end-to-end test reportedly exercises correct gate behavior, there is no strong evidence of a reachable money-correctness bug. A runtime guard/coercion is still reasonable defense-in-depth but not a hold.

## Dismissed findings

1. Need a service test proving a gated polie survives computeF1EventEdges
   - Raised by: codex-review
   - Dismissal reason: disagreed_with_justification
   - Reasoning: Codex-review requested adding such a test, but codex’s critique states: “the end-to-end test DOES prove gross is threaded ... and the gate behaves as intended,” implying the requested evidence already exists (games-money.polie.test.ts).

## Prioritized actions

1. [optional] Add a small runtime assertion/coercion at the service boundary when assigning `HoleState.gross` (e.g., `const gross = Number(s.grossStrokes); if (!Number.isFinite(gross)) throw/...;`) to harden against unexpected type drift (e.g., numeric strings) and make failures loud instead of silently fail-closed.
2. [optional] If keeping current behavior, add/retain a focused unit test for the specific type-drift scenario (numeric-string gross) to document intended semantics (either accept via coercion or intentionally void).
3. [optional] Track the two low-priority items mentioned in codex’s critique separately: numeric-string mismatch risk (if relevant beyond polie) and whether `parByHole ?? 0` masking missing par is acceptable for NFR-C1.

## Open questions (for human judgment)

- Product/engineering preference: should unexpected `grossStrokes` types (e.g., numeric strings) be coerced and accepted, or should the system throw/flag to avoid silently changing modifier outcomes?
- Is there any runtime ingestion path (outside drizzle schema enforcement) where `grossStrokes` could be non-integer/non-number (e.g., external API payloads, manual migrations, CSV imports)? If yes, defense-in-depth becomes more important.

## Warnings

None.
