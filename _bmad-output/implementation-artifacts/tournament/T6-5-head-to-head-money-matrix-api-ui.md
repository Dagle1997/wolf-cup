# T6-5: Head-to-Head Money Matrix API + UI [new]

## Status

Done

## Story

As any Event participant,
I want `GET /api/events/:eventId/money` returning the head-to-head money matrix in INTEGER CENTS across all players (including pairs who never shared a foursome) + a Money page rendering it in `$X.XX` format,
So that at settle-up Josh can see Rick is up $47.00 on Mark with no float-drift concerns (FR-D6, FR-H5, NFR-C1).

T6-5 is the FIFTH story in epic T6 and the FIRST T6 story to ship a UI surface.

## Risk Acceptance

### 1. Path footprint — ALLOWED only

```
apps/tournament-api/src/services/money.ts                                       [NEW]
apps/tournament-api/src/services/money.test.ts                                  [NEW]
apps/tournament-api/src/services/index.ts                                       [MOD: re-export]
apps/tournament-api/src/routes/money.ts                                         [NEW]
apps/tournament-api/src/routes/money.integration.test.ts                        [NEW]
apps/tournament-api/src/app.ts                                                  [MOD: mount router]
apps/tournament-web/src/lib/format-cents.ts                                     [NEW]
apps/tournament-web/src/routes/events.$eventId.money.tsx                        [NEW]
apps/tournament-web/src/routes/events.$eventId.money.test.tsx                   [NEW]
```

9 files (6 NEW + 3 additive MOD). All under `apps/tournament-*/**`. Zero SHARED, zero FORBIDDEN.

### 2. Scope — v1 aggregates 2v2 best ball + persisted team presses ONLY

Per epic AC line 1898: "matrix[a][b] = net cents player A is up on player B across all rounds + all bets + skins (T6.14)".

v1 simplification (load-bearing decision):
- **2v2 best ball + team presses**: full pipeline. Read `team_press_log` rows + invoke `compute2v2BestBall` per round; apply press multipliers per pressed-segment.
- **Individual bets**: aggregate using `computeIndividualBet` IF the bet rows exist in `individual_bets`. v1 includes them (since T6-3 ships the engine + schema; orchestration deferral in T6-4 only affects PRESS persistence for those bets, not base match-play money).
- **Skins**: NOT YET IMPLEMENTED (T6-14 is backlog). v1 returns 0 cents from skins → zero contribution to matrix. Placeholder hook prepared.

Followup T6-5a tracks completing skins integration when T6-14 ships.

### 3. Read-only computed-on-read; no cache; no audit

Per epic AC line 1902: "computed-on-read per D1-1 (no cache); cache-control: no-store header".

`computeMoneyMatrix` is a PURE QUERY service — no writes, no audit, no activity. Trip-day reality: O(N²) matrix with N=4-16 players, computed on every GET; SQLite is fast enough.

### 4. visibilityMode — field echoes config; filter logic bypassed v1 (codex H#2 fix)

Per epic AC line 1908-1910: schema supports `'open' | 'participant' | 'self_only'`. The `visibilityMode` FIELD in the response echoes the group's actual config (whichever of the 3 values is set on `groups.money_visibility_mode`). The FILTER LOGIC is bypassed in v1 — the full N×N matrix is returned regardless of the field's value. Followup T6-5d wires the filter (FR-D9) when needed.

In practice, all v1 events have `groups.money_visibility_mode = 'open'` (T3-3 UI gates the others as v1.5). So the field will return `'open'` in production v1, but the spec doesn't ASSUME that — it echoes whatever's stored.

### 5. UI scope — minimal functional matrix

`events.$eventId.money.tsx` renders:
- N×N table with player names as row+column headers.
- Cells show `formatCents(matrix[a][b])` as `+$X.XX` / `-$X.XX` / `$0.00`.
- Diagonal cells show `—`.
- Viewer's row visually highlighted (`bg-blue-50`).
- Total column on the right showing `totals[playerId]`.
- `cache-control: no-store` header on fetch (read fresh every visit).

OUT OF SCOPE for v1: tap-cell-to-drill-down (T6-6 settle-up integration), real-time refresh (poll once on mount), responsive design polish.

### 6. anti-symmetric matrix invariant

