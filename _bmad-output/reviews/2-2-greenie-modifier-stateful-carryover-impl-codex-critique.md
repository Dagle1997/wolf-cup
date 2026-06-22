# Codex Critique

- Generated: 2026-06-22T14:52:50.584Z
- Critiquing: gemini-pro-latest
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/modifiers/greenie.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/engine/games/config-schema.ts

## Verdict

**SHIP** — overall agreement: partial

## Summary

Gemini’s “zero findings” conclusion holds for the *production* money path shown (pins parsed via Zod + parseGameConfig, then computeFoursome). However, it missed a real defense-in-depth correctness gap: validateResolvedConfig does not runtime-type-check greenie.variant.carryover, and greenieCarryover’s `?? true` will treat many non-boolean values as truthy/falsey and potentially compute wrong money if computeFoursome is invoked with unvalidated JSON. The `par ?? 0` default in the dense-holes builder is very likely unreachable given how parByHole is built, but if it ever triggered it would silently suppress greenies (and possibly other par-dependent logic).

## Critiques of prior findings

1. [partial] No concrete findings were identified from the supplied evidence.
   - Reasoning: If we scope strictly to the pinned-service settlement path, config is parsed by Zod (carryover is boolean) and then semantically validated, so there’s no practical money-safety bug demonstrated. But the code explicitly claims computeFoursome’s validateResolvedConfig guard “protects any direct caller,” and that guard currently does *not* protect against a malformed carryover type; a direct caller bypassing Zod could get incorrect greenie carry behavior (truthiness) and thus wrong cents. That’s a real correctness gap in the engine’s fail-closed story, even if it’s not currently reachable through the shown service path.

## Additional findings (Codex caught, prior reviewer missed)

1. [medium] validateResolvedConfig does not runtime-type-check greenie.variant.carryover; non-boolean values can change carryover behavior via JS truthiness
   - File: apps/tournament-api/src/engine/games/registry.ts:66-119
   - Confidence: high
   - Why it matters: computeFoursome calls validateResolvedConfig and then assumes it has a safe, supported config. But validateResolvedConfig never checks that `m.variant.carryover` is actually a boolean. In greenieCarryover, `return m?.variant?.carryover ?? true;` means values like `'false'`, `1`, `{}`, etc. are not nullish and therefore returned; downstream `carryEnabled ? carry + 1 : 0` will use truthiness, so `'false'` becomes effectively TRUE (carryover on), while `0` becomes effectively FALSE (carryover off). If computeFoursome is ever called with a config built from untrusted/loosely typed JSON (i.e., bypassing parseGameConfig/Zod), this can compute the wrong money.
   - Suggested fix: Harden the semantic validator to enforce boolean at runtime for enabled greenie: e.g. `if (m.variant?.carryover !== undefined && typeof m.variant.carryover !== 'boolean') return {ok:false, reason:'invalid_greenie_variant:carryover_type'};`. Optionally also assert `typeof m.variant === 'object'` when present. Consider adding a unit test that passes `{ carryover: 'false' as any }` via computeFoursome and expects an unsettleable/throw rather than silently computing.

2. [low] Dense-holes builder uses `parByHole.get(holeNumber) ?? 0`; if ever hit, it would silently suppress par-3 greenies (and hide course-data corruption)
   - File: apps/tournament-api/src/services/games-money.ts:435-445
   - Confidence: medium
   - Why it matters: greenieFold gates on `hole.par !== 3`. Defaulting missing par to 0 would silently treat a par-3 as non-par-3, causing missing greenie awards (money under/over depending on game state). In the shown code this is *probably unreachable* because `siByHole` and `parByHole` are built from the same `holesInPlay` rows and you iterate `siByHole.keys()`, so the map lookup should always succeed. Still, the fallback can mask an invariant violation and turn what should be an unsettleable data issue into a silent money discrepancy.
   - Suggested fix: Replace with a fail-closed assertion: `const par = parByHole.get(holeNumber); if (par === undefined) throw new Error('missing par for hole '+holeNumber);` (caught and surfaced as unsettleable per-foursome). If you want non-throw behavior, at least log/surface a reason and mark the foursome unsettleable.

## Consensus recommendations

- Treat Gemini’s “no findings” as true only for the current pinned/Zod-validated production settlement path; it’s not true as a general claim about computeFoursome’s robustness to unvalidated configs.
- Add runtime validation for `greenie.variant.carryover` (type boolean) in validateResolvedConfig (or otherwise ensure computeFoursome cannot proceed with non-boolean carryover).
- Tighten the dense-holes `par ?? 0` fallback into an invariant check (throw/unsettleable) to avoid silently suppressing greenies if pinned course data is inconsistent.

## Warnings

None.
