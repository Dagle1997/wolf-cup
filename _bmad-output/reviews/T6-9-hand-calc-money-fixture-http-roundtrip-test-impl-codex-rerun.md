# Codex Review

- Generated: 2026-05-04T20:35:17.320Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts, apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc-generator.mjs, apps/tournament-api/src/routes/money-handcalc.integration.test.ts

## Summary

Round-2 changes generally address the prior findings (rules disabled for parity, shape guard added in verified path, and a client-close attempt exists). Remaining issues are mostly around test reliability when the suite becomes active: resource cleanup doesn’t cover the full test body (risking hanging handles on failure), and in-test mocking without a module reset can silently fail depending on module cache state. There’s also a correctness risk in the engine-level skins-to-pairwise ledger conversion due to truncation rounding.

Overall risk: high

## Findings

1. [high] libsql client cleanup only runs after the final assertions; earlier failures can leak handles and hang the test runner
   - File: apps/tournament-api/src/routes/money-handcalc.integration.test.ts:81-419
   - Confidence: high
   - Why it matters: The `try/finally` that closes `__testClient` is wrapped only around the final `expect(...)` calls (lines ~405-418). Any exception thrown earlier (migration failure, seed failure, any POST /complete /finalize failure, JSON parse error, etc.) will bypass the `finally` and leave the libsql client open. This is exactly the class of issue that causes Vitest to hang on open handles—especially relevant because this suite is intended to become a release gate once verified.
   - Suggested fix: Wrap the entire body after the client is created in a single `try/finally` (or use `afterEach/afterAll` within the describe block) so *any* thrown error triggers `__testClient.close?.()`. For example, start `try { ...` immediately after setting up the mocks / importing db, and end with the close in `finally`.

2. [medium] `vi.doMock` inside the test may not take effect if modules were previously imported/cached; missing `vi.resetModules()` makes the test order-dependent
   - File: apps/tournament-api/src/routes/money-handcalc.integration.test.ts:85-125
   - Confidence: high
   - Why it matters: This test relies on `vi.doMock('../db/index.js', ...)` (and `require-session`) before importing routers so that routes, seeding, and handlers share the same in-memory client. However, `vi.doMock` does not retroactively affect already-imported modules. If any prior test in the same worker imported `../db/index.js` (or a router that imports it) before this test runs, the import at line ~119 and/or router imports at ~121-123 can resolve to the cached real module, silently bypassing the mock. That creates flaky behavior (real DB usage, wrong client instance, or inconsistent state).
   - Suggested fix: Before `vi.doMock(...)`, add `vi.resetModules()` (and possibly `vi.clearAllMocks()`), then perform the mocks, then import `../db/index.js` and the routers. Alternatively, move the mocks to module scope with `vi.mock(...)` (if acceptable) to guarantee they apply before any imports.

3. [medium] Engine-level skins pairwise ledger uses `Math.trunc((potA - potB)/N)` which can lose/shift cents when potShares are not divisible in a way that preserves integer deltas
   - File: apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts:175-197
   - Confidence: high
   - Why it matters: The conversion from `skinsOut.potShares` to per-pair settlements divides by `N` and truncates (line ~190). This works cleanly when every `(potA - potB)` is a multiple of `N`, but can drift by 1+ cents in legitimate scenarios (e.g., pot split among 3 winners with remainder distribution, where differences like 668-666 yield 0.5). That can break anti-symmetry/zero-sum or produce a matrix that doesn’t match whatever production settlement logic is, causing the release-gate assertion to fail unexpectedly once the fixture is verified or if skins configuration changes.
   - Suggested fix: Avoid truncating pairwise deltas. Prefer deriving each player’s net for the round (e.g., `net[player]=potShare-buyIn`) and then generating a pairwise matrix via a deterministic settlement algorithm that preserves exact integer cents (e.g., settle creditors/debtors), or reuse/centralize the same logic production uses to turn skins results into the money matrix.

4. [low] Generator comments and retained data structures still describe sandies/greenies behavior even though they’re disabled in config
   - File: apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc-generator.mjs:6-176
   - Confidence: high
   - Why it matters: The generator header and several comments still claim the scores are tuned to produce sandies/greenies and that greenie validation is “2-putt”, while `BEST_BALL_CONFIG` explicitly disables sandies and carry-greenies and sets `greenieValidation: 'none'` (lines ~61-77). This doesn’t break runtime behavior, but it does create a maintenance trap: future readers may assume coverage that the enabled rules no longer exercise, and may re-enable flags without re-checking assumptions.
   - Suggested fix: Update the top-level and CTP/sandie commentary to clearly state that those annotations/data are intentionally present-but-inactive under T6-9d, and ensure the “greenie validation” description matches the current config (`none`).

5. [low] Organizer seeded with `isOrganizer: false` while the mocked session sets `isOrganizer: true`; potential auth inconsistency if routes consult DB flags
   - File: apps/tournament-api/src/routes/money-handcalc.integration.test.ts:152-163
   - Confidence: low
   - Why it matters: The DB row for the organizer is inserted with `isOrganizer: false` (line ~154), but `requireSession` sets `c.set('player', { isOrganizer: true })` for organizer requests (buildApp call at ~359). If any route checks organizer status from persisted data instead of (or in addition to) session context, the test can fail or, worse, pass for the wrong reasons depending on implementation.
   - Suggested fix: Set the organizer’s DB row to `isOrganizer: true` (or align the mocked session to match DB) so both layers agree and the test reflects real authorization behavior.

## Strengths

- Verified/unverified gating is implemented consistently across engine and HTTP tests, with clear CI discovery via suite title + console.warn.
- The fixture expected-shape guard is now invoked in the verified-path before any deep equality assertions (prevents accidental activation with null expected fields).
- HTTP test correctly posts scores through real routes and finalizes rounds, making it a strong end-to-end regression check once activated.
- Engine-level test asserts anti-symmetry and global zero-sum in addition to deep equality against the expected matrix/totals.

## Warnings

None.
