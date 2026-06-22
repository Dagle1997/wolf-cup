# Codex Review

- Generated: 2026-06-22T01:13:12.029Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md

## Summary

The spec is *almost* internally consistent and clearly centered on the append-only `hole_claim_writes` model with server-assigned ordering and `client_event_id` dedupe. I do **not** see any instruction to implement the old mutable cell-table / cell-UNIQUE / 409-on-cell-conflict / hard-delete model (aside from the allowed bug description + explicit negations).

However, there is one remaining meta note that contradicts “ready-for-dev” and could confuse implementers about whether the ACs are finalized: the DESIGN DECISION block still claims the ACs below are the “original (cell-table/hard-delete) framing” and that a build pass will rewrite AC1–AC3/AC9/AC11 and re-run review—even though the ACs in this document already appear rewritten to append-only.

AC9’s scorer gate is framed per-*user* (designated scorer user) and is consistent with the rest of the spec.

Append-only + server-assigned ordering is coherent end-to-end for at-least-once replay/idempotency (same `client_event_id` retry) under the single-writer scorer gate, with the intended “no resurrection from duplicate replay” property covered by explicit tests.

Overall risk: medium

## Findings

1. [medium] Stale meta text claims ACs below are still old cell-table framing and must be rewritten/re-reviewed, conflicting with current ACs and “ready-for-dev”
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:17-30
   - Confidence: high
   - Why it matters: Line 29 says: “The ACs below are the original (cell-table/hard-delete) framing… The build pass rewrites AC1-AC3, AC9, AC11… before implementation.” But AC1–AC3/AC9/AC11 *are already written* to the append-only `hole_claim_writes` model. This creates internal inconsistency: a dev could assume the ACs are not authoritative yet, or that another rewrite/re-review is required before starting, which undermines “Status: ready-for-dev.”
   - Suggested fix: Delete or update lines 29–30 to reflect the current state (e.g., “ACs below have been rewritten to match this block” or remove the paragraph entirely). Keep only the bug explanation + the superseding statement if desired.

2. [low] Ordering key is described as “seq/rowid” but not concretely specified in the schema column list, risking inconsistent implementations
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:21-38
   - Confidence: medium
   - Why it matters: The spec repeatedly relies on a “highest server-assigned monotonic order key” (lines 23, 37), but the schema examples (lines 21, 35) list `(id, round_id, …, created_at, …)` without explicitly naming an order column. Task 1 allows either “autoincrement integer `seq`, or rely on the rowid” (line 68). If different contributors choose different mechanisms (or if the DB engine doesn’t support a meaningful `rowid` concept), the ‘latest-write-per-cell’ query and correctness guarantees can drift.
   - Suggested fix: Pick one canonical approach and state it as an AC: e.g. “Use `id` (autoincrement PK) as the monotonic order key” or “Add `seq BIGINT GENERATED ALWAYS AS IDENTITY` and use it.” Then specify that all “latest-write-per-cell” derivations order by that column.

## Strengths

- No remaining *positive* instructions to build the old mutable cell/hard-delete/409 model; the document repeatedly negates those patterns (e.g., lines 36–37, 69).
- Append-only + `client_event_id` UNIQUE + `INSERT … ON CONFLICT DO NOTHING` is specified consistently across DESIGN + ACs + Tasks (lines 21–24, 35–37, 69).
- Resurrection-from-duplicate-replay risk is explicitly identified and directly covered by a required “stale-replay-no-resurrect” test (lines 19–24, 74).
- AC9 correctly frames the scorer gate as per-user (designated scorer user) and discusses same-user second-device behavior without introducing cell-conflict semantics (line 46).
- Tenant scoping + round/foursome membership validation are explicitly called out as required guards (lines 27, 37, 69).

## Warnings

None.
