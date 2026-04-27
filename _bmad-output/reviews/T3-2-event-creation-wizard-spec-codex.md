# Codex Review

- Generated: 2026-04-27T14:15:10.560Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md

## Summary

Spec is mostly patch-quality and stays within the tournament-only allowlist, but it contains a couple of concrete, build-breaking / correctness issues (timezone helper API misuse; React Query useQuery misuse) plus internal contradictions around 409 handling and error codes that will likely cause implementation/test drift.

Overall risk: high

## Findings

1. [critical] IANA timezone validator helper is specified incorrectly; likely never validates and may not throw on invalid tz
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:167-168
   - Confidence: high
   - Why it matters: The spec says `isValidIanaTimezone` should use `Intl.DateTimeFormat({ timeZone: tz })` in a try/catch. That call signature is wrong: the first argument is `locales` (string|string[]), not an options object. In JS, passing `{ timeZone: tz }` as the first argument will typically be treated as an invalid/ignored locales value, so you won’t actually exercise the `timeZone` option and invalid IANA tz strings may incorrectly pass validation. This undermines server-side validation (security boundary) and client-side gating, and will cause AC #2 to be implemented incorrectly.
   - Suggested fix: Update the spec’s helper to something like: `new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();` (or just construct it) inside try/catch, returning false on throw. Ensure both client + server implementations use the correct signature.

2. [critical] Frontend useQuery example will execute fetch immediately and is not a valid queryFn; will break at runtime/tests
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:304-305
   - Confidence: high
   - Why it matters: Spec says: `useQuery({ queryKey: ['courses'], queryFn: fetch('/api/courses') })`. React Query expects `queryFn` to be a function returning a promise; providing the promise directly causes the fetch to run during render and violates React Query’s API, likely causing runtime errors and flaky tests.
   - Suggested fix: Spec should require `queryFn: () => fetch('/api/courses').then(r => r.json())` (and handle non-2xx). Mirror the already-established T2-2/T2-5 patterns if they exist.

3. [high] 409/UNIQUE-conflict handling is internally contradictory (spec vs ACs); will cause implementation/test mismatch
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:47-95
   - Confidence: high
   - Why it matters: Risk Acceptance §3 states handler maps `UNIQUE → 409 conflict` (line 47), but §6 and AC #4 explicitly say “NO special 409 carveout” and generic 500 is sufficient (lines 73-80, 178-181). Separately, UI section says final submit handles `201/400/409/500` (line 94), while AC #11 only enumerates `201/400/500` (lines 220-227). This contradiction will produce either failing tests or a handler/UI that disagrees with the story’s deliberate choice (“no 409 path”).
   - Suggested fix: Choose one contract and make it consistent across: Risk Acceptance §3, §6, AC #4, UI notes line 94, and AC #11. Given the “deliberate” choice in the request, remove 409 handling mentions from the spec/ACs and ensure tests don’t expect 409.

4. [medium] Error code string is inconsistent: tasks mention `save_failed` but AC #4 requires `create_failed`
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:178-291
   - Confidence: high
   - Why it matters: AC #4 requires 500 `{ error: 'internal', code: 'create_failed', requestId }` (line 180). Task 2.4 says “500 save_failed” (line 290). If tests assert exact JSON shapes (noted in Dev Notes, line 335), this will cause drift and failing tests.
   - Suggested fix: Normalize on one code string everywhere (ACs, tasks, test plan). If AC #4 is the contract, update the task wording to match `create_failed`.

5. [medium] Invite-token test plan is too lax to prove 32-byte base64url tokens (could pass weaker tokens like UUIDs)
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:115-116
   - Confidence: high
   - Why it matters: Test target says: “verify token is a base64url string of length ≥ 32” (line 115). But a UUID (36 chars with hyphens) would satisfy length ≥ 32, and a shorter random token could pass if it’s 32+ chars. Given the story’s explicit entropy requirement (`randomBytes(32).toString('base64url')`, lines 44-53), the test should actually enforce base64url charset and the expected length (~43 chars) or at least `>= 43` plus charset.
   - Suggested fix: Tighten the test plan to assert base64url regex `^[A-Za-z0-9_-]+$` and length around 43 for 32 bytes (commonly exactly 43 without padding).

6. [low] Rounds max/count expectations are slightly inconsistent across doc (≤10 in sizing note vs schema max 20)
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:83-159
   - Confidence: high
   - Why it matters: Body-size note estimates “≤10 rounds” (line 83), but server schema allows `.max(20)` (line 158). Not a correctness bug, but it can create confusion in UI limits/tests (e.g., should UI allow adding up to 20?).
   - Suggested fix: Align the narrative sizing note + UI expectations with the actual schema limit (or explicitly state UI caps at 20).

## Strengths

- Explicit transaction + rollback discipline is clearly stated and testable (lines 40-48, 169-181).
- context_id stamping flow is concrete and patch-like, including pre-tx UUID generation and inheritance (lines 55-71, 169-176).
- Path allowlist boundaries are explicitly documented and stay within tournament-only files (lines 123-137, 272-275, 331-355).
- Auth loader + anonymous redirect deviation is documented with rationale and smoke verification (lines 85-86, 260-269, 276-279).
- Test coverage targets are concrete, including rollback + context_id + token-shape checks (lines 105-116).

## Warnings

None.
