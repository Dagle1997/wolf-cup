# Codex Review

- Generated: 2026-06-20T14:16:45.245Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/services/bets.ts, apps/web/src/routes/bets.tsx, apps/api/src/services/bets.settleup.integration.test.ts, apps/api/src/services/bets.settlement.integration.test.ts

## Summary

API now computes settle-up pairwise per unordered stakeholder pair and emits directional payments (`from` pays `to`). The sign math and direction resolution are consistent with the documented invariant (net signed from lowId’s perspective), and House/null-side bets are excluded safely. Web consumes the new shape exactly and computes per-person weekly net directly from each person’s settled bet outcomes, avoiding the prior cross-counterparty netting bug. Added/updated integration tests cover both (a) multi-bet netting within the same pair and (b) the Kyle scenario where different counterparties must remain separate.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Correct pairwise aggregation: single map entry per unordered stakeholder pair (`${lowId}-${highId}`) nets multiple bets together while keeping different counterparties separate (apps/api/src/services/bets.ts:380-433).
- Direction/sign correctness is internally consistent: `entry.net` increases when lowId wins and decreases when highId wins, then converts to `from`/`to` with `Math.abs` (apps/api/src/services/bets.ts:381-431).
- House/null-side exclusion is explicit and prevents null IDs from entering the pair map (apps/api/src/services/bets.ts:387-399).
- Web contract matches API field names (`fromPlayerId/fromName/toPlayerId/toName/amount`) and renders one payment row per pairwise entry (apps/web/src/routes/bets.tsx:41-46, 227-247).
- Weekly per-person net on cards is computed from the person’s own settled outcomes (won: +payout, lost: −payout), which remains correct even though settle-up is no longer a per-person net (apps/web/src/routes/bets.tsx:121-130).
- Integration tests cover (1) different-counterparty separation (Kyle scenario) and (2) same-pair netting across multiple bets + House exclusion (apps/api/src/services/bets.settleup.integration.test.ts; apps/api/src/services/bets.settlement.integration.test.ts:144-160).

## Warnings

None.
