# Codex Review

- Generated: 2026-06-22T15:21:22.397Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/2-2-greenie-modifier-stateful-carryover-party-review.md, apps/tournament-api/src/engine/games/modifiers/greenie.ts, apps/tournament-api/src/engine/games/registry.ts

## Summary

Cross-checking the PARTY-MODE review against the provided implementation (greenie.ts, registry.ts): the domain/model description of greenie scoring + carryover + AC8 barrier matches what greenieFold actually does, and the review correctly notes the two registry hardening additions (non-object variant shape + carryover boolean type) and the per-modifier “don’t silently ignore stray levers” checks that were implemented. The main concern is that the review’s framing of the remaining deferred hardening items as purely “theoretical” is in tension with the implementation’s explicit goal of protecting direct callers bypassing Zod; at least `m.enabled` type validation looks like the same class of fail-closed guard as the ones that were treated as important enough to implement now.

Overall risk: medium

## Findings

1. [medium] Deferred “strict m.enabled boolean” is arguably not just a nit given the same direct-caller threat model used to justify implemented guards
   - File: _bmad-output/reviews/2-2-greenie-modifier-stateful-carryover-party-review.md:28-29
   - Confidence: high
   - Why it matters: The review explicitly praises/relies on validateResolvedConfig as a standalone fail-closed guard even for “direct callers passing UNVALIDATED JSON” (which is also the rationale embedded in registry.ts comments). However, validateResolvedConfig still does not validate that `m.enabled` is actually a boolean. If a direct caller passes `enabled: "false"` (truthy), the modifier will be treated as enabled (and subjected to variant checks / applied in compute), potentially settling money when the caller intended it to be inert. Because the story already added other direct-caller hardening (invalid_variant_shape and carryover boolean type checks), classifying enabled-type validation as merely a non-blocking nit is debatable and may be misclassified in the review artifact.
   - Suggested fix: Update the PARTY review to either (a) explicitly narrow the threat model (“only Zod-validated configs are supported; direct callers are out of scope”) OR (b) reclassify `m.enabled` boolean validation as should-fix for the same fail-closed posture, and implement a simple check in validateResolvedConfig (e.g., `typeof m.enabled === 'boolean'`).

2. [low] Review makes several concrete claims about compute-foursome/service/tests that are not verifiable from the provided implementation files
   - File: _bmad-output/reviews/2-2-greenie-modifier-stateful-carryover-party-review.md:21-57
   - Confidence: high
   - Why it matters: Large portions of the PARTY review assert specific behaviors outside greenie.ts/registry.ts (e.g., compute-foursome short-circuit ordering, service-layer dense-holes construction, DB-backed test behavior/values, and golden-gate coverage). None of those referenced files/tests are included here, so this verification pass cannot confirm the absence of drift/false claims for those sections. This is not necessarily wrong, but it’s a correctness/completeness risk for the review artifact if it’s meant to be auditable from code.
   - Suggested fix: If the written review is intended to be self-auditing, add file/function references (and ideally line anchors/commit SHAs) for the compute-foursome integration, dense-holes creation, and named tests/fixtures so a reader can trace each claim to code.

## Strengths

- Greenie domain rules described in the review align with greenieFold: count-based rawA (#A-#B), unclaimed carry increment/expiry, winner sweeps pending pot, contested preserves carry (greenie.ts 96–120).
- AC8 barrier described matches implementation: on first incomplete par-3 (any member net missing) the fold BREAKS, not filters; later par-3s are deferred (greenie.ts 67–74, 96–100).
- Allowlist-boundary protections the review calls out are present: registry registers greenie (registry.ts 36–38) and rejects cross-modifier levers (carryover on net-skins; basis/bonus on greenie) plus malformed enabled-variant shapes and non-boolean carryover (registry.ts 88–137).
- The review correctly classifies as not-yet-implemented: unknown-key rejection inside variant objects, explicit dense-holes precondition assertion, and stricter par handling; these are indeed not enforced in greenie.ts/registry.ts beyond comments.

## Warnings

None.
