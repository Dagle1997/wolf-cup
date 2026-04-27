# Codex Review

- Generated: 2026-04-27T18:17:06.082Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-api/src/routes/invites.ts, apps/tournament-web/src/routes/me.tsx, apps/tournament-web/src/routes/me.test.tsx, apps/tournament-web/src/routes/auth.conflict.tsx, apps/tournament-web/src/routes/auth.conflict.test.tsx, _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md

## Summary

Implementation largely matches the T3-7 spec: `lookupOrBindOAuthIdentity(sub, deviceCookie)` returns the required `{playerId,rebindOccurred,consolidatableDeviceBindingId}` shape; outer SELECT short-circuits returning users with `consolidatableDeviceBindingId: null`; step 2.5 is tenant-scoped on `device_bindings` and provider-scoped to `google` for `oauth_identities`; UUID guard exists before any `device_bindings` access; consolidation UPDATE is gated and uses `isNull(session_id)` plus id+player_id+tenant_id. Conflict redirects 302 to `/auth/conflict?...` and clears intermediates; `/that-is-not-me` is `requireSession`, deletes session, tenant-scoped deletes device binding, clears both cookies using append semantics, and uses the new `deviceCookieClearHeader`.

Main issues are test quality/coverage and one potential auth-gating/cache drift on `/me` due to `staleTime` caching of auth status. No obvious injection/path traversal issues in the reviewed code.

Overall risk: medium

## Findings

1. [medium] /me auth gate can be bypassed briefly due to cached auth-status (staleTime=30s)
   - File: apps/tournament-web/src/routes/me.tsx:131-146
   - Confidence: high
   - Why it matters: AC requires `/me` to be authenticated via the auth-status loader (anonymous → redirect to `/api/auth/google`). With `queryClient.ensureQueryData(... staleTime: 30_000)`, a previously-authenticated value can be reused without refetching, so a user whose cookies/session were cleared (e.g., another tab, or server-side session deletion) may still pass `beforeLoad` and see the page for up to 30s. While server mutations remain protected, this is still a contract drift for client-side gating and can surface stale identity UI.
   - Suggested fix: For auth gating, force a fresh `/api/auth/status` check (e.g., `staleTime: 0`, or `queryClient.fetchQuery`/`ensureQueryData` with `staleTime: 0` and/or `refetchOnMount: 'always'`). Optionally invalidate `['auth-status']` on sign-out paths.

2. [medium] Missing cross-tenant regression test for POST /that-is-not-me device_bindings deletion
   - File: apps/tournament-api/src/routes/auth.ts:401-455
   - Confidence: medium
   - Why it matters: The handler correctly scopes deletion to `tenant_id = TENANT_ID` (good defense-in-depth per AC #4), but the new backend test suite shown adds cross-tenant coverage only for the OAuth callback rebind (device-bindings SELECT), not for the destructive `/that-is-not-me` endpoint. This endpoint is the more sensitive one (deletion). Without a test, a future refactor could drop tenant scoping and silently reintroduce cross-tenant deletion risk.
   - Suggested fix: Add a test that seeds a `device_bindings` row under a different tenant with the same UUID cookie value, calls POST `/that-is-not-me` with a valid session, and asserts the foreign-tenant row remains while the session is deleted and cookies are cleared.

3. [low] Potential flakiness/leak in “button disabled while in-flight” test due to not awaiting post-resolve effects
   - File: apps/tournament-web/src/routes/me.test.tsx:87-109
   - Confidence: medium
   - Why it matters: The test uses an unresolved-promise fetch to assert `disabled` while pending, then resolves the promise but does not `await` the ensuing React Query completion/onSuccess. That can let async state updates or `window.location.assign` fire after the test finishes, risking intermittent warnings or cross-test interference depending on scheduler timing.
   - Suggested fix: After resolving, `await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/'))` (or at least `await waitFor(() => expect(mockFetch).toHaveBeenCalled())` plus flushing microtasks). Alternatively, resolve immediately after the disabled assertion and await mutation completion deterministically.

## Strengths

- `lookupOrBindOAuthIdentity` signature and return contract match AC #1; outer SELECT correctly returns `consolidatableDeviceBindingId: null` for returning users (prevents stale device-cookie consolidation).
- Step 2.5 uses UUID shape guard before any `device_bindings` SELECT; `device_bindings` reads/writes/deletes are tenant-scoped; `oauth_identities` check is provider-scoped to `google` (multi-provider allowed).
- Post-session consolidation UPDATE is correctly gated on `consolidatableDeviceBindingId !== null` and uses the required quadruple-WHERE including `isNull(deviceBindings.sessionId)` (race-safe no-op).
- Conflict handling: `OAuthRebindConflictError` produces a 302 redirect to `/auth/conflict?reason=device_binding_conflict` and clears OAuth intermediates; session issuance is skipped because session creation happens after lookup.
- POST `/that-is-not-me` correctly uses `requireSession` and `c.get('session').sessionId`, deletes the session, tenant-scoped deletes device binding when UUID-shaped, and clears both cookies using append semantics with the new `deviceCookieClearHeader` helper.
- Allowlist footprint appears compliant: only the specified tournament-api/tournament-web route/test files plus the story artifact are touched; no SHARED/core workspace files shown.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/auth.ts
- Truncated file content for review: apps/tournament-api/src/routes/auth.test.ts
- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md
- Git diff was truncated for the review request.
