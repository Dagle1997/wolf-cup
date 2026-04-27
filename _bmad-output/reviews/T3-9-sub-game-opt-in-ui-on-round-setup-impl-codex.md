# Codex Review

- Generated: 2026-04-27T19:31:12.271Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-api/src/routes/admin-event-rounds.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.test.tsx, _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md

## Summary

Meets most of AC #1-#4/#6/#8/#14: new /api/admin/event-rounds router is organizer-gated, tenant-scoped on the listed tables, POST is transactional delete-then-insert, error-precedence is largely codified, frontend uses TanStack Query+Mutation and aborts in-flight saves on unmount, v1.5 sections are disabled with tooltip, dollars→cents uses Math.round, and tests are non-trivial. Two concrete spec drifts remain: (1) duplicate_participant is only checked per-entry, not across the whole request (AC #3 step 5), and (2) Save button is not disabled when the form is idle/unchanged (AC #5).

Overall risk: medium

## Findings

1. [medium] AC #3 step 5 not met: duplicate_participant is only checked within each subGame entry, not across the whole request
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:284-303
   - Confidence: high
   - Why it matters: The contract says “duplicate playerId in any participantPlayerIds” with deterministic precedence. Current logic catches duplicates only within a single entry (e.g., ['p1','p1']) but will allow the same playerId to appear in multiple subGames entries without triggering duplicate_participant, violating the spec and making server-side validation behavior non-deterministic vs the agreed contract.
   - Suggested fix: Move the duplicate participant check to be global across all entries (after duplicate_sub_game_type, before player_not_in_event). Example: maintain a single Set<string> seenParticipants; iterate entries in order, for each pid: if seenParticipants.has(pid) return duplicate_participant; else add.

2. [medium] AC #5 drift: Save button is not disabled when form is idle/unchanged
   - File: apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx:336-342
   - Confidence: high
   - Why it matters: AC #5 requires “Save button is disabled when no skins-section change has been made (idle)”. Current implementation disables only while the mutation is pending, so the UI allows no-op saves. This is user-visible behavior divergence from the spec and can create needless writes and confusion.
   - Suggested fix: Track a ‘dirty’ flag by comparing current draft.skins (buyInDollars + participant set) against the last server snapshot (query.data) and disable Save when !dirty && !isPending. Store an initialDraft derived from GET and compare (sets can be compared by size+membership).

3. [low] Tenant scoping gap in GET roster query: joined players rows are not filtered by tenant_id
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:126-136
   - Confidence: medium
   - Why it matters: The story explicitly emphasizes tenant scoping for defense-in-depth. The roster query filters group_members.tenant_id and groups are pre-filtered by tenant, but the joined players table is not filtered by players.tenant_id. If cross-tenant IDs or corrupted data exist, this can leak names from other tenants through the join.
   - Suggested fix: Add an additional predicate in the roster memberRows query: eq(players.tenantId, TENANT_ID). (Even if current data model prevents it, this matches the stated hardening posture.)

4. [low] Test coverage gaps vs AC wording: no test for global duplicate participant and roster dedupe+ASC ordering
   - File: apps/tournament-api/src/routes/admin-event-rounds.test.ts:224-733
   - Confidence: high
   - Why it matters: Backend tests are substantial, but two contract points aren’t asserted: (1) duplicate_participant across the whole request (currently unimplemented), and (2) roster is deduped and ASC by name (the happy-path GET test only checks length). These omissions make it easier for future changes to regress contract behavior unnoticed.
   - Suggested fix: Add: (a) a POST test where the same playerId appears in participantPlayerIds across two subGames entries and expect duplicate_participant (after code change), and (b) a GET test that seeds duplicate membership across multiple groups and asserts roster uniqueness and sorted-by-name order.

## Strengths

- AC #1/#3: Router is correctly mounted under /api/admin and both endpoints are requireSession → requireOrganizer gated (apps/tournament-api/src/routes/admin-event-rounds.ts:84-86; apps/tournament-api/src/app.ts:69-73).
- AC #3: Upsert is wrapped in db.transaction and uses DELETE-then-INSERT with tenant scoping on delete/reads (admin-event-rounds.ts:364-399).
- AC #3: Error precedence is implemented in the intended step order (invalid_body → event_round_not_found → sub_game_type_not_enabled → duplicate_sub_game_type → duplicate_participant → player_not_in_event) (admin-event-rounds.ts:224-355), with a precedence test present.
- AC #2: GET roster is ordered by players.name and deduped in code (admin-event-rounds.ts:126-144).
- AC #4/#6/#8: Frontend uses useQuery + useMutation, aborts in-flight mutation fetches on unmount, and renders v1.5 sections as disabled fieldsets with a tooltip title attribute; tests assert disabled attributes (web route file: 121-128, 169-250, 289-333; tests: 52-201).
- AC ‘Math.round’ requirement: dollarsStringToCents uses Math.round(parsed*100) (web route file: 103-109).

## Warnings

None.
