# T6-6: Settle-Up View — Pairwise Attribution + Zero-Sum Invariant [new]

## Status

Done

## Story

As any Event participant, I want a Settle-Up page that shows each player's net balance in cents AND a per-pair pairwise breakdown, with an explicit zero-sum invariant asserted, so that at the hotel lobby everyone can audit the math before cash changes hands (FR-D7, FR-H5, NFR-C1).

## v1 Scope

- **In scope:** UI page that fetches `GET /api/events/:eventId/money` (T6-5) and renders:
  - Player-balance list ordered by total balance (largest creditor first).
  - Pairwise attribution grid (each player's row from the money matrix).
  - Zero-sum assertion: `Math.abs(sum(totals)) === 0` (after integer aggregation; if non-zero, banner warns "Math is off — refresh"). Note: anti-symmetric matrix guarantees this mathematically; banner is defense-in-depth.
- **Out of scope (Followup T6-6a):** per-hole drill-down (clicking a pair shows hole-by-hole contributions). Requires new API surface; ship in v1.5.
- **Out of scope (Followup T6-6b):** "Min-transactions" suggestion algorithm (e.g., "A pays B $30, B pays C $15"). v1 shows balances + matrix; user computes payments themselves. v1.5 polish.

## Path footprint — ALLOWED only

```
apps/tournament-web/src/routes/events.$eventId.settle-up.tsx        [NEW]
apps/tournament-web/src/routes/events.$eventId.settle-up.test.tsx   [NEW]
```

2 NEW files. NO API changes (reuses T6-5's `GET /api/events/:eventId/money`). Zero SHARED, zero FORBIDDEN.

## Acceptance Criteria

**AC-1 — Page renders.** Route `/events/:eventId/settle-up` fetches the money matrix and renders:
  - Heading "Settle Up".
  - Player-balance section with each player + their total balance, sorted by total descending.
  - Pairwise grid section (similar to money page but ordered for settle-up perspective).

**AC-2 — Zero-sum assertion.** The sum of `totals[*]` MUST equal 0 (anti-symmetric matrix invariant). UI computes the sum on render; if `!== 0`, displays a warning banner: "Balances don't sum to zero — try refreshing".

**AC-3 — Auth + 403 handling.** Same auth pattern as T6-5: anonymous → redirect to /api/auth/google; 403 → inline forbidden message.

**AC-4 — Test.** Smoke test renders a 2-player matrix; asserts player-balance section + zero-sum check + forbidden-state rendering.

## Followups

- T6-6a: Per-hole drill-down (click a pair → drawer showing per-round per-hole contributions).
- T6-6b: Min-transactions suggestion algorithm.
- T6-6c: Print/share view for hotel-lobby paper handout.

## Files this story will edit

- apps/tournament-web/src/routes/events.$eventId.settle-up.tsx
- apps/tournament-web/src/routes/events.$eventId.settle-up.test.tsx
