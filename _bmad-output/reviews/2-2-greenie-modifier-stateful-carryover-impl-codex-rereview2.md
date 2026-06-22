# Codex Review

- Generated: 2026-06-22T15:12:41.102Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/modifiers/greenie.ts, apps/tournament-api/src/engine/games/modifiers/greenie.test.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/services/games-money.ts

## Summary

The two requested fail-closed fixes in `validateResolvedConfig` are implemented correctly as written and are exercised by targeted tests: (1) enabled greenie with non-boolean `carryover` is rejected with `unsupported_greenie_variant:carryover_type` (`registry.ts` 124-137; tests `greenie.test.ts` 217-229); (2) enabled modifiers with a non-object `variant` are rejected up-front (`registry.ts` 88-101; tests `greenie.test.ts` 241-260). These checks are gated on `m.enabled`, so they do not over-reject absent variants or disabled modifiers.

Greenie money behavior looks coherent end-to-end: `computeFoursome` folds `greenieFold`’s per-hole points into the existing `pts` path (no split-path fork) and values them at the collecting hole’s point value (`compute-foursome.ts` 45-76), matching the valuation AC and the tests. The service-layer change to emit DENSE hole rows (`games-money.ts` 425-445) is the right counterpart to the fold’s par-3 barrier semantics.

Remaining gaps are mostly in the “hypothetical direct unvalidated caller” posture: `validateResolvedConfig` still doesn’t validate the *shape* of modifier entries beyond `variant`, and it doesn’t fail-closed on unknown keys inside an object-shaped `variant`.

Overall risk: medium

## Findings

1. [medium] validateResolvedConfig does not type-check `m.enabled` (or other modifier fields), allowing truthy non-boolean values to unexpectedly enable modifiers for unvalidated callers
   - File: apps/tournament-api/src/engine/games/registry.ts:79-139
   - Confidence: high
   - Why it matters: These guards are explicitly intended to protect direct callers passing unvalidated JSON. Today, if `enabled` is provided as a truthy non-boolean (e.g. `'false'`, `1`), the engine will treat the modifier as enabled throughout (`m.enabled` checks at `registry.ts` 96, 107, 124; `greenieActive` returns `!!m && m.enabled` in `greenie.ts` 29-32). That can silently turn on greenie/net-skins and compute real money under unintended defaults—exactly the class of mis-settlement this story is trying to fail-close.
   - Suggested fix: In `validateResolvedConfig`, add explicit runtime checks for each modifier entry when iterating `config.modifiers`, e.g.:
- `typeof m.type === 'string'`
- `typeof m.enabled === 'boolean'`
Optionally also assert `m.variant === undefined || (plain object)` (already done) and that `config.modifiers` itself is an array before iterating, returning `{ok:false}` rather than throwing.

2. [medium] Enabled modifiers still accept object-shaped variants with unknown keys, allowing misspelled or stray levers to silently default (money correctness risk for unvalidated callers)
   - File: apps/tournament-api/src/engine/games/registry.ts:102-138
   - Confidence: high
   - Why it matters: You added an allowlist for *cross-modifier* keys (`carryover` rejected on net-skins; `basis/bonus` rejected on greenie). But if an unvalidated caller passes an object with unknown keys (e.g. greenie `{ carryOver:false }` or `{ foo:1 }`), it passes validation and will be ignored by the engine, causing greenie to default `carryover` to `true` (`greenieCarryover` uses `?? true`, `greenie.ts` 38-41). That is still a silent misconfiguration that can change money, and it’s not covered by the current checks because they only look for a few specific forbidden keys.
   - Suggested fix: For `m.enabled === true` and object-shaped `variant`, reject any keys outside the per-modifier allowed set.
- For `greenie`: allowed keys = `['carryover']`
- For `net-skins`: allowed keys = `['basis','bonus']`
Implement by iterating `Object.keys(m.variant)` and returning an `unsupported_*_variant:unknown_key=${k}` (or a generic `unsupported_variant_key:${m.type}:${k}`) when encountering an unexpected key.

3. [low] Service layer defaults missing par to 0, which could mask pinned course-data corruption and break greenie par-3 detection/barrier
   - File: apps/tournament-api/src/services/games-money.ts:435-445
   - Confidence: medium
   - Why it matters: The dense-hole emission uses `par: parByHole.get(holeNumber) ?? 0` (`games-money.ts` 444). If `parByHole` is unexpectedly missing an entry for an in-play hole (corrupt/partial pinned course revision), this will silently treat that hole as non-par-3. For greenie, that can prevent the barrier from ever seeing an incomplete par-3 gap and can also skip legitimate par-3 contesting, producing incorrect money rather than failing closed.
   - Suggested fix: If `parByHole.get(holeNumber)` is `undefined` for any `holeNumber` in `siByHole`, treat the foursome as unsettleable (e.g. throw inside the try and let the existing catch convert to `engine_error`, or return a structured `no_course_data`/`corrupt_pin` reason).

4. [low] Greenie barrier correctness depends on dense holes; computeFoursome/greenieFold cannot enforce this for direct callers, so sparse inputs can bridge carryover across missing par-3 rows
   - File: apps/tournament-api/src/engine/games/modifiers/greenie.ts:67-75
   - Confidence: medium
   - Why it matters: `greenieFold` documents a hard precondition that the `holes` array must be DENSE so the barrier can see an unplayed/partial par-3 (`greenie.ts` 72-74). The service layer now satisfies this, but a direct caller can still pass only “played holes” and accidentally allow carryover to cross an unrepresented par-3 gap, changing money. This is a remaining money-correctness footgun in the unvalidated/direct-call scenario.
   - Suggested fix: If you want stronger fail-closed behavior for direct callers, consider either:
- passing an explicit `holesInPlay`/course hole list into the engine so density can be asserted, or
- adding an optional `expectedHoleNumbers`/`holesToPlay` parameter used only when greenie is active to detect missing in-play holes (and throw). If that’s out of scope, at least ensure the precondition is prominently documented on `computeFoursome`’s public API.

## Strengths

- The two requested fail-closed checks are correctly scoped to `enabled` modifiers and won’t reject valid cases (absent variant, object-shaped variant, disabled modifier).
- Greenie integration into `computeFoursome` is valuation-correct (collecting-hole PV) and does not fork the 2v2 split path, aligning with AC7/NFR-C7 (`compute-foursome.ts` 45-76).
- Service-layer switch to dense hole rows is the right systemic fix to make the par-3 barrier observable, without changing base-game settlement because the existing complete-cell gate still skips incomplete holes (`games-money.ts` 425-445).
- Tests cover carryover type fail-closed and non-object variant fail-closed, plus key greenie behaviors (carry sweep, barrier, valuation, inert when inactive/disabled).

## Warnings

None.
