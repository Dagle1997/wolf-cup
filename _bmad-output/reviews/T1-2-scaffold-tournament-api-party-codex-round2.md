# Codex Review

- Generated: 2026-04-20T14:32:06.282Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/app.ts, apps/tournament-api/src/index.ts, apps/tournament-api/src/port.ts, apps/tournament-api/src/port.test.ts, _bmad-output/implementation-artifacts/tournament/T1-2-scaffold-tournament-api.md, _bmad-output/reviews/T1-2-scaffold-tournament-api-party-review.md

## Summary

Port resolver extraction is clean and avoids binding a port during unit tests. However, `resolvePort()` currently uses `Number.parseInt`, which is permissive and will accept partially-numeric strings (e.g. `"3001abc"`, `"3001.5"`, `"3e3"`) without warning—this conflicts with the revised AC #2a requirement to reject non-numeric inputs and can silently bind the wrong port. Tests currently don’t cover these cases, so the regression could slip through.

Overall risk: medium

## Findings

1. [medium] `resolvePort()` accepts partially-numeric strings (parseInt permissiveness), violating AC #2a and risking misbinding
   - File: apps/tournament-api/src/port.ts:12-22
   - Confidence: high
   - Why it matters: AC #2a now explicitly requires rejecting invalid inputs including “non-numeric”. With `Number.parseInt(raw, 10)`, inputs like `"3001abc"` parse to `3001` (no warning), `"3001.5"` parses to `3001`, and `"3e3"` parses to `3`. These are non-numeric / non-integer port specifications in typical env-var semantics, and silently coercing them can bind an unexpected port without the required `console.warn` fallback.
   - Suggested fix: Make parsing strict before converting:
- `const trimmed = raw.trim();`
- Treat missing/empty (after trim) as default 3000 (optionally no warn).
- Require full-string integer format: `if (!/^\d+$/.test(trimmed)) { warn+3000 }`
- Then `const port = Number(trimmed);` and validate `Number.isInteger(port) && port >= 1 && port <= 65535`.
This also makes the “valid integer PORT in [1, 65535]” clause exact.

2. [medium] Unit tests miss key invalid-but-accepted inputs (floats, scientific notation, trailing junk, whitespace) so AC #2a can regress silently
   - File: apps/tournament-api/src/port.test.ts:1-55
   - Confidence: high
   - Why it matters: Current tests cover undefined/empty/non-numeric/0/negative/>65535 and boundaries, but they don’t cover the inputs where `parseInt` is overly lenient. As a result, the current implementation can violate the revised AC while the suite stays green. Also, acceptance around whitespace is unspecified; without a test, behavior can drift unexpectedly.
   - Suggested fix: Add tests that assert fallback+warn (or explicitly-allowed behavior) for:
- `resolvePort('3001.5')` (should reject if integer required)
- `resolvePort('3e3')`
- `resolvePort('3001abc')` (and/or `'3001\n'`)
- Decide and test whitespace policy: `resolvePort(' 3001 ')` either allowed (trim) or rejected.
After making parsing strict (see prior finding), these tests should pass and lock the AC intent.

## Strengths

- `src/index.ts` now cleanly delegates port resolution to a helper module and still calls `serve()` at module scope as required (apps/tournament-api/src/index.ts:1-10).
- `src/port.ts` default-parameter design lets production read `process.env['PORT']` while tests pass explicit values, avoiding import-time `serve()` side effects.
- Tests correctly verify warning/no-warning behavior for the currently-covered branches and keep state clean via `afterEach(warnSpy.mockClear())`.
- Story AC #2a rewrite is materially clearer than the original literal-expression form and explicitly documents fallback + warn expectations.

## Warnings

None.