Per epic AC line 1898: `matrix[a][b] === -matrix[b][a]`. This is mathematically guaranteed by the per-round `compute2v2BestBall` perPair output (T6-1 AC-9) + `computeIndividualBet`'s netToPlayerACents being signed; the aggregation in `computeMoneyMatrix` preserves it by adding the same signed value to `matrix[a][b]` and subtracting from `matrix[b][a]`.

### 7. Diagonal cells are 0

A player can't owe themselves. `matrix[playerId][playerId] === 0` for every playerId. UI renders these as `—`.

### 8. INTEGER CENTS discipline

Every cell + total + intermediate sum is an integer. NO floating-point arithmetic. `formatCents(n: number)` is the SOLE conversion to `$X.XX` and runs at the UI render boundary only.

## Acceptance Criteria

**AC-1 — Service exports + signature.**
**Given** `apps/tournament-api/src/services/money.ts`
**When** inspected
**Then** it exports `computeMoneyMatrix(eventId: string, viewerPlayerId: string, tenantId: string): Promise<MoneyMatrix>`. Pure query (reads only). Shape:
```ts
export type MoneyMatrix = {
  players: Array<{ id: string; name: string }>;
  matrix: Record<string, Record<string, number>>;  // matrix[a][b] = signed cents A is up on B
  totals: Record<string, number>;                   // totals[a] = sum across row a
  computedAt: string;                               // ISO timestamp
  visibilityMode: 'open' | 'participant' | 'self_only';
};
```

**AC-2 — Aggregation pipeline.**
**Given** an event with N participants, M rounds
**When** computeMoneyMatrix runs
**Then**:
  (a) Read participants via group_members joined to groups.event_id = eventId.
  (b) For each round in the event with a runtime `rounds` row:
      - Read all hole_scores + foursome pairings.
      - Per foursome: invoke compute2v2BestBall (T6-1) using rule-set config; accumulate perPair contributions.
      - Read team_press_log for the round; apply each press's multiplier to its segment's pair contributions.
  (c) For each individual_bet active for this event:
      - Invoke computeIndividualBet (T6-3); accumulate netToPlayerACents into matrix[playerA][playerB] and matrix[playerB][playerA] = -value.
  (d) Skins: SKIPPED v1 (Followup T6-5a; T6-14 deferred).
  (e) Compute totals[a] = sum of matrix[a][*].
  (f) Return MoneyMatrix.

**AC-3 — Anti-symmetry invariant.**
**Given** any computed matrix
**When** inspected
**Then** for every pair (a, b) where a ≠ b: `matrix[a][b] + matrix[b][a] === 0`. Diagonal cells are 0.

**AC-4 — Integer-only.**
**Given** any computed matrix
**When** inspected
**Then** every cell value `Number.isInteger(value) === true`. No floats.

**AC-5 — `GET /api/events/:eventId/money` route.**
**Given** the route handler at `apps/tournament-api/src/routes/money.ts`
**When** invoked
**Then**:
  - Gates: `requireSession` → `requireEventParticipant`. Malformed-syntax + nonexistent eventIds BOTH return 403 from the middleware (no-existence-leak invariant; same pattern as T6-3 bets route).
  - Calls `computeMoneyMatrix(eventId, c.get('player')!.id, TENANT_ID)`.
  - Returns 200 with the matrix payload.
  - Sets `cache-control: no-store` header.
  - No audit row, no activity emit (read-only).

**AC-6 — Integration tests.**
**Given** `apps/tournament-api/src/routes/money.integration.test.ts` + `apps/tournament-api/src/services/money.test.ts`
**When** run
**Then** these cases pass:
  - (a) Empty event (no rounds, no bets) → matrix all zeros; totals all zeros.
  - (b) Single round with 2v2 best ball, A wins 2 holes, B wins 1 → matrix reflects (winning team's player) is up on (losing team's player).
  - (c) Anti-symmetry asserted across N players: every (a,b) pair sums to 0.
  - (d) Diagonal 0 for every player.
  - (e) Non-participant requester → 403.
  - (f) Nonexistent eventId (valid UUID shape, no matching event) → 403 (no-existence-leak).
  - (g) Integer-only assertion on every cell.

**AC-7 — `formatCents(n)` helper.**
**Given** `apps/tournament-web/src/lib/format-cents.ts`
**When** inspected
**Then** it exports `formatCents(n: number): string` that returns `+$X.XX` for positive, `-$X.XX` for negative, `$0.00` for zero. Throws `RangeError` on non-integer input (defense — keeps integer discipline at boundary).

