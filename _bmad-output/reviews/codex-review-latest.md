# Codex Review

- Generated: 2026-06-19T01:38:48.987Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/services/bets.ts, apps/api/src/routes/bets.ts, apps/api/src/routes/admin/bets.ts, apps/api/src/db/schema.ts, apps/web/src/routes/bets.tsx, apps/web/src/routes/admin/bets.tsx

## Summary

Core settle logic mostly matches stated semantics (push handling, per-hole netHoles sign, settle-up uses outcome.payout). The biggest real-money risks are around (a) net calculation silently falling back to HI=0 when round_players data is missing, (b) settling with a default tee when round.tee is null/invalid, and (c) missing server-side validation that IDs are valid/positive and belong to the round roster. There’s also a latent multi-tenant/context mixing risk because queries ignore tenantId/contextId despite the schema having them.

Overall risk: high

## Findings

1. [high] Net settlement can be wrong: missing round_players HI silently treated as 0 strokes (not gated)
   - File: apps/api/src/services/bets.ts:74-104
   - Confidence: high
   - Why it matters: computeStrokeTotals builds hiMap from round_players (line 74-78) but then uses `const hi = hiMap.get(s.playerId) ?? 0;` (line 91). If a subject has hole_scores rows but no round_players row (data inconsistency, guest/import issue, or a bet created for a non-roster player), they can reach holesPlayed===18 and the bet will settle with the wrong net (effectively gross, or under-stroked), moving real money incorrectly. This violates the invariant “Net must be IDENTICAL to the leaderboard’s net (per-round HI + tee)” because leaderboard net requires the correct per-round HI.
   - Suggested fix: Fail closed: if a player has any hole_scores for the round but no round_players.handicap_index, treat totals for that player as incomplete (holesPlayed=0) or return null net so bets stay `live`/error. Also validate on bet creation that subject(s) are in round_players for the round.

2. [high] Tee fallback can silently mis-grade net bets when round.tee is null/invalid
   - File: apps/api/src/services/bets.ts:24-236
   - Confidence: high
   - Why it matters: getBetsBoard uses `const tee = (round.tee as Tee | null) ?? DEFAULT_TEE;` with DEFAULT_TEE = "blue" (lines 24, 234-235). If the round’s tee hasn’t been set yet (null) or is an unexpected string, net strokes (and thus winners/payouts) can be computed for the wrong tee. That’s a direct real-money settlement risk, especially on game day if the admin forgot to set tee before scores start.
   - Suggested fix: Do not default tee for settlement. If round.tee is null/invalid, return board outcomes as `live` (or an explicit error status) and/or require tee be set before allowing bet creation/settlement. Consider validating tee against the Tee union at runtime rather than casting.

3. [medium] Per-hole settlement tolerates missing per-hole scores (continues) instead of failing closed
   - File: apps/api/src/services/bets.ts:141-164
   - Confidence: medium
   - Why it matters: In per_hole settlement, the loop skips holes where either side’s per-hole value is missing: `if (av == null || bv == null) continue;` (line 154). Although you gate on `holesPlayed < 18` (lines 144-145), adversarially this can still undercount holes if data becomes inconsistent (e.g., holesPlayed inflated by non-unique rows in a corrupted DB or future schema changes), leading to a smaller payout and potentially the wrong winner. This is exactly the kind of “partial data but settles anyway” failure that moves real money wrong.
   - Suggested fix: For per_hole, explicitly require both maps contain all 18 holes (e.g., check `ah.size===18 && bh.size===18` and/or verify each hole 1..18 exists). If any hole is missing for either player, return `live`.

4. [high] Admin bet creation does not validate player IDs are real/positive or in the round roster (can misattribute money)
   - File: apps/api/src/routes/admin/bets.ts:23-98
   - Confidence: high
   - Why it matters: Zod schema allows any int for player IDs (lines 28-33): not `.positive()`, not checked for existence, and not checked that subjects are in the round roster. If SQLite foreign keys are not enforced at runtime (common unless explicitly enabled), it’s possible to create bets referencing non-existent players (e.g., 0/negative) or non-roster players; then settle-up in getBetsBoard will credit/debit those IDs (apps/api/src/services/bets.ts lines 241-246), producing a wrong settle-up sheet. Even with FK enforcement, a malformed request can cause runtime errors and operational disruption on league day.
   - Suggested fix: Harden createBetSchema: require `.positive()` for all player IDs and roundId; then verify in DB that subject(s) exist AND are in round_players for that round. Also verify stakeholders exist in players. Return 422 on mismatch.

5. [medium] Queries ignore tenantId/contextId despite schema having them (possible cross-tenant data leak + wrong settlement)
   - File: apps/api/src/services/bets.ts:48-236
   - Confidence: medium
   - Why it matters: bets, players, hole_scores, round_players tables all carry tenantId/contextId, but getActiveRound/getBetsBoard/computeStrokeTotals filter only by status/roundId and not by tenant/context (e.g., getBetsBoard line 214-215; computeStrokeTotals lines 74-87). If the DB ever contains multiple tenants/contexts, the public GET /api/bets could mix or reveal other tenants’ bets and/or compute totals from the wrong population, corrupting the settle-up for real money.
   - Suggested fix: Thread tenantId/contextId through request context (or infer from deployment) and add WHERE clauses on tenantId/contextId consistently for rounds/bets/players/round_players/hole_scores. Add tests that ensure isolation.

## Strengths

- Settlement is recomputed from scores (no stored outcome), so score corrections automatically resettle (services/bets.ts).
- Push semantics are implemented for h2h ties and over/under == line with payout 0 (services/bets.ts lines 134-137, 171-173).
- Per-hole netHoles sign and payout magnitude align with the stated rules; settle-up aggregation uses outcome.payout (services/bets.ts lines 158-163, 241-246).
- Admin routes are protected by adminAuthMiddleware for create/delete (routes/admin/bets.ts lines 37, 53, 101).

## Warnings

- Truncated file content for review: apps/api/src/db/schema.ts
