# Codex Review

- Generated: 2026-05-04T12:48:06.002Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md

## Summary

Re-review of the provided spec excerpt shows the prior High + Medium findings appear addressed in-text: press rows now key off `event_rounds.id` via `firedAtRoundId` (and AC-8 updated), self-bet validation is explicitly first inside the transaction, and a dedicated `roundId` vs `eventRoundId` mapping table (9b) was added. AC-8b (hole-18 trigger → no fire) is also present.

Remaining issues are mostly spec/contract clarity risks that could translate into implementation bugs (especially around the “DB column alignment” claim for `PressFireRow`).

Overall risk: medium

## Findings

1. [medium] `PressFireRow` is described as directly DB-column-aligned, but the type does not match the `individual_bet_presses` table shape (missing required columns; includes non-column field)
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:100-269
   - Confidence: high
   - Why it matters: Section 5 defines `individual_bet_presses` with required DB columns including `bet_id` and `fired_at` (and also `tenant_id`, `context_id`). The `PressFireRow` type later claims “Field names align with the DB column names … so the route layer can persist directly without remapping” (lines ~246–255), but `PressFireRow` omits `betId` and `firedAt` entirely and also contains `trigger?: string`, which is not present in the SQL table. This mismatch can cause real implementation confusion:
- A dev may attempt to insert `PressFireRow` as-is and hit NOT NULL constraints (`bet_id`, `fired_at`, `context_id`).
- Or they may silently drop `trigger` and lose the only persisted explanation for why an auto-press fired (if you intended to keep it).
Given this is a “load-bearing” spec contract for T6-4 persistence wiring, the spec should be unambiguous about what is persisted vs computed-only metadata.
   - Suggested fix: Pick one and make the spec consistent:
1) If you truly want “persist without remapping,” update `PressFireRow` to include all required persistence fields (`betId`, `firedAt`, and optionally `tenantId/contextId` depending on your ecosystemColumns pattern) and remove/rename any non-column fields; OR
2) Keep `PressFireRow` as an engine-domain type, but change the wording to “partial alignment” and add an explicit mapping snippet showing how T6-4 builds the insert row (including how `bet_id` and `fired_at` are derived). If you want `trigger` persisted, add a DB column (e.g., `trigger TEXT`) or encode it into `config_json`/a new JSON column.

2. [medium] Potential round-identity inconsistency: `pressesByRound` is keyed by `eventRoundId` while each `PressFireRow` also carries `firedAtRoundId`, but no invariant/validation is specified
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:168-200
   - Confidence: high
   - Why it matters: The spec now correctly distinguishes `roundId` vs `eventRoundId` (Section 9b), but the engine input simultaneously uses `pressesByRound: Record<eventRoundId, PressFireRow[]>` and also includes `PressFireRow.firedAtRoundId`. If these ever disagree (caller bug, stale data grouping, copy/paste error), the engine could apply presses to the wrong round without noticing. This is a subtle correctness bug that’s hard to detect in testing unless you add an explicit check.
   - Suggested fix: Add an AC/boundary validation: for each `[eventRoundId, presses]` entry, assert every `press.firedAtRoundId === eventRoundId` (otherwise throw). Alternatively, remove the redundant `firedAtRoundId` from the press rows in-memory if you always key/group by round, but that conflicts with your persistence alignment goals.

3. [low] Numbering duplication in validation steps could cause implementation drift
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:142-156
   - Confidence: high
   - Why it matters: In the “Validation order” list, step (iii) is used twice (normalize pair; then verify rounds-in-event). AC-12 repeats the same numbering pattern. This is minor, but these numbered steps are often used as a dev checklist; duplication increases the chance an item is skipped or tests are written against the wrong step index.
   - Suggested fix: Renumber the steps so each is unique (i, ii, iii, iv, v, …) in both Section 6 and AC-12 to keep the implementation checklist unambiguous.

## Strengths

- Prior high-risk issue appears addressed: press identity now uses `firedAtRoundId` referencing `event_rounds.id` (schema + AC-8 updated) (lines ~100–111; ~316–320; ~260–269).
- Self-bet validation is now explicitly first inside the transaction (before canonical ordering / participant checks), matching the stated fix (lines ~146–149; ~351–356).
- Round identifier duality is explicitly documented with a clear mapping table and rule-of-use (Section 9b, lines ~190–200).
- AC-8b for “trigger at hole 18 → no press fires” is present and explicitly specified (lines ~321–325).
- Missing-score press-trigger behavior is documented and explicitly accepted for v1, reducing ambiguity (lines ~184–185).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md
