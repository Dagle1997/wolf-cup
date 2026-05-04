# Codex Review

- Generated: 2026-05-04T13:48:16.020Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/rules/individual-bets.ts, apps/tournament-api/src/routes/bets.ts

## Summary

The two stated fixes are present in the provided code: (1) auto-press firing is now suppressed past the round’s actual max hole via a new `maxHole` parameter threaded into `findAutoFiresInSegment`, and (2) route config-shape validation is now performed inside the DB transaction after participant + round scope validation, matching the documented ordering. One remaining correctness gap: the route currently allows `config: null` for `match_play_per_hole` due to `body.config ?? {}` coalescing, which bypasses the intended “must be an empty object” contract.

Overall risk: medium

## Findings

1. [medium] Route accepts `config: null` for match_play_per_hole (bypasses strict empty-object validation)
   - File: apps/tournament-api/src/routes/bets.ts:198-210
   - Confidence: high
   - Why it matters: `matchPlayPerHoleConfigSchema` is `z.object({}).strict()`, which correctly rejects extra keys and non-objects. However, the route parses `body.config ?? {}` for `match_play_per_hole`, so a client can send `config: null` (or omit it if the schema ever changes) and still pass validation and persist `{}`. If the API contract/spec requires the client to supply an actual empty object, this is a behavior hole and can mask client bugs.
   - Suggested fix: Validate `body.config` directly instead of coalescing nullish values. For example:
- Require object type: `const cfgParse = matchPlayPerHoleConfigSchema.safeParse(body.config);`
- Or tighten `betBodySchema` to `config: z.object({}).strict()` when `betType === 'match_play_per_hole'` via a discriminated union, so the body parse enforces it before the transaction.

2. [low] Engine comment still references suppression at >18 holes, but logic now uses `maxHole`
   - File: apps/tournament-api/src/engine/rules/individual-bets.ts:448-454
   - Confidence: high
   - Why it matters: `findAutoFiresInSegment`’s doc comment says fires are suppressed only if `> 18`, but the implemented suppression is now `firedAtHole <= maxHole`. This mismatch can mislead future maintainers and cause incorrect assumptions when changing course/hole modeling.
   - Suggested fix: Update the comment to reflect the new `maxHole`-based suppression (e.g., “suppressed if firedAtHole > maxHole”).

## Strengths

- Auto-press suppression now correctly keys off the round’s actual hole count via `maxHole` (supports 9-hole rounds without phantom presses).
- Route validation order now matches the stated spec ordering: participant checks + canonicalization + round scope occur before config validation, all within the transaction.
- Fixed-point auto-press logic remains deterministic via sorting and dedupe keys, and preserves existing press multipliers by cloning rows unchanged.

## Warnings

None.
