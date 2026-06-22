# Codex Review

- Generated: 2026-06-22T14:47:47.164Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/engine/games/modifiers/greenie.ts, apps/tournament-api/src/engine/games/modifiers/greenie.test.ts, apps/tournament-api/src/engine/games/greenie.golden.test.ts, apps/tournament-api/src/engine/games/games.property.test.ts, apps/tournament-api/src/engine/games/__fixtures__/greenie-carryover-on.json, apps/tournament-api/src/engine/games/__fixtures__/greenie-carryover-off.json, apps/tournament-api/src/engine/games/__fixtures__/greenie-two-on-one-hole.json, apps/tournament-api/src/services/games-money.ts

## Summary

Greenie fold + integration largely matches the ACs (count model, carryover math, holeNumber order, barrier break-not-filter, valuation at collecting hole PV) and is backed by solid unit + golden + property tests. The main money-safety gap I can support from the code is that computeFoursome’s fail-closed guard (validateResolvedConfig) does not actually validate the *type* of greenie’s `carryover` lever, so a malformed config can silently change carry behavior when computeFoursome is called directly (bypassing Zod). Separately, the new dense-holes builder in games-money.ts defaults missing par to 0, which can mask pinned course-data corruption and potentially bypass the par-3 barrier logic rather than failing closed.

Overall risk: medium

## Findings

1. [medium] validateResolvedConfig does not type-check greenie.variant.carryover, so malformed configs can silently change carry behavior
   - File: apps/tournament-api/src/engine/games/registry.ts:66-119
   - Confidence: high
   - Why it matters: computeFoursome explicitly relies on validateResolvedConfig as its fail-closed guard for “any direct caller” (compute-foursome.ts:15–21). But for greenie, validateResolvedConfig only rejects stray `basis`/`bonus` keys and does not validate `carryover` at all (registry.ts:110–117). In greenie.ts, `greenieCarryover` returns `m?.variant?.carryover ?? true` (greenie.ts:38–41). If a caller passes a malformed runtime config (e.g. `{carryover: "false"}` or `{carryover: 0}` or `{carryover: null}`) without going through Zod, the engine will treat it as truthy/falsey/default via JS semantics, potentially computing the wrong money instead of failing closed.
   - Suggested fix: In validateResolvedConfig, add an enabled-greenie check that if `m.variant?.carryover !== undefined` then `typeof m.variant.carryover === 'boolean'` (else reject with an `unsupported_greenie_variant:carryover_type` / `invalid_greenie_variant` reason). Optionally also reject `variant` objects that contain no recognized keys for enabled greenie if you want stricter fail-closed semantics.

2. [low] Dense-holes build defaults missing par to 0, masking course-data issues and potentially bypassing par-3 logic instead of failing closed
   - File: apps/tournament-api/src/services/games-money.ts:425-445
   - Confidence: medium
   - Why it matters: The new dense hole emission is key to AC8 (barrier seeing unplayed par-3 gaps). But the constructed HoleState uses `par: parByHole.get(holeNumber) ?? 0` (games-money.ts:444). If pinned course data is corrupt/inconsistent (par missing for a holeNumber that still appears in siByHole iteration), the engine will treat that hole as non-par-3 (par=0), which can defeat the greenie fold’s par-3-only barrier behavior (greenie.ts:97–100) and may also affect base scoring depending on holeNetPointsA’s assumptions. This is “fail open” relative to the service’s stated fail-closed posture.
   - Suggested fix: Instead of `?? 0`, explicitly require `parByHole.get(holeNumber)` to be present. If missing, return an unsettleable result (e.g. `no_course_data` / `corrupt_pin`) or throw inside the try so the foursome becomes unsettleable rather than silently computing with par=0.

## Strengths

- greenieFold implements AC6 correctly: WON uses `rawA + sign(rawA)*carry`, UNCLAIMED increments carry by 1 only on zero-boxes, CONTESTED preserves pot, non-par-3 skipped, and B-team sweep is sign-symmetric (greenie.ts:96–120; greenie.test.ts covers −3 sweep).
- AC8 barrier is implemented as a BREAK at first incomplete par-3 (greenie.ts:96–100) and the service now emits dense holes from `siByHole.keys()` to ensure gaps are visible (games-money.ts:425–445).
- computeFoursome adds greenie points before the `pts===0` short-circuit so “greenie-only win” settles correctly and is valued at that hole’s PV without forking the split path (compute-foursome.ts:62–78).
- Test coverage is strong for a money modifier: unit tests for carryover on/off, contested preservation, B-team sweep, foreign-key isolation, barrier deferral, terminal carry=0 money; plus golden fixtures and a fast-check carry-conservation property.

## Warnings

None.
