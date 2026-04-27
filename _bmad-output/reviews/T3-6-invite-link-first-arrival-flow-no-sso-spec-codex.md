# Codex Review

- Generated: 2026-04-27T17:18:31.997Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md, apps/tournament-api/src/db/schema/events.ts, apps/tournament-api/src/db/schema/device_bindings.ts

## Summary

Spec is largely coherent and stays within the tournament-only path allowlist, with clear contracts for the two anonymous endpoints + public SPA route. The main correctness risks are internal inconsistencies: “rolling” cookie refresh is described but not actually specified in the response behavior, `device_bindings.created_at` is repurposed as an update timestamp (semantic drift), and `device_info` capture/truncation differs between narrative and ACs. A few important edge cases (multi-group dedupe test, same player claimed on multiple devices) are not fully nailed down in ACs/tests.

Overall risk: medium

## Findings

1. [high] Cookie described as “rolling refresh on every read” but spec only sets cookie on INSERT branch
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:67-160
   - Confidence: high
   - Why it matters: Line 67 states Max-Age is “rolling — refresh on every read”, but the flow only mandates Set-Cookie on POST when inserting a new device_bindings row (lines 50, 158–160). The UPDATE branch (lines 152–155) does not say to re-issue the cookie, so Max-Age will not roll on re-taps; similarly GET does not refresh it. This is a contract inconsistency that can cause unexpected expiry despite ongoing usage.
   - Suggested fix: Decide and specify the intended behavior: if “rolling” is required, explicitly Set-Cookie on the UPDATE branch too (and/or on GET). Add a backend test asserting Max-Age refresh on the update path if that’s the intended contract.

2. [high] `device_bindings.created_at` is being updated on re-claim (semantic drift / audit risk)
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:153-157
   - Confidence: high
   - Why it matters: AC #3 specifies that on cookie-present UPDATE, it sets `created_at = now` (line 153). In schema, `device_bindings.created_at` is a required column (apps/tournament-api/src/db/schema/device_bindings.ts:41) and strongly implies insert time, not “last claimed”. Repurposing can break future logic that relies on original creation time (including analysis/debugging and any future retention policies).
   - Suggested fix: Either (a) keep `created_at` immutable on UPDATE and drop the “refresh” requirement, or (b) explicitly document in the spec that `created_at` is intentionally treated as “last claimed at” for device_bindings (and confirm no other code uses it as creation timestamp). If you need both, you’d normally add `updated_at`, but schema changes are out of scope—so the safest is to not update `created_at`.

3. [medium] `device_info` requirements are inconsistent (UA+IP vs UA-only; truncation only specified on INSERT)
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:50-158
   - Confidence: high
   - Why it matters: Narrative says `device_info` comes from “User-Agent + IP” (line 50), but AC #3 INSERT says `deviceInfo = userAgent ?? ''` truncated to ≤256 (line 157), and UPDATE says `device_info = userAgent` (line 153) with no truncation requirement. This creates ambiguity for implementation and tests. Also schema requires `device_info` not null (apps/tournament-api/src/db/schema/device_bindings.ts:40), so UPDATE must also handle missing UA deterministically.
   - Suggested fix: Pick one consistent rule and apply to both INSERT and UPDATE (including truncation). If IP is intended, specify exact formatting and max length behavior; if not, remove IP mention from line 50. Add/adjust tests to cover truncation and missing UA cases.

4. [medium] Roster union across multiple groups requires dedupe; test plan doesn’t explicitly cover duplicates
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:36-145
   - Confidence: high
   - Why it matters: AC #2 requires roster is the union across all groups under the event and “deduplicated by playerId” (line 144). The earlier description (line 36) is a straightforward join that will naturally duplicate players who appear in multiple groups. Without an explicit test seeding the same player into two groups, it’s easy to ship duplicates and violate AC #2.
   - Suggested fix: Add a backend test that seeds 2 groups under the event with the same player in both and asserts the GET roster contains that player exactly once and remains sorted by `players.name ASC`.

5. [medium] Spec doesn’t explicitly define whether the same `playerId` can be claimed by multiple devices (important v1 edge case)
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:43-74
   - Confidence: high
   - Why it matters: The flow validates `playerId` is in the event roster (lines 47–55, 151–152) but does not specify any uniqueness constraint or behavior if two different devices claim the same player concurrently. The schema also shows no uniqueness constraint preventing multiple device_bindings rows per player (apps/tournament-api/src/db/schema/device_bindings.ts:32–47). Ambiguity here can lead to surprising behavior later (e.g., “who is Player X?” if multiple devices are bound).
   - Suggested fix: Make an explicit v1 decision in ACs: either allow multiple device_bindings for the same player (and add a test), or enforce single-device binding per player (would require additional DB checks and defined conflict behavior like 409).

6. [low] Backend Set-Cookie assertion plan may be brittle if tests expect an exact header string
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:291-292
   - Confidence: medium
   - Why it matters: Spec says tests assert “exact JSON shapes + Set-Cookie headers” (lines 291–292). In practice, cookie helpers often reorder attributes or include `Expires=` in addition to `Max-Age`, which can cause false-negative tests across environments. This is a test stability risk, not a product bug.
   - Suggested fix: In tests, parse the Set-Cookie header and assert presence/values of required attributes (HttpOnly, SameSite=Lax, Secure, Path=/, Max-Age=7776000, no Domain) rather than exact string equality.

## Strengths

- Path allowlist is explicitly constrained to tournament-only files; spec reiterates “NO SHARED edits” and enumerates allowed paths (lines 115–126, 234–237).
- HTTP semantics are clearly specified for 404 vs 410 (lines 39–41, 140–143), and 410 Gone is reasonable for expired tokens.
- Cross-table membership validation is correctly described in terms of event→groups→group_members (lines 47–48, 151–152), and ACs anticipate future multi-group events (line 144).
- Cookie attribute contract is detailed and matches the stated needs for invite-link entry from external apps (SameSite=Lax rationale at lines 65–66, 279–280).
- Test targets are concrete and cover the main happy paths + primary error cases, including bodyLimit behavior (lines 93–107).

## Warnings

None.
