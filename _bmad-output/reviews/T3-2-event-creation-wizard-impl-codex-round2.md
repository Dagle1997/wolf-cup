# Codex Review

- Generated: 2026-04-27T14:35:37.131Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-events.ts, apps/tournament-web/src/routes/admin.events.new.tsx

## Summary

The two Round-1 fixes look clean and correctly targeted:
- Web wizard: courses query is now gated behind `enabled: form.step >= 2`, preventing the fetch on initial mount.
- API: the preflight `SELECT` for course revisions is now wrapped in try/catch, logs a structured failure event with a clear `stage`, and returns the same `{ error: 'internal', code: 'create_failed' }` 500 shape as the transaction failure path.

No new High/Medium issues surfaced in the provided files.

Overall risk: low

## Findings

1. [low] Wizard has no user-facing error/empty-state if course list fetch fails (user can get stuck on step 2)
   - File: apps/tournament-web/src/routes/admin.events.new.tsx:152-465
   - Confidence: high
   - Why it matters: If `/api/courses` fails (network/server), `useQuery` will enter an error state and the `<select>` will remain effectively empty (only the placeholder option). Step 2 cannot be completed, but the UI doesn’t explain why, so the user may be blocked without actionable feedback.
   - Suggested fix: Capture `error`/`isLoading` from `useQuery` and render an inline message (and optionally a retry button). Example: `const { data, error, isLoading, refetch } = useQuery(...)` and show "Failed to load courses" when `error` is set.

## Strengths

- Server-side: preflight course-revision existence check now fails safely (try/catch) and returns consistent 500 error shape while logging a stage-specific structured event (apps/tournament-api/src/routes/admin-events.ts:153-181).
- Client-side: courses query is correctly gated with `enabled: form.step >= 2`, preventing unnecessary fetches on wizard mount and reducing test/mock surface area (apps/tournament-web/src/routes/admin.events.new.tsx:152-164).
- Client and server both validate timezone strings via a robust `Intl.DateTimeFormat(...).format(...)` exercise, avoiding engine-deferred validation pitfalls.

## Warnings

None.
