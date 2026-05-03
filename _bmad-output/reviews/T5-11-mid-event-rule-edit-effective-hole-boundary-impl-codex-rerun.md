# Codex Review

- Generated: 2026-05-03T12:32:46.363Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/event-rule-edits.ts, apps/tournament-api/src/routes/event-rule-edits.integration.test.ts, apps/tournament-api/src/lib/audit-log.ts, apps/tournament-api/src/services/round-state.ts, apps/tournament-api/src/services/index.ts, apps/tournament-api/src/app.ts

## Summary

Both prior-pass fixes appear correctly applied in `event-rule-edits.ts`: (1) `frozenRoundIds` is now deduped via a `Set` before returning a 422, and (2) the `MAX(revision_number)` lookup and prior-config read are now tenant-scoped via `eq(ruleSetRevisions.tenantId, TENANT_ID)`. I don’t see any new concrete bugs/regressions introduced in the provided diff/files, and the endpoint behavior described by the comments/AC appears unchanged.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- `frozenRoundIds` dedupe is implemented defensively and safely (`Set` + null guard) at `apps/tournament-api/src/routes/event-rule-edits.ts:227-246`.
- Tenant scoping was added to both the revision-number computation query and the prior-config read query (`apps/tournament-api/src/routes/event-rule-edits.ts:263-273` and `280-289`), addressing cross-tenant bleed risk.
- Auth still runs first inside the transaction via `isEventOrganizerByEventId`, preserving the no-existence-leak behavior (nonexistent event → 403).
- Integration tests cover the freeze-window behavior and hole=19 boundary semantics, and nothing in the fix suggests a behavioral change that would violate those cases.

## Warnings

None.
