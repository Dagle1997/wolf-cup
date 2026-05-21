# T12-2: Mobile / Responsive @media Sweep

## Status

ready-for-dev

## Story

As a player or organizer using tournament-web on a phone at the course (it is a phone-first PWA), I want pages to not scroll horizontally and tap targets to be comfortable, so the app is usable on a 375px-wide screen — closing the "zero `@media` queries" gap the T11-1 audit named but never cut as a story.

## Audit (grounded, observed — not assumed)

- **viewport meta IS present** (`index.html`: `width=device-width, initial-scale=1.0`) — the catastrophic mobile bug is absent.
- **PageShell is already fluid** (`max-width: var(--page-max-width)` + `margin-inline: auto` + `padding: var(--page-padding)`) — narrow screens get the full width minus 16px padding. Good baseline.
- **Form controls already have `min-height: 40px`** + 16px font (no iOS focus-zoom bug) via the `index.css` base layer.
- **Zero `@media` queries** anywhere in tournament-web (confirmed by grep).
- **7 routes render `<table>`** (money matrix NxN, leaderboard 7-col, settle-up, course preview, etc.). **Measured with headless Chromium at 375px against the compiled CSS:** a 6-player money matrix + 7-col leaderboard inside PageShell produces `document.scrollWidth = 388 > viewport 375` → **the page scrolls horizontally**. With more players / longer names the overflow grows. This is THE mobile defect to fix.

## Risk Acceptance

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN
Primary edit is `apps/tournament-web/src/index.css` (global responsive layer). If a specific non-table element is found to overflow and can't be fixed globally, the minimal per-route fix stays under `apps/tournament-web/src/routes/**` (ALLOWED) and is appended to the File List. No API/engine/Wolf-Cup/repo-root/dependency changes. Primitives in `components/**` untouched.

### 2. The fix wraps each table in a scroll container (NOT global `display:block`)
Codex spec-review (High) correctly flagged that a global `table { display:block }` changes table layout semantics (borders/alignment/captions). The lower-risk, idiomatic fix is to **wrap each `<table>` (the 7 routes that render one) in a container `<div style={{ overflowX: 'auto' }}>`** so the table scrolls INSIDE the container instead of pushing the page wide. The `<table>` keeps `display:table` (no semantic change), and cells keep natural wrapping (NO `white-space: nowrap` — dropped per codex Med). Because `overflow-x: auto` scrolls only when content exceeds the container, this is responsive BY NATURE and needs no `@media` for tables — it is a no-op on desktop (table fits, no scroll) and scrolls on phones. (The story is a "responsive sweep"; we add `@media` only where a width-conditional rule is genuinely required — for the table fix, none is.) The tap-target bump (AC-3) is an unconditional base-layer change. The risky blanket `overflow-x: hidden` body guard considered earlier is REJECTED (codex Low — it masks real overflow/content loss); the table wrappers address the actual overflow source instead.

### 3. Verification is REAL (headless Chromium at 375px), not jsdom
jsdom does no layout, so unit tests cannot prove overflow is gone. Verification uses headless Chromium (Playwright) loading the app's COMPILED CSS + representative wide-table markup at a 375px viewport, asserting `document.scrollWidth <= viewport` AFTER the fix (vs the measured 388 BEFORE). The before/after measurement is the acceptance evidence, recorded in the Dev Agent Record. This is a verification harness, not shipped code.

### 4. What is NOT in this story
- No redesign / no component restructuring / no new breakpoint system beyond the minimal rules needed.
- No migration of inline styles to classes (separate concern).
- No dark mode, no theming.
- No changes to the primitives or to T12-1's state cards (already mobile-fine — centered cards).

## Acceptance Criteria