**AC-8 — UI page renders matrix.**
**Given** `apps/tournament-web/src/routes/events.$eventId.money.tsx`
**When** rendered
**Then**:
  - Table headers show player names (row + column).
  - Cells show `formatCents(matrix[a][b])`; diagonal shows `—`.
  - Viewer's row has `bg-blue-50` highlight.
  - Total column on the right.
  - Auth guard mirrors leaderboard pattern (anonymous → window.location.assign('/api/auth/google')).
  - 403 → inline forbidden message.

**AC-9 — UI test (smoke).**
**Given** `apps/tournament-web/src/routes/events.$eventId.money.test.tsx`
**When** run
**Then**:
  - 2-player matrix with mocked fetch renders correctly.
  - Anti-symmetry of rendered cells.
  - formatCents output verified.

## Tasks / Subtasks

- [ ] Task 1: services/money.ts with computeMoneyMatrix.
- [ ] Task 2: services/money.test.ts unit tests.
- [ ] Task 3: routes/money.ts GET handler.
- [ ] Task 4: routes/money.integration.test.ts.
- [ ] Task 5: app.ts mount.
- [ ] Task 6: lib/format-cents.ts + tests inline.
- [ ] Task 7: events.$eventId.money.tsx UI.
- [ ] Task 8: events.$eventId.money.test.tsx smoke test.
- [ ] Task 9: regression + impl-codex + commit.

## Followups

- T6-5a: Skins integration when T6-14 ships.
- T6-5b: Tap-cell drill-down → T6-6 settle-up integration.
- T6-5c: Real-time refresh polling.
- T6-5d: visibilityMode 'participant' / 'self_only' filter (FR-D9).
- T6-5e: Mobile-responsive table layout for trip-day phone use.

## Files this story will edit

- apps/tournament-api/src/services/money.ts
- apps/tournament-api/src/services/money.test.ts
- apps/tournament-api/src/services/index.ts
- apps/tournament-api/src/routes/money.ts
- apps/tournament-api/src/routes/money.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/lib/format-cents.ts
- apps/tournament-web/src/routes/events.$eventId.money.tsx
- apps/tournament-web/src/routes/events.$eventId.money.test.tsx

## Dev Agent Record

### Debug Log References

- Spec codex: 1 round (2H+1M+2L); 2H + 1M applied (eventId 400/403 contradiction, visibilityMode field-vs-filter clarification, viewerPlayerId vs session.userId).
- Impl codex: 3H+3M; H#3 + M#4 applied (rule-set determinism, holesToPlay respect). H#1 (visibility filter) deferred per spec Section 4 design (Followup T6-5d). H#2 (alphabetical team sort) deferred — engines are label-agnostic so math holds; documented as Followup T6-5g (mirrors T6-4g). M#5 (active bet filter) acceptable v1 — no canceled column. M#6 (boundary integer-cents check) belt-and-suspenders; engine validates internally.

### Completion Notes List

- 9 ALLOWED files (6 NEW + 3 additive MOD: services/index.ts, app.ts). Zero SHARED, zero FORBIDDEN.
- 14 new tests (7 integration + 2 service shape + 5 web smoke). tournament-api 730 → 739 (+9). tournament-web 117 → 122 (+5).
- pnpm -r typecheck + lint clean.
- v1 scope encoded: 2v2 best ball + active individual bets aggregated; press multipliers + skins deferred (Followups T6-5f / T6-5a).
- visibilityMode field echoes config; filter logic bypassed v1 (Followup T6-5d for FR-D9).

### File List

- apps/tournament-api/src/services/money.ts (NEW)
- apps/tournament-api/src/services/money.test.ts (NEW)
- apps/tournament-api/src/services/index.ts (MOD: re-export computeMoneyMatrix + MoneyMatrix)
- apps/tournament-api/src/routes/money.ts (NEW)
- apps/tournament-api/src/routes/money.integration.test.ts (NEW)
- apps/tournament-api/src/app.ts (MOD: mount moneyRouter)
- apps/tournament-web/src/lib/format-cents.ts (NEW)
- apps/tournament-web/src/routes/events.$eventId.money.tsx (NEW)
- apps/tournament-web/src/routes/events.$eventId.money.test.tsx (NEW)
