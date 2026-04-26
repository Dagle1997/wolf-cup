# Codex Review

- Generated: 2026-04-26T18:08:45.032Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/admin.courses.upload.tsx, _bmad-output/reviews/T2-3b-minimal-organizer-upload-ui-impl-codex.md

## Summary

Re-review of round-1 mechanical fixes in apps/tournament-web/src/routes/admin.courses.upload.tsx.

1) Auth-status loader caching/retry contract: The new `queryClient.ensureQueryData({ queryKey: ['auth-status'], queryFn: loadAuthStatus, staleTime: 30_000, retry: false })` in `beforeLoad` (lines 263-286) correctly enables per-tab caching and should reuse cached data for subsequent navigations within 30s, assuming the imported `queryClient` singleton is the same instance used app-wide. `retry: false` prevents TanStack Query retrying if the queryFn throws; in this implementation `loadAuthStatus()` collapses errors into `{player:null}` and does not throw, so “retry storms” are prevented either way.

2) Cancel/unmount race: The unmount cleanup abort (lines 104-109) plus the post-await `ac.signal.aborted` guards (lines 137, 141, 147, 152) close the previously-identified setState-after-cancel/unmount paths for the async stages present here, including the “slow `await res.json()` then user cancels” case.

3) No concrete new issues introduced are evidenced in the provided file. The `queryClient` import circularity risk can’t be confirmed or refuted without `../lib/query-client` contents.

Verdict: PASS-with-Lows (one low-risk behavior note below).

Overall risk: low

## Findings

1. [low] Auth-status failures are cached for 30s as `{player:null}`, which can extend transient-failure redirects within the tab
   - File: apps/tournament-web/src/routes/admin.courses.upload.tsx:51-286
   - Confidence: medium
   - Why it matters: Because `loadAuthStatus()` never throws and collapses all failures to `{player:null}` (lines 51-57), TanStack Query will treat a transient network/API failure as a successful cached value. With `staleTime: 30_000` (line 272), any subsequent navigation to this route within 30s will reuse `{player:null}` and immediately trigger the OAuth redirect again (lines 275-284), even if the underlying issue is already resolved—unless the redirect caused a full page reload (which typically clears the cache). This isn’t necessarily wrong given the stated Risk Acceptance §3 contract, but it is a real behavioral consequence of caching “unauthenticated” as data rather than as an error state.
   - Suggested fix: If you want to keep the 30s cache for normal authed results but avoid caching transient failures, consider either: (a) throwing on network/parse failures so `retry:false` applies and failures aren’t stored as fresh data, or (b) using a shorter `staleTime` / `gcTime` when returning `{player:null}` from error-collapse paths, or (c) explicitly `queryClient.removeQueries({queryKey:['auth-status']})` before redirecting so a transient failure doesn’t linger in-cache within the SPA session.

## Strengths

- `ensureQueryData` is used in `beforeLoad` with the specified `staleTime: 30_000` and `retry: false` (lines 269-274), so subsequent navigations within 30s should reuse cached auth status rather than refetching.
- Unmount cleanup aborts any in-flight upload request (lines 104-109), addressing the prior orphaned-fetch risk.
- The added `ac.signal.aborted` checks occur immediately after the awaited stages that can race with cancel/unmount (post-fetch: line 137; post-success-json: line 141; post-error-json: line 147; catch: line 152), which prevents late state transitions after cancel/unmount in the scenarios described.

## Warnings

None.