**AC-1: Every `<table>`-rendering route wraps its table in an overflow-x:auto container, AND the mechanism is proven to stop page overflow at 375px.**
**Given** the 7 routes that render `<table>`
**Then** each `<table>`'s page-level rendering is wrapped in a scroll container (`overflow-x: auto`) — grep-verifiable that no bare page-level `<table>` remains unwrapped in those routes.
**And** in headless Chromium at 375px, a representative wide table (≥6-player money matrix AND 7-col leaderboard) rendered inside PageShell + the wrapper + the app's COMPILED CSS yields `document.documentElement.scrollWidth <= window.innerWidth` AND `document.body.scrollWidth <= window.innerWidth` (the BEFORE measurement, unwrapped, was 388 > 375). The wrapper itself scrolls internally (intended).
**Honest limitation (recorded):** the harness uses representative markup, not the live authed route DOM, so it proves the FIX MECHANISM on real compiled CSS + real table structure; per-route application is proven by the grep that every table site is wrapped. On-phone confirmation by Josh remains the ultimate check.

**AC-2: Desktop layout is unchanged (wrapper transparent).**
**Given** the same wrapped content at a desktop viewport (≥1024px)
**When** rendered in headless Chromium
**Then** the wrapper engages no internal scroll — concretely: the wrapper div's `scrollWidth === clientWidth` (content fits, no scrollbar), and the page does not overflow (`documentElement.scrollWidth <= innerWidth`). The table renders at its natural full width exactly as before the change.

**AC-3: Tap targets meet the 44px guideline — without touching checkbox/radio/range.**
**Given** the existing base-layer rules for text-inputs / `select` / `button` (which ALREADY exclude checkbox/radio/range/button-type inputs via `:not(...)`)
**When** the change lands
**Then** ONLY those already-scoped controls get `min-height` bumped 40→44px; checkbox/radio/range and dense non-form controls are NOT resized (verified by confirming the bump edits only the existing scoped selectors). Computed-style check in the harness confirms a `<button>` and a text `<input>` report `min-height: 44px`.

**AC-4: No regression.**
**Given** the full suite
**When** run
**Then** tournament-web tests, typecheck, lint all pass at baseline; engine/wolf-cup-api/tournament-api unchanged.

**AC-5: Sprint-status flip lands atomically with the commit** (`T12-2…` → `done`).

## Tasks / Subtasks
1. Baseline capture (test counts) + the BEFORE 375px overflow measurement (done: 388px unwrapped).
2. Wrap each of the 7 routes' page-level `<table>` in `<div style={{ overflowX: 'auto' }}>` (no table `display`/`white-space` change). Bump the EXISTING scoped base-layer rules (text-input / select / button — already excluding checkbox/radio/range) `min-height` 40→44px in `index.css` (AC-3).
3. Rebuild compiled CSS; re-run the headless-Chromium harness with the wrapper at 375px (AC-1: doc + body scrollWidth ≤ 375) and 1024px (AC-2: wrapper transparent). Computed-style check button/input min-height = 44 (AC-3). Record before/after numbers.
4. Run tournament-web test + `pnpm -r typecheck` + `pnpm -r lint` + engine/wolf-cup-api/tournament-api (AC-4). Grep-confirm every table site is wrapped (AC-1).

## Dev Notes

### Architectural alignment
Per-route table wrappers (`<div style={{ overflowX: 'auto' }}>` around each `<table>`) plus a tap-target bump in the `index.css` base layer. The wrapper pattern keeps the table's native `display:table` semantics (no borders/alignment/caption regressions) and is responsive by nature — `overflow-x: auto` scrolls only when the table exceeds the container, so it is a no-op on desktop. Framework-agnostic; composes with Tailwind v4. No new files, no new deps in shipped code.

### Key references
- `apps/tournament-web/src/index.css` (tokens + base layer — where the rule lands).
- `apps/tournament-web/src/components/page-shell.tsx` (fluid wrapper — already mobile-safe).
- Verification harness: headless Chromium (installed in an isolated temp dir per the documented local-verify recipe), `document.scrollWidth` vs viewport at 375px.

### Risks / Followups
- **Wrapper downsides (acknowledged):** (a) focus outline on a cell/control near the wrapper edge can be clipped by `overflow-x:auto` — acceptable for table cells (mostly static text; interactive controls in these tables are rare); (b) if a wrapper were ever placed as a flex item, it would need `min-width: 0` to actually scroll rather than expand — N/A here since wrappers are block-level children of PageShell; (c) iOS momentum scrolling is the browser default and fine. None block the fix.
- **Harness fidelity:** representative markup, not the live authed route. It exercises the REAL compiled CSS on REAL table structure, which is what determines overflow — but is not a full end-to-end page render. Live on-phone confirmation by Josh remains the ultimate check.

