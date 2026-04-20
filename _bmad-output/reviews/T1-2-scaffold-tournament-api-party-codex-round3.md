# Codex Review

- Generated: 2026-04-20T14:34:20.524Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/port.ts, apps/tournament-api/src/port.test.ts

## Summary

The `/^\d+$/` guard fully closes the Round-2 `parseInt`-permissiveness hole for the ASCII-digit-only contract described in `port.ts`, and the expanded tests cover the important “parseInt trap” cases (suffix junk, floats, scientific notation, whitespace, sign). No ReDoS concern is evident here. A couple of small gaps remain around explicitly locking in the ASCII-only intent and avoiding console spy leakage across test files.

Overall risk: low

## Findings

1. [low] Unicode digit behavior is implicit ("\d" is ASCII-only in JS); add an explicit test to lock the contract
   - File: apps/tournament-api/src/port.test.ts:25-105
   - Confidence: high
   - Why it matters: Your docstring states “ASCII digits” and the regex uses `\d`, which in JavaScript regular expressions corresponds to `[0-9]` (ASCII). That means inputs like Arabic-Indic digits (e.g. `"٣٠٠١"`) or full-width digits (e.g. `"３００１"`) will be rejected. That’s likely correct for env-vars/ports, but it’s currently an untested edge case and was explicitly called out as a review concern. A future refactor (e.g., switching to Unicode property escapes) could silently change accepted inputs.
   - Suggested fix: Add at least one test asserting rejection of non-ASCII decimal digits, e.g.:
- `resolvePort('٣٠٠١')` (Arabic-Indic)
- `resolvePort('３００１')` (full-width)
Expect fallback to 3000 with the same warning. If the AC actually intends to accept all Unicode decimal digits, change the guard to something like `/^\p{Nd}+$/u` and keep/adjust tests accordingly.

2. [low] Console warn spy is not restored; potential cross-file test pollution
   - File: apps/tournament-api/src/port.test.ts:4-10
   - Confidence: high
   - Why it matters: `vi.spyOn(console, 'warn')` is created once for the whole `describe` and only `mockClear()` is called after each test. If other test files rely on the real `console.warn` (or create their own spies), this can cause unintended interactions depending on test ordering/execution mode.
   - Suggested fix: Add an `afterAll(() => warnSpy.mockRestore())` (or `vi.restoreAllMocks()` in an `afterAll`) to ensure the global is put back. Keep `mockClear()` in `afterEach` as you already do.

## Strengths

- The `/^\d+$/` guard before `parseInt` eliminates acceptance of `3001abc`, `3001.5`, `3e3`, leading/trailing whitespace, and signed values—addressing the Round-2 permissiveness issue directly.
- Range check `parsed <= 0 || parsed > 65535` correctly enforces the valid port interval and catches huge numeric strings even if they parse imprecisely or overflow.
- Tests assert both return value and warning message content for invalid inputs, and verify no warning for missing/valid inputs—good behavioral coverage for the specified contract.
- No realistic ReDoS risk: the regex is linear-time and the input is an env-var-sized string.

## Warnings

None.
