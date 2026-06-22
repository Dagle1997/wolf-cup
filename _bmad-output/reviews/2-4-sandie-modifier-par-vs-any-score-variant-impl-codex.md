# Codex Review

- Generated: 2026-06-22T18:13:24.178Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/modifiers/sandie.ts, apps/tournament-api/src/engine/games/modifiers/sandie.test.ts, apps/tournament-api/src/engine/games/sandie.golden.test.ts, apps/tournament-api/src/engine/games/__fixtures__/sandie-count.json, apps/tournament-api/src/engine/games/__fixtures__/sandie-all-push.json, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/engine/games/games.property.test.ts

## Summary

Implementation matches the Story 2.4 “PURE COUNT” sandie model: sandiePoints is A-positive (#A−#B), ignores foreign claim keys by only reading team members (FR23), has a self-guard, and computeFoursome folds sandie into pts before the pts===0 short-circuit. Registry registration + fail-closed variant rejection for enabled sandie is present, and the added unit/property/golden tests cover the required scenarios (1-box/2-box/contested/all-four, all-push ⇒ empty edges, additivity, order-independence). I don’t see a money-sign inversion or a settlement-path regression.

Two small gaps remain vs the “truly fail-closed”/“hoisted” intent, but they’re mainly robustness/perf rather than immediate money mis-settlement under the validated-production path.

Overall risk: low

## Findings

1. [low] computeFoursome hoists sandieActive, but sandiePoints re-checks config per hole (extra find + potential inconsistency if config is mutated)
   - File: apps/tournament-api/src/engine/games/compute-foursome.ts:60-82
   - Confidence: high
   - Why it matters: The comment says the active check is hoisted out of the loop, but when sandie is enabled you still pay an extra config.modifiers.find() per hole because sandiePoints self-guards via sandieActive (apps/tournament-api/src/engine/games/modifiers/sandie.ts:45). This isn’t a money-correctness bug under the current “validated + immutable config” assumption, but it is (a) unnecessary work and (b) creates a weird edge if any caller ever mutates config.modifiers during computation: sandieOn could be true while sandiePoints returns 0 (or vice versa), producing a hard-to-debug partial application.
   - Suggested fix: Keep the required self-guard, but split the implementation:
- a pure internal `sandieCount(hole, teamA, teamB)` (no config)
- `sandiePoints` does `if (!sandieActive(config)) return 0; return sandieCount(...)`
- computeFoursome uses `sandieOn ? sandieCount(...) : 0` to avoid the second lookup.

2. [low] Registry’s “fail-closed on ANY variant key” can be bypassed by non-enumerable or symbol keys (direct-caller edge)
   - File: apps/tournament-api/src/engine/games/registry.ts:157-168
   - Confidence: medium
   - Why it matters: The spec explicitly asks for “ANY non-empty variant (known OR unknown key)” to be rejected for enabled sandie. The current check uses `Object.keys(m.variant)` which only includes own *enumerable string* keys. A malicious or buggy direct caller (bypassing Zod) could attach non-enumerable properties (or symbols) and slip through validation while still ‘carrying’ a lever-like marker. This likely can’t happen via JSON/Zod, so it’s not a practical production bug, but it’s a real gap relative to the strongest possible interpretation of “ANY key.”
   - Suggested fix: If you want the strictest possible fail-closed behavior for direct callers, use `Reflect.ownKeys(m.variant)` and optionally check property descriptors for enumerability if you care. Alternatively, explicitly require a plain object in the shape guard (e.g., `Object.getPrototypeOf(variant) === Object.prototype`).

3. [low] Unit tests don’t cover the explicit “present but disabled” sandieActive case
   - File: apps/tournament-api/src/engine/games/modifiers/sandie.test.ts:39-44
   - Confidence: high
   - Why it matters: sandieActive is intended to mean “present AND enabled”. The helper test covers “present+enabled” and “absent”, but not `{ type:'sandie', enabled:false }`. This is minor (and validateResolvedConfig enforces enabled’s boolean-ness anyway), but adding it would lock the intended semantics and prevent regressions if sandieConfig() ever changes to include a disabled entry rather than omission.
   - Suggested fix: Add: `expect(sandieActive({ ...sandieConfig(), modifiers:[{type:'sandie', enabled:false}] })).toBe(false)` (or update sandieConfig to support enabled:false directly and test it).

## Strengths

- sandiePoints correctly implements the signed pure-count model (#A−#B) and uses `=== true` to avoid truthiness surprises (apps/tournament-api/src/engine/games/modifiers/sandie.ts:29-48).
- Foreign claim isolation is correctly achieved by only reading claim flags for the four team member ids, not iterating claim keys (sandie.ts:46-48), and is explicitly tested (sandie.test.ts:68-73).
- computeFoursome wires sandie into pts before the pts===0 short-circuit, preserving “all-push ⇒ skip ⇒ empty edges” behavior (compute-foursome.ts:74-83) and leaving the 2v2 split logic untouched (NFR-C7).
- Registry branch is correctly placed after the shared enabled/type/variant-shape guards, and allows absent/empty variant while rejecting any non-empty variant for enabled sandie (registry.ts:105-116, 157-168); tests cover known keys and unknown keys (sandie.test.ts:100-124).
- Golden fixtures + property test additivity check the intended 1-to-1 whole-dollar settlement math and order-independence for sandie-only configs, reducing risk of silent money drift (sandie.golden.test.ts; games.property.test.ts:240-294).

## Warnings

None.
