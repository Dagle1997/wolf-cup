# Epic (FUTURE — not this week): Permanent Stats & Audit — "all stats forever, like Wolf Cup"

**Status:** backlog / roadmap · **Registered:** 2026-06-22 (Josh directive) · **Priority:** AFTER F1 Epic 2 (2-5..2-8) + Epic 3 (3-2..3-5). NOT this week.

## Goal (Josh, verbatim intent)
> "Full history and audit change log for any score or money value on Tournament. All stats forever like Wolf Cup. Per-event stats AND global stats tied to each GHIN and verified player."

## What already exists (per-event audit is solid — verify, don't rebuild)
- **`audit_log`** (T5-1): polymorphic append-only event sink (score commits, round state transitions, any auditable action). Not FK'd to entities so deletes preserve history.
- **`score_corrections`** (T5-9): append-only cell-level audit of every score change after the first (who/when/old→new/request_id).
- **`hole_claim_writes`** (F1): append-only greenie/polie/sandie claim log (set/remove, idempotent).
- **`activity`** spine (T8): per-event activity feed.
- **`round_pins`**: immutable snapshot of resolved config + handicaps at round start.
- **Money = recompute-on-read** from scores + frozen pin + config → reproducible, never a silently-drifting stored value. The money "audit trail" is the audit trail of its inputs.

## The gap (what this epic builds)
1. **Verify end-to-end audit coverage** — confirm EVERY score commit (first write, not just corrections) emits an `audit_log` row; confirm a money-reproducibility + retention guarantee (a finalized round's money can always be re-derived byte-identically from pinned inputs). Close any hole found.
2. **GHIN / verified-player identity spine** — stats keyed to the player's **verified identity (GHIN)**, not a per-event roster row, so a player's record follows them across every event/season. Requires: a canonical player↔GHIN↔verified-identity mapping, and stat aggregation that joins on it (handle GHIN-less manual roster entries + identity merges).
3. **Per-event stats** — surfaced career-style per event (already mostly derivable; presentation layer).
4. **Global / perpetual stats** — the Wolf Cup analogue: cross-event + season standings, champions, all-time leaderboards, head-to-head records, career money — the `history-data.ts` / season-export world, but tournament-native and GHIN-keyed.
5. **Immutability + retention** — "stats forever": never hard-delete audited rows; define retention = permanent; ensure event/round deletion preserves the audit + stat history (polymorphic audit_log already supports this).

## Open design questions (for the planning session)
- GHIN as the stable key vs. a tournament-internal verified-identity id that GHIN maps to (handles GHIN changes / manual players).
- Identity merge/reconciliation (same human, two roster rows / two GHINs).
- Money history: store an immutable settlement snapshot at finalization (a "money ledger" row) vs. recompute-from-pins forever. (Recompute is sound; a snapshot adds defense-in-depth + speed.)
- Cross-tenant / multi-organizer scoping of "global" stats (whose all-time board?).

## Sequencing
Do NOT register stories in `sprint-status.yaml` yet (keeps the director on F1). Plan via BMAD (create-prd → architecture → epics) when F1 Epic 2/3 land. This doc is the captured requirement.
