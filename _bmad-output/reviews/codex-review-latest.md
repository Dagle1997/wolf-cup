# Codex Review

- Generated: 2026-06-20T12:46:50.808Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/routes/bets.ts, apps/api/src/routes/admin/bets.ts, apps/api/src/routes/admin/bets.test.ts, apps/api/src/routes/bets.test.ts, apps/web/src/routes/bets.tsx, apps/web/src/components/ScoutingPanel.tsx, apps/web/src/routes/index.tsx, apps/web/src/routes/admin/bets.tsx

## Summary

All three previously-reported issues appear resolved with solid, test-backed fixes:

1) Public /bets “past round” framing is now keyed off server-provided round status, not the presence of a search param. Web now computes isPastRound from data.round.status (finalized|completed), so carrying ?round for scoping no longer forces past-round copy/empty-state on the live board (apps/web/src/routes/bets.tsx:155-161, 201-210).

2) Admin bet creation is now server-gated to open rounds (active|scheduled) by looking up the round status before insert and returning 422 round_not_open (or 404 round_not_found). This closes the bypass where finalized rounds could be written-to and auto-settled (apps/api/src/routes/admin/bets.ts:116-126). The new admin API tests cover both the allow and deny paths (apps/api/src/routes/admin/bets.test.ts:112-138).

3) Admin round selector now has a safe value fallback when q.data.round is null, avoiding the previous mismatch (apps/web/src/routes/admin/bets.tsx:207).

Round scoping also looks correct end-to-end: web uses ?round for routing, maps it to API ?roundId, and the public API accepts/validates roundId while preserving the default-to-active behavior for invalid values (apps/api/src/routes/bets.ts:15-22; apps/web/src/routes/bets.tsx:150-153; tests in apps/api/src/routes/bets.test.ts:73-111).

Overall risk: low

## Findings

1. [low] Admin UI empty-state message is misleading when a requested roundId doesn’t exist but rounds do exist
   - File: apps/web/src/routes/admin/bets.tsx:221-225
   - Confidence: high
   - Why it matters: If an admin lands on /admin/bets?roundId=N for a non-existent round, the server can legitimately return round=null while still returning a non-empty rounds list. The page currently shows “No rounds yet — set up a round first…”, which is incorrect in that scenario and may confuse operators.
   - Suggested fix: Differentiate between “no rounds exist” vs “selected round not found”. For example: if (!q.data.round && q.data.rounds.length>0) show “Round not found” and/or reset selectedRoundId to q.data.rounds[0].id.

2. [low] Leaderboard history query will be enabled whenever ?round is present (including active round IDs), which may introduce extra fetches after visiting /bets
   - File: apps/web/src/routes/index.tsx:954-1044
   - Confidence: medium
   - Why it matters: ScoutingPanel now always links to /bets with a round id, and BetsPage’s back-link preserves that round param back to /. LeaderboardPage derives viewingRoundId from ?round, and historyData is enabled whenever viewingRoundId !== null, so users can end up always fetching leaderboard history even when effectively on the live round.
   - Suggested fix: If this is unintended, consider enabling history fetch only when viewingRoundId refers to a non-active round (e.g., compare to liveData?.round?.id), or provide a “canonical live” navigation that strips ?round when it equals the active round.

## Strengths

- Server-side open-round gate (active|scheduled) prevents finalized-round bet creation regardless of client behavior (apps/api/src/routes/admin/bets.ts:116-126).
- Public /bets round scoping is explicit and tested: default active, accept ?roundId, invalid falls back, valid-but-missing yields empty board (apps/api/src/routes/bets.ts:15-22; apps/api/src/routes/bets.test.ts:73-111).
- UI past-round framing now correctly follows round.status instead of the presence of a routing param (apps/web/src/routes/bets.tsx:155-161).
- Admin selector value fallback handles round=null cases safely (apps/web/src/routes/admin/bets.tsx:207).

## Warnings

- Truncated file content for review: apps/web/src/routes/index.tsx
