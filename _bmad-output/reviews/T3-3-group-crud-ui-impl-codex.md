# Codex Review

- Generated: 2026-04-27T16:20:38.724Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-groups.ts, apps/tournament-api/src/routes/admin-groups.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx, apps/tournament-web/src/routes/admin.groups.$groupId.edit.test.tsx

## Summary

Backend adminGroupsRouter largely matches the ACs (4 endpoints under /groups, correct auth gating, bodyLimit only on PATCH/POST with 400 body_too_large, GET shape + member sort, v1 visibility guard, composite-PK/UNIQUE → 409 mapping, pre-flight 404s, and required mounts/tests). Frontend route/UI covers the required flows and has 5 tests, but two concrete issues stand out: (1) state update during render for nameDraft sync, and (2) no AbortController/unmount cancellation despite AC #16. Also, group_members contextId is likely wrong (uses groupId where comment says event-scope).

Overall risk: medium

## Findings

1. [medium] group_members.contextId uses groupId instead of event scope (likely wrong value)
   - File: apps/tournament-api/src/routes/admin-groups.ts:299-306
   - Confidence: high
   - Why it matters: The code/comment says group_members should inherit an event-scope context_id, but it writes `contextId: `event:${groupId}`` (line 305-306). If other code relies on contextId for scoping, auditing, or cleanup, using the groupId here will misclassify rows and can cause subtle data access/consistency problems. Tests seed groupMembers with `contextId: event:${eventId}` (admin-groups.test.ts:151-154, 419-424), which suggests eventId is the intended value.
   - Suggested fix: Use the group’s eventId (or group.contextId) when inserting groupMembers. Since you already fetched the group in the pre-flight, select `eventId` (or `contextId`) there and use it for `contextId: `event:${eventId}`` (or copy `groups.contextId`). Add an assertion in POST tests to verify the inserted groupMembers.contextId.

2. [medium] React state update during render for nameDraft sync
   - File: apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx:215-218
   - Confidence: high
   - Why it matters: Calling `setNameDraft(...)` during render is an anti-pattern and can lead to extra renders, StrictMode surprises, and harder-to-reason-about component behavior. While the guard likely prevents an infinite loop, this pattern is still fragile and can regress if conditions change.
   - Suggested fix: Move the sync into a `useEffect` that runs when `group?.name`, `nameDraftDirty` changes, e.g. `useEffect(() => { if (group && !nameDraftDirty) setNameDraft(group.name); }, [group?.name, nameDraftDirty]);`.

3. [medium] Missing AbortController / request cancellation on unmount (AC #16)
   - File: apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx:105-209
   - Confidence: high
   - Why it matters: AC #16 explicitly calls for AbortController-on-unmount. Current fetches in `useQuery`/`useMutation` don’t pass an AbortSignal, so in-flight requests will continue after navigation/unmount. This can waste network, slow route transitions, and in some cases cause post-unmount updates/errors (especially for non-React-Query-managed fetches in mutations).
   - Suggested fix: For React Query queries, accept the queryFn context and pass `signal` into fetch: `queryFn: ({ signal }) => fetch(url, { signal })...`. For mutations, create an AbortController per call (or use a ref) and abort in a `useEffect(() => () => controller.abort(), [])` cleanup; alternatively, use React Query’s `mutationFn` with an externally managed signal if you standardize it.

4. [low] No backend test covering bodyLimit(4KB) → 400 body_too_large mapping (AC #1)
   - File: apps/tournament-api/src/routes/admin-groups.test.ts:208-405
   - Confidence: high
   - Why it matters: bodyLimit and its `onError` mapping are part of AC #1, but there’s no regression test ensuring oversized bodies return `{ code: 'body_too_large' }` with 400 for PATCH/POST. A future middleware change could silently break this contract.
   - Suggested fix: Add two tests that send >4KB JSON bodies to PATCH and POST and assert 400 + `code: 'body_too_large'`.

## Strengths

- AC #1/#8: Router is mounted at `/api/admin` (apps/tournament-api/src/app.ts:56-59) and defines the 4 `/groups/...` routes; bodyLimit(4KB) is applied only to PATCH/POST with 400 `body_too_large` onError (admin-groups.ts:137-150, 222-235).
- AC #2: GET returns `{ id, name, eventId, moneyVisibilityMode, members }` and members are ordered by `asc(players.name)`; 404 `group_not_found` on missing (admin-groups.ts:104-131). Backend test asserts name sort (admin-groups.test.ts:125-173).
- AC #3: PATCH schema enforces at least one field (admin-groups.ts:70-77) and v1 guard rejects non-'open' with 400 `mode_not_v1` (admin-groups.ts:183-191). Tests cover name change and both invalid modes (admin-groups.test.ts:209-263).
- AC #4/#7: POST uses discriminated union, pre-flight group existence check (admin-groups.ts:251-273), race-safe resolve-or-insert for GHIN (admin-groups.ts:390-433), and maps UNIQUE/PRIMARYKEY violations to 409 `player_already_in_group` (admin-groups.ts:39-68, 299-313). Tests cover new GHIN, existing GHIN reuse, and duplicate add → 409 (admin-groups.test.ts:281-376).
- AC #5: Manual add always creates a new player with `ghin: null` (admin-groups.ts:282-286, 435-454). Test covers manual path (admin-groups.test.ts:340-354).
- AC #6: DELETE removes only group_members row and returns 204; 404 `member_not_found` when 0 rows affected (admin-groups.ts:352-373). Test asserts players row remains intact (admin-groups.test.ts:407-442).
- AC #9/#10-#14: Frontend route exists at `/admin/groups/$groupId/edit` with dual export Route + EditGroupPage, organizer gating, header form, member table, GHIN/manual add flows, and remove buttons. Frontend tests exercise render/add/remove and conflict message (admin.groups.$groupId.edit.test.tsx:53-321).
- AC #17/#18: Backend tests are present and count to 17; frontend tests count to 5.

## Warnings

None.
