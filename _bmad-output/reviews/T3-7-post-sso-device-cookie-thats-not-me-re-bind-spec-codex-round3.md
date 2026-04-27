# Codex Review

- Generated: 2026-04-27T17:55:01.958Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/lib/session.ts, apps/tournament-api/src/routes/invites.ts, apps/tournament-api/src/db/schema/device_bindings.ts

## Summary

The provided code does not reflect the Round-2/T3-7 spec changes: `lookupOrBindOAuthIdentity` still has the old signature/behavior, the OAuth callback never reads/passes the device cookie, there is no consolidation UPDATE (triple-WHERE or logging), and `deviceCookieClearHeader()` is not present in invites.ts. As-is, the Round-2 fixes cannot be said to “hold” because they appear not implemented in the reviewed files.

Overall risk: high

## Findings

1. [critical] OAuth callback + lookupOrBindOAuthIdentity do not implement the T3-7/Round-2 device-cookie rebind + consolidation contract
   - File: apps/tournament-api/src/routes/auth.ts:272-464
   - Confidence: high
   - Why it matters: Round-2 fixes (and AC #1/#2/#4) depend on: (a) extracting the device cookie once in the callback, (b) passing it into `lookupOrBindOAuthIdentity(sub, deviceBindingCookieValue)`, (c) returning `{ playerId, rebindOccurred, consolidatableDeviceBindingId }`, and (d) performing the guarded triple-WHERE `device_bindings` consolidation UPDATE after session creation. None of that exists in the provided code: the callback calls `lookupOrBindOAuthIdentity(sub)` (line 275) and the helper returns only `Promise<string>` (line 384), with no device-binding logic at all. This means the Round-2 regression guards (especially “never re-read cookie during consolidation” and gating solely on `consolidatableDeviceBindingId !== null`) are not actually in effect in the reviewed implementation.
   - Suggested fix: Update the callback to extract `tournament_device_id` once and pass it into `lookupOrBindOAuthIdentity(sub, cookieValue)`. Change `lookupOrBindOAuthIdentity` to return the specified object and implement step 2.5 (device_bindings lookup + provider='google' scoped identity checks + conflict error). After `createSession`, perform the triple-WHERE UPDATE on `device_bindings` and log `affectedRows`.

2. [high] deviceCookieClearHeader() sibling helper is not present/exported, so device cookie clearing cannot match the spec/AC #4 requirements
   - File: apps/tournament-api/src/routes/invites.ts:63-82
   - Confidence: high
   - Why it matters: Round-2 Med #2 was specifically about clearing the device cookie correctly (Max-Age=0 with matching attributes). In the provided invites.ts, only `deviceCookieHeader(value: string)` exists (lines 70-82); there is no `deviceCookieClearHeader()` implementation or export. If the rest of T3-7 tries to clear the device cookie without a correct builder, you risk a “ghost cookie” that persists (attribute mismatch) or a clear that never happens.
   - Suggested fix: Add `deviceCookieClearHeader(): string` next to `deviceCookieHeader` with identical attributes (HttpOnly, SameSite=Lax, Path=/, conditional Secure) and `Max-Age=0`, and export it for the /that-is-not-me handler.

## Strengths

- auth.ts still consistently uses append semantics for multiple Set-Cookie headers in the Google OAuth entry/callback flows (auth.ts:124-127, 303-305), which is important for multi-cookie responses.
- Session cookie builder in session.ts continues to validate values and mirrors attributes on clear via `sessionCookieHeader(null)` (session.ts:177-197), which is the right pattern to reuse for logout-style flows.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md
