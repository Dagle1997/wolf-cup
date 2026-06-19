# Codex Review

- Generated: 2026-06-19T02:54:59.413Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/services/bets.ts, apps/api/src/services/bets.test.ts, apps/api/src/routes/admin/bets.ts, apps/api/src/db/schema.ts, apps/api/src/db/migrations/0032_nostalgic_mauler.sql, apps/web/src/routes/admin/bets.tsx, apps/web/src/routes/bets.tsx

## Summary

The new `odds_win` bet type is largely integrated end-to-end (schema fields, admin validation, settlement logic, board rendering) and you added targeted unit tests for `americanProfit` + `settleBet` odds_win. The main money-risk issue is that `odds_win` can settle as a *loss for the bettor* in cases that look like data/enum corruption (e.g., empty `round_results` on a finalized round or an unexpected `odds_market` string), rather than failing closed to `live`. There’s also a small but real admin validation bug where an extraneous `subjectBPlayerId` can incorrectly block odds_win bet creation.

Overall risk: high

## Findings

1. [high] odds_win can incorrectly settle as bettor loss when day markets are indeterminate (e.g., empty round_results)
   - File: apps/api/src/services/bets.ts:49-227
   - Confidence: high
   - Why it matters: This is real-money settlement. `computeDayMarkets()` returns null winners when `round_results` is empty (`rows.length===0` ⇒ `soleLeader` returns null) (lines 63-78). When the round is finalized, `getBetsBoard()` passes `day.finalized=true` (lines 352-359), and `settleBet()` will then treat `winnerId=null` as a miss and settle the bet for side B with payout=stake (lines 215-227). If `round.status==='finalized'` ever occurs before `round_results` is populated/complete (or if `round_results` is temporarily empty due to a write failure), the system will display the bettor as definitively losing and credit the layer—despite having no authoritative results. That’s not “fail closed”; it’s “fail to layer,” which is dangerous for money correctness and operator trust.
   - Suggested fix: Differentiate “tie at the top” from “no authoritative data.” Minimal fix: have `computeDayMarkets` include `rowCount`/`hasResults`/`ready` (e.g., `ready = finalized && rows.length>0`) and make `settleBet` return `live` unless `day.ready` is true. If you need to also guard against partial results, consider requiring results for all roster players or some explicit `round_results_complete`/`finalized_at` invariant. Add tests covering: finalized+empty results ⇒ live; finalized+tie ⇒ settles to B.

2. [high] Invalid/unknown oddsMarket value causes automatic layer win instead of failing closed
   - File: apps/api/src/services/bets.ts:209-227
   - Confidence: high
   - Why it matters: `bets.odds_market` is a free-text column (no DB CHECK). Although the admin route uses a Zod enum, the DB can still contain unexpected values (manual edits, older data, future code bugs). In `settleBet()`, an unknown `bet.oddsMarket` falls through to `winnerId=null` (lines 215-223) and therefore settles as a miss (side B wins stake) (lines 223-227). That’s an asymmetric failure mode that can silently transfer money in the wrong direction rather than leaving the bet live for investigation.
   - Suggested fix: Treat unrecognized `oddsMarket` as non-gradeable: return `{status:'live'...}` (or hard error) instead of settling to B. Example: validate `bet.oddsMarket` against the allowed set at runtime and fail closed if not matched. Add a unit test: `oddsMarket='typo'` + finalized day ⇒ live (not settled B).

3. [medium] Admin roster validation may incorrectly reject odds_win if client sends subjectBPlayerId (even though it is ignored)
   - File: apps/api/src/routes/admin/bets.ts:94-106
   - Confidence: high
   - Why it matters: For roster validation, `subjectIds` includes `subjectBPlayerId` whenever `d.betType !== 'over_under'` and `subjectBPlayerId != null` (line 98). That condition includes `odds_win`. But on insert you always write `subjectBPlayerId: null` for odds_win (line 125). So a client that accidentally sends `subjectBPlayerId` (or a future UI regression) can get `subject_not_in_round` even though subjectB is irrelevant and will be discarded. This is a correctness/ops footgun during admin entry.
   - Suggested fix: Only include `subjectBPlayerId` in `subjectIds` for bet types that actually use it: `if (d.betType === 'h2h' || d.betType === 'per_hole') subjectIds.push(...)`. Optionally also hard-reject `subjectBPlayerId` being provided for odds_win/over_under to keep the API strict.

4. [medium] odds_win settlement gate only checks status === 'finalized'; schema allows 'completed' too (possible never-settle)
   - File: apps/api/src/services/bets.ts:352-359
   - Confidence: medium
   - Why it matters: `getBetsBoard()` passes `finalized = round.status === 'finalized'` (line 353). In the provided schema, `rounds.statusCheck` allows a `'completed'` status as well (apps/api/src/db/schema.ts lines 188-193). If production data ever uses `'completed'` as the terminal state (legacy or admin tooling), `odds_win` bets would remain `live` forever even though the round is effectively done.
   - Suggested fix: Confirm the canonical terminal status. If `'completed'` is real, treat it as finalized for odds_win settlement (and likely elsewhere): `finalized = round.status === 'finalized' || round.status === 'completed'`. Add a test or fixture to prevent regression.

5. [medium] Migration SQL uses `ALTER TABLE ... ADD ...` (missing `COLUMN`) — verify SQLite compatibility
   - File: apps/api/src/db/migrations/0032_nostalgic_mauler.sql:1-2
   - Confidence: medium
   - Why it matters: SQLite commonly uses `ALTER TABLE table_name ADD COLUMN col_def;`. This migration uses `ALTER TABLE `bets` ADD `odds_market` text;` (line 1) and similarly for `odds` (line 2). If your migration runner truly targets SQLite syntax and `ADD` without `COLUMN` isn’t accepted in your SQLite version/config, the migration will fail and runtime queries selecting these columns will error (breaking bets board/admin in production).
   - Suggested fix: Double-check prior migrations / the migration runner’s dialect. If needed, change to `ADD COLUMN` for both statements and re-run. Consider adding a smoke test or CI migration apply step to catch this class of issue.

## Strengths

- `americanProfit` implements correct profit (not payout) semantics for American odds and is unit-tested for both + and − odds, including rounding behavior (apps/api/src/services/bets.test.ts:181-186).
- `odds_win` settlement correctly gates on round finalization and fails closed to `live` when day markets aren’t provided (apps/api/src/services/bets.ts:212-214; test coverage at bets.test.ts:209-216).
- Admin route validates stakeholders differ and that subjects are in the round roster (apps/api/src/routes/admin/bets.ts:80-106), which is key for deterministic settlement.
- Net ledger reuse in `getBetsBoard` correctly treats `outcome.payout` as the transfer amount; for odds_win this matches real-world net transfers (profit on win; stake on loss) (apps/api/src/services/bets.ts:359-365).

## Warnings

- Truncated file content for review: apps/api/src/db/schema.ts
