# Codex Review

- Generated: 2026-06-22T02:27:35.680Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md

## Summary

Spec is close and the embedded golden math for ON/OFF carryover is internally consistent, but there are a couple of money-critical ambiguities/inconsistencies that could lead to incorrect settlement (especially around incomplete par-3s and the proposed fold implementation/API). I’d block dev until AC8 (incomplete par-3 barrier) and the carryover-conservation property are made mechanically implementable and non-tautological.

Overall risk: high

## Findings

1. [high] AC8 says carry must NOT advance through an incomplete par-3, but Task 2’s proposed implementation (“filter to complete par-3 holes”) would let carry jump past it
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:49-70
   - Confidence: high
   - Why it matters: Carryover is stateful; if an earlier par-3 is incomplete, you cannot safely settle later par-3 greenies because the missing hole could change the carried pot (claimed vs unclaimed vs conflict). The spec currently says “incomplete par-3 is omitted… and the carry does not advance through it” (AC8, line 49), but Task 2 instructs to “filter to complete par-3 holes… fold” (line 69). Filtering would incorrectly allow carry from H1 to apply to H5 even if H3 (par-3) is present but incomplete and sorted earlier by holeNumber. That’s a real-money correctness bug in the resolver guidance, and will also undermine the property test definition of “completePar3Count.”
   - Suggested fix: Make the fold iterate holes in holeNumber order WITHOUT dropping incomplete par-3s. Suggested algorithm:
- sort all holes by holeNumber
- for each hole:
  - if par !== 3: continue
  - if par===3 but incomplete (missing any of 4 nets): BREAK (stop folding; later par-3s are not settleable)
  - else apply claim rule and update carry
Also update AC10 wording so `completePar3Count` means “count of settleable par-3s up to (but excluding) the first incomplete par-3”, and add an explicit unit test: H1 complete unclaimed, H3 incomplete par-3, H5 complete claimed => H5 award MUST be 0 until H3 completes.

2. [high] Carryover-conservation property (AC10) requires `finalCarry`, but the proposed exported API returns only a Map; tests risk becoming tautological or duplicating resolver logic
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:54-87
   - Confidence: high
   - Why it matters: AC10 requires asserting `sum(|awarded points|) + finalCarry === count(...)` (lines 54–55), but Task 2 specifies exporting only `greeniePointsByHole(...): Map<number, number>` (line 69) and Task 6 reiterates the need for `finalCarry` (line 86). Without `finalCarry` surfaced, implementers may (a) compute `finalCarry` as `count - sum(|awarded|)` which makes the property tautological, or (b) re-implement the fold in the test, which can share the same bug and fail to detect regressions. Either outcome weakens a required money-safety property.
   - Suggested fix: Change the resolver API to return fold state, e.g.:
```ts
export type GreenieFoldResult = {
  pointsByHole: Map<number, number>;
  finalCarryPoints: number;
  settleablePar3Count: number; // per AC8 barrier semantics
};
export function greenieFold(...): GreenieFoldResult
```
Then AC10 can compute `sumAbs(pointsByHole.values()) + finalCarryPoints === settleablePar3Count` without duplicating logic.

3. [medium] Config/schema plan may silently accept `carryover` on other enabled modifiers (variant is shared), weakening fail-closed guarantees
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:36-67
   - Confidence: medium
   - Why it matters: AC3/Task 1 add `carryover?: boolean` to the shared `ModifierVariant` and to the shared Zod variant object (lines 36, 64–66). Unless `validateResolvedConfig` also rejects unexpected variant keys for other enabled modifier types, configs that previously would have failed could start passing and be silently ignored. In a money engine, silently-ignored config fields are dangerous because they hide operator mistakes (e.g., `carryover:false` accidentally placed on `net-skins` or future modifiers). The spec only mandates rejecting `basis/bonus` when greenie is enabled (line 66), but doesn’t mandate rejecting `carryover` when non-greenie modifiers are enabled.
   - Suggested fix: Add explicit per-modifier variant allowlists in `validateResolvedConfig`:
- if enabled greenie: allow only `carryover`
- if enabled net-skins: allow no variant keys (or whatever net-skins actually supports)
- (future) birdie variants: allow `basis/bonus`
Alternatively, change `modifierSchema` to a discriminated union keyed by `type` so variant keys are structurally constrained without relying on runtime checks.

4. [medium] Money rule “carried pot valued at the collecting hole’s pointValueCents” is not locked by the golden (flat PV) and needs an explicit test/fixture
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:48-125
   - Confidence: high
   - Why it matters: AC7 states: “Each greenie point is worth the hole's pointValueCents; a carried pot is valued at the collecting hole's point value.” (line 48). The embedded golden uses a flat `pointValueCents = 500` (line 94), so it cannot detect an implementation that incorrectly carries cents instead of points, or that values carried points at the originating hole rather than the collecting hole. In real configs, point values may differ by hole/segment; this can materially change payouts.
   - Suggested fix: Add at least one unit test (or an additional golden) where par-3 holes have different `pointValueCents` and the carry is collected on the higher/lower PV hole, asserting the exact cents result. Also clarify explicitly in AC7/Task 2 that carry state is tracked in integer *points*, not cents.

5. [medium] Both-teams-conflict rule is marked as an open decision but is also embedded as an AC; spec remains non-deterministic until that gate is resolved
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:46-136
   - Confidence: high
   - Why it matters: AC6 hardcodes the conflict behavior (wash + carry) but labels it “[DECISION — Josh confirms at the spec gate]” (line 46) and reiterates it as an open money decision (lines 129–136). Until that decision is explicitly approved/closed, two different implementations could both claim compliance, and you risk writing goldens/tests against a rule that later changes.
   - Suggested fix: Before dev, resolve the decision and remove the “DECISION” ambiguity from AC6: either (a) keep wash+carry and make it final, or (b) specify the alternative (e.g., wash+reset) and update the required unit test accordingly. Consider adding a short rationale in AC6 to prevent later reinterpretation.

6. [low] Spec doesn’t explicitly define handling of out-of-foursome/unknown-player claim keys (defensive ignore vs fail)
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:35-71
   - Confidence: medium
   - Why it matters: AC2 says the resolver “reads structurally only its own foursome's claims” (line 35), implying it should ignore any extraneous claim keys. However, the award rules in AC6 are phrased in terms of “team A/B claims” without explicitly stating the resolver must ignore claims for playerIds not in `teamA ∪ teamB`. If upstream ever leaks extra claim entries into `holeState.claims`, a naive implementation that scans all claims could incorrectly detect ‘both teams claim’ or award the wrong side.
   - Suggested fix: Add an explicit AC sentence: “Only claims for playerIds in the current foursome’s teamA/teamB are considered; all others are ignored.” Then in Task 2, specify claim detection based solely on the four team members’ claim booleans.

## Strengths

- Golden ON/OFF arithmetic is internally consistent with the existing 4-cross-pair split: pts=3 at pv=500 yields half=750 edges and per-player ±1500 (lines 108–124). Ledger totals (3000/1000) match sum(edges).
- The spec correctly isolates greenie as the only mover (nets=par everywhere), which is an excellent money-safety device for the golden (lines 94–107).
- File path allowlist is clean: all planned edits are under apps/tournament-api/** or _bmad-output/** (lines 177–191).
- Order invariance is correctly scoped: invariant to input order via holeNumber sort, not to reordering the hole sequence itself (line 50).
- Fail-closed intent is strong and explicitly calls out unsupported variant combinations and terminal pending carry = $0 (line 55).

## Warnings

None.
