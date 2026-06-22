# Codex Review

- Generated: 2026-06-22T01:08:30.363Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md

## Summary

Not clean yet. The spec is largely folded to the append-only `hole_claim_writes` model, but there are still several explicit leftovers that reference the old cell-table/`hole_claims` framing (including 409/delete language) and one internal inconsistency on ordering (DESIGN block still says order by `created_at`). These remaining contradictions are likely to cause implementation drift/regressions unless removed.

Overall risk: medium

## Findings

1. [high] Leftover references to old `hole_claims`/cell-table behavior (and 409/delete language) remain in Tasks/Notes
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:1-97
   - Confidence: high
   - Why it matters: Your stated goal is a single, end-to-end append-only design. Remaining mentions of `hole_claims`, “cell-conflict 409”, and “delete-to-remove” are directly contradictory and can easily reintroduce the exact failure mode the writes-log design was meant to eliminate (or at minimum mislead the implementer/test author).
   - Suggested fix: Update/remove the remaining old-model strings:
- Line 1: rename story title to `hole_claim_writes` (not `hole_claims` table).
- Line 72: Task 5 says populate from `hole_claims`; change to `hole_claim_writes`.
- Line 74: Task 7 includes “cell-conflict 409, delete-to-remove”; remove/replace with append-only expectations (dedupe no-op; remove is appended write).
- Line 94: Project Structure Notes says new `db/schema/hole-claims.ts`; change to `hole-claim-writes.ts`.
- Line 97: Testing standards mention “two-unique ON CONFLICT behavior”; for claims, align with “ONE dedupe UNIQUE on client_event_id” (unless you truly intend two uniques for claims, which would conflict with AC2).

2. [high] Ordering key is inconsistent: DESIGN DECISION still says “latest by created_at” while AC3 requires server monotonic seq/rowid
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:21-37
   - Confidence: high
   - Why it matters: You explicitly fixed the prior HIGH about non-robust `created_at` ordering by moving to a server-assigned monotonic key. But the DESIGN DECISION block (which claims to “win” on conflicts) still instructs ordering by `created_at` (line 23). That reopens ambiguity (ties/clock resolution) and could cause an implementer to pick the wrong ordering rule, undermining the “resurrection/ordering concern” fix.
   - Suggested fix: Make the DESIGN DECISION block match AC3: replace “latest write by created_at” with “highest server-assigned monotonic order key (seq/rowid/autoincrement id)”; optionally state a deterministic tiebreaker if you still keep `created_at` for display.
Also consider explicitly naming which column is the order key (e.g., `seq` or `id INTEGER PRIMARY KEY`) in AC1 so it’s unambiguous.

3. [medium] AC9 claim that a “second device” is blocked by `requireScorerForRound` is likely incorrect (gate is per-user/scorer role, not per-device)
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:46-47
   - Confidence: medium
   - Why it matters: `requireScorerForRound` (as described) enforces that only the designated scorer can write, but it typically won’t prevent the same scorer from writing from two devices. If two devices are possible for the same scorer, FIFO-per-device does not imply a global FIFO, so “latest” becomes purely server-arrival LWW. That may be acceptable, but the spec currently asserts device-level blocking as a premise for determinism.
   - Suggested fix: Adjust AC9 wording to be precise: it’s single-writer by scorer identity, not necessarily single-client. If you want true single-device, you’d need an explicit device/session lease mechanism (out of scope if you don’t want it). If you accept multi-device for the scorer, state that ordering is by server seq so LWW is defined even across devices.

## Strengths

- Acceptance Criteria 1–4 clearly state append-only, immutable rows, and a single dedupe UNIQUE on `client_event_id` with `INSERT ... ON CONFLICT DO NOTHING`, eliminating the hard-delete replay resurrection class of bugs.
- AC3 explicitly moves “latest” determination off client timestamps and onto a server-assigned monotonic key (seq/rowid), which is the right direction for robustness under offline replay.
- AC10/AC11/AC12 consistently describe deriving current state from the writes-log (latest `set` per cell; `remove` as an appended row), keeping the engine pure and recompute-on-read semantics intact.

## Warnings

None.
