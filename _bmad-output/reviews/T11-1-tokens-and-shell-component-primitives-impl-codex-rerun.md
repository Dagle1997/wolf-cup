# Codex Review

- Generated: 2026-05-20T21:48:20.501Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/components/back-link.tsx, apps/tournament-web/src/components/back-link.test.tsx

## Summary

BackLink’s typing change is locally contained and the conditional-spread pattern correctly avoids `exactOptionalPropertyTypes` issues. Tests now properly wait for async href resolution. The main remaining risk is that loosening `to` to `string` also makes it easy to render a `$param` placeholder path without required `params`, which may throw during href construction (depending on TanStack Router’s behavior).

Overall risk: medium

## Findings

1. [medium] Potential runtime throw if `to` contains `$param` placeholders but `params` is omitted
   - File: apps/tournament-web/src/components/back-link.tsx:30-45
   - Confidence: medium
   - Why it matters: With `to: string`, callers can pass paths like `/admin/events/$eventId` without `params`. Many router path builders throw when required params are missing during href generation. That would crash render rather than degrade to a 404, and the current typing no longer protects against this footgun.
   - Suggested fix: Add a small runtime guard before building `linkProps`, e.g. detect `/$[A-Za-z0-9_]+/` segments in `to` and, if present, assert `params` exists and contains those keys (throw a clear error message). Add a unit test covering the missing-params case (expecting a thrown error or a safe fallback if you choose one).

## Strengths

- The `NonNullable<LinkProps['to']>` cast is more explicit and localized than the prior `as any`, keeping the untyped surface area confined to the component implementation (apps/tournament-web/src/components/back-link.tsx:40-45).
- The conditional spread for `params` correctly avoids passing `params={undefined}` under `exactOptionalPropertyTypes: true` (apps/tournament-web/src/components/back-link.tsx:42-44).
- Tests now wait for async href computation with `waitFor`, reducing version-dependent flakiness (apps/tournament-web/src/components/back-link.test.tsx:46-48, 62-64).

## Warnings

None.
