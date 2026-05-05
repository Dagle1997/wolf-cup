# Codex Review

- Generated: 2026-05-05T19:56:13.327Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/__root.tsx

## Summary

The dummy-eventId fallback is gone and the “early-return when no eventId” + “re-extract/bail at fire time” pattern is directionally correct. However, the new “treat all 4xx as success (no retry)” combined with a broad pathname regex can create a real lockout path: a single 4xx on any `/events/<something>` URL will permanently set `hostStampedRef` for the lifetime of the root host instance (likely the entire SPA session), preventing stamping later on a valid event route.

Overall risk: medium

## Findings

1. [high] 4xx-as-success can permanently lock stamping for the whole SPA session if eventId extraction matches non-event pages under /events/*
   - File: apps/tournament-web/src/routes/__root.tsx:133-199
   - Confidence: high
   - Why it matters: `InstallPromptHost` is mounted at the root (line 16) and `hostStampedRef` is intentionally never reset after a “successful” attempt. With the current logic, any 4xx response sets `succeeded = true` (lines 169–174), so `hostStampedRef.current` remains `true` forever for that host instance.

Because `extractEventIdFromLocation()` matches any pathname containing `/events/<segment>` (line 197) and is not anchored/bounded to an actual event-detail route, routes like `/events/new`, `/events/create`, `/events/search`, etc. (or any future non-id subroute under `/events/`) will be treated as having an “eventId”. If the POST then returns 400 (invalid_event_id) or 404, that 4xx is treated as success, so the host will never POST again later when the user navigates to a real event. This is exactly a new “lockup path” caused by broad matching + 4xx-as-success.
   - Suggested fix: Make the eventId detection stricter so it only returns an id for true event-scoped routes, e.g. anchor and require a segment boundary: `^/events/([^/]+)(?:/|$)`.

Additionally (or alternatively), do not treat all 4xx as terminal success for the purposes of the host-level lock. Options:
- Only treat specific known terminal errors as “no retry” after confirming they cannot become valid later in-session.
- Reset `hostStampedRef` for `invalid_event_id` (and possibly other cases) so navigation to a valid event can still stamp.
- Best: derive `eventId` from the router params for routes where it exists instead of parsing `window.location.pathname`.

2. [medium] Auth status fetch turns server errors into “no player/device” for 30s, suppressing the prompt without retry
   - File: apps/tournament-web/src/routes/__root.tsx:34-95
   - Confidence: medium
   - Why it matters: `fetchAuthStatus()` returns `{ player: null, device: null }` on any non-2xx response (line 37) and on exceptions (lines 70–72). React Query will treat this as a successful fetch (not an error), so `InstallPromptHost` will early-return null (line 127 / 131). With `staleTime: 30_000` (line 93) and `retry: false` (line 94), a transient `/api/auth/status` 500 can suppress the install prompt for at least 30 seconds (and potentially longer depending on refetch settings) without showing an error state.

This isn’t a security issue, but it can make the feature flaky under transient backend issues and may reduce prompt impression rates.
   - Suggested fix: Consider throwing on non-2xx so React Query records an error and can refetch sooner (or show a controlled fallback), e.g. `if (!res.ok) throw new Error(...)`. If you intentionally want silent suppression, consider a shorter `staleTime` when the response is non-OK or add an explicit refetch trigger (e.g., on focus) to recover faster.

## Strengths

- Early-returning null when `extractEventIdFromLocation()` is null (lines 140–142) removes the previous dummy-eventId data pollution risk on clearly non-event routes.
- Re-extracting eventId inside `onShown` and bailing with `hostStampedRef` reset + query invalidation (lines 151–161) correctly handles navigation changes between mount and prompt display.
- Host-level `hostStampedRef` guard (lines 82–88, 144–150) is a solid mitigation against StrictMode remount/double-invoke behaviors causing duplicate POSTs.

## Warnings

None.
