# Codex Review

- Generated: 2026-05-06T13:09:05.667Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/eslint.config.js, apps/tournament-api/src/routes/activity.ts, apps/tournament-web/src/providers/activity-feed-provider.tsx

## Summary

ESLint override split does keep the activity write-gate armed for the read-side service, and the cursorBefore state update logic now correctly captures the first non-null before-cursor after an empty bootstrap. One concrete concern remains: disabling `no-restricted-imports` entirely for `activity-feed.ts` also disables unrelated restricted-import protections (e.g., engine import restrictions) for that production file.

Overall risk: medium

## Findings

1. [medium] `no-restricted-imports: 'off'` for `activity-feed.ts` disables *all* restricted-import protections (not just `activity` schema)
   - File: apps/tournament-api/eslint.config.js:86-100
   - Confidence: high
   - Why it matters: The base `no-restricted-imports` rule (lines 14–44) enforces multiple invariants, including the FD-11/12 engine import restriction and the activity-schema import restriction. Overriding the rule to `'off'` for `src/services/activity-feed.ts` removes *all* of those checks for that production file, which can allow accidental forbidden imports (e.g., `@wolf-cup/engine` or other banned subpaths) to slip in undetected.
   - Suggested fix: Instead of turning `no-restricted-imports` completely off, override it for `src/services/activity-feed.ts` with a narrowed config that preserves the engine restrictions while removing only the activity-schema restrictions. Practically: copy the base rule options and delete just the `patterns` entries that block importing `activity` (the `*db/schema*` + `**/db/schema/activity*` restrictions).

## Strengths

- Override split achieves the stated goal: `activity-feed.ts` is allowlisted only for imports while `no-restricted-syntax` remains enabled (write-gate preserved).
- `setCursorBefore((prev) => (prev !== null ? prev : finalBeforeCursor))` correctly captures the first non-null cursorBefore even when the initial bootstrap returns empty, without clobbering a previously-set cursor.
- The route comment now documents the middleware-ordering reality and aligns expectations with the renamed test behavior (avoids misleading assertions).

## Warnings

None.
