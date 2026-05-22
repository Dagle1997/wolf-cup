# T12-3: Scroll-Region Accessibility (accessible-name + focus-ring)

## Status

ready-for-dev

## Story

As a keyboard-only or screen-reader user of tournament-web, I want the horizontal-scroll table containers (added in T12-2) to announce themselves and show a visible focus ring when I tab to them, so the scrollable data tables are operable and discoverable without a mouse — closing the two non-blocking a11y followups explicitly recorded in T12-2's Dev Agent Record (commit `d6ca3f2`).

## Audit (grounded, observed — not assumed)

- **8 scroll-region wrappers across 7 routes**, all identical shape `<div style={{ overflowX: 'auto' }} tabIndex={0}><table>…`. Grep-confirmed (`overflowX` search, 2026-05-22):
  - `admin.groups.$groupId.edit.tsx:333`
  - `events.$eventId.courses.$courseId.tsx:194`
  - `admin.events.new.tsx:382`
  - `admin.courses.new.tsx:489` (Tees) and `:547` (Holes) — two wrappers
  - `admin.events.$eventId.pairings.tsx:534`
  - `events.$eventId.money.tsx:125`
  - `events.$eventId.leaderboard.tsx:215`
- **Gap 1 — no accessible name.** `tabIndex={0}` makes each div a keyboard tab-stop, but with no `role`/`aria-label` a screen reader announces nothing meaningful on focus (an unnamed focusable container). This is the exact item T12-2 deferred (T12-2 story line 110, item 1).
- **Gap 2 — no explicit focus ring.** `apps/tournament-web/src/index.css` defines a `:focus-visible` outline rule for text inputs (`outline: 2px solid #1d4ed8; outline-offset: 1px`, ~line 80) but **nothing** for these focusable divs. The keyboard-focus indicator is therefore the browser default (subtle / inconsistent). T12-2 line 110 item 2 flagged confirming this; this story makes it explicit and consistent with the input rule.
- **Existing primitive family** to match: `BackLink`, `PageShell`, `LoadingCard`, `EmptyState`, `ErrorCard` under `apps/tournament-web/src/components/**` — doc-comment header citing the story, typed props, inline `var(--token)` styling, `exactOptionalPropertyTypes`-aware. `back-link.tsx` is the closest reference.

## Risk Acceptance

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN
New primitive + its test under `apps/tournament-web/src/components/**`, one global CSS rule in `apps/tournament-web/src/index.css`, 7 route edits under `apps/tournament-web/src/routes/**`, and the tournament `sprint-status.yaml`. No API/engine/Wolf-Cup/repo-root/dependency changes. No new deps.

### 2. Correct-over-expedient: a shared `ScrollableTable` primitive, not 8 hand-edited divs
Rather than repeat `role`/`aria-label`/`tabIndex`/`className`/style across 7 files (the copy-paste pattern T11/T12 has been collapsing), extract a `ScrollableTable` primitive that encapsulates `overflowX:auto` + `tabIndex={0}` + `role="region"` + an `aria-label` (required prop) + a `scroll-region` className. Each call site supplies a meaningful `label`. This is the same primitive-extraction discipline as the rest of the T11/T12 sweep and is unit-testable.

