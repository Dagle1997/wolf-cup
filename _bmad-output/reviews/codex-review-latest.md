# Codex Review

- Generated: 2026-06-20T14:46:12.429Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/lib/season-export.ts, apps/api/src/lib/email.ts, apps/api/src/services/bets.ts, apps/web/src/routes/bets_.history.tsx, apps/api/src/services/bets.settlement.integration.test.ts, apps/api/src/lib/season-export.test.ts

## Summary

The batch largely does what it claims: season export now builds per-round “detail” sheets with per-group blocks, battingOrder parsing is guarded with Array.isArray + typeof checks, bonuses are pre-parsed per hole (not per cell), and partial scorecards are visually flagged in Tot. Bets season history now rolls up won/lost/net plus W–L counts and has integration test coverage. The main concrete correctness risk I see is that bonusesJson parsing is still not shape-validated and can crash the export on valid-but-wrong JSON (e.g. "null"). Routing un-nesting looks consistent with TanStack file-route IDs, but I can’t verify the generated route tree from the provided evidence.

Overall risk: medium

## Findings

1. [high] bonusesJson JSON.parse result is not shape-validated; parsed null/non-object can crash export
   - File: apps/api/src/lib/season-export.ts:197-284
   - Confidence: high
   - Why it matters: You explicitly hardened battingOrder against valid-but-wrong-shape JSON, but bonusesJson is still assumed to parse into an object. If bonusesJson ever contains a valid JSON value that isn’t a non-null object (e.g. "null", "[]", "1"), then `b.greenies` / `b.polies` / `b.sandies` will throw a TypeError at runtime (property access on null/primitive), aborting the entire season workbook build (and therefore the finalize email attachment generation). This is a concrete crash path in both `buildBonusSummary` and the per-group `bonusByHole` pre-parse loop.
   - Suggested fix: After JSON.parse, validate `b != null && typeof b === 'object'` before accessing properties. Also validate arrays, e.g. `const greenies = Array.isArray((b as any).greenies) ? (b as any).greenies.filter((x) => typeof x === 'number') : []` (same for polies/sandies). Apply in both `buildBonusSummary` (lines ~197-214) and `bonusByHole` pre-parse (lines ~264-275).

2. [medium] Routing un-nest relies on file-route underscore semantics; cannot be confirmed without routeTree.gen.ts
   - File: apps/web/src/routes/bets_.history.tsx:110-113
   - Confidence: medium
   - Why it matters: The fix depends on TanStack file-based routing interpreting `bets_.history.tsx` + `createFileRoute('/bets_/history')` as URL path `/bets/history` while avoiding nesting under `/bets`. If the underscore semantics aren’t applied as expected (or the route tree wasn’t regenerated/used), the page could end up mounted at `/bets_/history` (underscore visible) or still be nested and render the parent route again. This was the original bug class.
   - Suggested fix: Confirm the generated `routeTree.gen.ts` has a route whose `path` is `'/bets/history'` (no underscore) and that it is not a child of the `/bets` route. Also ensure any navigation uses `to="/bets/history"` (path) rather than the route ID.

3. [low] No test coverage for partial scorecard Tot formatting or invalid battingOrder JSON shape
   - File: apps/api/src/lib/season-export.test.ts:84-120
   - Confidence: high
   - Why it matters: The new behaviors called out as fix-ups (partial-card Tot cell formatting and the Array.isArray/typeof guard on battingOrder) are not asserted in the provided tests. A future refactor could regress these without detection (especially the partial Tot string formatting, which is easy to break unintentionally).
   - Suggested fix: Add a test round where a player has <18 holeScores and assert Tot is `${sum} (${playedCount})`, plus one with 0 holes and assert Tot is blank. Add a test where `groups.battingOrder` is valid JSON but wrong shape (e.g. `'null'` or `'{}'` or `'["7701"]'`) and assert export still succeeds and ordering falls back to name.

## Strengths

- battingOrder parsing is now safely guarded with Array.isArray and numeric filtering before use (apps/api/src/lib/season-export.ts:235-248).
- Bonus parsing is moved out of the per-cell loop into a per-group pre-parse map, avoiding repeated JSON.parse calls (apps/api/src/lib/season-export.ts:264-285).
- Partial scorecards are explicitly flagged in Tot to prevent misreading partial sums as full 18 totals (apps/api/src/lib/season-export.ts:289-294).
- Season bet history won/lost/net/wins/losses aggregation matches the payout semantics and still excludes the House as a person (apps/api/src/services/bets.ts:487-552).
- Integration test now asserts won/lost and W–L counts alongside net, covering the intended behavior end-to-end (apps/api/src/services/bets.settlement.integration.test.ts:162-180).

## Warnings

None.
