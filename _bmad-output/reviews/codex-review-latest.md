# Codex Review

- Generated: 2026-06-19T03:42:56.603Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/db/schema.ts, apps/api/src/db/migrations/0033_goofy_salo.sql, apps/api/src/services/bets.ts, apps/api/src/routes/admin/bets.ts, apps/web/src/routes/admin/bets.tsx, apps/web/src/routes/bets.tsx, apps/web/src/components/ScoutingPanel.tsx

## Summary

Change largely achieves the goal: DB + API + both UIs now tolerate `bets.side_b_player_id = NULL` and display/grade odds_win vs “The House” without crashing. The main remaining risks for real-money are (1) lack of a DB-level invariant restricting NULL sideB to `bet_type='odds_win'`, and (2) `settleUp` is no longer guaranteed to be zero-sum once house bets exist, which can break any downstream code/assumptions that implicitly relied on conservation between players.

Overall risk: medium

## Findings

1. [high] DB now permits NULL side_b_player_id for any bet_type (no invariant that only odds_win can be vs House)
   - File: apps/api/src/db/schema.ts:803-806
   - Confidence: high
   - Why it matters: After this change, the database allows `side_b_player_id` to be NULL for *all* bet types, but the “NULL means The House” interpretation is only valid for `odds_win`. If any non-odds_win row is ever inserted/edited with NULL sideB (future code path, manual DB fix, bad import), the system will silently treat it as a house bet in `getBetsBoard` (sideB becomes null → UI shows “The House”; ledger will omit the missing stakeholder), producing incorrect settlement/settle-up for real money.
   - Suggested fix: Add a DB-level CHECK constraint tying nullability to bet type, e.g. `CHECK (bet_type = 'odds_win' OR side_b_player_id IS NOT NULL)` in both Drizzle schema and a migration. Also consider a defensive runtime guard in `getBetsBoard`: if `betType !== 'odds_win' && sideBPlayerId == null`, fail closed (mark outcome live/push and/or surface an admin-visible error) instead of treating it as house.

2. [medium] Settle-up ledger is no longer zero-sum when house bets settle (may break implicit invariants)
   - File: apps/api/src/services/bets.ts:365-398
   - Confidence: high
   - Why it matters: With `sideBPlayerId` nullable, `getBetsBoard` intentionally omits the house from `net` (lines 369-375). This means totals across `settleUp` will not necessarily sum to 0 once any odds_win vs house settles (e.g., bettor wins → +profit with no corresponding negative). If any downstream consumer (current or future) assumes settle-up is an internal player-to-player reconciliation (zero-sum), those computations will be wrong. This is a money-path behavioral change even if the UI currently just displays nets.
   - Suggested fix: Decide and codify what `settleUp` represents:
- If it’s “player vs everyone (including house) P/L”, current approach is fine, but document that it’s not zero-sum.
- If it’s “player-to-player settle-up only”, then exclude house bets entirely from `net`, or add an explicit synthetic entry (e.g. `{ playerId: 0, name: 'The House', net: -sum(players) }`) so conservation holds.
Add tests covering mixed boards (peer bets + house bets) to lock the intended semantics.

3. [medium] Migration relies on PRAGMA foreign_keys toggling during table rebuild; may be ineffective under transactional runners and doesn’t validate existing FK integrity
   - File: apps/api/src/db/migrations/0033_goofy_salo.sql:1-31
   - Confidence: medium
   - Why it matters: SQLite’s `PRAGMA foreign_keys` setting is connection-scoped and cannot be changed inside a transaction (attempts can be ignored). If your migration runner wraps statements in a transaction, the OFF/ON may not behave as intended. Also, turning foreign_keys back ON does not retroactively validate existing rows, so any preexisting FK issues would persist silently. This is a production migration on real-money week.
   - Suggested fix: Verify how Drizzle runs migrations in your environment (transactional vs not). Consider:
- Removing reliance on toggling if unnecessary (bets likely has no inbound FKs), or explicitly running rebuild outside a transaction.
- Running `PRAGMA foreign_key_check;` as an operational post-migration verification step.
- Add a preflight assertion query in a follow-up migration to ensure no invalid `side_*_player_id` references exist.

4. [medium] No automated test coverage added for odds_win vs House settlement + board rendering
   - File: apps/api/src/services/bets.ts:214-399
   - Confidence: medium
   - Why it matters: This change modifies the settlement ledger path and API contract (`BoardBet.sideB` nullable) in a real-money feature area. There’s no accompanying test demonstrating (a) odds_win vs house bettor win records +profit only and doesn’t crash, (b) bettor loss records −stake only, (c) mixed peer + house boards produce expected `settleUp` and stable UI-facing JSON shapes.
   - Suggested fix: Add focused tests:
- Unit tests for `getBetsBoard`’s net aggregation with `sideBPlayerId=null` for odds_win (both winningSide A and B).
- Contract test ensuring `BoardBet.sideB` is null in JSON and clients handle it.
- Regression test ensuring non-odds_win with null sideB is rejected (route) and/or fails closed (board).

## Strengths

- API layer properly gates NULL sideB to odds_win creation (`needs_layer` for other bet types) and avoids self-stakeholder collision only when sideB is present (apps/api/src/routes/admin/bets.ts:107-114).
- `getBetsBoard` now avoids inserting `null` into the `ids` set and avoids `Map` writes with `null` keys (apps/api/src/services/bets.ts:347-355, 369-375), eliminating the most likely crash/NaN risk.
- Both admin and public web UIs were updated to treat `sideB` as nullable and render a clear “The House” fallback without creating a roster card for the house (apps/web/src/routes/admin/bets.tsx:21-22, 316-321; apps/web/src/routes/bets.tsx:92-110).

## Warnings

- Truncated file content for review: apps/api/src/db/schema.ts
