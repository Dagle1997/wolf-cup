# Codex Review

- Generated: 2026-05-05T16:02:46.069Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md

## Summary

Spec edits credibly address the original round-1 issues (atomic conditional UPDATE for idempotency, single timestamp source via Date.now(), explicit allowlist-only enforcement for audit entity types, eventId shape+length guard, added test coverage notes, and beforeinstallprompt staleness handling). One new area that still looks underspecified/risky is the client-side “on unmount => onShown()” defense-in-depth, which can easily double-invoke or stamp without meaningful user-visible display unless implemented very carefully.

Overall risk: medium

## Findings

1. [medium] Stale beforeinstallprompt fallback could render iOS instructions on non‑iOS platforms
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:97-128
   - Confidence: high
   - Why it matters: The spec states that if a stale `beforeinstallprompt` reference causes `prompt()` to throw, the component will catch and “fall back to rendering the iOS-style instructions card OR null” (line 127). On Android/desktop Chromium, showing iOS A2HS instructions is incorrect and could confuse users; on unsupported platforms it could present actions that can’t work.
   - Suggested fix: Constrain the catch fallback to a platform-appropriate path: e.g., if `beforeInstallEvent.prompt()` throws, clear the deferred event and render `null` or a generic “Install not available” state. Only render iOS instructions when the iOS detection branch is true.

2. [medium] Unmount-triggered onShown() is prone to double invocation unless explicitly guarded
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:98-102
   - Confidence: high
   - Why it matters: The component both (a) calls `onShown()` on user actions (install click resolving `userChoice`, iOS dismiss), and (b) calls `onShown()` on unmount if the user “has neither accepted nor dismissed” (line 101). In React, it’s easy for cleanup logic to run with stale state/closures, or for state transitions to cause unmount after a click—leading to `onShown()` firing twice. The backend is idempotent, but this still risks extra network calls, noisy logs, and brittle tests (AC-6g expects exactly once).
   - Suggested fix: In the component design, require a `useRef` (e.g., `didReportShownRef`) that is set synchronously before awaiting `userChoice` / before triggering any state that could unmount. Cleanup should check the ref, not React state, to ensure `onShown()` is invoked at most once.

## Strengths

- Atomic conditional UPDATE inside a transaction with audit insert only when the UPDATE flips NULL→timestamp (lines 41-45) directly addresses concurrent POST idempotency and duplicate-audit risk.
- Explicitly standardizing persisted timestamps on `Date.now()` and documenting why SQL `CURRENT_TIMESTAMP` is avoided in SQLite (line 60) removes the earlier ambiguity.
- Defense-in-depth validation on `:eventId` before writing it into audit payload JSON (lines 36-38) is a concrete mitigation against log stuffing.
- Clear statement that audit entity type constraints are enforced in TypeScript via allowlists/unions (lines 58-59), consistent with prior additions like `GALLERY_PHOTO`.

## Warnings

None.
