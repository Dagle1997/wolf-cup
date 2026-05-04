# Codex Review

- Generated: 2026-05-04T20:29:40.782Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts, apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc-generator.mjs, apps/tournament-api/src/routes/money-handcalc.integration.test.ts, _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md

## Summary

Adds a deterministic Pinehurst-shaped fixture generator + two scaffolded tests (engine + HTTP) that self-skip until `fixture.expected.verifiedBy`/`verifiedDate` are set. Pending-state gating is mostly solid, but the HTTP roundtrip currently does not apply key fixture inputs (CTP/greenie meta + sandies flag), and the generator’s intent annotations contain concrete inconsistencies with the generated scores—both are likely to derail or mislead the eventual hand-calculation verification.

Overall risk: high

## Findings

1. [high] HTTP roundtrip does not apply fixture’s CTP (greenie) metadata or sandies flags, so money output will diverge from fixture once verified
   - File: apps/tournament-api/src/routes/money-handcalc.integration.test.ts:306-352
   - Confidence: high
   - Why it matters: The fixture explicitly exercises sandies + carry-greenies and the engine-level test passes `holeMeta` and `sandyFromBunker`-annotated scores into the calculators. In the HTTP test, scores are posted with only `{ playerId, grossStrokes, putts, clientEventId }` (no `sandyFromBunker`) and there is no seeding or HTTP call to set closest-to-pin per hole (CTP) for greenies/carryover. If the production money computation uses these fields (as implied by the fixture + best-ball config), the HTTP computed matrix will miss sandie/greenie money and fail the equality assertion once the suite activates, or worse: Josh might hand-calc including these features and be blocked by a test that never set the inputs.
   - Suggested fix: Extend the HTTP seed/roundtrip to write the same data the engine path consumes:
- When posting scores, include `sandyFromBunker` if the scores route supports it (or insert/update the underlying score rows directly if not).
- Seed or POST the per-hole CTP/`closestToPinPlayerId` meta for each round (whatever table/route the app uses for hole meta). Use `fixture.rounds[].holeMeta` as the source of truth.
- Add a small assertion that the meta/flags were persisted (e.g., query the relevant table) before calling `/complete`/`/finalize`, to avoid silent no-ops.

2. [medium] Fixture generator’s score-intent annotations contradict the actual generated scores on specific holes (risking incorrect hand-calc)
   - File: apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc-generator.mjs:89-180
   - Confidence: high
   - Why it matters: The `__meta.scoreIntentByHole` notes are explicitly meant to guide Josh’s hand-calculation. Several comments/intent entries are inconsistent with the hard-coded offsets:
- Round 2 comment says “P4 birdies the par 5 hole 11” (line ~98-104), but `ROUND_OFFSETS[2].P4[11]` is `0` → par on hole 11.
- Score intent says Round 2 hole 11 “P1+P4 both -1 → skin tie-carry” (line ~169-170), but Round 2 P1 hole 11 offset is `0` and P4 hole 11 offset is `0`.
- Score intent says Round 4 hole 18 “No outright low gross → split-among-winners triggers” (line ~179-180), but Round 4 hole 18 offsets are `P1:0, P2:1, P3:1, P4:2` → P1 is outright low gross.
These inconsistencies can cause Josh to focus on the wrong holes and derive an incorrect expected matrix, creating avoidable churn and undermining the goal of a trustworthy hand-verified fixture.
   - Suggested fix: Reconcile `SCORE_INTENT`/inline comments with the actual `ROUND_OFFSETS` (or adjust offsets to match the narrative). At minimum, fix the three items above so the worksheet guidance is reliable. Consider adding a lightweight self-check in the generator (even just asserts) that validates the documented intent against computed gross scores for the referenced holes.

3. [medium] HTTP test lacks a fixture-shape guard when verified; null `expected.matrixCents`/`totalsCents` will fail with non-actionable errors
   - File: apps/tournament-api/src/routes/money-handcalc.integration.test.ts:364-391
   - Confidence: high
   - Why it matters: The suite activation predicate only checks `verifiedBy` and `verifiedDate` (lines 40-49). If someone sets those fields but forgets to fill `matrixCents`/`totalsCents`, the test proceeds and then relies on non-null assertions (`expected.matrixCents!`, `expected.totalsCents!` at lines 366-367), which will cause a TypeError or confusing deep-equality mismatch rather than a clear “fixture is incomplete” diagnostic. The engine test has an explicit guard (`assertFixtureExpectedShape`), but the HTTP test currently does not.
   - Suggested fix: Add a small `assertFixtureExpectedShape` helper (can be shared/copied from the engine test) and call it at the start of the test when `verified` is true, before any DB/migration work. This keeps failures actionable and aligned with the release-gate intent.

4. [medium] Mocked libsql client is never closed; when suite activates it may leak handles and hang the Vitest run
   - File: apps/tournament-api/src/routes/money-handcalc.integration.test.ts:82-110
   - Confidence: medium
   - Why it matters: `vi.doMock('../db/index.js'...)` creates a libsql client (line 84) and enables foreign keys (line 86), but the client is not closed at the end of the test. Many DB clients keep the event loop alive; this can cause the suite to hang or require `--forceExit`, especially once this gate becomes active in CI.
   - Suggested fix: Capture the created client in an outer variable and close it in a `try/finally` inside the test, or add `afterAll(async () => client.close())` (or the appropriate libsql close method). If the close method is `client.close()`/`client.disconnect()`, call it explicitly. Also consider `vi.resetModules()`/`vi.restoreAllMocks()` at the end if module state is reused in other tests.

5. [low] Pending-state pattern claims “no module-scope side effects” but intentionally logs at module scope
   - File: apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts:85-96
   - Confidence: high
   - Why it matters: Both tests emit `console.warn` at module scope when unverified. This is intentional per AC-6, but it does mean the skipped path still has an observable side effect and contradicts the comment that module scope is only import + predicate eval (lines 98-101). Not a functional bug, but worth acknowledging because it can surprise future maintainers and create noisy output locally.
   - Suggested fix: Either (a) adjust the comments to explicitly permit module-scope logging as the only allowed side effect, or (b) move the warn inside the skipped `describe` block (noting that some reporters may not execute skipped bodies—verify in Vitest first).

## Strengths

- Strict activation predicate (`verifiedBy` non-empty + `verifiedDate` YYYY-MM-DD) and use of `describe.skip` with reason baked into suite title are robust for discoverability.
- Engine-level test includes a clear verified-branch shape guard (`assertFixtureExpectedShape`) and asserts anti-symmetry + zero-sum invariants before deep equality.
- HTTP test correctly delays all expensive imports/mocks/DB work until inside the (potentially skipped) test, and includes a seed sanity check before issuing HTTP requests.
- UUID remap helpers for comparing logical fixture IDs to DB-minted UUIDs are straightforward and should produce stable assertions once expected values exist.

## Warnings

None.
