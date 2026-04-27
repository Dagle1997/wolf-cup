# Codex Review

- Generated: 2026-04-27T13:19:54.433Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md

## Summary

Spec is largely executable and stays within the allowed-path boundary. Main risk: one FK choice (rule_set_revisions → event_rounds ON DELETE RESTRICT) can break the promised “event delete cascades through children” semantics and make event deletion impossible once a mid-event rule revision exists. A few acceptance criteria are ambiguous about FK delete actions and naming (camel vs snake), which is a concrete migration/Drizzle-gen footgun (esp. googleSub / google_sub duplication).

Overall risk: high

## Findings

1. [high] Event deletion can be blocked by rule_set_revisions.effective_from_round_id ON DELETE RESTRICT (conflicts with event_rounds ON DELETE CASCADE)
   - File: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md:78-88
   - Confidence: high
   - Why it matters: You explicitly require event_children to be deletable via ON DELETE CASCADE (lines 19-23, 320-321) and define event_rounds.event_id ON DELETE CASCADE (line 154). But rule_set_revisions.effective_from_round_id is specified as FK → eventRounds.id ON DELETE RESTRICT (line 171). If any rule_set_revision references an event_round, deleting the parent event will attempt to delete its event_rounds and will be rejected due to the RESTRICT FK, preventing the cascade chain and making `DELETE FROM events` fail for events that had mid-event rule edits.
   - Suggested fix: Pick a deletion behavior that doesn’t block event deletion. Since effectiveFromRoundId is nullable, the least-invasive fix is changing this FK to `ON DELETE SET NULL` (keep the revision, drop the pointer when an event_round is deleted). Alternatively, if revisions should be event-scoped instead of library-scoped, make them event-context children and delete them with the event, but that contradicts your current library scoping.

2. [medium] ACs mix camelCase vs snake_case for the same DB columns (high risk of duplicate/incorrect columns and indexes, especially googleSub/google_sub)
   - File: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md:154-189
   - Confidence: high
   - Why it matters: The spec names columns as camelCase in some places (`holesToPlay`, `googleSub`, `appleSub`, `manualHandicapIndex`, `preferredTeeColor`) but references constraints/indexes using snake_case (`holes_to_play`, `google_sub`, `apple_sub`, `effective_from_hole`) (e.g., lines 154-155, 171-172, 178-185). In Drizzle, property-name vs SQL column-name can diverge, but the spec doesn’t consistently state which is which. This is a concrete footgun for drizzle-kit generation: you can accidentally create both `googleSub` and `google_sub` (or index the wrong identifier) depending on how columns are declared.
   - Suggested fix: In ACs, explicitly specify the actual SQL column names for each table (e.g., `google_sub`), and if you intend Drizzle property aliases, document them separately. Also make the audit step explicitly check both naming variants before adding the column/index.

3. [medium] organizerPlayerId FK delete behavior is unspecified (ambiguous vs your declared ON DELETE RESTRICT posture for players)
   - File: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md:150-156
   - Confidence: high
   - Why it matters: AC #1 defines `events.organizerPlayerId` as FK → players.id but does not specify ON DELETE behavior (line 153), while other player FKs are explicitly RESTRICT (lines 155, 163, 171, 195). Given your stated key choice “ON DELETE RESTRICT for shared infrastructure (players…)” (line 318), leaving this implicit risks drift (a future implementation could accidentally set CASCADE or SET NULL) and makes the AC less testable.
   - Suggested fix: Amend AC #1 to explicitly require `organizerPlayerId` FK ON DELETE RESTRICT (or NO ACTION if that’s your SQLite equivalent), and include a RESTRICT test case similar to other FKs.

4. [medium] Missing non-negative constraint for buyInPerParticipant allows negative “cents” values
   - File: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md:191-197
   - Confidence: high
   - Why it matters: You emphasize integer-cents discipline (lines 194, 324-325), but the schema as specified has no CHECK preventing negative values. A negative buy-in will likely break downstream accounting/payout logic and is hard to clean once inserted.
   - Suggested fix: Add `CHECK(buy_in_per_participant >= 0)` (or equivalent) and a test asserting a negative insert triggers SQLITE_CONSTRAINT_CHECK.

5. [medium] Uniqueness constraints on players identities (ghin/google_sub/apple_sub) appear global, not tenant-scoped (may violate your stated multi-tenant isolation model)
   - File: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md:42-52
   - Confidence: medium
   - Why it matters: You state tenant isolation via ecosystemColumns (lines 42-52, 118-120). But AC #4 requires partial unique indexes on `ghin`, `google_sub`, `apple_sub` without tenantId (line 184). If you ever enable true multi-tenant within one DB, this forces global uniqueness across tenants, contradicting the “isolation via tenantId” posture and potentially preventing legitimate duplicates across tenants (especially GHIN).
   - Suggested fix: If future multi-tenant-in-one-DB is real, make these partial unique indexes composite on `(tenant_id, ghin)` etc. If you intentionally want global uniqueness for these identifiers, state that explicitly in the spec so it’s not an accidental constraint.

6. [low] AC/test plan does not explicitly require testing the longest cascade chain (event → event_rounds → sub_games → sub_game_participants and event → groups → group_members)
   - File: _bmad-output/implementation-artifacts/tournament/T3-1-event-group-rule-set-invite-sub-game-device-binding-schema.md:112-128
   - Confidence: medium
   - Why it matters: You call out cascade behavior as a focus and require FK cascade tests (lines 112-118, 226-228), but the enumerated subtasks/tests mostly test a single-hop cascade (e.g., event→event_rounds, event_round→sub_games). Without at least one multi-hop cascade test, it’s easy to miss a missing ON DELETE CASCADE on an intermediate FK and only discover it in later T3 stories.
   - Suggested fix: Add at least one explicit test requirement that deletes an event and asserts multi-hop cleanup across 2–3 levels (including invites, groups/group_members, event_rounds/sub_games/sub_game_participants, and device_bindings).

## Strengths

- Paths/allowlist boundary is clearly stated and stays within allowed directories (lines 19-24, 129-145, 253-260).
- Forward-dependency posture is explicitly addressed for sub_games and rule_set_revisions (lines 78-88) and references only already-shipped T1-6a/T2-1 entities (players, sessions, course_revisions).
- Load-bearing nullable sessionId + ON DELETE SET NULL behavior is specified and explicitly tested (lines 70-76, 229-232).
- Acceptance criteria are mostly concrete and testable: explicit tables, columns, indexes, CHECK constraints, and migration expectations (lines 148-218).
- googleSub duplication risk is explicitly called out as an audit/skip requirement (lines 60-61, 180-185, 280-283).

## Warnings

None.
