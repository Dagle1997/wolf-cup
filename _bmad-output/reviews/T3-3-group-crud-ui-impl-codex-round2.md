# Codex Review

- Generated: 2026-04-27T16:24:12.702Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-groups.ts, apps/tournament-api/src/routes/admin-groups.test.ts, apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx

## Summary

R2 review: the prior R1 fixes you called out look correctly applied in the provided code (group_members.contextId now uses eventId; React setState during render replaced by a useEffect sync; AbortController signals are threaded through queries/mutations with unmount cleanup; bodyLimit test added for PATCH). No new high/critical issues found. A couple of concrete low-risk correctness/coverage gaps remain.

Overall risk: low

## Findings

1. [low] Frontend type mismatch: PATCH /groups returns no `members` but is cast to `GroupResponse`
   - File: apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx:159-176
   - Confidence: high
   - Why it matters: `GroupResponse` requires `members`, but the PATCH endpoint response is only `{id,name,eventId,moneyVisibilityMode}` (no `members`). Today the UI doesn’t read the mutation result, so it won’t crash, but the cast is misleading and makes it easy to introduce a future runtime bug (e.g., if someone later reads `patchGroup.data.members`).
   - Suggested fix: Change the mutation return type to match the PATCH response shape (e.g., `Pick<GroupResponse,'id'|'name'|'eventId'|'moneyVisibilityMode'>`) or don’t return the parsed body at all if it’s unused. Optionally update the API to return a consistent shape (including members) if that’s the intended contract.

2. [low] Hard-coded tenant/context stamping risks inconsistent data if multiple tenants/contexts exist
   - File: apps/tournament-api/src/routes/admin-groups.ts:36-38
   - Confidence: medium
   - Why it matters: Inserts into `players` and `group_members` stamp `tenantId`/`contextId` from constants (`TENANT_ID`, `PLAYER_CONTEXT_ID`) rather than deriving from the authenticated session or the owning event/group. If data from another tenant/context is ever present, this can create cross-tenant contamination or constraint surprises. Even in a single-tenant app, this makes the router easy to misuse when expanding to multiple leagues.
   - Suggested fix: Derive `tenantId`/`contextId` from the session/request context (or from the fetched group/event row) and scope reads/updates/deletes by the same tenant/context. At minimum, use the preflight group row’s `tenantId/contextId` for stamping group_members.

3. [low] No test asserts the newly-fixed group_members.contextId stamping uses eventId
   - File: apps/tournament-api/src/routes/admin-groups.test.ts:301-326
   - Confidence: high
   - Why it matters: The change from `event:${groupId}` to `event:${eventId}` is a correctness fix, but the current POST tests only assert row counts, not the inserted `groupMembers.contextId`. This could regress without being caught.
   - Suggested fix: In the POST add-member tests, fetch the inserted `groupMembers` row and assert `contextId === 
  `event:${eventId}`` (and optionally `tenantId === TENANT_ID`).

## Strengths

- Server-side: preflight now fetches `eventId` and stamps `group_members.contextId` as `event:${groupEventId}` (fix aligns with comment and FD-6).
- Web: nameDraft sync moved into a dependency-tracked `useEffect`, avoiding setState during render.
- Web: AbortController lifecycle looks coherent (tracked per mutation, signals passed to fetch, unmount cleanup aborts + clears).
- Test suite: bodyLimit regression is now covered for the PATCH path with an explicit >4KiB payload.

## Warnings

None.
