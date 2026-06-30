# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-24T16:29:21.138Z
- Synthesized sources: codex-review, gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: (prior outputs only)

## Verdict

**HOLD** — confidence: high

## Executive summary

Decision: whether to ship the Wolf Cup sub-aware pairing changes (SUB_SPREAD_PENALTY soft spreading + union-find play-with links) and the new attendance.play_with_player_id API/UI. Reviewers strongly agree there are correctness issues that can strand valid linked clusters in the remainder and a determinism regression in the pinned path. Verdict is HOLD until the cluster-assignment fallback and pinned determinism are fixed; the two debated items (status-gating, public exposure) are not consensus blockers.

## High-confidence findings (consensus)

1. [critical] Oversized linked clusters (> groupSize) are stranded in remainder instead of falling back to singletons as promised
   - File: Unknown (pairing/suggestGroups engine)
   - Affirming sources: codex-review, gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
   - Summary: When union-find produces a cluster larger than groupSize, current behavior pushes the whole cluster into the remainder rather than degrading to a valid assignment (e.g., split to singletons) per the JSDoc/expected behavior.
   - Recommended action: Implement a deterministic fallback: if cluster.size > groupSize, split into singletons (or otherwise degrade) and continue placement; add tests covering oversized clusters + expected fallback.

2. [high] Valid size>=2 clusters can be dropped due to fragmentation/placement failure (bin-packing effect)
   - File: Unknown (pairing/suggestGroups engine)
   - Affirming sources: gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
   - Summary: Shuffled cluster placement can cause a valid cluster (size>=2) to find no contiguous seats late in the process and be stranded in the remainder, even though a feasible assignment exists.
   - Recommended action: Adopt a deterministic placement strategy that reduces fragmentation (e.g., First-Fit Decreasing by cluster size using stable sort or size-bucketing). Additionally, add a safety fallback: if placement fails and cluster.size>1, split into singletons and reassign rather than dropping into remainder.

3. [high] Pinned path determinism regression: cluster pin-lifting changes overflow precedence / ordering vs legacy in WITH-PINS scenarios
   - File: Unknown (pairing/suggestGroups engine)
   - Affirming sources: codex-review, gemini-critique-of-codex
   - Summary: Union-find contraction and pin-lifting can change how pins are applied/overflowed and alter in-group ordering relative to the prior pinMap iteration order. Existing coverage appears to only assert determinism for a no-pins path (AC6), leaving pinned cases potentially non-byte-identical.
   - Recommended action: Decide the determinism contract for pinned scenarios (byte-identical vs acceptable change). Then enforce it: preserve legacy ordering/precedence (or update contract) and add targeted tests for WITH-PINS + links/subs to prevent regressions.

## Divergent findings (need resolution)

1. Whether to gate play-with linking on attendance.status inside buildSubGroupingInputs (defense-in-depth vs redundant)
   - Codex argues link construction should explicitly check attendance.status (not just rely on caller-provided playerIds). Gemini argues the caller already pre-validates to attending subset, and pidSet membership filtering makes an additional DB/status gate redundant.
   - Positions:
     - **codex-review** (add status-gating): "buildSubGroupingInputs doesn't gate links on attendance.status (relies on caller playerIds)."
     - **codex-critique-of-gemini** (add status-gating / claims of discard are unsupported): "Gemini's strength-claim that out-status links are discarded is UNSUPPORTED (lib doesn't check status)."
     - **gemini-critique-of-codex** (status-gating unnecessary): "playerIds already pre-validated to attending subset, pidSet.has() filters out players, duplicate DB status check unnecessary."
   - Synthesizer lean: Lean: SHOULD FIX as defense-in-depth unless an invariant is explicitly enforced. The evidence supports Codex’s narrower claim (the library itself doesn’t check status); Gemini’s argument can be valid if the callsite invariant is guaranteed. Best resolution: either (a) add an explicit status gate in the input builder, or (b) codify the invariant with an assertion + tests at the callsite so the library can safely assume it.

2. Public GET /attendance exposing playWithPlayerId (incremental disclosure vs already-public analogous data)
   - Codex flags that returning playWithPlayerId on a public route increases disclosure. Gemini argues it’s structurally equivalent to already-public groupRequest and is theoretical without a concrete new risk.
   - Positions:
     - **codex-review** (risk: incremental disclosure): "public GET /attendance now returns playWithPlayerId."
     - **gemini-critique-of-codex** (risk is theoretical/analogous): "groupRequest already exposed on same public route, playWithPlayerId structurally identical week-specific preference, no concrete risk."
   - Synthesizer lean: Lean: OPTIONAL/PRODUCT-POLICY DECISION. Given reviewers didn’t cite a concrete exploit and there’s an asserted precedent (groupRequest already public), this is not a must-fix on engineering grounds alone. If privacy expectations differ for play-with links vs freeform groupRequest, this becomes an escalation to product/legal/policy rather than a code-level blocker.

## Dismissed findings

1. Claim that out-status links are already discarded by the library
   - Raised by: gemini-review
   - Dismissal reason: missing_evidence
   - Reasoning: Codex critique notes the implementation does not itself check attendance.status; any discarding would have to come from upstream filtering, which was not evidenced in the review materials (codex-critique-of-gemini).

## Prioritized actions

1. [must_fix_before_send] Fix cluster overflow/placement failure so valid players aren’t stranded in remainder: if cluster.size > groupSize, deterministically split (e.g., into singletons) and continue; if placement fails for size>1 due to fragmentation, split and reassign instead of dropping. Add tests for both scenarios.
2. [must_fix_before_send] Address pinned-path determinism: either preserve legacy pin overflow precedence and ordering (including WITH-PINS cases) or explicitly change the contract and update tests. Add coverage for WITH-PINS + links/subs so determinism regressions are caught.
3. [should_fix] Reduce fragmentation proactively: implement stable size-descending placement (FFD) via stable sort or explicit size-bucketing to avoid engine/JS sort-stability dependence; verify it’s a no-op for all-singletons so AC6 remains valid (per Gemini + Codex critique).
4. [should_fix] Resolve status-gating by choosing one: (a) add explicit attendance.status gating for play-with links in the input builder, or (b) document and enforce the upstream invariant (assertion + tests) that only eligible attending playerIds are passed.
5. [optional] Clarify/document the within-cluster cost handling (not counted toward incremental) if it’s correct-but-non-obvious, to prevent future “bug fixes” that break intended behavior (codex-critique-of-gemini).
6. [optional] Re-evaluate whether playWithPlayerId should be returned on the public GET /attendance response; if uncertain, gate behind auth/role or omit from public payload while keeping PATCH behavior (policy-dependent).

## Open questions (for human judgment)

- What is the intended public/privacy policy for exposing playWithPlayerId on GET /attendance (is it equivalent to groupRequest in sensitivity, or should it be restricted)?
- What is the explicit determinism contract for suggestGroups when pins are present (must be byte-identical to legacy, or is any deterministic output acceptable as long as constraints are met)?
- Is it a guaranteed invariant that the suggestGroups/link builder only receives playerIds for eligible attending players (and never waitlist/cancelled)? If yes, where is it enforced and tested?

## Warnings

None.
