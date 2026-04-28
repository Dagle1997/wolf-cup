# Codex Review

- Generated: 2026-04-28T19:04:30.894Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md

## Summary

Spec is largely implementable and stays within the stated path allowlist, but there are a few areas where it’s ambiguous or likely to drift from the epic ACs: authorization scope for the new backend endpoint, how the UI detects “came from cache” to show Offline mode, React Query retry behavior vs cache fall-through, and underspecified par/SI layout. There’s also an explicit deferral of the “course revision superseded” UX that may conflict with epic requirements, and the network-error heuristic may be brittle across browsers/environments.

Overall risk: medium

## Findings

1. [high] Backend endpoint authorization is underspecified and may be too permissive (requireSession only)
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:53-55
   - Confidence: high
   - Why it matters: The spec explicitly calls for `requireSession` only and “NO requireScorerForRound” so “any participant should be able to read course data.” As written, this is broader than “participant”: it appears to allow any authenticated user in the tenant to fetch course data for any roundId (tenant-scoped, but still potentially overbroad). If the tenant can contain users who are not participants in a given event/round (admins, staff, other players), this becomes an authorization gap relative to typical least-privilege expectations and may diverge from epic intent.
   - Suggested fix: Clarify the intended auth rule: (a) any authenticated tenant user, or (b) only users who are participants in the round’s event (or otherwise entitled). If (b), add an AC requiring a participant/roster check (e.g., `requireParticipantForRound` / membership query) and add a backend test for 403/404 behavior for non-participants within the same tenant.

2. [high] Offline mode chip requires a reliable “data source = cache vs network” signal, but spec doesn’t define how to compute it
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:145-147
   - Confidence: high
   - Why it matters: React Query does not inherently tell you whether returned data came from “cache fallback” vs a successful network response unless you explicitly encode that signal. Without a clear mechanism, multiple reasonable implementations exist (wrapping data, out-of-band state, query meta), and it’s easy to get false positives/negatives (e.g., showing Offline mode when only one query fell back, or when React Query served previously-cached in-memory data). Your tests (AC #7 attribution) depend on this being deterministic.
   - Suggested fix: Specify an explicit mechanism, e.g. make each queryFn return `{ data, source: 'network'|'idb' }` (and adapt consumers), or set a side-channel flag (e.g. `setDidUseIdb(true)` inside queryFn) with care for retries. Update the integration test AC to assert chip logic precisely (e.g., chip appears only when both sources are 'idb').

3. [medium] React Query retry behavior vs cache fall-through is not pinned; can cause slow offline renders or unexpected extra network attempts
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:123-144
   - Confidence: medium
   - Why it matters: The intended behavior is “network-first, but on network failure fall through to IDB.” If cache miss occurs while offline, the queryFn throws, and React Query’s default retries can repeatedly re-run the queryFn (and thus re-attempt fetch and/or re-check IDB) causing delayed error states and noisy logs. Conversely, if you always return cached data on first TypeError, you may suppress retries even for transient network blips (which may or may not be desired). The spec asks for robustness “against React Query’s retry behavior” but doesn’t mandate settings.
   - Suggested fix: Add AC language to explicitly set `retry` behavior for these queries (e.g., `retry: false` when offline/network error, or `retry: (count, err) => !isNetworkError(err) && count < N`). Also consider setting `networkMode` intentionally if you use it elsewhere. Make integration tests cover the offline path without waiting on retries (assert no repeated fetch calls).

4. [medium] isNetworkError heuristic is likely brittle across browsers and fetch implementations
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:143
   - Confidence: medium
   - Why it matters: Matching error.message against `/Failed to fetch|NetworkError|Network request failed/` is not consistently portable across browsers (Safari/older WebViews), node/jsdom fetch shims, and future changes. A false negative means you won’t fall back to IDB even though the network is down, breaking the core offline requirement.
   - Suggested fix: Consider broadening the condition to treat `TypeError` from fetch as network by default (with an allowlist for known non-network TypeErrors if needed), or check for `err.name` patterns plus `TypeError`. Pin this in cache-lib tests (and optionally route tests) with representative error shapes (message variants / missing message).

5. [medium] Par/SI “scorecard-shell strip” layout is ambiguous (single-hole label vs per-hole row above grid)
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:159-167
   - Confidence: high
   - Why it matters: The spec says “per-hole par + SI strip above the score input grid” but the example shows a single hole (“Hole 5 • Par 4 • SI 11”). A developer could implement: (a) a header that changes with selected hole, (b) a row per hole across the grid (Par row and SI row), or (c) repeating labels in each hole column. This affects test assertions and UX consistency.
   - Suggested fix: Define the exact UI: for example, “render two compact header rows aligned to the hole columns: Par: [4,5,3…], SI: [11,3,17…]” (or explicitly “only for the currently focused hole”). Update the 2 integration tests to assert the intended rendering (e.g., presence of Par/SI for multiple holes, not just one token string).

6. [medium] Epic AC drift risk: “course-revision-superseded-upstream banner” appears deferred, but epic lines 1378–1380 are referenced as AC
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:117
   - Confidence: medium
   - Why it matters: The spec references epic AC line 1378–1380 and includes `clear*` functions “for … handling,” but then states the banner UX is deferred to v1.5 (lines 255–256). If the epic acceptance criteria require user-visible signaling or a specific invalidation behavior, shipping only silent overwrite may fail epic-level acceptance even if this story’s ACs pass.
   - Suggested fix: Reconcile explicitly: either (a) update this story’s ACs to include the epic-required behavior (banner + clear) now, or (b) document an explicit variance/waiver with product sign-off and ensure epic tracking is updated to reflect the deferral. Add at least one test (frontend) that exercises the superseded detection if it’s required now.

7. [low] Cache-lib contract for malformed IDB data is left ambiguous
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:228
   - Confidence: high
   - Why it matters: AC #7 test attribution includes “malformed data in IDB returns null cleanly (or throws; spec the contract).” This directly admits multiple behaviors are acceptable, which can lead to inconsistent handling in the route (e.g., chip logic, rendering errors, noisy error boundaries).
   - Suggested fix: Choose one contract: either strict (throw and surface an error state) or forgiving (return null and treat as cache miss). Update both the cache-lib tests and the route integration tests to match that contract.

## Strengths

- Clear path footprint constraints and explicit allowlist/forbidden statements (lines 17–38).
- Well-defined backend response shape and tenant-scoped lookup chain (lines 57–94).
- Cache-aside approach (overwrite on successful fetch) is spelled out and aligns with offline-read goals (lines 119–120, 195–200).
- Test floor is explicit with expected net count deltas and file-level attribution (lines 149–232).
- URL shape deviation is documented with rationale and called out for PORTS.md (lines 46–52, 237–240).

## Warnings

None.
