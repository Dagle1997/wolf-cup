# Codex Review

- Generated: 2026-06-22T16:07:42.725Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts

## Summary

The 5 previously-raised spec issues you listed appear resolved in the text as written: (1) the fast-check polie additivity property is now non-tautological + signed + includes b1===−a1 and shuffle invariance (Story spec AC9 / Task 6); (2) FD-1/FD-2 scope is clarified as CODE only under apps/tournament-api/**, with _bmad-output treated as director artifacts (AC11); (3) fail-closed reason strings are now explicit and aligned to the shipped 2.2 convention style (AC10); (4) FR44 posture is clarified: allowlist rejects misplaced KNOWN keys; truly-unknown keys inside object variants remain deferred, with Zod .strict() covering the write path (AC10); (5) per-player vs ledger-total PV semantics are clarified (AC6).

Remaining blockers are confined to (a) a likely-mis-specified additivity equation if the property is implemented against segmented point-value schedules, and (b) the golden’s claimed order-independence coverage not being explicitly demonstrated in Fixtures 1–2 as written (it can be satisfied by shuffling the holes array in the JSON, but the spec/hand-calc doesn’t state that explicitly).

Overall risk: medium

## Findings

1. [medium] Polie additivity property uses a single pointValueCents constant; will be wrong under segmented (front/back) PV unless constrained to flat schedules or weighted per hole
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:64-71
   - Confidence: high
   - Why it matters: computeFoursome values points at the hole’s point value (pv depends on holeNumber when the schedule is segmented). The AC9/Task 6 statement `perPlayerCents[a1] === pointValueCents * Σ_completeHoles rawA` is only generally correct if the schedule is flat (constant pv for all holes). If an implementer reuses the general configArb (which likely includes both flat and front/back schedules), this property will fail spuriously—or worse, get “fixed” in a way that reduces its ability to detect PV bugs.
   - Suggested fix: Make the property either: (A) explicitly generate only flat schedules for this property (and state that in AC9/Task 6), or (B) change the RHS to `Σ_completeHoles (rawA_hole * pv(holeNumber))` using `pointValueCents(config.pointValueSchedule, hole.holeNumber)` computed from raw inputs. Keep the RHS independent of engine output.

2. [medium] Golden fixture requirement claims order-independence coverage, but Fixtures 1–2 hand-calc doesn’t explicitly encode a shuffled holes array (could silently not test AC1(iv))
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:51-54
   - Confidence: high
   - Why it matters: AC1 requires the golden fixture(s) to cover order-independence. However, the Fixture 1 description/table lists holes in natural order (1–4) and does not explicitly say the JSON fixture will present them shuffled. If the JSON ends up ordered, the golden won’t actually exercise the sorting/order-invariance path; you’d be relying solely on property tests for that dimension.
   - Suggested fix: Add an explicit note in Dev Notes for Fixture 1 (or add a small Fixture 3) stating that the `holes` array in the JSON is intentionally out-of-order (e.g., [3,1,4,2]) while holeNumber values remain correct, and that expected output is unchanged. Alternatively, mandate a separate golden that is identical except for holes array order.

3. [low] AC7 wording over-claims “invariant to hole ordering itself” despite PV-by-holeNumber; needs clarification to avoid mis-implementation
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:65-66
   - Confidence: medium
   - Why it matters: The engine’s valuation can depend on `holeNumber` (front/back schedules). So while the ledger is invariant to *input array order*, it is not invariant to changing holeNumber assignments / swapping which hole is on front vs back. The current wording could confuse an implementer writing tests (or interpreting failures) around “hole ordering itself.”
   - Suggested fix: Reword AC7 to: “invariant to input array order / iteration / insertion order (holes may be provided unsorted; engine sorts by holeNumber).” Avoid implying invariance to changing holeNumber values when PV depends on them.

## Strengths

- Fail-closed variant allowlist section is now concrete and testable, with explicit reason strings and explicit cross-modifier misplaced-key rejections (AC10).
- The polie-additivity property is now genuinely non-tautological (RHS derived from raw inputs, not engine output), signed, and includes both antisymmetry and shuffle invariance (AC9/Task 6).
- Money semantics are clearer than the previous iteration: per-player swing vs ledger total is explicitly called out (AC6), reducing risk of the common “2x vs 4x vs netted total” misunderstanding.
- FR44 posture is explicitly scoped to the 2.2 precedent (misplaced known keys rejected; unknown keys inside variant object deferred) which aligns expectations for Josh’s gate review.
- Scope guard (AC11) now cleanly distinguishes application code vs director artifacts, resolving the FD-1/FD-2 ambiguity.

## Warnings

None.
