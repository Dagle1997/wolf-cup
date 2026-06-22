# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-22T15:17:57.159Z
- Synthesized sources: codex-review-rereview2, gemini-review-rereview2, codex-critique-of-gemini-round1
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: (prior outputs only)

## Verdict

**SHIP** — confidence: high

## Executive summary

Decision: whether the Story 2.2 greenie modifier (stateful carryover) money-engine implementation is safe to ship after two fail-closed fixes landed. Both reviewers agree the two requested hardening fixes are correct, complete, and tested, and there are no money-correctness issues in the pinned/Zod-validated production path. Remaining Codex items are best classified as defense-in-depth gaps for hypothetical callers bypassing schema validation or violating preconditions (dense holes), not blocking production money correctness; verdict: ship.

## High-confidence findings (consensus)

1. [low] Production money path is ship-safe; remaining issues are defensive hardening for hypothetical unvalidated callers
   - File: (cross-cutting)
   - Affirming sources: codex-review-rereview2, gemini-review-rereview2, codex-critique-of-gemini-round1
   - Summary: One reviewer’s remaining findings are explicitly framed as gaps only for a hypothetical direct/unvalidated caller, while the other reviewer reports no concrete issues and the critique agrees that "zero findings" holds for the production path (Zod/parseGameConfig-validated config).
   - Recommended action: Ship as-is for production; optionally add small runtime assertions/guards to make bypassing validation fail-closed and to document/encode preconditions.

## Divergent findings (need resolution)

1. "par ?? 0" default: potential masking of corruption vs likely unreachable
   - One review flags a low-severity risk that defaulting missing par to 0 could mask corrupted course data and affect par-3 detection; the critique argues it’s very likely unreachable given how the maps are built in the production path.
   - Positions:
     - **codex-review-rereview2** (Concern (low): "Service defaults missing par to 0, could mask pinned course-data corruption + break greenie par-3 detection (games-money.ts:435-445)."): If par is unexpectedly absent, silently treating it as 0 could change barrier logic and hide upstream data issues.
     - **codex-critique-of-gemini-round1** (Not an issue in practice: "The par ?? 0 default is very likely unreachable given parByHole is built from the same holesInPlay as siByHole (identical keyset)."): In the production construction, parByHole should contain all holes that are in play, so the fallback never executes.
   - Synthesizer lean: Lean toward the critique: in the pinned production pipeline described, this is not a reachable money-correctness bug. Treat as optional hardening (e.g., assert/invariant instead of default) rather than a ship-blocker.

2. Residual validation gaps exist vs "no concrete findings"
   - Codex identifies remaining runtime validation hardening gaps (non-boolean enabled; unknown keys inside object variants; dense-holes precondition for direct callers). Gemini reports no findings, implicitly treating the production invariants and schema validation as sufficient.
   - Positions:
     - **codex-review-rereview2** (Defense-in-depth gaps remain for unvalidated callers): "Remaining gaps are all in the 'hypothetical direct unvalidated caller' posture" including m.enabled type and unknown keys in object variants, plus dense-holes precondition exposure.
     - **gemini-review-rereview2** (No concrete findings): Reports implementation is correct and fail-closed; does not call out bypass-the-schema scenarios.
   - Synthesizer lean: Lean that both are compatible: the code is ship-safe for the validated production path, while Codex’s items are reasonable optional hardening if the functions might ever be reached with unvalidated inputs.

## Dismissed findings

1. Missing runtime boolean check for m.enabled in validateResolvedConfig
   - Raised by: codex-review-rereview2
   - Dismissal reason: theoretical
   - Reasoning: This enables truthy non-boolean values only for callers that bypass the Zod/parseGameConfig validation gate; sources 2 and 3 agree the production path has no concrete issues, and source 1 itself frames this as an unvalidated-caller posture.

2. Unknown keys inside object-shaped variant accepted at runtime
   - Raised by: codex-review-rereview2
   - Dismissal reason: theoretical
   - Reasoning: The concern is silent acceptance of stray/misspelled levers only when bypassing schema validation; the review itself frames it as an unvalidated-caller issue, and the overall consensus is that the production path is safe (sources 2 and 3).

3. Dense-holes precondition not enforced for direct callers of greenie fold
   - Raised by: codex-review-rereview2
   - Dismissal reason: theoretical
   - Reasoning: The issue requires sparse/non-dense hole arrays being passed by a direct caller; the production builder is described as emitting dense holes, and reviewers did not identify a concrete production reachability path for sparse inputs.

## Prioritized actions

1. [must_fix_before_send] None. Based on reviewer consensus, there are no reachable production-path money-correctness bugs remaining after the two fail-closed fixes.
2. [should_fix] Add a runtime type check in validateResolvedConfig that enforces m.enabled is strictly boolean (fail-closed) to fully harden against unvalidated callers (codex-review-rereview2).
3. [should_fix] If validateResolvedConfig is intended to be robust standalone, reject unknown keys within object-shaped variants (or explicitly document that this function assumes schema-validated input) (codex-review-rereview2).
4. [should_fix] Replace "par ?? 0" with an invariant/throw/log to avoid silently masking impossible states, unless you intentionally want permissive behavior (codex-review-rereview2; critique argues it’s likely unreachable).
5. [optional] Encode/verify the dense-holes precondition at the API boundary (assert dense arrays) or document it clearly for any direct callers of the greenie fold functions (codex-review-rereview2).

## Open questions (for human judgment)

- Is validateResolvedConfig ever invoked on inputs that are not guaranteed to be Zod/parseGameConfig validated (e.g., CLI tools, migrations, tests, admin endpoints, or future integrations)? If yes, the 'should_fix' hardening items become more important.
- Are there any production callers that can pass sparse/non-dense hole arrays into the greenie folding logic (bypassing the service that "always builds dense holes")? If yes, enforce or normalize density at the boundary.

## Warnings

None.
