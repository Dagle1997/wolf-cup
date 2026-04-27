# Codex Review

- Generated: 2026-04-27T17:45:56.476Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/db/schema/device_bindings.ts

## Summary

Spec is mostly consistent with existing T1-6b architecture (oauth_identities lookup, not players.google_sub) and stays within ALLOWED path boundaries. The main risk is an incorrect post-SSO device_binding.session_id consolidation that can attach a returning user’s new session to an unrelated unclaimed device_binding just because the device cookie exists. There are also a couple of race/implementation-spec gaps around how lookupOrBindOAuthIdentity can read cookies and how UNIQUE collisions during rebind are interpreted.

Overall risk: high

## Findings

1. [high] Post-session device_binding consolidation can attach the new session to the wrong player if a stale device cookie exists
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:58-66
   - Confidence: high
   - Why it matters: Spec says: after session creation, if `tournament_device_id` cookie points to a `device_bindings` row with `session_id IS NULL`, UPDATE that row to the new session id (lines 60-63; repeated in AC #2 lines 160-163). But `lookupOrBindOAuthIdentity` returns early on existing oauth_identity hits (lines 40-43), so a returning user can sign in while still having an old invite-claim device cookie for a *different* player whose device_binding is still unclaimed (`session_id NULL`). Under the current spec, the callback would then incorrectly bind the returning user’s session to that other player’s device_binding, creating cross-player device/session association (scoring/mutating flows would identify the device as the wrong player).
   - Suggested fix: In the callback’s post-session UPDATE, add an ownership guard tying the binding to the resolved player: UPDATE `device_bindings` SET session_id = :newSessionId WHERE id = :cookieValue AND session_id IS NULL AND player_id = :playerId (or only run consolidation if the rebind branch was taken and returned that same playerId). Add a backend test for: existing oauth_identity(sub)->player B + cookie points to device_binding(player A, session_id NULL) ⇒ no UPDATE occurs.

2. [high] Rebind-path UNIQUE collision handling is underspecified; may silently bind to a different player under race
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:45-55
   - Confidence: medium
   - Why it matters: Case A inserts a new `oauth_identities` row binding device_binding.player_id ↔ sub (line 50 / AC #1 lines 154-156). Under concurrent callbacks, the INSERT could fail with UNIQUE(tenant_id, provider, provider_sub) if another tab/device binds the same sub first. If implementation reuses T1-6b’s “catch UNIQUE → reselect by sub → return that playerId” pattern, it can return a *different* playerId than the device_binding.player_id, contradicting the intended “claim-the-invite-bound-player” behavior and potentially leaving device_binding pointing at a player that didn’t get the oauth identity.
   - Suggested fix: For the rebind INSERT branch, if UNIQUE fires, re-select the oauth_identity by sub and compare its player_id to device_binding.player_id: if same, treat as idempotent; if different, throw OAuthRebindConflictError (redirect to /auth/conflict). Add a test: simulate UNIQUE collision where sub is already bound to a different player than device_binding.player_id ⇒ conflict redirect and no device_binding.session_id update.

3. [medium] lookupOrBindOAuthIdentity cannot read request cookies as specified without changing its signature/call contract
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:47-54
   - Confidence: high
   - Why it matters: Spec requires `lookupOrBindOAuthIdentity` step 2.5 to “Read the tournament_device_id cookie from the request” (lines 47-52; AC #1 lines 151-157). But the current implementation signature is `lookupOrBindOAuthIdentity(sub: string)` and is called as `lookupOrBindOAuthIdentity(sub)` in `auth.ts` (apps/tournament-api/src/routes/auth.ts:275-276). It has no access to `Context` or cookie header, so this branch can’t be implemented as-written without changing the function API or moving cookie handling outside.
   - Suggested fix: Update the spec/plan to pass the cookie value (or cookie header) into `lookupOrBindOAuthIdentity` (e.g., `lookupOrBindOAuthIdentity(sub, { deviceBindingId })`), or explicitly state that cookie extraction happens in the callback and the deviceBindingId is passed into the function. Ensure tests cover both with/without cookie.

4. [medium] Test plan missing the “returning user + stale unclaimed device cookie” scenario that would have caught the wrong-player consolidation
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:111-118
   - Confidence: high
   - Why it matters: The backend tests listed cover (a) rebind happy/idempotent/conflict and (b) cookie absent/bogus/session_id already set (lines 111-118). They do not cover the important edge case: cookie matches a device_binding with session_id NULL for player A, but the Google sub is already bound to player B (outer SELECT hit). Without an explicit test, it’s easy to implement AC #2 literally and accidentally attach session B to binding A.
   - Suggested fix: Add a backend test: pre-create oauth_identity(google, sub)->player B; create device_binding(id=cookie, player A, session_id NULL); run callback; assert session created for player B; assert device_binding.session_id remains NULL (or unchanged) because player_id mismatch.

5. [low] Cookie-clearing steps should explicitly require Set-Cookie append semantics to avoid one clear overwriting the other
   - File: _bmad-output/implementation-artifacts/tournament/T3-7-post-sso-device-cookie-thats-not-me-re-bind.md:70-79
   - Confidence: medium
   - Why it matters: The endpoint requires clearing both cookies (line 77; AC #4 lines 177-178). In Hono, repeated `c.header('Set-Cookie', ...)` without `{ append: true }` can overwrite prior Set-Cookie values. The spec mentions “two Set-Cookie headers” but doesn’t explicitly call out append semantics for the endpoint (it does call out append in the existing /google handler rationale in code).
   - Suggested fix: In the spec/implementation notes, explicitly require `{ append: true }` for both clear-cookie headers (and any additional Set-Cookie in the same response). Add a test asserting both Set-Cookie headers are present.

## Strengths

- Clear, intentional documentation of the deviation from stale epic wording re: `players.google_sub` vs `oauth_identities` (spec lines 26-34), and it matches the existing auth.ts approach (oauth_identities lookup).
- Path footprint is explicitly constrained to tournament-only files (spec lines 132-145, 266-290), aligning with FD-1/FD-2 boundary requirements.
- Conflict handling is correctly framed as redirect-based (spec lines 89-97; AC #3 lines 165-170), consistent with the OAuth callback’s redirect flow.
- Acceptance criteria are mostly concrete and testable, with explicit backend/frontend test-count baselines (AC #10-#12).

## Warnings

None.
