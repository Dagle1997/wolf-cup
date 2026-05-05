# Codex Review

- Generated: 2026-05-05T19:53:39.821Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/__root.tsx

## Summary

The updated `onShown` logic generally implements the intended lock-and-reset pattern: it locks immediately, only unlocks on retry-eligible failures, and keeps the lock on success paths. The main concrete risk I see is treating *all* `404` responses as “success/no retry”, combined with posting under a dummy eventId when no `/events/:id` is in the URL—this can permanently lock the host for the session without ever stamping the real device row.

Overall risk: medium

## Findings

1. [high] Treating all 404s as success + dummy eventId fallback can lock stamping for the whole session without actually stamping
   - File: apps/tournament-web/src/routes/__root.tsx:144-160
   - Confidence: high
   - Why it matters: `onShown` uses `extractEventIdFromLocation() ?? '00000000-0000-0000-0000-000000000000'` (lines 144-145). If the app is currently not on an `/events/:id` path when the install prompt is shown, it will POST to a likely-nonexistent event. If the backend responds `404` for “event not found” (or any other reason), the code treats `404` as `succeeded = true` (line 153), leaving `hostStampedRef.current = true` and preventing any further POST attempts for the remainder of this host instance/session. That can cause a silent failure to ever stamp `installPromptShownAt` in-session, even when the user later navigates to a real event page. This is the same functional outcome as the previously reported lock bug, just via a different path.
   - Suggested fix: Avoid posting when `extractEventIdFromLocation()` is null (return early without setting the permanent lock, or set the lock only after a successful POST). Alternatively, only treat `404` as success when you can disambiguate it as the specific “no device/cross-player” case (e.g., backend returns a distinct status code like 409/412, or a structured error code in JSON), and do not use a dummy eventId that can generate unrelated 404s.

2. [medium] 4xx handling is inconsistent with the stated retry semantics; some permanent/expected failures will be retried indefinitely
   - File: apps/tournament-web/src/routes/__root.tsx:150-159
   - Confidence: medium
   - Why it matters: The comment says “5xx / network errors are retry-eligible” (line 152), but the actual code unlocks (retries later) for any response that is neither `res.ok` nor `404` (lines 153-159). That includes non-retry-eligible 4xx statuses like 400/401/403/422. If those occur (e.g., auth expired between the status query and the POST), the host will keep allowing future POST attempts whenever `onShown` fires again, potentially causing repeated failing requests.
   - Suggested fix: If you truly only want retries for 5xx/network, explicitly set `succeeded = true` for all non-5xx responses (or explicitly reset only on `res.status >= 500`). If some 4xx should still be retry-eligible, encode that explicitly (e.g., retry on 408/429, or on a specific backend error code).

## Strengths

- The lock is acquired immediately at `onShown` entry (line 141), preventing same-tick reentrancy and parallel calls from double-posting.
- The ref is reset only on failure (lines 157-159), addressing the previously reported permanent-lock-on-POST-failure behavior for network/5xx paths.
- Always invalidating the `auth-status` query after the attempt (line 160) helps reconcile UI state with backend state after a successful stamp.

## Warnings

None.
