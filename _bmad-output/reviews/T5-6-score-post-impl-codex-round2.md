# Codex Review

- Generated: 2026-04-28T15:55:08.492Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/middleware/require-scorer-for-round.test.ts, apps/tournament-api/src/routes/scores.integration.test.ts

## Summary

Round-1 race-safety and UNIQUE-error detection fixes are materially implemented (not just papered over): conditional UPDATE predicates plus `.returning()` length checks are exercised by the integration tests (state transition + audit assertions), and the 409 conflict test demonstrates `isUniqueConstraintError()` matches the libsql/drizzle error shape in this environment.

One concrete regression/bug exists in the concurrent-loss re-read query: it drops the tenant predicate, which can break tenant isolation and can also produce incorrect `postState` under unlikely but possible ID-collision / data-corruption scenarios. There are also a couple of smaller correctness hardening gaps (holeNumber NaN / <1 defense-in-depth; potential brittleness in UNIQUE detection if libsql changes field typing/names), but those are not demonstrated failures in the provided tests.

Overall risk: medium

## Findings

1. [medium] Concurrent-loss state re-read drops tenant filter (tenant isolation + correctness risk)
   - File: apps/tournament-api/src/routes/scores.ts:288-295
   - Confidence: high
   - Why it matters: In the `not_started → in_progress` transition, when the conditional UPDATE affects 0 rows (meaning another writer likely won), the code re-reads `round_states` using only `roundId` (`where(eq(roundStates.roundId, roundId))`). All other round/round_state accesses are tenant-scoped. If the DB ever contains multiple `round_states` rows with the same `roundId` across tenants (or if a malicious/buggy migration created duplicates), this re-read can return the wrong tenant’s state, causing incorrect `postState` and potentially triggering/avoiding auto-complete logic incorrectly. It also weakens the “defense-in-depth” tenant boundary the rest of the handler enforces.
   - Suggested fix: Include the same tenant predicate used everywhere else: `.where(and(eq(roundStates.roundId, roundId), eq(roundStates.tenantId, TENANT_ID)))`. Consider also selecting by the same key(s) that make the row unique (if composite PK includes tenantId).

2. [low] Handler allows NaN/invalid holeNumber if middleware contract is ever bypassed/mis-mounted
   - File: apps/tournament-api/src/routes/scores.ts:64-103
   - Confidence: high
   - Why it matters: `holeNumber` is parsed via `Number(c.req.param('holeNumber'))` and the handler only checks `holeNumber > round.holesToPlay`. If `holeNumber` is `NaN` (non-numeric path segment) or `< 1`, the comparison won’t catch it and an invalid value can reach the INSERT. Today this is likely prevented by `requireScorerForRound`, but the handler already includes other defense-in-depth checks; this is an inconsistent gap that can turn a routing/middleware regression into data-integrity issues or unexpected DB driver behavior (binding NaN).
   - Suggested fix: Add a local guard: `if (!Number.isInteger(holeNumber) || holeNumber < 1) return 400/422 (whichever spec dictates);` and keep the existing `> holesToPlay` check.

3. [low] UNIQUE detection may still be brittle if libsql/drizzle changes field names or numeric vs string typing
   - File: apps/tournament-api/src/routes/scores.ts:384-416
   - Confidence: medium
   - Why it matters: The new implementation is appropriately narrower than `message.includes('UNIQUE')`, and tests prove it works for the current libsql+drizzle error shape. However, if a future libsql version reports `extendedCode` as a number (or uses different property names like `errno`, `sqliteCode`, etc.) without setting `rawCode`, this function would fail to classify the UNIQUE violation and would throw, converting a designed 409 into a 500. This is not a demonstrated current bug but is an operational robustness concern for a boundary error path.
   - Suggested fix: If you want extra robustness without reverting to message substring matching, consider additionally accepting numeric `extendedCode === 2067` and/or checking a small allowlist of known field aliases (documented with links/versions). Add a unit test that simulates the wrapped error variants you expect to support.

## Strengths

- Race-safe state transitions are now based on conditional UPDATE predicates and are verified by integration tests that assert both state changes and audit rows (indirectly proving `.returning()` behavior in the libsql memory adapter).
- Idempotent replay path correctly avoids audit/activity emission when `.onConflictDoNothing()` results in no insert; the integration test now asserts audit count = 1 for `score.committed`.
- `isUniqueConstraintError()` is tightened in a principled way (code/extendedCode/rawCode + cause inspection) and is exercised by the 409 integration test, indicating it matches the current runtime error shape.

## Warnings

None.
