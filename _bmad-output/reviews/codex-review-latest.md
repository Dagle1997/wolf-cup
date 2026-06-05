# Codex Review

- Generated: 2026-06-04T20:53:55.585Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/routes/admin/season.ts

## Summary

Confirmed: A and B are resolved by the new guard implementation.

(A) Ownership is now derived from the authoritative anchor (side_games.scheduledFridays) rather than scheduledRoundIds: currentFridayOwner is built by parsing each game’s scheduledFridays (lines 361-381), and compared against newFridayOwner computed from the newly calculated rotation (lines 382-385). Each settled round is mapped to its Friday via rounds.scheduledDate (lines 403-410), and the guard skips if that Friday’s owner would change/drop/newly-assign (cur !== next) (lines 411-419). This makes the guard independent of scheduledRoundIds state and prevents silent history corruption.

(B) Malformed scheduledFridays no longer crashes or bypasses the guard: parsing is wrapped in try/catch and explicitly rejects non-arrays and arrays with non-string elements (lines 368-374). Any parse/shape failure triggers a fail-safe skip with reason 'data-integrity' (lines 374-378).

User’s four verification points:
1) Future-rainout happy path preserved: for settled past rounds, the comparison is per-Friday (lines 406-419). A normal future-only toggle should keep cur===next for past Fridays, so rotation proceeds.
2) Any settled round whose Friday would move/drop/newly-assign triggers a skip regardless of scheduledRoundIds: the guard compares owners on scheduledFridays only (lines 355-360, 409-416). If current owner is missing (undefined) but new owner exists (or vice versa), cur !== next and it skips.
3) No crash on malformed scheduledFridays: JSON.parse and validation are in try/catch; failures set skip and break (lines 368-378).
4) No remaining path here where a played/in-progress/result-bearing round is silently reassigned/dropped: updates only execute when sideGameRotationSkipped is false (lines 423-440), and “settled” includes status active/finalized/completed plus any roundIds with side_game_results (lines 393-402). If any such round’s Friday owner would change, the recompute is skipped (lines 415-418).

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Guard comparison is now anchored to scheduledFridays (authoritative) and performed per-Friday per settled round, eliminating the prior scheduledRoundIds desync blind spot (lines 355-360, 403-419).
- Fail-safe behavior for unreadable scheduledFridays prevents crashes and avoids making potentially destructive updates when current ownership cannot be trusted (lines 368-378).
- Settled-round detection covers both status-based progression and the presence of recorded side-game results, reducing the chance of corrupting already-recorded history (lines 387-402).
- The API response now surfaces a clear warning and a machine-readable sideGameRotationSkipped flag when auto-adjustment is intentionally skipped (lines 479-489).

## Warnings

None.
