# Codex Review

- Generated: 2026-04-27T13:26:59.795Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md

## Summary

Round-1 fixes called out in your checklist are reflected cleanly in the spec text (FK delete actions are now explicit; naming convention guidance is upfront; negative buy-in is guarded by CHECK; multi-hop cascade/SET NULL tests are explicitly required). The main remaining risk I see is an unaudited FK target for `device_bindings.session_id` that could break migration generation/apply if the existing `sessions` table doesn’t actually expose `session_id` as the referenced key column in tournament-api’s 0000 migration.

Overall risk: medium

## Findings

1. [medium] `device_bindings.session_id` FK references `sessions.session_id` but spec lacks an audit step to confirm the sessions table/PK column name
   - File: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md:195-241
   - Confidence: medium
   - Why it matters: The spec requires `device_bindings.session_id ... FK → sessions.session_id` and tests that delete a parent `sessions` row to assert `ON DELETE SET NULL` (AC #5, #12). If the existing `sessions` table (from 0000 / T1-6a auth) uses a different primary key column name (commonly `id`) or even a different table/column naming scheme, `drizzle-kit generate` or `drizzle-kit migrate` will fail, blocking the entire migration. Unlike the `players.google_sub` case, there’s no explicit “audit first” instruction here.
   - Suggested fix: Add an explicit audit requirement similar to AC #4’s `google_sub` audit: grep/inspect `apps/tournament-api/src/db/schema/*` (or the 0000 migration snapshot) to confirm the sessions table name and PK column. Then pin the FK to the actual column (e.g., `sessions.id` if that’s what exists). Update AC #5/#12 wording accordingly so the dev can’t accidentally ship a broken FK.

## Strengths

- Round-1 FK delete-action concerns are now spelled out explicitly (notably `events.organizer_player_id ON DELETE RESTRICT` and `rule_set_revisions.effective_from_round_id ON DELETE SET NULL`) with rationale and dedicated tests (AC #12a/#12b).
- The naming-convention preamble plus “ACs reference SQL column names” rule meaningfully reduces Drizzle-vs-SQL ambiguity and should prevent migration/index-name mismatches.
- New CHECK constraints for `sub_games.buy_in_per_participant >= 0` and enumerated fields (`holes_to_play`, `money_visibility_mode`, `sub_games.type`) are paired with explicit negative/out-of-range test requirements, which is the right posture for schema-only stories.
- The spec explicitly calls out additive-only migration discipline and requires both fresh-DB and T2-populated migration test coverage, reducing data-loss/regression risk.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md
