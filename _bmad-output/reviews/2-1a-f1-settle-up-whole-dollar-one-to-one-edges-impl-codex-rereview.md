# Codex Review

- Generated: 2026-06-22T13:38:17.159Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/ledger-to-edges.ts, apps/tournament-api/src/engine/games/ledger-to-edges.test.ts

## Summary

The three requested hardening changes are present and ordered sensibly: teamSplit structure is validated before any ID use, perPlayerCents keys are required (no `?? 0` masking), reconstruction guard remains, and `sum(edges) === ledger.totalCents` is enforced. No new regression affecting valid symmetric 2v2 whole-dollar settlement is evident from the provided code/tests.

One NEW gap remains in the new validations: the teamSplit check can be bypassed by non-array “array-like” values (e.g., strings) because only `.length`/indexing are used. Also, one edge-case can throw a raw TypeError instead of `incomplete_ledger` if `ledger.perPlayerCents` is missing/null at runtime.

Overall risk: medium

## Findings

1. [medium] teamSplit validation can accept non-array, array-like inputs (e.g., strings) and emit edges with unintended parties
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:30-45
   - Confidence: high
   - Why it matters: Current validation checks `teamA?.length === 2` and reads `teamA?.[0]`, `teamA?.[1]` but does not assert `Array.isArray(teamA)` / `Array.isArray(teamB)`. A malformed caller could pass `teamA: 'ab'` and `teamB: 'cd'` (or other array-like objects) which would pass length/index checks and produce edges for parties `'a','b','c','d'` rather than failing closed. This is a direct “malformed input slips through” path.
   - Suggested fix: Strengthen the structural guard:
- `if (!Array.isArray(teamA) || !Array.isArray(teamB) || teamA.length !== 2 || teamB.length !== 2 ...) throw`
This closes the array-like bypass while keeping existing distinct/non-empty checks.

2. [low] If ledger.perPlayerCents is missing/null at runtime, code throws TypeError instead of `incomplete_ledger` (fail-closed but misclassified)
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:51-56
   - Confidence: medium
   - Why it matters: The loop uses `Object.prototype.hasOwnProperty.call(pp, m)` where `pp = ledger.perPlayerCents`. If `perPlayerCents` is `undefined`/`null` due to an upstream runtime bug, `hasOwnProperty.call(pp, m)` will throw a TypeError before your intended `incomplete_ledger` error. This is still fail-closed (no edges emitted), but it breaks the stated contract “else throw incomplete_ledger” and may reduce debuggability/metrics consistency if callers key off error codes.
   - Suggested fix: Add a small guard before iterating:
- `if (!pp || typeof pp !== 'object') throw new Error('incomplete_ledger: perPlayerCents missing');`
Optionally also validate `Number.isInteger(ledger.totalCents)` for symmetry with the new checks.

## Strengths

- Guard ordering is fail-closed: teamSplit validated before dereferencing player IDs; perPlayerCents validated before edge emission; reconstruction check precedes ledger-total check; any failure throws before returning edges.
- `?? 0` masking is removed; required per-player keys are enforced with an integer check, matching the stated hardening intent.
- Loss-less invariant is explicitly enforced via `edgeTotal !== ledger.totalCents` with a dedicated `ledger_total_mismatch` throw.
- Whole-dollar 1-to-1 behavior for valid symmetric ledgers is preserved: edges are derived from per-player nets, reconstruction verifies exact per-player balances, and tests cover A-up/B-up/push and the old half-dollar scenario.

## Warnings

None.
