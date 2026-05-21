# Codex Review

- Generated: 2026-05-21T20:22:31.750Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md

## Summary

The spec is grounded in an observed, measurable defect (375px horizontal overflow) and proposes a low-footprint fix (global CSS) with a layout-capable verification method (headless Chromium). The main risk is that the chosen global pattern (`table { display:block; overflow-x:auto; white-space:nowrap }` under a breakpoint) can subtly change table layout/rendering and may not cover other common overflow sources (long unbroken strings, pre/code, wide flex/grid children). The verification approach is directionally sound but, as written, can be gamed by representative markup that doesn’t reflect the worst real route DOM/data; it’s disclosed, but the AC wording should make the limitation explicit and/or broaden the sweep to the actual routes or a larger corpus of cases. The tap-target bump is likely safe but needs selector care (avoid checkbox/radio/etc. inputs) and a quick UI regression check on dense layouts.

Overall risk: medium

## Findings

1. [high] Global `display:block` on `<table>` can change table layout behavior and cause regressions (alignment/borders/captions/sticky headers)
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:24-26
   - Confidence: medium
   - Why it matters: The spec’s core fix is to make the `<table>` itself a scroll container via `display:block; overflow-x:auto` (and implied `white-space:nowrap`) under a max-width query (lines 24–26, 62–63). While this is a common pattern, changing a table’s display type can alter how browsers apply the table layout algorithm, border-collapsing behavior, caption placement, and header/body alignment in edge cases. If any of the 7 routes rely on table-specific rendering (e.g., `border-collapse`, `colgroup`, sticky headers, caption styling), the change can create subtle visual regressions that won’t be detected by a pure `scrollWidth` assertion.
   - Suggested fix: Prefer a wrapper scroll container when possible (e.g., `div.table-scroll { overflow-x:auto }` with the table left as `display:table`). If markup changes are truly off-limits, mitigate by testing the actual affected tables visually and consider a less invasive rule first: `table { max-width:100%; }` + apply overflow to an ancestor known to wrap tables (if one exists). If sticking with `display:block`, explicitly validate border/cell alignment on representative tables and consider adding `border-collapse` expectations and a screenshot check in the harness.

2. [medium] Global `white-space: nowrap` (inherited) may harm readability/accessibility and create excessive internal scrolling
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:76-78
   - Confidence: high
   - Why it matters: The spec explicitly calls out the tradeoff of `white-space: nowrap` (lines 76–78). Applied at the table level, `white-space` is inherited into cells, forcing all cell content (including long team/course names or explanatory text) onto a single line. This can make content harder to read on mobile, increase required horizontal scrolling, and may be worse for some tables (e.g., settle-up explanations) where wrapping is desirable.
   - Suggested fix: Consider omitting `white-space:nowrap` from the global rule (keep only the scroll container behavior). If you want to protect specific numeric matrix tables, scope nowrap to those tables via a class or a narrow selector, or apply it only to selected columns/cells. Pair with `overflow-wrap:anywhere`/`word-break:break-word` for non-table text overflow cases instead of forcing nowrap everywhere.

3. [medium] Verification harness (representative markup + compiled CSS) is not equivalent to “7 routes fixed” and AC wording could overclaim
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:17-18
   - Confidence: high
   - Why it matters: The spec measures overflow using “compiled CSS + representative wide-table markup” (lines 17–18, 27–29, 38–42) and discloses it is not a live authenticated route render (lines 78–79). That’s honest as a limitation, but the story framing (“7 routes render `<table>`… This is THE mobile defect to fix”) risks readers assuming all real routes are verified. Real routes can differ (additional wrappers, `display:flex` parents, long unbroken strings, conditional columns, sticky headers), so representative DOM may pass while a real route still overflows.
   - Suggested fix: Make AC-1 explicitly about either (a) the actual affected routes (preferred: iterate through the real routes in Playwright and assert `scrollWidth <= innerWidth`), or (b) a broader set of representative fixtures that cover worst-case data (long names, maximum columns/players, any special table styles). At minimum, reword acceptance evidence to state “representative fixtures” and list what is covered vs not covered.

