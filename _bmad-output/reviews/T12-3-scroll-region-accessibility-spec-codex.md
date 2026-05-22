# Codex Review

- Generated: 2026-05-22T19:38:18.219Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T12-3-scroll-region-accessibility.md

## Summary

Spec is largely well-scoped and stays within the tournament-web allowlist. The core a11y plan (focusable scroll container + explicit accessible name + visible focus indicator) matches the stated gaps from T12-2 and is testable. Main issues are (1) an internal contradiction/assumption around the CSS “mirrors input rule” requirement (offset and token), and (2) mild a11y/UX risk around adding 8 new named `region` landmarks (acceptable but worth explicitly acknowledging in ACs or making reversible in the primitive).

Overall risk: medium

## Findings

1. [medium] AC-3 says the focus ring rule should “mirror” the existing input rule, but the spec proposes different values and assumes a CSS variable exists
   - File: _bmad-output/implementation-artifacts/tournament/T12-3-scroll-region-accessibility.md:22-61
   - Confidence: high
   - Why it matters: The story cites the existing input focus-visible rule as `outline: 2px solid #1d4ed8; outline-offset: 1px` (line 22), but later proposes `.scroll-region:focus-visible { outline: 2px solid var(--color-brand-primary); outline-offset: 2px; }` (lines 33–34). That’s not a true mirror (offset differs), and it assumes `--color-brand-primary` is defined and equals `#1d4ed8` (line 34) without evidence in this spec. If the variable is missing/mismatched, the scroll-region may end up with no visible outline (or wrong color), directly failing the goal/AC-3.
   - Suggested fix: In AC-3, pin the rule to exactly match the existing input rule values (including `outline-offset`), or explicitly require reusing the same token/source as the input rule (e.g., if the input uses a literal hex, use the same literal; if it uses a variable, confirm that variable is defined in `index.css`/tokens and reference it). Consider adding a tiny CSS assertion to the PR checklist (manual/visual) since unit tests won’t validate computed CSS in jsdom reliably.

2. [low] `role="region"` is valid but will add 8 new named landmarks; spec should guard against landmark noise or provide a reversible escape hatch
   - File: _bmad-output/implementation-artifacts/tournament/T12-3-scroll-region-accessibility.md:36-38
   - Confidence: medium
   - Why it matters: With `role="region"` + accessible name, each wrapper becomes a landmark. Eight additional landmarks across key routes can increase noise for screen-reader landmark navigation, especially on pages that already have multiple landmarks. This isn’t “wrong,” but it’s a meaningful UX tradeoff that could prompt a follow-up change (e.g., switching to `role="group"` or using native semantics).
   - Suggested fix: Either (a) explicitly accept this in ACs (not just in “Risk Acceptance”) so reviewers don’t block later, or (b) make the primitive flexible: allow a prop to choose `role="region"` vs `role="group"` (defaulting to region to satisfy T12-2 wording), or support `aria-labelledby` so the accessible name can be tied to an on-screen heading (often preferred over `aria-label`).

3. [low] AC-2 “grep confirms zero remaining bare wrappers” is brittle as written and may miss small variations or create false positives
   - File: _bmad-output/implementation-artifacts/tournament/T12-3-scroll-region-accessibility.md:52-56
   - Confidence: medium
   - Why it matters: Searching for the exact substring `style={{ overflowX: 'auto' }}` is formatting-sensitive and doesn’t guarantee you’ve eliminated all focusable unnamed scroll containers (e.g., `overflowX:"auto"`, `overflowX: "auto"`, style extracted to a const, or wrappers using `overflowX: 'scroll'`). It could also flag unrelated uses of `overflowX: 'auto'` that are not these table wrappers.
   - Suggested fix: Tighten the verification to the actual risk: unnamed focusable scroll containers. For example, grep for `tabIndex={0}` near `overflowX` in `routes/**`, or grep for `tabIndex={0}` on `div` wrapping `<table` without `aria-label`/`role`. Alternatively, add a targeted lint rule / codemod check in the PR checklist, or update AC-2 wording to allow equivalent code that still routes through the primitive.

## Strengths

- Clear audit trail with exact file/line callouts for all 8 wrappers, reducing migration risk (lines 13–20).
- Acceptance criteria are concrete and test-oriented (AC-1 specifies role/name/tabIndex/class and testing-library queries).
- Path footprint is explicitly constrained to the allowed tournament-web and tournament implementation-artifacts areas (lines 27–29, 120–133), with no forbidden-scope edits proposed.
- Good attention to preserving the T12-2 overflow fix and not changing table layout/styling (lines 39–42, AC-4).

## Warnings

None.
