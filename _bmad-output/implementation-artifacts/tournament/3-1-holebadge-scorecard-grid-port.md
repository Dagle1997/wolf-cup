# Story 3.1: Port HoleBadge + front-9/back-9 scorecard grid shell to tournament-web

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Tournament player viewing the during-round board**,
I want **the Wolf Cup–style hole-by-hole scorecard notation (eagle/birdie/par/bogey/double badges, handicap-stroke dots, greenie/polie/sandie dots) and a front-9/back-9 grid**,
so that **my round reads at a glance like the Wolf board the group already loves — without the Stableford/Harvey/Wolf rows Pete Dye doesn't use.**

This is **S1 of the scoreboard rework** (see `scoreboard-rework-spec.md` "Suggested story split"): port the presentation primitives with **static/fixture data only**. No API, no live wiring, no real money — those are stories 3-2 (scorecard API), 3-3 (per-hole F1 money), 3-4 (leaderboard rework). 3-1 delivers tested, standalone, fixture-driven components ready for 3-4 to consume.

## Acceptance Criteria

1. **HoleBadge ported** to `apps/tournament-web` renders the Wolf notation keyed on `d = gross − par`: `d ≤ −2` eagle+ (filled red circle), `d === −1` birdie (red circle outline), `d === 0` par (plain number), `d === 1` bogey (amber square outline), `d ≥ 2` double+ (blue nested double-square). Visual parity with `apps/web/src/routes/index.tsx` `HoleBadge` (L145–208).
2. **Bonus dots** (bottom-center of the badge): greenie = emerald, polie = amber, sandie = orange — each shown only when its flag is set; multiple can co-occur.
3. **Handicap-stroke dots** (top-right of the badge): `relativeStrokes === 1` → one dot, `relativeStrokes >= 2` → two dots, falsy/0 → none.
4. **ScorecardGrid ported** renders a front-9 table (Out column) always, and a back-9 table (In + Tot columns) **only once at least one back-9 hole (holeNumber > 9) has been played** (`grossScore != null`) — mirroring Wolf `back9played.length > 0` (L395). Rows: **Hole / Par / Score(HoleBadge) / Net / $** and column totals. **No Stab (Stableford), Hvy Pts (Harvey), or Wolf rows** (dropped per Pete Dye adaptation).
   - **Totals contract** (matches Wolf): `Out` = sum over **played front-9 holes** of {Par, gross, Net, non-null moneyNet}; `In` = same over played back-9 holes; `Tot` = front + back. A played-hole count of 0 renders `—` for that section's totals. The Par cell for a given hole shows `par` only when that hole is played, else `—` (Wolf L302).
