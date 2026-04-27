# Codex Review

- Generated: 2026-04-27T17:31:33.890Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/invites.ts, apps/tournament-api/src/routes/invites.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/invite.$token.tsx, apps/tournament-web/src/routes/invite.$token.test.tsx

## Summary

Reviewed the provided T3-6 backend+frontend implementation against the listed acceptance criteria. The invite router is mounted at the new /api/invites prefix, exposes exactly the two anonymous endpoints (GET /:token and POST /:token/claim with 8 KiB bodyLimit), returns 404/410 as specified, returns roster sorted ASC with dedupe across groups, implements cookie-aware UPDATE vs INSERT with cross-event protection, truncates UA to 256, sets the device cookie with the required attributes (including Secure only in production), preserves created_at on UPDATE, and creates device_bindings with session_id=NULL on INSERT. Frontend route /invite/$token is public (no beforeLoad) and the UI/test coverage matches the described behaviors and thresholds (15 backend tests, 5 frontend tests).

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- AC#1/#5: New anonymous inviteRouter mounted at /api/invites; no requireSession/requireOrganizer; bodyLimit(8 KiB) applied to POST only (apps/tournament-api/src/app.ts:68-70, apps/tournament-api/src/routes/invites.ts:107-169, 174-365).
- AC#2: GET returns 404 invite_not_found and 410 invite_expired; roster is ordered ASC by player name and deduped by playerId across groups (apps/tournament-api/src/routes/invites.ts:111-119, 134-156).
- AC#3: POST validates token + playerId membership in event group_members; UA-only device_info truncated to 256; cookie-aware UPDATE vs INSERT with cross-event contextId protection implemented (apps/tournament-api/src/routes/invites.ts:215-270, 283-341, 295-313).
- AC#4: Device cookie attributes meet requirements: HttpOnly, SameSite=Lax, Path=/, Max-Age=7776000, no Domain; Secure appended only when NODE_ENV=production (apps/tournament-api/src/routes/invites.ts:70-82).
- Design decisions validated by tests: session_id NULL on insert; created_at preserved on update; cookie attribute assertions are parsed as individual contains/match; cross-event same-cookie creates two rows; bogus cookie value falls through to insert (apps/tournament-api/src/routes/invites.test.ts:199-450).
- AC#6: /invite/$token route is public with no beforeLoad (apps/tournament-web/src/routes/invite.$token.tsx:216-219).
- AC#7-#10: Frontend fetch+claim flow, success surface, and 404/410/other error states are implemented and covered by component tests (apps/tournament-web/src/routes/invite.$token.tsx:68-210, apps/tournament-web/src/routes/invite.$token.test.tsx:50-183).

## Warnings

None.
