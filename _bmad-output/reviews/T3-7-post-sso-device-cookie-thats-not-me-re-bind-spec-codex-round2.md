# Codex Review

- Generated: 2026-04-27T17:51:56.759Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/lib/session.ts, apps/tournament-api/src/routes/invites.ts, apps/tournament-api/src/db/schema/device_bindings.ts

## Summary

Round-1 fixes are mostly reflected in the spec’s ACs (cookie read once → function, consolidation gated on `consolidatableDeviceBindingId !== null`, triple-WHERE UPDATE, UNIQUE-collision conflict check). Two concrete spec/codebase mismatches remain that can reintroduce bugs at implementation time: (1) the narrative section still describes re-reading the device cookie in the callback (contradicting AC #1/#2), and (2) AC #4 references a `deviceCookieHeader` API shape that doesn’t exist in the referenced code (risking a non-clearing “empty but long-lived” device cookie). There’s also a policy ambiguity in the rebind branch: treating “any existing oauth identity (even non-google)” as a hard conflict may be stricter than intended and should be explicit + tested.

Architecture deviation from epic (`players.google_sub`) remains appropriate per Fork 2b (use `oauth_identities`). Path footprint remains ALLOWED-only per the spec.

Overall risk: medium

## Findings

1. [medium] Spec contradicts itself on whether callback re-reads device cookie (could reintroduce stale-cookie consolidation bug)
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:64-72
   - Confidence: high
   - Why it matters: Section 4 still says the callback "Read the tournament_device_id cookie" and conditionally updates `device_bindings` (lines 68-72). But AC #1 and AC #2 explicitly require: cookie extracted once and passed into `lookupOrBindOAuthIdentity`, and the callback must NOT independently re-read the cookie to gate consolidation (lines 158-186). This contradiction can cause an implementer to accidentally add back the unsafe pattern (re-read cookie later) and regress High #1.
   - Suggested fix: Delete/replace spec §4 lines 68-72 to match AC #2 exactly: callback uses only `consolidatableDeviceBindingId` returned by `lookupOrBindOAuthIdentity` to decide consolidation; no separate cookie read/SELECT in the callback.

2. [medium] AC #4 requires `deviceCookieHeader('', { maxAge: 0 })` but current codebase’s `deviceCookieHeader` has no options and would not clear the cookie
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:194-201
   - Confidence: high
   - Why it matters: AC #4 mandates clearing the device cookie via `deviceCookieHeader('', { maxAge: 0 })` (line 200). In the referenced code (`apps/tournament-api/src/routes/invites.ts`), `deviceCookieHeader(value: string)` hardcodes `Max-Age=${DEVICE_COOKIE_MAX_AGE_S}` (lines 70-82). If an implementer reuses that helper with `''`, they’ll set a long-lived empty-value cookie, not clear it (and some client logic may treat “cookie present” as truthy/claimed). This is a concrete data-integrity/UX risk for the “That’s not me” escape hatch.
   - Suggested fix: In the spec, either (a) require a new `deviceCookieClearHeader()` / `deviceCookieHeader(value, { maxAgeSeconds })` helper with default 90d and explicit `maxAge=0` for clear, or (b) specify the clear Set-Cookie string explicitly (must mirror HttpOnly/SameSite/Path/Secure). Also update AC #4 examples to match the actual helper signature you intend to implement.

3. [low] Rebind Case C definition is potentially over-broad: any existing oauth identity (even other providers) becomes a conflict
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:55-60
   - Confidence: medium
   - Why it matters: Step 2.5 selects `oauth_identities WHERE player_id = device_binding.player_id (any provider)` (line 55) and Case C includes "different sub OR different provider already on this player" (lines 60, 174-175). That means a player who already has *any* oauth identity (e.g., future GitHub) but not Google would be blocked from adding Google, even though that’s not an identity merge. This might be intentional, but it’s a significant policy decision that should be explicit because it affects future extensibility and can create surprising conflicts.
   - Suggested fix: Clarify in AC #1 step 2.5 whether the intent is (1) forbid multi-provider identities per player (then keep as-is and add a test), or (2) only treat "existing google identity with different sub" as conflict (then change the Case C condition to provider='google' only).

4. [low] Test plan doesn’t explicitly cover ‘post-session consolidation UPDATE becomes a no-op due to race’ behavior
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:179-187
   - Confidence: medium
   - Why it matters: AC #2’s triple-WHERE guard intentionally turns races into no-ops. But the backend test list doesn’t include an assertion for the no-op branch when `consolidatableDeviceBindingId !== null` but the UPDATE affects 0 rows (e.g., another request already set `session_id`). Without a test, an implementation might assume UPDATE always succeeds and later rely on `session_id` being set for downstream flows.
   - Suggested fix: Add a backend test that simulates `device_bindings.session_id` being set between lookup and consolidation UPDATE, then assert: no overwrite occurs, request still succeeds, and (optionally) a log/metric indicates consolidation was skipped/no-op.

## Strengths

- AC #1 returning-user branch explicitly forces `consolidatableDeviceBindingId = null`, preventing stale device-cookie consolidation into the wrong returning account (regression guard for Round-1 High #1).
- AC #2’s consolidation gating on the function-returned `consolidatableDeviceBindingId` correctly couples the rebind decision and consolidation decision, preventing drift from separate cookie re-reads.
- Triple-WHERE UPDATE (`id` + `session_id IS NULL` + `player_id = resolvedPlayerId`) is a solid defense-in-depth against overwriting another session/player in races.
- UNIQUE-collision retry now includes the crucial `player_id` mismatch check → throw `OAuthRebindConflictError`, addressing Round-1 High #2.
- Cookie append semantics are called out explicitly in AC #4, matching Hono’s overwrite-by-default behavior.

## Warnings

None.
