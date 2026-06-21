# Codex Review

- Generated: 2026-06-21T21:46:15.660Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/pin-round.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/services/pin-round.test.ts, apps/tournament-api/src/db/schema/game-config.test.ts

## Summary

The three previously-high issues appear resolved in the provided code: (1) canonical config enforcement is now fail-closed via `gameConfigSchema.strict()` and `pinRound` persists `JSON.stringify(parsed.config)` (not raw input); (2) per-player handicaps are validated with `z.number().finite()` and rejected on NaN/Infinity/wrong shape; (3) tenancy provenance is now copied from the `rounds` row (caller no longer supplies tenant/context) and `round not found` fails closed. The prior existing-row guard issue is also resolved: the conflict/no-op path now explicitly throws if the expected existing pin row is absent.

No evidence that `.strict()` wrongly rejects the valid `guyan-2v2` config: the schema includes `scope`, `cap`, and `lockState` as optional, and tests assert `parseGameConfig(VALID).ok === true`.

Remaining risks are relatively small and center on unvalidated `createdAt` and potential key-based object hazards in `perPlayerHandicaps` (if any untrusted input can reach it).

Overall risk: medium

## Findings

1. [medium] `createdAt` is not validated as finite/int before DB write (NaN/Infinity or non-integer could be persisted)
   - File: apps/tournament-api/src/services/pin-round.ts:31-94
   - Confidence: high
   - Why it matters: `pinRound` fail-closes config and handicaps, but `createdAt` is accepted as a raw `number` and written directly (`createdAt: input.createdAt`). If a caller bug (or any untrusted caller path) passes NaN/Infinity or a non-integer timestamp, the DB may store an invalid value or reject the insert depending on driver/binding behavior. That can break ordering, determinism, and any downstream logic that assumes `createdAt` is a valid epoch millis integer.
   - Suggested fix: Add a validation guard similar to handicaps, e.g. `if (!Number.isFinite(input.createdAt) || !Number.isInteger(input.createdAt)) throw ...;` (or a small Zod schema for `PinRoundInput`). Add a unit test for NaN/Infinity/non-integer `createdAt` rejection.

2. [low] `perPlayerHandicaps` record keys are unconstrained beyond non-empty; consider blocking `__proto__`/`constructor`/`prototype` if any untrusted IDs can reach this writer
   - File: apps/tournament-api/src/engine/games/config-schema.ts:52-55
   - Confidence: medium
   - Why it matters: `perPlayerHandicapsSchema` uses `z.record(z.string().min(1), ...)`, which permits keys like `__proto__`. While `JSON.stringify`/`JSON.parse` are generally safe, prototype-pollution hazards can reappear if later code merges these objects (e.g., `Object.assign`, deep-merge utilities) during recompute or aggregation. If player IDs are always system-generated UUIDs this is likely moot; if any caller-supplied IDs can reach this path, it becomes a defense-in-depth concern.
   - Suggested fix: If IDs may be untrusted, add a key refinement to reject `__proto__`, `constructor`, `prototype` (and optionally enforce an ID format like UUID). Alternatively, normalize to `Map` semantics at runtime and avoid object merges. Add a test covering a forbidden key if you enforce it.

## Strengths

- Canonical config persistence is now enforced: `pinRound` persists `JSON.stringify(parsed.config)` and rejects unknown keys via `.strict()` (pin-round.ts:45-49,66-69; config-schema.ts:35-45).
- Per-player handicaps now fail closed on non-finite numbers and invalid shape (pin-round.ts:50-55; config-schema.ts:52-55).
- Tenancy provenance is correctly derived from the `rounds` table and rejects missing rounds (pin-round.ts:56-65,75-76).
- Existing-row guard in the conflict/no-op path avoids the prior `existing[0]!` crash and throws a clear diagnostic if invariants are violated (pin-round.ts:84-93).
- Tests cover the addressed regressions: NaN handicap rejection, round-not-found, and strict unknown-key rejection; and the valid `guyan-2v2` config is explicitly accepted (pin-round.test.ts; game-config.test.ts).

## Warnings

None.
