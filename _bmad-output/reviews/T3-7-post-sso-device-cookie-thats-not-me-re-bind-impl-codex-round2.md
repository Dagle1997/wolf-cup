# Codex Review

- Generated: 2026-04-27T18:19:07.743Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-api/src/routes/invites.ts, apps/tournament-web/src/routes/me.tsx, apps/tournament-web/src/routes/me.test.tsx, apps/tournament-web/src/routes/auth.conflict.tsx, apps/tournament-web/src/routes/auth.conflict.test.tsx

## Summary

Round-1 fixes appear to hold based on the provided diff/content.

(2) `queryClient.fetchQuery({ queryKey: ['auth-status'], staleTime: 0 })` will still populate/update the `['auth-status']` cache entry. In TanStack Query, `staleTime` is evaluated by the caller/observer at read time; it is not “stored” in the cache in a way that would prevent reuse. Other routes that read `['auth-status']` with a 30s `staleTime` should still benefit from the freshly-updated `dataUpdatedAt` produced by this fetch; `/me` just forces an always-refetch behavior for itself.

(3) The new cross-tenant `POST /that-is-not-me` test exercises the right path for the tenant-scoping regression it’s meant to catch: the handler deletes the caller’s session by `sessionId` and deletes `device_bindings` by `(id, tenant_id)`. If a bug reintroduces an unscoped delete-by-id, this test would start failing (foreign row would be deleted).

(4) No new concrete issues introduced are evident from the provided snippets; overall the added coverage around device-binding rebind + destructive escape hatch materially reduces regression risk.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- `/me` loader now forces an on-demand `/status` read while still reusing the shared `['auth-status']` key.
- `POST /that-is-not-me` is tenant-scoped in the DB delete predicate; the added cross-tenant test directly guards against the most dangerous regression (foreign-row deletion).
- OAuth callback reads the device cookie once and passes it into `lookupOrBindOAuthIdentity`, reducing drift/stale-cookie classes of bugs.
- Good defense-in-depth predicates on consolidation UPDATE (`id` + `playerId` + `tenantId` + `session_id IS NULL`).

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/auth.ts
- Truncated file content for review: apps/tournament-api/src/routes/auth.test.ts
- Git diff was truncated for the review request.
