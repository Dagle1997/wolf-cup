# Codex Review

- Generated: 2026-05-05T19:47:57.196Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/device_bindings.ts, apps/tournament-api/src/db/migrations/0009_install_prompt_shown_at.sql, apps/tournament-api/src/lib/audit-log.ts, apps/tournament-api/src/routes/install-prompt.ts, apps/tournament-api/src/routes/install-prompt.integration.test.ts, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/components/install-prompt.tsx, apps/tournament-web/src/components/install-prompt.test.tsx, apps/tournament-web/src/hooks/use-first-mutation.tsx, apps/tournament-web/src/hooks/use-first-mutation.test.tsx

## Summary

Backend route and auth-status extension are largely correct and well-covered: the conditional UPDATE is properly player+tenant scoped, idempotent, and audit insertion is gated on the UPDATE actually flipping NULL→timestamp. Main concrete issues are on the frontend: the React-side “single invocation” guard does not actually protect against React 18 StrictMode’s dev-only remount semantics, the iOS fallback path for stale beforeinstallprompt events is unreachable as written, and the Android button can get stuck disabled if prompt() throws and the stamp call fails to unmount the component promptly.

Overall risk: medium

## Findings

1. [high] InstallPrompt cleanup-stamping can fire twice under React 18 StrictMode double mount (ref guard does not survive remount)
   - File: apps/tournament-web/src/components/install-prompt.tsx:49-81
   - Confidence: high
   - Why it matters: The component claims the `useRef` guard prevents double-stamping under React 18 strict-mode double-mount, but `hasStampedRef` is per-component-instance. In React 18 StrictMode (dev), React intentionally unmounts and remounts components to detect unsafe side effects; on the first simulated unmount, the cleanup at lines 75–80 calls `stampOnce.current()`. On the second mount, refs reset and the cleanup can call `onShown()` again. That can produce duplicate POSTs (even if the server is idempotent, it still creates extra network traffic and can complicate client logic/tests) and can also prematurely stamp in dev when the prompt hasn’t meaningfully been “shown to the user” beyond a transient mount.
   - Suggested fix: Move the “stamp on render/unmount” responsibility up to a parent scope that survives StrictMode remounts (e.g., a module-level/session-scoped guard, or keep the guard in a context/provider keyed by device id). Alternatively, only stamp from explicit user-visible actions (dismiss/click) and from a window-level `pagehide/visibilitychange` handler registered once per session/device rather than component cleanup.

2. [medium] iOS stale-event fallback is unreachable because Android branch only runs when isIos is false
   - File: apps/tournament-web/src/components/install-prompt.tsx:84-103
   - Confidence: high
   - Why it matters: The Android branch is gated by `beforeInstallEvent !== null && !isIos` (line 87). Inside `onStaleFallback`, it checks `if (isIos) setShowIosFallback(true)` (line 93), but `isIos` is statically false in this branch. As a result, `setShowIosFallback(true)` never runs and `showIosFallback` is effectively dead state. This contradicts the stated intent in the header comment about platform-aware fallback behavior and makes the fallback logic harder to reason about/verify against ACs.
   - Suggested fix: Either remove `showIosFallback` and the unreachable `if (isIos)` branch (simplify: non-iOS stale prompt → stamp), or adjust branching so that if `beforeInstallEvent` exists on an iOS UA you can attempt prompt and then fall back to iOS instructions on failure (if that’s truly required by the spec). Add a test that forces `prompt()` to throw and asserts the intended fallback behavior.

3. [medium] Android install button can remain permanently disabled if prompt() throws and the stamp call doesn’t immediately unmount the prompt
   - File: apps/tournament-web/src/components/install-prompt.tsx:111-167
   - Confidence: high
   - Why it matters: On Install click, `setBusy(true)` is called (line 157). On success, the component does not reset busy (it relies on parent unmount after `onShown()`), and on failure it calls `onStaleFallback()` but also never resets busy (lines 162–166). If `onShown()` triggers an async POST that fails or is slow (or if the parent doesn’t immediately suppress/unmount), the user can be stuck with a disabled dialog and no way to retry/dismiss via UI, creating a UX dead-end.
   - Suggested fix: Set `setBusy(false)` in a `finally` block, or in both success and catch branches, and decide whether you want to keep the dialog visible after a failure (likely yes, with buttons re-enabled). Consider also clearing `window.__deferredInstallPrompt` on staleness to avoid repeated use of a bad event.

4. [low] Sentinel NotFoundError inside transaction may not reliably survive if the transaction layer wraps/rethrows errors
   - File: apps/tournament-api/src/routes/install-prompt.ts:88-158
   - Confidence: low
   - Why it matters: The 404 path depends on `throw new NotFoundError()` inside the transaction (line 130) and later `err instanceof NotFoundError` in the outer catch (lines 145–147). Many libraries rethrow the original error unchanged, but some wrap it (changing the instance), which would turn expected 404s into 500s. There’s no direct evidence Drizzle wraps transaction callback errors here, but the route correctness is currently coupled to that behavior.
   - Suggested fix: Avoid using `instanceof` across library boundaries: e.g., set a local `let notFound = false` flag and return normally, or throw a plain object/tagged error and detect via `err && (err as any).name === 'NotFoundError'`/message (less ideal) or `Symbol` tagging. Add a test that simulates the “valid-shaped cookie but no matching row” case and asserts 404 deterministically.

## Strengths

- Backend conditional UPDATE is correctly scoped to (deviceId, playerId, tenantId) and `install_prompt_shown_at IS NULL`, preventing cross-player stamping and ensuring idempotency (apps/tournament-api/src/routes/install-prompt.ts:92–103).
- Audit row insertion is correctly gated on the UPDATE actually affecting a row; already-stamped calls return 204 without duplicating audit entries (install-prompt.ts:105–143) and is covered by integration tests.
- /api/auth/status device extension is player-scoped and tenant-scoped, and explicitly returns `device: null` for malformed or cross-player cookies (apps/tournament-api/src/routes/auth.ts:142–178) with good test coverage.
- Allowlist scope appears respected: changes are confined to tournament-api/tournament-web plus a single migration; Wolf Cup codepaths shown are untouched.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/auth.ts
- Truncated file content for review: apps/tournament-api/src/routes/auth.test.ts
