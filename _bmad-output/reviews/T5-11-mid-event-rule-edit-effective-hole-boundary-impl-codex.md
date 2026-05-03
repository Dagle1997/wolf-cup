# Codex Review

- Generated: 2026-05-03T12:31:26.138Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/event-rule-edits.ts, apps/tournament-api/src/routes/event-rule-edits.integration.test.ts, apps/tournament-api/src/lib/audit-log.ts, apps/tournament-api/src/services/round-state.ts, apps/tournament-api/src/services/index.ts, apps/tournament-api/src/app.ts, _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md

## Summary

Implements the endpoint largely per spec: auth-first in-tx with the no-existence-leak invariant (nonexistent eventId → 403), loose tenant-scoped rule_set existence check (404 rule_set_not_found), correct effectiveFromHole=19 anchor-skip windowing, finalized-round freeze guard, revision insert with contextId='event:<eventId>', audit + activity in-tx, and post-commit breadcrumb logging. Integration tests cover the key AC scenarios including the hole=19 anchor skip and rollback behavior.

Overall risk: low

## Findings

1. [medium] Frozen-round guard can return duplicate frozenRoundIds if round_states is not strictly 1-row-per-round
   - File: apps/tournament-api/src/routes/event-rule-edits.ts:224-252
   - Confidence: medium
   - Why it matters: The handler builds frozenRoundIds by iterating join results (rounds ⨝ round_states) and pushing rounds.event_round_id values without deduping. If the schema ever allows multiple round_states rows per round (e.g., if it becomes an append-only history table, or if data corruption occurs), the API could return duplicates. That can lead to noisy UI rendering, unstable snapshots, or client-side logic bugs (e.g., assuming unique ids).
   - Suggested fix: Deduplicate at the query or in code: e.g. select distinct eventRoundId (Drizzle: sql`distinct(...)`), or `const frozenRoundIds = Array.from(new Set(frozenRows.map(r => r.eventRoundId).filter(Boolean)))`.

2. [low] Revision MAX/prior-config reads are not tenant-scoped (inconsistent with the rest of the route’s tenant scoping)
   - File: apps/tournament-api/src/routes/event-rule-edits.ts:259-291
   - Confidence: high
   - Why it matters: Most queries in the handler explicitly scope by tenantId, but the MAX(revision_number) and prior-config read queries filter only by ruleSetId. Today ruleSetId is a UUID and likely globally unique, so this is unlikely to misbehave; however it weakens the stated invariant (“every query includes tenant_id”) and makes cross-tenant data corruption harder to detect if IDs are ever reused or imported.
   - Suggested fix: Add `eq(ruleSetRevisions.tenantId, TENANT_ID)` to both the maxRows and priorRows WHERE clauses for consistency and future-proofing.

## Strengths

- Auth check is executed inside `db.transaction` before any existence/state reads, preserving the no-existence-leak invariant (nonexistent eventId → 403).
- Effective-hole boundary logic matches the spec: hole 1..18 includes the anchor; hole 19 excludes it via `includeAnchor` and `gt(round_number, anchor.round_number)`.
- Frozen-round window guard correctly treats event_rounds without an associated runtime rounds row as not-finalized (innerJoin requires both rounds + round_states).
- Audit payload includes priorConfig and newConfig and uses the new constants `AUDIT_EVENT_TYPES.RULE_SET_REVISED` and `AUDIT_ENTITY_TYPES.RULE_SET` as required.
- Breadcrumb log is emitted after transaction completion (post-commit), avoiding false recompute-pending logs on rollback.
- Integration tests cover the most failure-prone cases (403 no-existence-leak, cross-event round_not_in_event, finalized-round window rejection, hole=19 anchor skip).

## Warnings

None.
