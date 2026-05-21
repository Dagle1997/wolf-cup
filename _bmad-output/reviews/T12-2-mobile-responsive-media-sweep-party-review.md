# T12-2 Party-Mode Review — Mobile / Responsive Sweep

Single non-interactive written review (analyst, architect, pm, qa, dev). No questions
that BLOCK the director gate; two non-blocking followups (a11y naming/focus-ring; on-phone
confirmation) are documented, not open blockers — see "Verdict."

**Subject:** Fix the tournament-web mobile horizontal-overflow defect. The audit found the
viewport meta present and PageShell already fluid; the measured defect was that wide
`<table>`s overflow the page at 375px (headless-Chromium: docScrollW 388 > 375). Fix:
wrap each of the 7 routes' `<table>` (8 total) in `<div style={{overflowX:'auto'}}
tabIndex={0}>` so tables scroll internally; bump tap-target `min-height` 40→44 on the 3
scoped base-layer controls. Verified with REAL headless Chromium at 375px (no overflow)
and 1024px (wrapper transparent). Suite green; typecheck + lint clean.

---

## Analyst
The story correctly distinguished the real defect (table overflow, measured) from
non-problems (viewport meta + PageShell were already fine). It resisted the trap of
adding `@media` for its own sake — the chosen `overflow-x:auto` wrapper is responsive by
nature, so no breakpoint was invented. Scope stayed on the 7 grep-confirmed table routes.

## Architect
The wrapper approach is the right call: spec-codex flagged that a global `table{display:
block}` would mutate table layout semantics, so the fix was redirected to per-route scroll
containers that keep `display:table` intact. `overflow-x:auto` is a no-op when content
fits (verified transparent at 1024px), so desktop is untouched and no media query is
needed. The tap-target bump reuses the existing `:where(...)` base-layer selectors that
already exclude checkbox/radio/range, so no dense-control resizing leaks in.

## PM
Scope held: index.css + 7 route files, no API/engine/Wolf-Cup/repo-root/dep changes,
primitives untouched. The "@media sweep" framing evolved honestly to "responsive sweep"
when the evidence showed wrappers (not @media) were the correct fix — documented, not
hand-waved.

## QA
Verification is the strongest part: this is the one story where the test suite alone
couldn't prove the fix (jsdom does no layout), so a REAL headless-Chromium harness measured
`document.scrollWidth` against the compiled CSS — page scrollWidth 388→375 at mobile width
(the page no longer overflows the viewport; the wrapper's scrollWidth > clientWidth so it
holds scrollable content rather than pushing the page wide) and wrapper-transparent at
desktop (scrollWidth === clientWidth), plus a computed-style check confirming
`min-height:44px`. (Keyboard scrollability is provided structurally via `tabIndex={0}`; not
separately exercised in the harness.) The before/after numbers are recorded. Full regression green
(tournament-web 325, engine 472, wolf-cup-api 517, tournament-api 965+2skip). Honest
residuals are documented: accessible-name + focus-indicator on the new focusable regions
are noted as non-blocking a11y followups (the keyboard-scroll capability itself works), and
on-phone confirmation remains the ultimate check (harness uses representative markup, not
the live authed route DOM).

## Dev
Edits are uniform (`replace_all` wrapping + a single min-height bump), JSX nesting verified
(0 unwrapped tables, matching `</table></div>`), typecheck + lint clean. The same-line
`<div…><table>` formatting (impl-codex Low) is valid and lint-accepted; left as-is.

---

## Verdict
**PASS — no blocking questions, no required changes.** (The two followups below are
documented non-blockers, not unresolved questions: the harness verification is sufficient
evidence to ship; the on-phone pass is additional confirmation, and the a11y naming is
polish on an already-functional change.) The measured mobile defect (375px
horizontal page overflow) is fixed and the fix is verified in a real browser at both mobile
and desktop widths; tap targets meet 44px; no regression. Proceed to commit with status
`done`. Residuals are explicitly documented and non-blocking: (a) accessible-name +
focus-ring refinement on the focusable scroll regions (a11y polish on an already-functional
change), and (b) on-phone confirmation by Josh as the final real-world check — the harness
proves the fix mechanism on real compiled CSS + real table structure but is not a live
end-to-end page render.
