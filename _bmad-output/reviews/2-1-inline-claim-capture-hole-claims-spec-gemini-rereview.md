# Gemini Review

- Generated: 2026-06-22T01:04:52.493Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md

## Summary

The redesign to an append-only write log (`hole_claim_writes`) is structurally sound and successfully eliminates the CRITICAL resurrection bug caused by offline queue retries against hard-deletes. However, the Tasks and Dev Notes sections contain extensive leftover instructions from the old design (e.g., implementing a `cellUniq` constraint and `409` conflict logic) which, if followed, will completely break the new append-only model. There is also a minor risk of non-determinism when sorting by `created_at`.

Overall risk: high

## Findings

1. [critical] Leftover Tasks and Dev Notes instruct adding a `cellUniq` constraint, breaking the append-only log
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:68-97
   - Confidence: high
   - Why it matters: Tasks 1, 2, 7 and the Dev Notes explicitly instruct the developer to implement a `cellUniq` constraint ('the cell + dedupe uniques', 'mirrors it exactly', 'two-unique ON CONFLICT'), handle 'cell-upsert', and throw '409' on cell conflict. If a cell unique constraint is applied to the schema, the database will reject any subsequent writes (like an edit `set` or a `remove`) to the same cell, completely breaking the append-only log and preventing users from editing or removing claims.
   - Suggested fix: Remove references to 'the cell + dedupe uniques', 'cell-upsert', 'cell-conflict->409', and 'delete-to-remove' from the Tasks. Rewrite the Dev Note on line 80 to explicitly state that `hole_claim_writes` does NOT mirror the `hole_scores` cell unique constraint, and uses ONLY the single dedupe unique on `client_event_id`.

2. [medium] Defining 'latest write' strictly by `created_at` is vulnerable to clock skew and collisions
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:23-37
   - Confidence: medium
   - Why it matters: Relying purely on a server-assigned `created_at` timestamp to determine the current claim state can lead to non-deterministic outcomes if two writes arrive very rapidly and receive the exact same timestamp, or if the server clock is adjusted backwards (NTP skew).
   - Suggested fix: Define the 'latest' write by ordering by `created_at DESC, id DESC` to provide a deterministic tie-breaker. (If `id` is a v4 UUID instead of a serial integer/sortable ID, consider adding an explicit auto-incrementing `sequence` column for monotonic ordering).

## Strengths

- The redesign to an immutable, append-only log is an excellent and robust solution to the offline queue resurrection problem.
- Strong architectural separation by isolating the state derivation to `compute-foursome` at the service layer, keeping engine resolvers pure.
- Excellent test strategy that intentionally front-loads fail-closed and edge-case testing (inert-vs-fail-closed, idempotency).

## Warnings

None.