### 3. The focus ring is one CSS rule mirroring the proven input rule (exact width/color/offset)
Add `.scroll-region:focus-visible { outline: 2px solid var(--color-brand-primary); outline-offset: 1px; }` to `index.css`. This matches the existing input `:focus-visible` rule (line ~80: `outline: 2px solid #1d4ed8; outline-offset: 1px`) in width (2px), color, and offset (1px) — a true mirror. The ONE intentional difference: the color is sourced via the `--color-brand-primary` token, which is defined in `index.css` line 34 as `#1d4ed8` (value-identical to the literal the input rule uses), so the assumption that the token exists is verifiable, not speculative. The outline is drawn outside the element's border box (positive `outline-offset`), so the element's OWN `overflow-x:auto` does NOT clip it (overflow clips children, not the element's outline). `:focus-visible` (not `:focus`) means the ring only shows for keyboard focus, not mouse/touch — matching the input rule's behavior and avoiding a ring on touch-scroll.

### 4. role="region" tradeoff (decided)
`role="region"` + `aria-label` is the WAI-ARIA APG pattern for a keyboard-scrollable region and is what T12-2 line 110 named. It does create a landmark per table; for data tables this is acceptable and is the documented pattern. `role="group"` (non-landmark) was considered as a lower-noise alternative but rejected to match the explicitly-deferred T12-2 wording and the APG scrollable-region figure. Recorded as a reversible decision.

### 5. What is NOT in this story
- No change to table layout, table styling, or the `overflow-x:auto` mechanism itself (T12-2 already proved that stops page overflow at 375px).
- No new breakpoints / `@media` / theming.
- No migration of other inline styles to classes (separate concern).
- **On-phone confirmation by Josh is OUT OF SCOPE** — it is operational manual-verify (tabbing through on a real device / VoiceOver), not code. Recorded as a manual followup, not implemented.

## Acceptance Criteria

**AC-1: A `ScrollableTable` primitive exists with the correct a11y semantics.**
**Given** `apps/tournament-web/src/components/scrollable-table.tsx`
**Then** it renders a single wrapper `<div>` with `role="region"`, `aria-label={label}` (label is a required string prop), `tabIndex={0}`, `className="scroll-region"`, and `style={{ overflowX: 'auto' }}`, wrapping `children`.
**And** unit tests (jsdom + testing-library) assert: children render; the wrapper has `role="region"`; the accessible name equals the passed `label` (queryable via `getByRole('region', { name })`); it is focusable (`tabIndex` 0); it carries the `scroll-region` class.

**AC-2: All 8 scroll-region call sites use the primitive with a meaningful label — zero bare wrappers remain.**
**Given** the 7 routes listed in the Audit
**Then** each `<div style={{ overflowX: 'auto' }} tabIndex={0}>` is replaced by `<ScrollableTable label="…">`, with these labels: Group members; Course scorecard; Event rounds; Course tees; Course holes; Pairings; Money matrix; Leaderboard.
**And** the primitive owns the overflow style: a grep for the literal `overflowX` in `apps/tournament-web/src/routes/**` returns **zero** matches (any nonzero count is a fail — every route-level scroll wrapper now goes through `ScrollableTable`, which holds the `overflowX:auto` style internally). This is robust to whitespace variants because it greps the property name, not a formatted style-object literal.
**And** any table-level inline styles that were on the `<table>` (e.g. `width:100%; borderCollapse:collapse`) are preserved on the `<table>`, not moved.

**AC-3: A keyboard focus ring is defined for the scroll region.**
**Given** `apps/tournament-web/src/index.css`
**Then** a `.scroll-region:focus-visible` rule exists with `outline: 2px solid var(--color-brand-primary)` and `outline-offset: 1px` — identical width (2px), color (`--color-brand-primary` = `#1d4ed8`, index.css:34), and offset (1px) to the existing input `:focus-visible` rule (index.css ~line 80). The only intentional difference is sourcing the color via the token rather than the `#1d4ed8` literal; there is no value divergence.

**AC-4: No layout/visual regression to the tables on desktop or mobile.**
**Given** the migrated routes
**Then** the rendered DOM is structurally equivalent to T12-2's wrappers plus the new attributes (role/aria-label/class) — which do not affect layout — so the 375px overflow fix and desktop rendering from T12-2 are preserved (the wrapper still scrolls internally; the page still does not overflow). No `@media` added.

**AC-5: No regression.**
**Given** the full suite
**When** run
**Then** tournament-web tests (baseline + the new primitive tests), `pnpm -r typecheck`, `pnpm -r lint` all pass; engine / wolf-cup-api / tournament-api unchanged.

**AC-6: Sprint-status flip lands atomically with the commit** (`T12-3…` → `done`), and `epic-T12` is flipped back to `done` in the same commit (T12-3 is the last open T12 story).

## Tasks / Subtasks
1. Baseline capture (test counts for tournament-web / engine / wolf-cup-api / tournament-api).
2. Create `apps/tournament-web/src/components/scrollable-table.tsx` (doc-comment header citing T12-3; typed `{ label: string; children: ReactNode }`; renders the role=region / aria-label / tabIndex=0 / scroll-region / overflowX:auto div). Add `scrollable-table.test.tsx` (AC-1).
3. Add `.scroll-region:focus-visible` rule to `index.css` (AC-3).
4. Migrate all 8 call sites across the 7 routes to `<ScrollableTable label="…">`, preserving any `<table>`-level inline styles (AC-2). Import the primitive in each route.
5. Run tournament-web test + `pnpm -r typecheck` + `pnpm -r lint` + engine/wolf-cup-api/tournament-api (AC-5). Grep-confirm zero bare wrappers remain (AC-2).

## Dev Notes

### Architectural alignment
`ScrollableTable` joins the T11-1 primitive family (`components/**`). It is presentational and framework-agnostic; composes with Tailwind v4. The focus ring is a single global rule keyed on the `scroll-region` class (CSS `:focus-visible` cannot be expressed inline, which is exactly why the class + index.css rule is the right vehicle — mirrors how the input focus rule already lives in the base layer). No new deps in shipped code.

### Proposed primitive (reference shape — dev may refine)
```tsx
import type { ReactNode } from 'react';

export type ScrollableTableProps = {
  /** Accessible name announced when the scroll region receives focus. */
  label: string;
  children: ReactNode;
};

export function ScrollableTable({ label, children }: ScrollableTableProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="scroll-region"
      style={{ overflowX: 'auto' }}
    >
      {children}
    </div>
  );
}
```

### Key references
- `apps/tournament-web/src/components/back-link.tsx` — closest primitive idiom (doc header, typed props, token styling).
- `apps/tournament-web/src/index.css` line ~80 — the input `:focus-visible` rule the new `.scroll-region` rule mirrors.
- T12-2 story (`T12-2-mobile-responsive-media-sweep.md`) lines 109–110 — the two deferred followups this story closes.

### Risks / Followups
- **role="region" landmark noise** (decided in Risk Acceptance §4): 8 region landmarks added; acceptable for data tables and matches the deferred wording. Reversible to `role="group"` if a future a11y pass prefers fewer landmarks.
- **On-phone / screen-reader confirmation by Josh** remains the ultimate check (VoiceOver/TalkBack announcing the region name + visible ring on a real device). Operational, not code — not implemented here.
- Verification is unit-test-based (jsdom CAN assert role/name/tabindex/class via testing-library) plus the CSS rule mirroring the already-proven input rule. A headless-Chromium focus-ring screenshot is optional and not required for acceptance.

## Files this story will edit
- apps/tournament-web/src/components/scrollable-table.tsx
- apps/tournament-web/src/components/scrollable-table.test.tsx
- apps/tournament-web/src/index.css
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx
- apps/tournament-web/src/routes/admin.events.new.tsx
- apps/tournament-web/src/routes/admin.courses.new.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx
- apps/tournament-web/src/routes/events.$eventId.money.tsx
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

(All paths are under `apps/tournament-web/**` or the tournament implementation-artifacts folder — ALLOWED. Zero SHARED, zero FORBIDDEN. The two `components/` files are new; the rest are edits.)

## Dev Agent Record
### Agent Model Used
claude-opus-4-7[1m] (acting as tournament-director).
### Debug Log References
- Regression (deltas vs start-of-story baseline): tournament-web 325→**329** (+4 new ScrollableTable tests); engine **472** (unchanged); wolf-cup-api **517** (unchanged); tournament-api **965 ✓ +2 skip** (unchanged). `pnpm -r typecheck` + `pnpm -r lint` clean.
- tournament-api first run reported 1 transient failure that did NOT reproduce on two subsequent runs (965 green) — the known T10-3 finalize-before-handoff flake; a tournament-web-only diff cannot reach tournament-api. Not a regression.
- AC-2 verification: `grep overflowX apps/tournament-web/src/routes/** = 0 matches`; 8 `<ScrollableTable label="…">` usages across the 7 routes.
- Codex: spec 0 High / 1 Med / 2 Low (all addressed in spec before gate); impl **PASS, 0 findings**; party-codex 0 High / 1 Med / 2 Low (all prose-quality nits on the review doc itself — corrected in the review artifact, no code impact).
### Completion Notes List
- Fix = a shared `ScrollableTable` primitive (`role="region"` + required `aria-label` via `label` prop + `tabIndex={0}` + `className="scroll-region"` + `overflowX:auto`) replacing the 8 bare T12-2 wrappers, plus a `.scroll-region:focus-visible` rule in `index.css` whose width/color/offset are identical to the existing input focus rule (color sourced via `--color-brand-primary` token = `#1d4ed8`).
- Labels per site: Group members / Course scorecard / Event rounds / Course tees / Course holes / Pairings / Money matrix / Leaderboard.
- Table-level inline styles preserved on the `<table>` (course scorecard kept `width:100%; borderCollapse:collapse`); only the wrapper `<div>` was replaced. No layout change (added attributes don't affect layout); no `@media` added; T12-2 overflow fix intact.
- **role="region" tradeoff:** 8 named region landmarks added — decided + reversible to `role="group"` in the one primitive file if a future a11y pass prefers fewer landmarks.
- **Out of scope (manual followup, NOT implemented):** on-phone / VoiceOver-TalkBack confirmation that the region name is announced and the focus ring is visible on a real device. The `aria-label` is the code-level contract (unit-test asserted); the exact SR announcement is AT-dependent and is what device confirmation verifies.
### File List
- apps/tournament-web/src/components/scrollable-table.tsx (NEW — primitive)
- apps/tournament-web/src/components/scrollable-table.test.tsx (NEW — 4 unit tests)
- apps/tournament-web/src/index.css (added `.scroll-region:focus-visible` rule)
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx (label "Leaderboard")
- apps/tournament-web/src/routes/events.$eventId.money.tsx (label "Money matrix")
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx (label "Pairings")
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx (label "Course scorecard"; table style preserved)
- apps/tournament-web/src/routes/admin.events.new.tsx (label "Event rounds")
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx (label "Group members")
- apps/tournament-web/src/routes/admin.courses.new.tsx (2 tables: "Course tees", "Course holes")
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml (T12-3 → done + epic-T12 → done at step 10)
- _bmad-output/reviews/T12-3-scroll-region-accessibility-{spec,impl,party}-codex.md + -party-review.md (review artifacts)
