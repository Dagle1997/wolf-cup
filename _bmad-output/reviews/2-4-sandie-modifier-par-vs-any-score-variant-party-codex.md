# Codex Review

- Generated: 2026-06-22T18:21:05.702Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/2-4-sandie-modifier-par-vs-any-score-variant-party-review.md, apps/tournament-api/src/engine/games/modifiers/sandie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts

## Summary

(a) The PARTY-MODE review accurately reflects the provided implementation.

- Pure-count model / no eligibility gate: `sandiePoints` is strictly `(#A checked) - (#B checked)` with checks driven only by `hole.claims?.[playerId]?.sandie === true`, and no score-based gate or gross lookup (`apps/tournament-api/src/engine/games/modifiers/sandie.ts` lines 4-14, 29-32, 39-49).
- Folded into `pts` before `pts===0` short-circuit: sandie is added into the same `pts` accumulator as base + greenie + polie, and the `if (pts === 0) continue;` happens after (`compute-foursome.ts` lines 74-83). So “sandie-only hole settles” and “all-push stays inert” matches.
- No-variant fail-closed: enabled sandie rejects any non-empty `variant` by checking `Object.keys(m.variant)` and failing with `unsupported_sandie_variant:<key>` (`registry.ts` lines 157-168). Empty `variant:{}` passes, consistent with the review.
- Base-money-neutral (in the sense used by the review): sandie adds no new dependence on gross/other fields, and when absent/disabled it contributes exactly 0 due to the hoisted `sandieOn` guard (`compute-foursome.ts` lines 62-82).

(b) No evidence in the provided code that the review “ACCEPTED” any blocking recommendation that wasn’t implemented. The two cited optional Lows are consistent with what’s in code:

- “self-guard intentional”: implemented via `if (!sandieActive(config)) return 0;` inside `sandiePoints` (`sandie.ts` line 45), even though `computeFoursome` already gates with `sandieOn` (`compute-foursome.ts` line 80-81).
- “symbol-key theoretical”: the validator uses `Object.keys` (string, enumerable, own properties only) (`registry.ts` line 164). There is no symbol-key handling in the provided code, matching the review’s classification as theoretical/non-blocking in the JSON config context.

(c) No drift from the Josh-ratified pure-count model is visible in the provided files, and no allowlist-boundary crossing is evident: sandie has no levers, reads only sandie claim flags for the 4 members, and the validator explicitly fail-closes on any enabled sandie variant key (`sandie.ts` lines 29-32, 45-48; `registry.ts` lines 157-168).

Note: the review’s broader test-count/suite-pass assertions can’t be verified from the provided diff/file contents (tests not included), but the wiring and semantics it claims for sandie are consistent with the shown code.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Implementation matches the documented “pure count, no gate” model: claims-only, stateless, and order-independent by construction (`sandie.ts`, `compute-foursome.ts`).
- Correct integration point: sandie folds into `pts` before the `pts===0` early-exit, preserving intended settlement behavior (`compute-foursome.ts` lines 74-83).
- Fail-closed config validation is consistent with “no levers”: enabled sandie rejects any non-empty variant (`registry.ts` lines 157-168).
- Modifier enablement is hoisted once per settlement loop (via `sandieOn`), matching the review’s performance/structure claim (`compute-foursome.ts` lines 62-65).

## Warnings

None.