5. **Unplayed-cell contract.** `HoleBadge` is rendered **only for played holes** (`grossScore != null`); it is never invoked with a null gross. An unplayed Score cell renders an em-dash placeholder directly, plus a stroke dot **only when `relativeStrokes > 0`**, and then **exactly one** dot (never two) regardless of the stroke count — the 1-vs-2-dot distinction in AC #3 applies only to the played `HoleBadge` (matching Wolf L316, where the unplayed dot is conditional on `relativeStrokes`). Unplayed Par/Net/$ cells render `—`. Totals sum only played holes (per AC #4).
6. **The `$` row is gated by a `showMoney` prop** and driven entirely by the fixture's `moneyNet` values. To make "money not supplied" structurally representable (so the component can never fabricate a value), **`moneyNet` is `number | null`**: `null` = money unknown / not-yet-computed (the 3-3 seam), `0` = a legitimate even-money result. A played hole whose `moneyNet === null` renders `—` in the `$` cell (NOT `0`, NOT `$0`); `moneyNet === 0` renders `0`. The `$` column total sums only non-null `moneyNet` of played holes; **if a section (Out/In/Tot) has zero played holes with a non-null `moneyNet`, that total also renders `—`** — an empty sum is "unknown", never `0` (this closes the all-null fabrication path). 3-1 does **not** compute money. When `showMoney` is false the `$` row is omitted entirely.
7. **Styling adapts to tournament-web tokens, not Wolf's shadcn aliases.** Standard Tailwind palette utilities used by the Wolf badge (`bg-red-600`, `border-amber-500`, `bg-emerald-500`, `bg-orange-500`, `text-blue-600`) are kept (Tailwind v4 is present). The shadcn **semantic** aliases the Wolf source uses but tournament-web does NOT define (`text-muted-foreground`, `bg-muted`, `bg-foreground/50`, `text-destructive`, `border-border`) MUST be replaced with the tournament token system (`var(--color-text-muted)`, `var(--color-money-pos)`, `var(--color-money-neg)`, `var(--color-border-subtle)`, etc.) so the components render correctly in both light and `.dark` themes.
8. **Tests:** HoleBadge unit tests cover every notation branch (eagle/birdie/par/bogey/double), each bonus dot, and the 1-dot / 2-dot stroke cases. ScorecardGrid tests cover: front-only render, front+back render with totals, unplayed-cell placeholder + stroke dot, `showMoney` true/false (row present/absent), and absence of Stab/Harvey/Wolf rows.
9. **No live route is modified.** The components are standalone and fixture-tested. Wiring into the leaderboard route is deferred to 3-4. (This keeps 3-1's diff scoped to new files + zero behavior change to the running app.)

## Files this story will edit

- apps/tournament-web/src/types/scorecard.ts
- apps/tournament-web/src/lib/scorecard-fixtures.ts
- apps/tournament-web/src/components/hole-badge.tsx
- apps/tournament-web/src/components/hole-badge.test.tsx
- apps/tournament-web/src/components/scorecard-grid.tsx
- apps/tournament-web/src/components/scorecard-grid.test.tsx

## Tasks / Subtasks

- [ ] Task 1 — Shared type + fixtures (AC: #5, #6)
  - [ ] `src/types/scorecard.ts`: export a tournament `ScorecardHole` type — the Pete Dye subset of the Wolf type (DROP `stablefordPoints`, `wolfRole`, `wolfDecision`, `wolfPlayerName`, `partnerPlayerName`, `teammateName`). Fields: `holeNumber: number`, `par: number`, `grossScore: number | null`, `netScore: number | null`, `moneyNet: number | null` (null = money not supplied/not-yet-computed; see AC #6), `hasGreenie?: boolean`, `hasPolie?: boolean`, `hasSandie?: boolean`, `relativeStrokes?: number`.
  - [ ] `src/lib/scorecard-fixtures.ts`: export at least one full-18 fixture (the Steven Chatterton showcase card from the spec — a realistic mix of birdies/pars/bogeys with a greenie + a polie + a sandie and a couple of stroke holes) and a partial-front-9 fixture (back-9 unplayed) for the unplayed-cell tests. **These fixtures are AUTHORED in this story — there is no pre-existing fixture file.** Include at least one played hole with `moneyNet: null` and one section whose played holes are all-null, so the "—" money paths (AC #6) are test-reachable. Pure data, no imports beyond the type. The type intentionally diverges from Wolf's non-nullable `moneyNet` (both prior reviewers required nullability); since 3-1 has no API, fixtures exercise the null path.
- [ ] Task 2 — HoleBadge component (AC: #1, #2, #3, #7)
  - [ ] `src/components/hole-badge.tsx`: port `HoleBadge` near-verbatim from the Wolf source. Keep the standard-palette utilities; replace `bg-foreground/50` (stroke dot) with a tournament token (`var(--color-text-muted)`). Props: `{ gross, par, hasGreenie?, hasPolie?, hasSandie?, relativeStrokes? }`.
- [ ] Task 3 — ScorecardGrid component (AC: #4, #5, #6, #7)
  - [ ] `src/components/scorecard-grid.tsx`: port the front-9/back-9 grid from `ScorecardPanel` (L278–518) but as a **pure presentational component** that takes `{ holes: ScorecardHole[]; showMoney?: boolean }` as props instead of fetching. DROP the Stab, Harvey, and Wolf rows and all wolf-decision logic. Keep Hole / Par / Score / Net / $ + Out/In/Tot totals. Replace shadcn semantic classes (`text-muted-foreground`, `bg-muted`, `border-border/30`, `text-destructive`, `text-green-600`, `bg-green-700`) with tournament tokens per the mapping table: money colors → `var(--color-money-pos)` / `var(--color-money-neg)`; muted text → `var(--color-text-muted)`; dividers → `var(--color-border-subtle)`; the green table-header → `var(--color-brand-primary)` with white text (do NOT leave `bg-green-700`, so the header tracks the tournament identity in both themes). Money/par formatting helpers (`formatMoney`, `formatNetToPar` from the Wolf source) are **defined locally** (inline or a small local helper; reuse `src/lib/format-cents.ts` if it fits) — **never imported from `apps/web/**`**.
- [ ] Task 4 — Tests (AC: #8)
  - [ ] `src/components/hole-badge.test.tsx`: assert each notation branch renders the gross number and the expected shape/role markers; assert bonus dots and stroke dots appear/absent per props. Follow the existing `@testing-library/react` + `vitest` convention (see `empty-state.test.tsx`).
  - [ ] `src/components/scorecard-grid.test.tsx`: front-only, front+back+totals, unplayed-cell placeholder + stroke dot, `showMoney` on/off, and a negative assertion that no "Stab"/"Wolf"/"Hvy" row label is present.
- [ ] Task 5 — Verify (AC: #9)
  - [ ] `pnpm --filter @tournament/web test`, `pnpm -r typecheck`, `pnpm -r lint` clean. Confirm no existing route file changed (diff is new files only).

## Dev Notes

### Reference implementation (READ-ONLY — never edit)
- `apps/web/src/routes/index.tsx` is **Wolf Cup** (FD-1/FD-2). Read it for the pattern; do not modify it.
  - `HoleBadge` L145–208 — copy logic; adapt the one shadcn alias (`bg-foreground/50`).
  - `ScorecardPanel` L214–518 — the grid source. 3-1 takes the **rendering** (front/back tables, totals, unplayed handling) and drops the data-fetch (`useQuery`), the Stab/Wolf rows, and `autoCalculateMoney`→ rename to a `showMoney` prop.
  - `ScorecardHole` type L80–97 — tournament subset only (no Stableford/Wolf fields).

### Styling — the porting crux (evidence-cited)
- tournament-web is **Tailwind v4** (`apps/tournament-web/src/index.css` L1 `@import "tailwindcss"`) so standard palette utilities (`bg-red-600`, `border-amber-500`, `bg-emerald-500`, `bg-orange-500`, `bg-green-700`, `text-blue-600`) resolve.
- It does **NOT** define the shadcn semantic tokens. Grep confirmed zero uses of `text-muted-foreground` / `bg-muted` / `text-destructive` in `src/components` + `src/routes`. The token system is CSS custom properties in `index.css` (`--color-text-muted`, `--color-money-pos`, `--color-money-neg`, `--color-border-subtle`, `--color-brand-primary`, …), consumed via inline `style={{ … 'var(--color-…)' }}` (see `card.tsx`, `scrollable-table.tsx`).
- **Deterministic mapping** (Wolf alias → tournament replacement; all cited tokens verified present in `index.css`):

  | Wolf source (undefined in tournament) | Tournament replacement |
  | --- | --- |
  | `text-muted-foreground`, `text-muted-foreground/50` | `style={{ color: 'var(--color-text-muted)' }}` |
  | `bg-muted/30` (row stripe) | `style={{ background: 'var(--color-surface-sunken)' }}` (the sunken surface reads as a subtle stripe on the white card; flips correctly in dark) |
  | `border-border/30`, `border-border` | `style={{ borderColor: 'var(--color-border-subtle)' }}` |
  | `text-destructive` and `text-green-600` (money cells) | `var(--color-money-neg)` / `var(--color-money-pos)` |
  | `bg-foreground/50` (stroke dot) | `style={{ background: 'var(--color-text-muted)' }}` |
  | `bg-green-700` (table header) | `style={{ background: 'var(--color-brand-primary)', color: '#fff' }}` (fairway-green identity; matches the Wolf header look) |

- **KEEP as-is** (real Tailwind palette, resolves under v4): `bg-red-600`, `border-red-600`, `text-red-600`, `border-amber-500`, `text-amber-600`, `bg-emerald-500`, `bg-amber-400`, `bg-orange-500`, `text-blue-600`, `border-blue-600`. These are the badge notation/dot colors — do not tokenize them (no tournament token exists for badge semantics, and tokenizing would diverge from the Wolf visual).
- **Enforcement (verify before commit):** grep the two new component files for the shadcn semantic aliases `muted-foreground`, `bg-muted`, `text-destructive`, `border-border`, `bg-foreground`, `text-foreground` — **zero matches** must remain. Any remaining alias is a silent no-op under Tailwind v4 (renders unstyled) and is a defect.
- Components MUST read correctly in `.dark` (tokens flip automatically; never hardcode a hex except the explicit white badge/header text).

### Scope guardrails
- **Tournament paths only** (`apps/tournament-web/**`). FORBIDDEN: any edit to `apps/web/**`, `apps/api/**`, `packages/engine/**`.
- **No cross-app imports.** The new components MUST NOT `import` anything from `apps/web/**`, `apps/api/**`, or `packages/engine/**` (FD-1/FD-2 — the Wolf source is a READ-only *pattern* reference, not a runtime dependency). The port is hand-copied + token-adapted, never re-exported across the app boundary. Verify the diff contains no `from '../../../web/...'` or `@wolf-cup/*` import.
- **No API, no money math, no route wiring** in 3-1. The `$` row is fixture-driven + `showMoney`-gated; it must never display fabricated `$0` from absent live data (AC #6) — that guard is the contract 3-3 fulfills.
- Pure presentational components (props in, JSX out) — no `useQuery`, no network, no global state.

### Testing standards
- `vitest` + `@testing-library/react` under jsdom (`vitest.config.ts`, `src/test-setup.ts`). Co-locate `*.test.tsx` next to the component (repo convention). Render-and-assert; query by text/role. No snapshot tests (none exist in the suite).
- **Avoid brittle className assertions.** Tailwind utility strings are an implementation detail — do NOT assert on `.toHaveClass('bg-red-600')`. To make notation variants and dot presence deterministically queryable, add stable hooks to `HoleBadge`: a `data-testid="hole-badge"` with `data-variant` ∈ {`eagle`,`birdie`,`par`,`bogey`,`double`}, and `data-greenie`/`data-polie`/`data-sandie`/`data-strokes` attributes. Tests assert on the gross number text + these `data-*` attributes, not on class names. (These attributes are inert in production and harmless.)

### Project Structure Notes
- New files only; aligns with the existing `src/components/*.tsx` + co-located `*.test.tsx`, `src/types/*.ts`, `src/lib/*.ts` layout. No new directories. No conflict with existing primitives (HoleBadge/ScorecardGrid are net-new names).

### References
- [Source: _bmad-output/implementation-artifacts/tournament/scoreboard-rework-spec.md#Reference implementation] — HoleBadge logic, drop/keep list, story split (S1).
- [Source: apps/web/src/routes/index.tsx:145-208] — HoleBadge reference (READ-ONLY).
- [Source: apps/web/src/routes/index.tsx:214-518] — ScorecardPanel grid reference (READ-ONLY).
- [Source: apps/tournament-web/src/index.css:1-130] — Tailwind v4 + token system.
- [Source: apps/tournament-web/src/components/card.tsx] — inline `var(--color-*)` styling convention.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (tournament-director, ultracode build+review fan-out)

### Debug Log References

- Build via ultracode fan-out (`story-3-1-build-fanout`, run `wf_c2cae0d6-8a0`): foundation agent (type + 3 fixtures) → parallel HoleBadge + scorecard-grid agents.
- Review via Codex impl review + re-review (both `gpt-5.2` high) + 4-lens Claude fan-out (`story-3-1-review-fanout`, run `wf_969daa6a-311`). Gemini deliberately skipped this session (user direction — Gemini calls were failing; Codex + Claude substituted).

### Completion Notes List

- All 9 ACs met. HoleBadge + ScorecardGrid ported as standalone, fixture-driven presentational components; Stab/Harvey/Wolf rows dropped; Hole/Par/Score/Net/$ kept. NOT wired into any live route (AC #9 — that's 3-4), so zero behavior change to the running app.
- `moneyNet: number | null`; played+null → `—`, `0` → `0`, empty-sum section total → `—` (never fabricates `$0`). `formatMoney(0)` returns `0` (improved over Wolf's `$0`) so a zero total matches the per-hole rule.
- Styling adapted from Wolf shadcn aliases to tournament `var(--color-*)` tokens (verified zero aliases remain; all tokens exist; dark-mode-correct). Real palette utilities kept on the badge.
- Tests: tournament-web 370 → 404 (+34 new: HoleBadge 23, ScorecardGrid 11), incl. rendered dot-count assertions, Par/Net/In totals, and the money null/zero/empty-sum paths. typecheck + lint clean.
- Reviews: Codex impl 0 High/2 Med/1 Low → Mediums adjudicated faithful-port/defensive-only, Low + net-new coverage gaps fixed → Codex re-review PASS. 4-lens Claude fan-out: 0 High.
- **Followups (deferred, not 3-1 defects):** (1) null-net reducer hardening at the 3-2/3-3 API seam; (2) badge a11y / screen-reader text (future a11y story); (3) duplicate/out-of-range holeNumber validation at the 3-2 API seam. See the party-review for detail.

### File List

- `apps/tournament-web/src/types/scorecard.ts` (new)
- `apps/tournament-web/src/lib/scorecard-fixtures.ts` (new)
- `apps/tournament-web/src/components/hole-badge.tsx` (new)
- `apps/tournament-web/src/components/hole-badge.test.tsx` (new)
- `apps/tournament-web/src/components/scorecard-grid.tsx` (new)
- `apps/tournament-web/src/components/scorecard-grid.test.tsx` (new)
