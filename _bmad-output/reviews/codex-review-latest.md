# Codex Review

- Generated: 2026-06-01T17:21:13.825Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/lib/house-ledger.ts, apps/api/src/routes/admin/the-house.ts, apps/api/src/routes/scouting.ts, apps/api/src/index.ts, apps/web/src/routes/admin/the-house.tsx, apps/web/src/components/ScoutingPanel.tsx, apps/web/src/routes/admin/index.tsx, packages/engine/src/odds.ts

## Summary

Reviewed the new/extracted House ledger lib, new admin endpoint + web page, and the public scouting endpoint changes (weeks filter + removal of House ledger). Admin auth gating appears correctly applied, public /scouting no longer returns the ledger, and the cancelled-round exclusion in the week selector query matches the stated intent. Main residual concerns are minor: season-selection robustness and a client-side redirect pattern that can cause render-time navigation warnings; plus a ledger edge case where a week can be counted as “open” even if nobody is priced (0 stakes).

Overall risk: low

## Findings

1. [medium] Season selection in /admin/the-house is sensitive to overlaps/ordering and uses local-date generation
   - File: apps/api/src/routes/admin/the-house.ts:16-33
   - Confidence: medium
   - Why it matters: The endpoint selects the "current" season via `all.find(startDate <= today <= endDate)` over an unordered `select` (line 22). If seasons ever overlap due to misconfiguration (or if multiple rows satisfy the predicate), selection becomes dependent on DB return order. Also `todayIso()` uses the server's local timezone; around midnight/UTC vs ET mismatch, it could select the wrong season on boundary days.
   - Suggested fix: Make selection deterministic and robust: query ordered (e.g., `orderBy(seasons.year desc)` or by `endDate desc`) and if multiple seasons match 'today', pick the highest year/latest endDate. Consider using a consistent timezone (e.g. UTC via `new Date().toISOString().slice(0,10)`), matching how dates are stored/compared elsewhere.

2. [low] Client-side 401 redirect triggers navigation during render
   - File: apps/web/src/routes/admin/the-house.tsx:44-55
   - Confidence: high
   - Why it matters: Calling `navigate()` directly in the render path (lines 52–54) can produce React warnings (state update during render) and can lead to repeated navigations on re-render in some scenarios.
   - Suggested fix: Move the redirect into a `useEffect` that runs when `(isError && error.message === 'UNAUTHORIZED')` becomes true; optionally use `replace: true` to avoid back-button loops.

3. [low] House ledger counts a week as “open” even if no members are priced (0 stakes)
   - File: apps/api/src/lib/house-ledger.ts:146-174
   - Confidence: high
   - Why it matters: A week is pushed to `perWeek` (and thus included in `openWeeks`) even when `priced` is empty (line 146–169). In that case `simulateWeekHousePnl` returns `{0,0}` and the entry shows 0 stakes/P&L while still affecting `openWeeks` and average `effectiveHold` (line 172). If the intended meaning of “open week” is “a board existed that week,” this can slightly skew summary metrics in edge cases (e.g., many new/under-sampled members).
   - Suggested fix: If desired, treat weeks with `priced.length === 0` as not-open: `continue` before sim + perWeek push, or track a separate `pricedWeeks` counter for `effectiveHold` averaging and `openWeeks` definition.

## Strengths

- Security/auth gating: the new admin endpoint applies `adminAuthMiddleware` directly on the route handler (apps/api/src/routes/admin/the-house.ts:21), and it’s mounted under `/api/admin` (apps/api/src/index.ts:83–84), so the P&L ledger is not exposed on public routes.
- Public /scouting payload no longer includes the House ledger in either early-return or main response paths (apps/api/src/routes/scouting.ts:161–163 and 350–351). No dangling house-ledger imports/vars are present in the provided file.
- Weeks dropdown filter matches the stated requirement: it excludes only `status='cancelled'` while still including scheduled/active/finalized (apps/api/src/routes/scouting.ts:93–98).
- Determinism in the extracted ledger looks intentional and well-defended: per-week odds are seeded by round id (apps/api/src/lib/house-ledger.ts:132), dead-heat winners are sorted for deterministic selection (142–143, 178–179), and bootstrap CIs use a deterministic seed derived from season + open-week count (223–238).
- Calibration sign display on the admin page is consistent with the API’s `vsUniform = ours - uniform` convention: negating mean and bounds yields “positive = line wins” (apps/web/src/routes/admin/the-house.tsx:159–161).
- Scouting UI change is applied: retrospective banner renders above The Line (apps/web/src/components/ScoutingPanel.tsx:278–283), and no House ledger types/components appear in the provided ScoutingPanel.

## Warnings

None.
