# Codex Review

- Generated: 2026-04-27T17:20:27.987Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md

## Summary

The Round-1 fixes mostly read clean (cookie refresh on UPDATE, created_at preserved, UA-only + truncation, dedupe + Set-Cookie parsing tests). Two new spec-level correctness risks remain: (1) a lingering inconsistency about whether device_info includes IP, and (2) UPDATE-branch behavior can corrupt the per-event `context_id` semantics of `device_bindings` when the same device follows invites for multiple events. Also consider the practical impact of always setting `Secure` cookies in local (http) dev.

Overall risk: medium

## Findings

1. [medium] device_info still inconsistent: §2 says UA+IP, but AC #3 says UA-only (and truncation formula)
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:43-156
   - Confidence: high
   - Why it matters: The spec claims this inconsistency was fixed, but there’s still a contradictory requirement: the endpoint description says INSERT uses “device_info from User-Agent + IP” while AC #3 mandates UA-only with `deviceInfo = (UA ?? '').slice(0, 256)` in both branches. This will either cause implementation drift or tests to encode the wrong behavior.
   - Suggested fix: Delete/replace the UA+IP mention in the endpoint overview (line ~50) to match AC #3 exactly (UA-only, truncated to 256, both INSERT+UPDATE). If IP capture is explicitly deferred, keep that rationale in one place to avoid reintroducing it.

2. [medium] UPDATE branch can create cross-event data corruption: device_binding row is selected by id only (cookie), but `context_id` is event-scoped
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:48-166
   - Confidence: high
   - Why it matters: The spec sets `context_id = 'event:{eventId}'` on INSERT (line ~50 / AC #3 line ~162), implying device bindings are scoped to an event. But the UPDATE branch (line ~48-50 / AC #3 line ~156-159) updates an existing row solely because the cookie id exists, without checking that the existing row belongs to the same event/context. If a user uses the same browser/device to open an invite for a different event later, you can end up with a row whose `context_id` references Event A while `player_id` now belongs to Event B. That breaks the meaning of `context_id`, complicates T3-7’s “find unclaimed binding for this event” logic, and is a concrete data integrity risk.
   - Suggested fix: Amend AC #3 to either: (A) require the UPDATE branch to only apply when `context_id === 'event:{eventId}'` (otherwise treat as INSERT and issue a new cookie), or (B) explicitly update `context_id` (and clarify what `created_at` means if the context changes), or (C) redefine `context_id` semantics to be device-global (not event-scoped) and remove event scoping from inserts. Option (A) usually preserves audit semantics best.

3. [low] Always setting Secure cookie may break local (http) invite flow in browsers (cookie won’t persist)
   - File: _bmad-output/implementation-artifacts/tournament/T3-6-invite-link-first-arrival-flow-no-sso.md:61-170
   - Confidence: medium
   - Why it matters: The spec mandates `Secure` unconditionally. Browsers generally refuse to set `Secure` cookies over plain HTTP, so local dev at `http://localhost` will appear broken (claim succeeds but cookie won’t stick, so subsequent requests won’t resolve the device binding). This is a practical dev/QA footgun and can slow implementation/debugging.
   - Suggested fix: Either (1) specify environment-conditional Secure (e.g., only set `Secure` in production / when request is HTTPS), mirroring whatever the existing session-cookie helper does; or (2) explicitly document that local manual testing must run behind HTTPS (and ensure the dev setup supports that). Adjust cookie-attribute tests accordingly (e.g., expect Secure only under prod-like config, or force the test env to simulate HTTPS).

## Strengths

- Cookie rolling-refresh behavior is now explicitly constrained to POST (INSERT+UPDATE) and not GET, which avoids unintended write-on-read semantics (§3, line ~67).
- `created_at` immutability on UPDATE is clearly stated and has an explicit regression test requirement (§5 line ~107; AC #3 line ~157).
- The UA-only + truncation formula is unambiguous in AC #3 (line ~155) and avoids XFF/load-balancer caveats.
- Test plan improvements are concrete (Set-Cookie attribute parsing, roster dedupe across groups, cookie refresh on UPDATE).

## Warnings

None.
