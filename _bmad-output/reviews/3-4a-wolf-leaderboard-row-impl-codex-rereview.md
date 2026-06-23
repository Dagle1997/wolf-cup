# Codex Review

- Generated: 2026-06-23T18:59:08.799Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/routes/events-leaderboard.ts, apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx, apps/tournament-api/src/services/leaderboard.test.ts

## Summary

Re-review of Story 3-4a fixes: the prior Highs (money-engine 500 risk and F1 netToPar out-of-play hole deflation) appear resolved in the provided code. New work adds scope-summed moneyCents to the leaderboard response and introduces netToPar computed from per-hole par. No new critical/high correctness regressions are evident, but there are a few medium/low risks around unnecessary engine invocation, silent error suppression, and assumptions about par stability vs pinned revisions.

Overall risk: medium

## Findings

1. [medium] Money settlement engine still invoked even when money is not exposed (unlocked or non-F1), contrary to intent; potential perf/instability risk
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:49-74
   - Confidence: high
   - Why it matters: computeScopeMoneyByPlayer calls computeF1EventEdges whenever f1MoneyEnabled() is true, even for non-F1 events or unlocked events where money isn’t exposed (it only learns this after calling the engine). This can add avoidable load/latency to common leaderboard reads and increases the chance of hitting (and silently suppressing) money-engine failures on requests that shouldn’t depend on the engine at all. This partially undermines the stated goal of “scores-only / non-F1 leaderboard read does NO extra work”.
   - Suggested fix: Resolve exposure (isF1 + lockState + moneyEnabled) via a cheap query first (you already do this in resolveF1Mode), and only call computeF1EventEdges when exposure is true. Consider passing f1Mode into computeScopeMoneyByPlayer or folding the exposure check into a single function to avoid double work/races.

2. [medium] Money-engine errors are swallowed without logging; can hide production settlement failures
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:57-64
   - Confidence: high
   - Why it matters: The try/catch around computeF1EventEdges returns null on any error with no log. This prevents 500s (good), but it also removes observability: a persistent settlement bug would silently degrade moneyCents to null for everyone, and operators may not notice until users report it.
   - Suggested fix: Log the caught error at least at warn/error level with requestId + eventId (and maybe opts.scope/roundId). Keep returning null to preserve the non-500 guarantee.

3. [low] Comment/contract mismatch: helper says “empty map when not exposed” but returns null
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:43-48
   - Confidence: high
   - Why it matters: The docstring for computeScopeMoneyByPlayer states it “Returns an empty map when not exposed”, but the implementation returns null for the not-exposed paths. This isn’t a runtime bug (call-site handles null), but it can mislead future maintainers and cause incorrect reuse.
   - Suggested fix: Either update the comment to match (null means not exposed/disabled/error) or change the function to return an empty Map for the “not exposed” case and reserve null for “disabled/error” if you want to distinguish.

4. [low] netToPar uses event-round course revision par even for F1 pinned rounds; relies on “par stable across revisions” assumption
   - File: apps/tournament-api/src/services/leaderboard.ts:292-307
   - Confidence: medium
   - Why it matters: For F1 rounds, net uses the pinned course revision stroke index, but netToPar uses par from eventRounds.courseRevisionId. If par can differ between revisions (even if SI is pinned), To-Par could be incorrect for F1 rounds. You’ve documented the assumption, but the code enforces neither stability nor alignment.
   - Suggested fix: If par truly can’t change in your domain, consider asserting that invariant (e.g., compare pinned vs eventRound par totals when both exist). Otherwise, for pinned rounds consider sourcing par from the pinned courseRevisionId (roundPins.courseRevisionId) to keep To-Par consistent with pinned context.

5. [low] Round-scope money edge filter assumes sourceId is always a string; could throw if null/undefined
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:68-71
   - Confidence: medium
   - Why it matters: Filtering with e.sourceId.startsWith(...) will throw if sourceId is ever null/undefined due to unexpected engine output or schema drift. The try/catch only wraps computeF1EventEdges, not the subsequent loop, so this would still 500 the request.
   - Suggested fix: Defensively guard: if (opts.scope==='round' && (typeof e.sourceId !== 'string' || !e.sourceId.startsWith(...))) continue; Alternatively wrap the loop in a try/catch and return null on any processing error to preserve the “never 500” promise.

## Strengths

- Leaderboard money exposure is now gated by f1MoneyEnabled() before any engine call, eliminating the previous “flag off still 500s” risk path.
- computeF1EventEdges is wrapped in try/catch and degrades to moneyCents=null, meeting the non-500 guarantee for leaderboard reads.
- netToPar computation mirrors the F1 in-play hole filter (pin.siByHole) to avoid deflation from stray out-of-play hole_scores.
- Added service-level invariant test for legacy netToPar on the all-par-4 fixture, plus web tests covering To-Par/$ rendering and $ suppression when money isn’t exposed.

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/leaderboard.ts