4. [medium] `scrollWidth` assertion alone can be flaky/insufficient without tolerances and body/documentElement cross-check
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:38-46
   - Confidence: medium
   - Why it matters: AC-1/AC-2 rely on `document.documentElement.scrollWidth <= window.innerWidth` (lines 38–46). In practice, headless Chromium can show off-by-1 behavior due to rounding, fractional device scale factors, or scrollbar presence. Also, some layouts report overflow on `document.body.scrollWidth` rather than `documentElement` depending on CSS. A strict single-metric assertion can produce false failures or false confidence.
   - Suggested fix: In the harness, compute `const scrollW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth); const vw = window.innerWidth;` and allow a small tolerance (e.g., `scrollW <= vw + 1`). Consider also checking `document.documentElement.clientWidth` and/or asserting `!hasHorizontalScrollbar` by comparing `scrollW` to `clientWidth`.

5. [medium] Tap-target bump (40→44) needs selector safety to avoid unintentionally resizing checkbox/radio/range and dense UI
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:15-16
   - Confidence: medium
   - Why it matters: The spec states a global base-layer rule sets form controls to `min-height: 40px` and will be bumped to 44px (lines 15–16, 48–52, 62–63). If the selector is broad (e.g., `input`), it can unintentionally affect checkboxes/radios/range/file inputs and any compact toolbars, potentially causing layout shifts (especially in tight rows) and changing table row heights if inputs appear in cells.
   - Suggested fix: Ensure the min-height rule targets only controls that should be large (e.g., `button`, `select`, `textarea`, `input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])`, etc.). Add a quick spot-check list of known dense layouts (headers/toolbars/forms/tables) to confirm no unintended vertical expansion.

6. [low] Path allowlist vs verification tooling: spec implies a harness but also says “No new files” — clarify how verification is repeatable
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:27-29
   - Confidence: high
   - Why it matters: Verification is described as a Playwright/Chromium harness (lines 27–29, 74–75), but the story also emphasizes minimal file edits and “No new files, no new deps” (line 69) and an allowlist limited to `index.css` and sprint-status (lines 80–84). If the harness is not committed, verification may be non-repeatable for reviewers/CI; if it is committed, it may violate the stated file footprint unless explicitly allowlisted.
   - Suggested fix: Explicitly state whether the harness is (a) entirely out-of-repo (commands only) and how to reproduce, or (b) committed under an allowed path (and then add that file to the allowlist). If you want ongoing protection, consider adding a CI-safe Playwright test in `apps/tournament-web/**` and declare it in “Files this story will edit.”

7. [low] Adding a global `overflow-x:hidden` “guard” is risky because it can mask real overflow/content loss
   - File: _bmad-output/implementation-artifacts/tournament/T12-2-mobile-responsive-media-sweep.md:62-63
   - Confidence: high
   - Why it matters: The tasks mention adding a defensive body/root horizontal overflow guard only if a non-table overflow source is found (lines 62–63). Global `overflow-x:hidden` can hide content (including focus outlines, menus, toasts) and make some horizontal-scroll affordances inaccessible, while also making the `scrollWidth` test trivially pass by masking the symptom rather than fixing the cause.
   - Suggested fix: Avoid global `overflow-x:hidden` unless you can identify the specific offender and fix it at the source. If you must use it, scope it tightly (route/container) and add explicit regression checks (e.g., focus ring visibility, off-canvas UI).

## Strengths

- Diagnosis is based on an actual measured layout metric at 375px (scrollWidth 388 > 375) rather than assumptions (lines 17–18).
- Proposed fix is intentionally minimal and centralized (global CSS) to reduce per-route risk and churn (lines 24–26, 62–63).
- Acceptance criteria are concrete and mechanistically verifiable with a real browser engine (headless Chromium), acknowledging jsdom limitations (lines 27–29).
- Limitations of the harness fidelity (representative markup vs live authed routes) are explicitly disclosed (lines 78–79).
- Clear file footprint constraints and an explicit allowlist reduce scope creep risk (lines 21–23, 80–84).

## Warnings

None.
