# Codex Review

- Generated: 2026-04-27T17:56:22.454Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md

## Summary

Spec is largely internally consistent (ACs, risk acceptance, test plan counts, and path footprint align). Remaining gaps are mainly around hardening multi-tenant + malformed-cookie handling, and one AC that’s partly non-deterministic/inspection-based in a way that can reduce testability.

Overall risk: medium

## Findings

1. [high] Device cookie UUID value is used in `WHERE id = :cookieValue` without an explicit UUID-format guard; malformed values may throw (vs safely returning 0 rows)
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:51-55
   - Confidence: high
   - Why it matters: The spec assumes a bogus/missing cookie simply yields 0 rows and falls through (lines 53-55, 125-126, 170-171). With Postgres `uuid` columns, binding a non-UUID string to `WHERE id = $1` can raise `invalid input syntax for type uuid`, turning attacker-controlled cookies into a 500/DoS vector and breaking the “safe no-op” intent.
   - Suggested fix: Add an explicit requirement: validate `tournament_device_id` is UUID-shaped before querying (treat invalid as null/no-cookie), and add a backend test for a malformed cookie (non-UUID) that must not 500 and must behave as “no matching row.”

2. [high] Device binding SELECT/UPDATE/DELETE are not specified as tenant-scoped; cross-tenant integrity relies solely on unguessable UUIDs
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:52-55
   - Confidence: medium
   - Why it matters: The spec consistently uses `(tenant_id, provider, provider_sub)` scoping for `oauth_identities` (e.g., lines 41-43, 166-168) but device binding operations are specified as `WHERE id = :cookieValue` (lines 52-53 / 169-170), consolidation `UPDATE ... WHERE id = ...` (lines 70-71 / 185-186), and /that-is-not-me `DELETE FROM device_bindings WHERE id = cookieValue` (lines 83-85 / 202-203) with no tenant constraint. In a multi-tenant system on the same domain, a stale/foreign cookie could reference another tenant’s device_binding and be mutated/deleted if the UUID is obtained/guessed/leaked, violating tenant isolation.
   - Suggested fix: Add explicit AC language: all device_bindings lookups/mutations must include `tenant_id = currentTenantId` (and optionally also `player_id = session.playerId` for /that-is-not-me if desired). Add/adjust tests to assert tenant-scoped no-ops when cookie references a device_binding in a different tenant.

3. [medium] AC #4 includes an implementation escape clause that makes the requirement non-deterministic/test-hostile
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:197-203
   - Confidence: high
   - Why it matters: AC #4 says to get `sessionId` from `c.get('session')` but then adds “verify the middleware exposes this — if not, extract via ... + lookup” (line 200). That creates two acceptable implementations, which can complicate writing precise tests and code review at the gate (it’s unclear which behavior is required).
   - Suggested fix: Convert the note into a firm requirement: either (a) requireSession must expose `sessionId`/`playerId` in `c.get('session')`, or (b) this endpoint must parse+lookup explicitly. Then align tests to that single contract.

## Strengths

- No internal contradictions found between AC #1-#4 and Risk Acceptance §§3-§5; the rebind decision tree is consistent across narrative (§3-§4) and AC #1-#3.
- Test plan counts are consistent with the stated goal: 10 callback rebind variations (lines 119-130) + 4 /that-is-not-me (131-136) = 14 backend tests; 4 frontend tests (137-143).
- Path allowlist/footprint is coherent: 3 modified backend files (auth.ts/auth.test.ts/invites.ts), 4 new frontend route+test files, 1 auto-regenerated routeTree; explicitly zero SHARED and zero FORBIDDEN (lines 146-157).
- Race-safety intent is well specified: “outer SELECT must force consolidatableDeviceBindingId = null” for returning users (lines 166-167) plus triple-WHERE consolidation update (lines 70-71 / 185-186) and the explicit no re-read of device cookie (lines 68-69 / 188-190).

## Warnings

None.
