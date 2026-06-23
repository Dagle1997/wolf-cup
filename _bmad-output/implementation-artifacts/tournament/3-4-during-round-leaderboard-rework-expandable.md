# Story 3.4: During-round leaderboard rework — expandable per-player scorecard

Status: ready-for-dev

<!--
SOURCING NOTE (director, 2026-06-23): Sourced from `scoreboard-rework-spec.md`
(Epic-3 "Scoreboard rework", View 1 "During-round scoreboard" + "Suggested story
split" S4), NOT the create-story `epics_file` (which has a colliding Epic 3). 3-1,
3-2, 3-3 were built the same way.
-->

## Story

As a **Tournament player watching the live during-round board**,
I want **to tap any player's leaderboard row and see their Wolf-style hole-by-hole scorecard — notation, handicap-stroke dots, greenie/polie/sandie dots, per-hole Net and per-hole $ — inline**,
so that **the board shows the real, expandable per-player card the group loves (and the Pete Dye brochure p4 can be captured natively from a live event).**

This is **S4 of the scoreboard rework**: it WIRES the already-built pieces together — the ported `ScorecardGrid`/`HoleBadge` (3-1), the scorecard API (3-2), and per-hole F1 money (3-3) — into the live `events.$eventId.leaderboard.tsx` route. It is **tournament-web ONLY**: no API change, no new endpoint, no schema. The brochure p4 (Steven Chatterton's expanded card) becomes capturable once this lands.

## Background — what already exists (evidence, 2026-06-23)

- **Components (3-1, ready):** `apps/tournament-web/src/components/scorecard-grid.tsx` `ScorecardGrid({ holes: ScorecardHole[], showMoney?: boolean })` renders front-9/back-9 Hole/Par/Score(`HoleBadge`)/Net/$ with Out/In/Tot. `hole-badge.tsx` renders notation + greenie/polie/sandie dots + stroke dots. Both pure/presentational. `types/scorecard.ts` `ScorecardHole` = `{ holeNumber, par, grossScore, netScore, moneyNet, hasGreenie?, hasPolie?, hasSandie?, relativeStrokes? }`.
- **API (3-2 + 3-3, ready):** `GET /api/rounds/:roundId/players/:playerId/scorecard` → `{ holes: ScorecardHole[] }`, each hole carrying `grossScore`, `netScore`, `relativeStrokes`, `hasGreenie/Polie/Sandie`, and **`moneyNet` (3-3) in INTEGER CENTS** (player-signed; null when money not exposed / hole unsettled; a settled push = 0). `Cache-Control: no-store`.
- **Route (to rework):** `events.$eventId.leaderboard.tsx` polls `GET /api/events/:eventId/leaderboard?round=current|<id>` every 15s; returns `rows[]` + `round: { id, eventRoundId, name, status }` (where **`round.id` is the runtime `rounds.id`** — exactly the `:roundId` the scorecard endpoint needs, verified at `events-leaderboard.ts` `fetchRoundSummary`) + optional `f1: { lockState, mode: 'money'|'scores_only', moneyEnabled }`.

### ⚠️ Unit seam — cents → dollars (must handle)
`ScorecardGrid`'s `formatMoney(amount)` renders `amount` as **whole DOLLARS** (`+$${amount}`), but the 3-3 API returns `moneyNet` in **CENTS**. The 3-4 adapter MUST convert: `moneyNet = apiCents === null ? null : apiCents / 100`. F1 Guyan money is whole-dollar (pv = $5 = 500¢; `pts*pv` is always a multiple of 100), so `/100` is an exact integer — assert this in a test and document the assumption. Do NOT pass raw cents to `ScorecardGrid` (it would render `+$500` for $5).

## Acceptance Criteria

1. **Expandable rows (round scope), SINGLE-OPEN.** In the `events.$eventId.leaderboard.tsx` board, when a single current round is resolved (`data.round` non-null with a `round.id`), each leaderboard row is an accessible toggle (a `<button>` or `role="button"` with `aria-expanded` + `aria-controls` pointing at the panel's `id`, keyboard-operable, ≥44px tap target). Tapping a row expands an inline panel below it rendering that player's `ScorecardGrid`; tapping again collapses it. **Single-open:** opening one row collapses any other open row (state = `expandedPlayerId: string | null`) — this bounds the per-row scorecard fetch fan-out to at most one in flight and keeps the phone view focused. The existing viewer-row highlight, rank medallions, and columns are preserved.

2. **Lazy fetch per expanded player.** On expand of a row, fetch `GET /api/rounds/${round.id}/players/${row.playerId}/scorecard` via TanStack Query, `enabled` ONLY while the row is expanded, keyed by `['scorecard', round.id, playerId]`. **While open it stays fresh with `refetchInterval: 15_000`** (matching the leaderboard poll, so an open panel never goes stale; the API is `no-store`). A collapsed row issues no fetch. **`round.id` is the runtime `rounds.id`** the endpoint expects (NOT `eventRoundId`) — a test asserts the issued URL embeds `round.id` so a future regression (e.g. swapping in `eventRoundId`) is caught rather than silently 404ing. Loading → a compact inline spinner/`LoadingCard` inside the panel; error → an inline `ErrorCard` with retry (does NOT break the rest of the board); 403/404 → a small inline "scorecard unavailable" note (never a full-page error).

3. **Render the grid with the cents→dollars adapter.** Map each API `ScorecardHole` to the component `ScorecardHole`, converting `moneyNet` **cents → dollars** (`/100`, null-preserving). Pass `holes` to `<ScorecardGrid showMoney={...} />`.

4. **Money column gating mirrors the leaderboard.** `showMoney` controls whether the grid's `$` ROW renders at all, and is `true` only when the board is in money mode AND money is enabled — i.e. `f1?.mode === 'money' && f1.moneyEnabled === true`. This is the SAME condition under which the API populates `moneyNet` (3-3 exposure gate), so when `showMoney` is false the API's `moneyNet` is null anyway. **Important — `showMoney` ≠ per-hole non-null:** even in money mode, individual UNPLAYED or UNSETTLED holes still carry `moneyNet: null` and the grid renders `—` for those cells (its existing per-hole null handling); a settled PUSH carries `0` (dollars after the adapter) and renders `0`. So `showMoney` decides row visibility; per-hole null/0/value is decided per cell by the grid. When money is not exposed, the `$` row is simply hidden (Hole/Par/Score/Net only). This keeps the board's $ never wider than the leaderboard money mode (3-3 AC5).

5. **Event scope unchanged.** In "All rounds" (event) scope there is no single runtime round, so rows are NOT expandable (no `round.id` to query). The expand affordance only appears in round scope. (Cross-round expansion is out of scope — note as a followup.)

6. **No API / schema / Wolf-Cup changes.** tournament-web only (FD-1/FD-2). No edit to `apps/tournament-api/**`, `apps/web/**`, `apps/api/**`, `packages/engine/**`. Reuse the 3-1 components and `types/scorecard.ts` as-is (do not fork the grid). No new endpoint.

7. **Tests.** Component/route tests (the existing `vitest` + Testing Library pattern used by `events.$eventId.team-standings.test.tsx` etc.):
   - A row expands on click and renders `ScorecardGrid` (assert a `HoleBadge`/grid cell appears) with the fetched holes; collapses on second click; `aria-expanded` toggles; opening a second row collapses the first (single-open).
   - **Fetch uses the runtime `round.id`:** assert the mocked scorecard fetch was called with a URL containing the leaderboard mock's `round.id` (guards the round.id-vs-eventRoundId regression, AC#2).
   - The **cents→dollars** conversion (all on PLAYED holes — the grid only renders a `$` cell when `grossScore != null`): a fetched `moneyNet: 500` cents on a played hole renders `+$5` in the grid's `$` row; **`moneyNet: -2000` (player-signed loss) renders `-$20`** (a losing-team hole); `moneyNet: 0` on a played hole renders `0`; `moneyNet: null` on a played hole renders `—`. (An unplayed hole renders `—` regardless.)
   - `showMoney` gating: money mode (`f1.mode==='money' && moneyEnabled`) → the `$` row is present; scores-only / flag-off → no `$` row.
   - Loading + error (and 403/404 unavailable) states for the per-row scorecard fetch are inline and don't crash the board.
   - Event scope: rows are not expandable (no toggle rendered).
   - No regression to the existing leaderboard tests; tournament-web typecheck + lint clean.

## Files this story will edit

- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx

## Tasks / Subtasks

- [ ] Task 1 — Expandable row state + affordance (AC#1, #5)
  - [ ] Add per-row expand state (e.g. `expandedPlayerId: string | null`, or a `Set`). Only render the toggle when `data.round?.id` exists (round scope). Make the row's player cell (or a dedicated chevron button) an accessible toggle with `aria-expanded`, keyboard support, ≥44px target. Preserve the viewer highlight + existing columns.
- [ ] Task 2 — Per-player scorecard fetch + adapter (AC#2, #3)
  - [ ] A small child component (e.g. `RowScorecard({ roundId, playerId, showMoney })`) using `useQuery` (`enabled` when mounted/expanded; key `['scorecard', roundId, playerId]`; `refetchInterval` aligned to the board). Define the API hole shape locally (or reuse `types/scorecard.ts`; the API is a strict superset). Map cents→dollars for `moneyNet` (null-preserving). Inline loading/error/unavailable.
  - [ ] Render `<ScorecardGrid holes={adapted} showMoney={showMoney} />` inside an expanded `<tr><td colSpan=…>` (or a panel below the row).
- [ ] Task 3 — showMoney gating (AC#4)
  - [ ] Compute `showMoney = f1?.mode === 'money' && f1.moneyEnabled === true`. Thread to `RowScorecard`.
- [ ] Task 4 — Tests (AC#7)
  - [ ] Extend `events.$eventId.leaderboard.test.tsx`: mock the leaderboard fetch (round scope, with `f1` money mode) AND the scorecard fetch; assert expand renders the grid, cents→dollars ($5 / 0 / —), showMoney gating, inline loading/error, aria-expanded, and event-scope non-expandable.
- [ ] Task 5 — Verify (AC#6, #7)
  - [ ] `pnpm --filter @tournament/web test`, `pnpm -r typecheck`, `pnpm -r lint` clean. Diff = the 2 declared files only; no API/engine/Wolf-Cup edits.

## Dev Notes

### The expand panel inside a table
The leaderboard is a `<table>` inside `ScrollableTable`. An expanded panel is cleanest as a second `<tr>` with a full-width `<td colSpan={columnCount}>` holding the `ScorecardGrid` (which itself wraps its front/back tables in `ScrollableTable`, so nested horizontal scroll is fine on phone). Compute `colSpan` from the visible columns (Rank/Player/HCP/[CH]/Thru/Gross/Net/[Skins]). Alternatively render the panel below the table keyed to the selected row — but the inline `<tr>` keeps the visual association the brochure wants.

### Cents → dollars (the one correctness item)
```ts
function toGridHole(api: ApiScorecardHole): ScorecardHole {
  return {
    holeNumber: api.holeNumber, par: api.par,
    grossScore: api.grossScore, netScore: api.netScore,
    moneyNet: api.moneyNet === null ? null : api.moneyNet / 100, // cents → whole dollars
    hasGreenie: api.hasGreenie, hasPolie: api.hasPolie, hasSandie: api.hasSandie,
    relativeStrokes: api.relativeStrokes,
  };
}
```
F1 Guyan is whole-dollar so `/100` is exact; a test asserts `500 → +$5`. (If a future non-whole-dollar point value is configured, the $-row would need cents-aware formatting — note as a followup, not a 3-4 concern.)

### Freshness
The scorecard endpoint sets `Cache-Control: no-store` (3-2) precisely so this live board can poll it. Mirror the leaderboard's 15s `refetchInterval` (or refetch on expand + rely on React Query staleness). Don't fetch collapsed rows (`enabled` gate) — N players × polling shouldn't fan out to N scorecards unless expanded.

### Showcase / brochure
Per `scoreboard-rework-spec.md`: capture Steven Chatterton's expanded card for brochure p4 once this lands; the demo/Pete Dye event must be LOCKED (money mode) + `TOURNAMENT_F1_MONEY_ENABLED=true` for the `$` row to show (3-3 exposure model). Capture recipe: `reference/SCREENSHOTS.md` → `node reference/swap-and-render.mjs`.

### Scope guardrails
- **tournament-web only.** No `apps/tournament-api/**` (the API is done in 3-2/3-3), no `apps/web`/`apps/api`/`packages/engine`.
- **Reuse, don't fork** the 3-1 `ScorecardGrid`/`HoleBadge`. If a real gap is found in the component, prefer a minimal, additive prop over a copy.
- **No row-level $ / full sort here.** The spec's row-level `To Par`/`$` columns + the sortable Money/Net-to-Par/Individual weekend standings are **Story 3-5** (View 2). 3-4 delivers the expandable per-player card (View 1's expand). A row-level money column would need the leaderboard API to return per-player F1 totals — out of scope.

### References
- [Source: scoreboard-rework-spec.md#View 1 — During-round scoreboard] — expand → ScorecardPanel; Steve as the showcase.
- [Source: apps/tournament-web/src/components/scorecard-grid.tsx] — the grid (note `formatMoney` expects DOLLARS).
- [Source: apps/tournament-web/src/types/scorecard.ts] — `ScorecardHole` (moneyNet number|null).
- [Source: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx] — the route to rework (round.id = runtime roundId; f1 mode).
- [Source: apps/tournament-api/src/services/scorecard.ts] — API moneyNet is CENTS, null when not exposed / unsettled, 0 on a settled push.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (tournament-director, direct implementation)

### Debug Log References

- New leaderboard test green: `events.$eventId.leaderboard.test.tsx` 10/10. Full tournament-web suite 414 ✓ (404 baseline + 10). typecheck (tsc --noEmit, exit 0) + lint clean.

### Completion Notes List

- **All 7 ACs met.** `events.$eventId.leaderboard.tsx` rows are single-open expandable in round scope; a `RowScorecard` child lazy-fetches the 3-2/3-3 scorecard endpoint (enabled only while expanded; 15s refetch parity; inline loading/error/404-unavailable) and renders the ported `ScorecardGrid`. tournament-web ONLY — no API/schema/Wolf-Cup change.
- **cents → dollars adapter** (`toGridHole`): the API's `moneyNet` is INTEGER CENTS, the grid renders DOLLARS, so `/100` (null-preserving). F1 Guyan is whole-dollar so it's exact; even if violated, `cents/100` yields the correct dollar amount (not a wrong number) — verified, documented, gemini-agreed non-bug.
- **showMoney** = `f1?.mode === 'money' && f1.moneyEnabled === true` (mirrors 3-3's exposure; the grid's `$` row hides otherwise). The scorecard is still fetched in scores-only mode (scores ARE shown) — money is server-gated (3-3) + grid-gated.
- **round.id** (runtime `rounds.id`, verified) is the `:roundId` used; a test asserts the fetch URL embeds it (not `eventRoundId`).
- **Impl review (codex+gemini, mandatory debate → synthesis SHIP):** applied the should-fix items — reset `expandedPlayerId` on scope toggle (no auto-reopen); `aria-controls` now targets a `<div role="region">` (not a `<tr>`); added tests for lazy no-fetch-until-expanded, `moneyEnabled=false` gating, and scope-toggle reset. The cents→dollars Medium was a documented non-bug (gemini disagreed it's an issue).
- **Party review:** SHIP. Party-phase ensemble found one Medium (the scope gate relied indirectly on the API returning round=null in event scope) → applied a defensive gate `expandable = roundId !== null && data.scope === 'round'` + a test. Re-review clean: gemini clean; **codex's new High (roundId string|null → RowScorecard type error) is a VERIFIED FALSE POSITIVE** — `tsc --noEmit -p tsconfig.app.json` exits 0 (TS 4.4+ aliased-condition narrowing narrows `roundId` to string inside the `expandable && isOpen` guard).

### Followups (minor a11y polish, non-blocking)

- `aria-controls` references a region that is only mounted while expanded (standard disclosure pattern; acceptable).
- Pre-existing scope-toggle `role=tablist`/`tab` keyboard + `tabpanel` semantics (a T5-5 inheritance, not 3-4 code) — track separately if strict a11y is required.
- Cross-round expansion (event scope) — deferred (no single runtime round to query).
- Row-level `To Par`/`$` columns + the sortable Money/Net-to-Par/Individual weekend standings → **Story 3-5** (View 2).

### Brochure (the reason this story exists)

Once this is deployed (or run locally), capture **Steven Chatterton's expanded card** for brochure p4 per `reference/SCREENSHOTS.md` → `node reference/swap-and-render.mjs`. The capture event must be LOCKED (money mode) + `TOURNAMENT_F1_MONEY_ENABLED=true` for the `$` row to render (3-3 exposure model).

### File List

- `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx` (modified — RowScorecard + cents→dollars adapter + expandable single-open rows + showMoney gating + scope-gate)
- `apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx` (new — 10 tests)
