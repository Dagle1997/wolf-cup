# Codex Review

- Generated: 2026-05-04T19:56:55.083Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md

## Summary

Spec is clear about the two-phase delivery and the intent to avoid circular validation. However, there are a few concrete risks/ambiguities that will likely cause either (a) path allowlist violations, (b) tests that don’t actually print the required “loud” skip reason in CI, or (c) future mis-verification because key money-rule parameters are under-specified (notably skins buy-in semantics and how “fixture comments” exist in JSON).

Overall risk: high

## Findings

1. [critical] Path allowlist violation risk: the provided story artifact is outside apps/tournament-api/**
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:1-146
   - Confidence: high
   - Why it matters: You state an explicit release-gate constraint: “ALLOWED only: apps/tournament-api/**” (lines 71-80). The file under review is in _bmad-output/**, which would violate that constraint if it’s committed as part of the story’s diff. If the gate is enforced mechanically (or by reviewer policy), this can block the merge or undermine the constraint discipline.
   - Suggested fix: Ensure this planning/spec file is not part of the shipped diff for T6-9 (or relocate it under apps/tournament-api/** if it must be committed). If your process requires retaining it, add an explicit note in the PR description that only the 3 files listed in lines 73-77 are included in the actual code diff.

2. [high] AC-6 “skip reason is discoverable” is not guaranteed by typical test runners using test.skip/skipIf
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:56-121
   - Confidence: high
   - Why it matters: The spec relies on `test.skipIf(...)` (line 56) and asserts the skip reason appears in CI output (lines 117-121). In many runners (Jest/Vitest), skipped tests often show only the test name and “skipped” without printing an arbitrary reason string unless you bake the reason into the test title or explicitly log it. If the reason is not printed, AC-6 fails and the “silent inert gate” problem remains.
   - Suggested fix: Make the reason part of the test title itself (e.g., `test.skip('[AWAITING JOSH HAND-CALC VERIFICATION] money fixture', ...)`) and/or emit a `console.warn` before skipping so CI logs capture it. Also avoid nonstandard APIs unless you’ve confirmed your runner supports them; if using Vitest, confirm `test.skipIf` exists in your version, otherwise implement a small helper: `if (unverified) { console.warn(...); test.skip(...); return; }`.

3. [high] Fixture references “fixture comments” and “top-level comment field”, but JSON has no comments—AC-2/AC-7 are underspecified and likely to be misimplemented
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:89-127
   - Confidence: high
   - Why it matters: AC-2 says rule-exercising conditions are “verified by inspecting the fixture comments” (line 93). AC-7 says add a `// REGENERATED...` header “to the JSON’s top-level comment field” (line 127). Standard JSON cannot contain comments, and “comment field” is not a defined schema. This ambiguity risks (a) invalid JSON being checked in, (b) engineers inventing different ad-hoc fields, or (c) losing the intended documentation of why the fixture exercises sandies/greenies/skins/carries.
   - Suggested fix: Define an explicit, valid JSON metadata field, e.g. `"__meta": { "notes": [...], "regenerated": "YYYY-MM-DD", "worksheet": "..." }` (or keep your existing `_handCalcWorksheet` but extend it). Update AC-2/AC-7 wording to reference that field rather than “comments”.

4. [high] Skins buy-in semantics are ambiguous (per round vs per event), which will break hand-calculation and expected.money verification later
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:30-34
   - Confidence: high
   - Why it matters: You specify: “Skins (gross mode) on all 4 rounds, buy-in 500¢ per participant” (line 31). It’s unclear whether that means 500¢ per player per round (common) or a single 500¢ per player for the entire 4-round event. The difference is 4× in pot size and will completely change `matrixCents`/`totalsCents` and the plausibility checks Josh will do. This is exactly the kind of ambiguity that causes later rework and undermines NFR-C1.
   - Suggested fix: Explicitly state the buy-in unit: e.g. “500¢ per player per round” (or “once per event”) and ensure the fixture encodes it in the same shape the engine expects (likely per sub-game instance / per round sub-game config).

5. [medium] Pending-state pattern: when verifiedBy becomes non-null, spec doesn’t require non-null expected fields; tests may crash/compare against null unintentionally
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:40-63
   - Confidence: medium
   - Why it matters: The `expected` block sets several fields to null initially (lines 44-52). The activation switch is `verifiedBy !== null` (lines 56-61, 100-101, 108-109). If someone sets `verifiedBy` but forgets to populate one of `matrixCents` / `totalsCents` / `skinsResults` / `betResults`, tests could fail with confusing runtime errors (null deref) rather than a clear “fixture incomplete” message, or worse, do a loose equality check depending on assertion code.
   - Suggested fix: In both tests, after `verifiedBy !== null`, add explicit guards with clear errors: assert all required expected fields are present and correctly typed (arrays/objects of integers) before running comparisons. Consider a single helper `assertFixtureVerified(fixture)` that validates presence/shape and throws a tailored message.

6. [medium] HTTP test seeding plan is extremely schema-coupled; spec doesn’t constrain using stable seeding APIs vs direct inserts, increasing brittleness and FD-1/FD-2 boundary risk
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:105-110
   - Confidence: medium
   - Why it matters: AC-4 requires direct inserts across many tables (line 109). This is brittle (any schema tweak breaks the test) and can violate domain layering if there are invariants normally enforced by service/repo code (e.g., derived fields, revision linking, membership constraints). You call this out as acceptable (lines 143-145), but FD-1/FD-2 “boundary violations” were explicitly requested for review: bypassing creation flows can also produce states the HTTP endpoints never see in production, reducing the end-to-end value of the roundtrip test.
   - Suggested fix: If available in apps/tournament-api, prefer existing test helpers/factories or API-level creation for the core entities (event, players, course/tees/holes, groups), and reserve direct inserts only for what cannot be created via public routes yet. At minimum, specify that inserts must follow the same constraints (FK order, revision pointers) as production code and include a single “schema version” comment in the test explaining expected columns.

7. [medium] “file::memory:?cache=shared” may not share the same DB connection as the HTTP server unless the app is explicitly wired for it
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:108-110
   - Confidence: medium
   - Why it matters: AC-4 assumes you can seed via direct DB inserts into a shared in-memory libsql DB and then exercise HTTP routes against that same data (line 109). In practice, if the server under test creates its own DB connection with a different URI/flags, it won’t see the seeded data. This can lead to flaky tests or tests that always fail until a hidden wiring change is made.
   - Suggested fix: In the integration test, ensure the HTTP app/server is constructed with the exact same DB client/connection instance used for seeding (dependency injection), or ensure both use the identical URI plus the correct libsql/sqlite URI configuration. Add an assertion after seeding and before HTTP calls that the server can read a known seeded row via an internal query or a lightweight GET endpoint.

8. [low] Engine-level expectations mention specific function names that may not match actual exported APIs
   - File: _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md:99-102
   - Confidence: medium
   - Why it matters: AC-3 names `compute2v2BestBall`, `computeIndividualBet`, `calcSkins` (line 101). If your actual engine exports differ (naming, signature, or aggregation responsibility), implementers may either add wrappers just for the test (unwanted) or “adjust” the spec ad hoc later, causing drift between intended and actual verification approach.
   - Suggested fix: Loosen AC wording to “invokes the existing engine calculators for best-ball, individual bet, and skins” and reference the actual module paths/exports once known, or add a small adapter layer inside the test only (not production) that maps fixture input to current engine functions.

## Strengths

- Clear two-phase delivery to avoid circular validation while still landing infrastructure early (lines 13-18, 65-70).
- Explicitly asserts anti-symmetry of the matrix and zero-sum totals (line 101), which are powerful invariants for catching money bugs.
- Round-scoped individual bet (line 34) is a good edge case to include in a compact fixture.
- Explicit path footprint list under apps/tournament-api (lines 73-77) shows good intent to comply with the allowlist (even though the current artifact file itself must not ship).

## Warnings

None.
