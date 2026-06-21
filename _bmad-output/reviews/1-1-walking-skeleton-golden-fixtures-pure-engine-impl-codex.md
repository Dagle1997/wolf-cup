# Codex Review

- Generated: 2026-06-21T20:22:47.821Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/resolver.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/engine/games/ledger-to-edges.ts, apps/tournament-api/src/engine/games/modifiers/net-skins.ts, apps/tournament-api/src/engine/games/games/guyan-2v2.ts, apps/tournament-api/src/engine/games/index.ts, apps/tournament-api/src/engine/games/guyan-2v2.golden.test.ts, apps/tournament-api/src/engine/games/resolver.test.ts, apps/tournament-api/src/engine/games/games.property.test.ts, apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-base-flat.json

## Summary

Money math for the core Guyan 2v2 hole scoring (+1/-1 per base point, skin gate net<=par, team total independent, net-skins winner-takes-all-by-level with equal-level no-blood) and the cross-team matrix -> SettlementEdge lowering look consistent with the described model and are covered by golden + property invariants. The main risks are (a) fail-open behavior on incomplete hole data, and (b) missing fail-closed validation for unsupported modifier variants (gross/double), which can silently compute the wrong money.

Overall risk: high

## Findings

1. [critical] Unsupported net-skins variants are not rejected; can silently compute wrong money (e.g., bonus:'double' treated as single, basis:'gross' silently disables)
   - File: apps/tournament-api/src/engine/games/games/guyan-2v2.ts:18-22
   - Confidence: high
   - Why it matters: Story spec says Story 1.1 supports net basis + single only; gross/double are later epics. Current behavior is not fail-closed:
- If config sets variant.bonus='double', `netSkinsActive()` still returns true and the engine applies the single bonus anyway (underpays vs intended config).
- If config sets variant.basis='gross', `netSkinsActive()` returns false and the modifier is effectively ignored (also wrong vs intended config).
Because `validateResolvedConfig()` only checks modifier *type* (registry.ts) and not variant support, these mismatches will pass validation and produce an incorrect settlement without surfacing an “unsettleable” state.
   - Suggested fix: Enforce variant support during validation (preferred):
- In `validateResolvedConfig`, when m.type==='net-skins' and m.enabled, require `(m.variant?.basis ?? 'net')==='net'` and `(m.variant?.bonus ?? 'single')==='single'`, else return `{ok:false, reason:'unsupported_modifier_variant:net-skins:...'}`.
Or enforce in `netSkinsActive()` by throwing/rejecting unsupported variants (but that’s less clean than fail-closed validation). Add tests covering gross + double variants producing rejection.

2. [high] Incomplete holes are silently skipped instead of fail-closed, risking under/over settlement without surfacing data issues
   - File: apps/tournament-api/src/engine/games/compute-foursome.ts:25-29
   - Confidence: high
   - Why it matters: This engine is money-critical. `computeFoursome` currently does:
```ts
if (members.some((p) => hole.net[p] === undefined)) continue;
```
So any hole missing a single player net is omitted from settlement. That can silently change money outcomes and will be hard to detect upstream (especially if the caller expects a full-round settle). The story’s “fail-closed” emphasis suggests incomplete inputs should produce an unsettleable error, not a partial settle.
   - Suggested fix: Change the API to return a Result (ok/err) or throw a structured error when encountering an incomplete hole, e.g. `throw new Error('incomplete_hole_state:holeNumber=...')`. If partial settlement is a desired feature, make it explicit via an option (e.g., `allowIncompleteHoles`) and default it to fail-closed. Add tests for incomplete holes to ensure expected behavior.

3. [medium] Point value parity requirement enforced at runtime only; can crash settlement instead of yielding unsettleable validation result
   - File: apps/tournament-api/src/engine/games/compute-foursome.ts:33-36
   - Confidence: high
   - Why it matters: The engine requires splitting `pv/2` into cross-team pairs to keep integer cents. `computeFoursome` enforces this by throwing if `pv % 2 !== 0`. If config comes from DB/user input, this becomes a runtime crash path rather than a clean “unsettleable” result. Also, the error message says “whole-dollar”, but the actual requirement is “even cents” (e.g., 50 cents is fine).
   - Suggested fix: Validate `pointValueSchedule` earlier (in resolver/registry validation) and return `{ok:false, reason:'invalid_point_value_schedule:odd_cents'}`. Adjust the error message to match the real constraint (“must be even cents”). Add a unit test that an odd-cent schedule is rejected (or throws, if you keep throwing).

4. [medium] Resolver selects the first 'event' row; duplicate event rows can cause order-dependent resolution
   - File: apps/tournament-api/src/engine/games/resolver.ts:48-55
   - Confidence: medium
   - Why it matters: `resolveConfig` uses `rows.find((r) => r.level === 'event')`. If the caller accidentally supplies multiple event-level rows (e.g., data duplication), the resolved config depends on input ordering, violating the order-independence intent and potentially settling money under the wrong configuration.
   - Suggested fix: Fail closed on duplicates: count rows by level and reject if `event` count != 1 (and optionally if more than one row exists for `round` or `foursome` for the same identity, depending on your data model). Add a test case for duplicate event rows returning `{ok:false, reason:'duplicate_event_level_config'}` (or similar).

5. [medium] Duplicate hole numbers are not detected; duplicates will be double-counted
   - File: apps/tournament-api/src/engine/games/compute-foursome.ts:22-27
   - Confidence: medium
   - Why it matters: Holes are sorted by `holeNumber` but not validated for uniqueness. If the input contains the same hole twice (a plausible integration/data bug), settlement will count it twice and move real money incorrectly.
   - Suggested fix: Validate `holeNumber` uniqueness (and optionally range 1..18) before computing. If duplicates exist, fail-closed with a structured error/reason. Add a test for duplicate hole numbers.

6. [low] No validation of point value schedule bounds (negative/zero cents)
   - File: apps/tournament-api/src/engine/games/games/guyan-2v2.ts:12-16
   - Confidence: medium
   - Why it matters: `pointValueCents` will return negative or zero cents if configured. That can invert money flows or make points worth nothing. If such configs should be impossible, they should be rejected explicitly rather than producing surprising settlements.
   - Suggested fix: Extend config validation to require non-negative integers (and likely >0) for schedule cents/frontCents/backCents. Add tests for rejecting negative values.

## Strengths

- Core per-hole scoring logic matches the described model: low-ball, skin gated by winning low ball net<=par, team total independent, and net-skins winner-takes-all by strictly higher best level with equal-level no-blood (guyan-2v2.ts:45-64; net-skins.ts:10-40).
- Cross-team matrix math correctly yields per-player net = pts*pv (A players) / -pts*pv (B players) while keeping integer cents via pv/2 split (compute-foursome.ts:37-44), and property tests assert zero-sum + loss-less edge reconciliation (games.property.test.ts:51-71).
- Determinism measures are present: holes sorted by holeNumber before accumulation (compute-foursome.ts:22-24) and edges sorted canonically (ledger-to-edges.ts:29-35).
- No evidence of forbidden imports (apps/api, apps/web, packages/engine) within the provided files; engine surface remains pure (no Date/random/db usage in implementation files).
- Resolver lock gate prevents lower-level override of event lockState as required (resolver.ts:57-89), and unknown modifier types / too-new configVersion are rejected after merge (registry.ts:46-58; resolver.ts:90-92).

## Warnings

None.
