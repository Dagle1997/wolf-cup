# Codex Review

- Generated: 2026-05-05T19:51:57.239Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/components/install-prompt.tsx, apps/tournament-web/src/routes/__root.tsx

## Summary

The Android try/finally fix keeps the button responsive, and the iOS dead-code removal doesn’t break rendering. However, the new host-level stamping introduces a correctness risk: it marks the client as “stamped” even when the POST fails (including non-2xx responses), which can prevent any retry in the same session and leave the UI repeatedly showing without ever successfully stamping. Also, lifting the ref to InstallPromptHost does not actually survive React 18 StrictMode full remounts (the host is remounted too), so the original StrictMode concern is only partially addressed.

Overall risk: medium

## Findings

1. [high] Stamp guard is set before confirming the POST succeeded; non-2xx responses don’t throw, so failures permanently disable retries in-session
   - File: apps/tournament-web/src/routes/__root.tsx:133-150
   - Confidence: high
   - Why it matters: In `onShown`, `hostStampedRef.current` is set to true before the network request, and the code never checks `res.ok` (fetch only throws on network errors). If the endpoint returns 400/401/404/500 (e.g., bad `eventId`, auth/device mismatch, server error), the promise resolves, the guard stays true, and subsequent attempts to stamp in the same session are skipped. Because rendering suppression depends on `device.installPromptShownAt` (server state), the user can keep seeing the prompt while the app will never attempt to stamp again until a full reload—breaking the intended “shown-at flips and suppresses” behavior.
   - Suggested fix: Only set `hostStampedRef.current = true` after a successful POST (check `res.ok`). Alternatively, set it early but reset it on any non-OK response/exception. Also consider treating non-OK as an error path so a later prompt render can retry stamping.

2. [medium] Host-level ref still does not survive React 18 StrictMode full remount; double-stamp is still possible in dev StrictMode
   - File: apps/tournament-web/src/routes/__root.tsx:82-90
   - Confidence: high
   - Why it matters: The comment claims this addresses React 18 StrictMode remount behavior, but StrictMode’s dev-only double-invocation involves unmounting and remounting components, which resets `useRef` state on the host as well. Lifting the ref from `<InstallPrompt>` to `<InstallPromptHost>` only prevents duplicate stamping across child unmount/remount while the host stays mounted; it does not prevent duplicate stamping across host remounts. If the original issue was specifically StrictMode remount, this does not fully eliminate it (though your backend idempotency limits damage).
   - Suggested fix: If you truly need to dedupe across full remounts, use a guard that survives remounts (e.g., module-level singleton, `sessionStorage`, or a query-cached flag keyed by device id). If dev-only duplicates are acceptable, update the comment to reflect the narrower guarantee (child lifecycle, not StrictMode remount).

## Strengths

- Android install button busy-state handling is now robust: the outer `try/finally` ensures `setBusy(false)` runs even when `prompt()` throws (apps/tournament-web/src/components/install-prompt.tsx:156-173).
- iOS dead-code removal is consistent with the new logic: the Android stale-event path no longer attempts an unreachable iOS fallback, and non-iOS users won’t see iOS-shaped UI (install-prompt.tsx:84-108).
- Host-level stamping does prevent duplicate POSTs when only the child `<InstallPrompt>` unmounts/remounts while the host remains mounted (e.g., due to query-driven conditional rendering).

## Warnings

None.