## Files this story will edit
- apps/tournament-web/src/index.css  (tap-target min-height 40→44 on the existing scoped selectors)
- apps/tournament-web/src/routes/admin.courses.new.tsx  (wrap `<table>` in overflow-x:auto)
- apps/tournament-web/src/routes/admin.events.new.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- apps/tournament-web/src/routes/events.$eventId.money.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

(The 7 route files are the grep-confirmed `<table>` renderers. If a non-table overflow source is found, the minimal fix stays under `apps/tournament-web/**` and is appended here before commit. No file outside `apps/tournament-web/**` + tournament sprint-status is edited; `components/**` primitives untouched.)

**Verification tooling is NOT committed:** the headless-Chromium harness lives in an isolated temp dir outside the repo (like the T10-3 diagnosis probe). "No new files" / "no new deps" refers to SHIPPED code — the temp-dir Playwright install and harness script are throwaway.

## Dev Agent Record
### Agent Model Used
claude-opus-4-7[1m] (acting as tournament-director).
### Debug Log References
- BEFORE (unwrapped, headless Chromium @375px against compiled CSS, 6-player money matrix + 7-col leaderboard in PageShell): `document.scrollWidth = 388 > viewport 375` → page overflows by 13px.
- AFTER (each `<table>` wrapped in `<div style={{overflowX:'auto'}} tabIndex={0}>`, recompiled CSS):
  - @375px: docScrollW = bodyScrollW = **375 = viewport → NO page overflow**; money-matrix wrapper scrollW 372 > clientW 343 (scrolls internally, intended); button + input computed `min-height: 44px`.
  - @1024px: wrapper transparent (scrollW === clientW === 928); no page overflow; min-height 44px.
- Wrapping grep: every page-level `<table>` in the 7 routes is preceded by the wrapper (0 unwrapped); 8 wrappers total (admin.courses.new has 2).
- Regression: tournament-web 325 ✓, engine 472 ✓, wolf-cup-api 517 ✓, tournament-api 965 ✓+2 skip; `pnpm -r typecheck` + `pnpm -r lint` clean.
- Codex: spec FIXED 7 (2 rounds; High global-`display:block` → switched to per-route wrappers). Impl FIXED keyboard-scroll a11y (added `tabIndex={0}` to all wrappers).
### Completion Notes List
- Fix = per-route table scroll wrappers (no global `table{display:block}`, no `white-space:nowrap` — both rejected by spec codex) + tap-target `min-height` 40→44 on the 3 already-scoped base-layer selectors (checkbox/radio/range/textarea untouched). No `@media` was needed — `overflow-x:auto` is responsive by nature (no-op on desktop). Verified with REAL headless Chromium at 375px and 1024px, not jsdom.
- Wrappers are `tabIndex={0}` so keyboard-only users can focus + arrow-scroll them (impl-codex Medium).
- **Documented followups (non-blocking a11y polish, per findings-gating):** (1) the focusable scroll regions lack an accessible name (`role="region"` + per-table `aria-label`) — a future a11y refinement; the keyboard-scroll capability itself works. (2) confirm a visible focus indicator on the new tab stops (browser default ring should apply; Tailwind preflight does not strip it). Neither blocks the overflow fix.
- On-phone confirmation by Josh remains the ultimate check (harness uses representative markup + real compiled CSS, not the live authed route DOM).
### File List
- apps/tournament-web/src/index.css (min-height 40→44 on input/select/button base-layer rules)
- apps/tournament-web/src/routes/events.$eventId.money.tsx (table wrapper)
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx (table wrapper)
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx (table wrapper)
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx (table wrapper)
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx (table wrapper)
- apps/tournament-web/src/routes/admin.events.new.tsx (table wrapper)
- apps/tournament-web/src/routes/admin.courses.new.tsx (2 table wrappers)
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml (status flip → done at step 10)
- _bmad-output/reviews/T12-2-*-{spec,impl}-codex*.md + -party-review.md (review artifacts)
