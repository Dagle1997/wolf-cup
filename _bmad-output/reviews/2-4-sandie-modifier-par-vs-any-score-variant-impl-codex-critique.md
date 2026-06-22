# Codex Critique

- Generated: 2026-06-22T18:15:32.171Z
- Critiquing: gemini-pro-latest
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-api/src/engine/games/modifiers/sandie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts

## Verdict

**SHIP** — overall agreement: partial

## Summary

Gemini’s “zero findings / exceptional” conclusion is directionally right on money-correctness: the Sandie implementation is a stateless pure-count and, as shown, there is no reachable money-settlement bug. However, “no concrete findings” overstates it—there are a few low-severity robustness/test-coverage nits (including the ones you listed). None are blocking given your stated threat model (config from JSON + Zod .strict() at write + computeFoursome validating configs).

## Critiques of prior findings

1. [disagree] “No concrete findings were identified.”
   - Reasoning: There are legitimate low-severity findings: (1) redundant self-guard (computeFoursome already gates on sandieOn), (2) fail-closed variant key check uses Object.keys which ignores symbol keys / non-enumerables, and (3) missing a unit test for present-but-disabled sandieActive behavior. They’re not money-correctness blockers under the provided assumptions, but they are still concrete review notes.

2. [partial] “Fail-closed variant validations are robust and exactly match FR44.”
   - Reasoning: Functionally robust for the real production path (JSON → Zod strict → validateResolvedConfig). But strictly speaking, the sandie ‘no variant keys’ check can be bypassed by symbol keys or non-enumerable properties because it uses Object.keys. That’s a direct-caller / adversarial-object edge case and does not affect money (sandie ignores variant), so it’s more theoretical than operational.

3. [agree] “computeFoursome integration is precise and demonstrably preserves stability.”
   - Reasoning: The integration is consistent with other modifiers: sandieOn is hoisted once, sandiePoints is stateless and range-bounded (−2…+2), and it only reads team member claim flags. No ordering/state interactions are introduced, and the points are folded into `pts` like polie/greenie, preserving the existing settlement mechanics.

## Additional findings (Codex caught, prior reviewer missed)

1. [low] Redundant active-check (self-guard) inside sandiePoints
   - File: apps/tournament-api/src/engine/games/modifiers/sandie.ts:39-48
   - Confidence: high
   - Why it matters: computeFoursome already gates the call with `sandieOn ? sandiePoints(...) : 0`, so the internal `if (!sandieActive(config)) return 0;` is redundant. It’s not incorrect; it’s just extra work / extra dependency on config scanning in the helper, and slightly muddles the intended call contract (either ‘always safe’ or ‘caller must gate’).
   - Suggested fix: Pick one pattern consistently: either (a) keep sandiePoints self-guarded and remove the outer ternary in computeFoursome, or (b) remove the internal guard and treat sandiePoints as ‘requires active’ (matching the hoist). Given you note it matches poliePoints’ shipped pattern, leaving it is fine.

2. [low] Fail-closed sandie variant key check ignores symbol keys / non-enumerable props
   - File: apps/tournament-api/src/engine/games/registry.ts:163-168
   - Confidence: high
   - Why it matters: Object.keys only returns enumerable string keys. A direct caller could pass `variant` with symbol keys or non-enumerable properties and bypass the intended ‘sandie has zero allowed variant keys’ rejection. In your stated model (JSON config + Zod strict), this is not reachable, and since sandie ignores variant entirely it also doesn’t create a money-correctness bug—this is mostly a “fail-closed purity” nit.
   - Suggested fix: If you want the guard to be truly ‘any own key’, use `Reflect.ownKeys(m.variant)` (and optionally require a plain object via `Object.getPrototypeOf(m.variant) === Object.prototype`).

3. [low] Missing unit test for sandieActive when modifier present but disabled
   - File: apps/tournament-api/src/engine/games/modifiers/sandie.ts:23-27
   - Confidence: medium
   - Why it matters: This is a small behavior edge that can regress silently: config contains `{type:'sandie', enabled:false}` should make sandieActive false and sandiePoints contribute 0. It’s unlikely to break, but it’s cheap coverage for a money engine toggle.
   - Suggested fix: Add a test asserting `sandieActive` returns false when present+disabled, and that computeFoursome doesn’t move money in that config even if claims are checked.

## Consensus recommendations

- Ship as-is: no reachable money-correctness bugs are evidenced in the Sandie pure-count logic or its computeFoursome folding under the stated config pipeline (JSON + Zod strict + validateResolvedConfig).
- Optionally tighten the registry sandie-variant allowlist check from Object.keys to Reflect.ownKeys for a more airtight fail-closed story against exotic direct-caller objects.
- Add the small present-but-disabled sandieActive unit test; keep or simplify the redundant self-guard depending on your preferred consistency pattern.

## Warnings

None.
