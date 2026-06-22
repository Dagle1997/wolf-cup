# Codex Review

- Generated: 2026-06-22T17:53:04.448Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md

## Summary

The 4 previously flagged items appear incorporated in the spec text: Fixture 1 now includes an all-four-boxes hole that must net to 0; AC10 now explicitly allows absent/empty `variant:{}` and clarifies shared-guard ordering; and AC2/Task 2 now require `sandiePoints(..., config)` with a self-guard returning 0 when inactive. One remaining potential blocking issue: AC10’s “fail-closed allowlist” intent is undermined by only rejecting a fixed set of *recognized* variant keys—an enabled sandie with an *unknown* variant key would be accepted (silently inert), which is not truly fail-closed and can hide config typos/misconfigs.

Overall risk: medium

## Findings

1. [medium] AC10 ‘fail-closed variant allowlist’ is not truly fail-closed if unknown variant keys are accepted
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:66
   - Confidence: high
   - Why it matters: AC10 is labeled “Fail-closed, per-modifier variant allowlist” (FR44), and the user expectation mentions a “fail-closed no-variant allowlist.” However, AC10 specifies rejecting only a fixed list of known keys (`basis`/`bonus`/`carryover`/`polieBogeyOrBetter`) and explicitly says “only a recognized variant KEY rejects.” That implies an enabled sandie config like `{ type:'sandie', enabled:true, variant:{ typoBasis:true } }` or `{ variant:{ foo:1 } }` would pass validation and be silently ignored. This is the opposite of fail-closed behavior and is a money-settlement risk because it can mask operator/config mistakes and produce unexpected settlement outcomes without any error signal.
   - Suggested fix: Tighten AC10 to: for enabled sandie, `variant` must be absent or an empty object; if `variant` has *any* keys (including unknown), reject. Implementation-wise: after the shared guards, if `enabled && variant && Object.keys(variant).length>0`, return `unsupported_sandie_variant:<firstKey>` (using deterministic key order if needed). If you want to preserve the explicit ordering for known keys, you can still special-case them first, but fall back to rejecting any remaining keys.

## Strengths

- Fixture 1 now explicitly includes the ‘all four players checked’ scenario (H5) that must evaluate to 0, aligning with AC1’s stated coverage (lines 101–111).
- AC10 now clearly allows absent `variant` and empty `variant:{}` as inert, and clarifies the shared-guard execution order before sandie-specific checks (line 66).
- Resolver contract now matches the shipped pattern by threading `config` into `sandiePoints(...)` and requiring a self-guard returning 0 when inactive (AC2 line 52; Task 2 line 77).
- Golden hand-calc numbers are fully spelled out (per-player cents, edges, ledger total), which supports an unambiguous NFR-C1 spec gate (lines 95–115).

## Warnings

None.
