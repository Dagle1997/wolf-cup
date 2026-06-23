# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-23T16:52:54.544Z
- Synthesized sources: codex-review, gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: (prior outputs only)

## Verdict

**SHIP** — confidence: medium

## Executive summary

Decision: whether to ship the Story 3–4 leaderboard expandable per-player scorecard implementation, and what to fix before merge. Reviewers largely agree there are a couple of small UI/a11y issues, while the only potentially riskier issue (cents→dollars fractional output) is disputed and appears to depend on a documented backend invariant. Net: safe to ship with small cleanups; no evidence of a critical bug or data leak in the discussed scope.

## High-confidence findings (consensus)

1. [medium] expandedPlayerId not reset on scope toggle causes auto-reopen/refetch when returning to round scope
   - File: unknown
   - Affirming sources: codex-review, codex-critique-of-gemini, gemini-critique-of-codex
   - Summary: Expanded row state persists across scope changes; when users toggle away and back to round scope, the previously expanded player row reopens automatically (and may refetch), which is a real but minor UX/state bug.
   - Recommended action: Clear expandedPlayerId (and any expanded-row local state) whenever the scope changes (e.g., round ↔ event).

2. [low] aria-controls points to a <tr> rather than a region/controlled element appropriate for disclosure
   - File: unknown
   - Affirming sources: codex-review, gemini-critique-of-codex
   - Summary: The disclosure control’s aria-controls references a table row element, which is not an ideal controlled 'region'/container for accessibility relationships.
   - Recommended action: Make the expanded content a semantically appropriate controlled element (e.g., a container with role="region" or similar) and point aria-controls to that element’s id.

## Divergent findings (need resolution)

1. cents→dollars conversion (/100) could yield fractional dollars if backend returns non-whole-dollar values
   - Codex flags a potential fractional-dollar display risk if the backend ever returns amounts that aren’t whole dollars; Gemini argues this is not a bug because the whole-dollar invariant is explicitly documented and enforced by the domain/engine (throwing on odd values).
   - Positions:
     - **codex-review** (risk exists (depends on backend invariant)): “cents→dollars /100 can yield fractional dollars if backend returns non-whole-dollar (Guyan is whole-dollar; documented in comments).”
     - **gemini-critique-of-codex** (not a bug; invariant documented): “DISAGREE on Finding 1: the whole-dollar invariant IS documented right above the code; not a bug.”
     - **codex-critique-of-gemini** (still a dependency risk): “Reaffirms the cents→dollars (depends on a documented-only invariant).”
   - Synthesizer lean: Lean: treat as a low-risk dependency, not a must-fix bug. Since the invariant is documented (per gemini-critique-of-codex) and is domain-enforced (per the original debate summary: engine throws on odd pv), this is unlikely to manifest. However, Codex is right that it’s a backend-contract dependency; a lightweight assert/guard or a unit test encoding the invariant would reduce future regression risk.

2. Tests missing for “no-fetch-until-expanded” and moneyEnabled=false gating
   - Codex says tests don’t assert these behaviors; Gemini says tests cover lazy fetch and showMoney. Gemini-critique says it couldn’t verify due to missing test file context in the review packet.
   - Positions:
     - **codex-review** (tests are missing these assertions): “tests miss no-fetch-until-expanded + moneyEnabled=false.”
     - **gemini-review** (tests already cover lazy fetch and showMoney): “Lazy fetch deferred until expanded; … tests cover … showMoney.”
     - **gemini-critique-of-codex** (unable to verify): “Finding 4: couldn't verify (no test file given).”
   - Synthesizer lean: Lean: add/ensure the assertions anyway (cheap, reduces risk). Even if partial coverage exists, explicitly asserting “no fetch until expanded” and “moneyEnabled=false prevents money fetch/render path” is low-cost and clarifies intent.

## Dismissed findings

1. Scope toggle uses role=tablist/tab without full tabpanel/keyboard behavior
   - Raised by: codex-critique-of-gemini
   - Dismissal reason: missing_evidence
   - Reasoning: It’s described as pre-existing and not attributable to the Story 3–4 changes (“pre-existing role=tablist on the scope toggle”). Without evidence that Story 3–4 introduced/regressed this, it should not block shipping this PR (though it may merit a separate a11y ticket).

2. RowScorecard fetches regardless of showMoney; relies on server to omit moneyNet (privacy concern)
   - Raised by: codex-critique-of-gemini
   - Dismissal reason: theoretical
   - Reasoning: The report itself notes this relies on server gating and states “(3-3 AC5, no leak)” in the user-provided summary. With the stated acceptance criteria indicating the server omits moneyNet, this is not demonstrated as an actual leak for this change; treat as a defense-in-depth improvement rather than a blocker.

## Prioritized actions

1. [should_fix] Reset/clear expandedPlayerId (and any expanded-row state) on scope toggle so returning to a scope does not auto-reopen a previously expanded row.
2. [should_fix] Fix aria-controls to reference an appropriate controlled element for the expanded content (e.g., wrap expanded details in a region/container with an id and point aria-controls to it).
3. [should_fix] Add or confirm tests explicitly asserting: (a) no network fetch happens until a row is expanded, and (b) moneyEnabled=false (or equivalent) prevents money-related fetch/render behavior as intended.
4. [optional] Add a lightweight runtime assert/guard or a unit test encoding the “whole-dollar invariant” for money values so /100 conversion can’t silently produce fractional dollars if backend contracts change.
5. [optional] Create a separate backlog ticket for the pre-existing scope toggle tab semantics/keyboard support (role=tablist/tab + tabpanel expectations), if accessibility compliance requires it.
6. [optional] If product/privacy requirements prefer minimizing even gated money requests, consider short-circuiting the RowScorecard fetch when showMoney/moneyEnabled is false (defense-in-depth), but do not block this ship on it given stated server-side gating.

## Open questions (for human judgment)

- Is the whole-dollar invariant (no fractional dollars) formally guaranteed by the backend contract/API schema, or only documented in code comments? If only informal, should we enforce it with validation to prevent future backend changes from causing fractional-dollar UI output?
- What is the authoritative expected behavior for moneyEnabled=false: should it prevent the request entirely, or is it acceptable to fetch and rely on server-side omission (AC5 suggests the latter)?
- Do accessibility requirements for this project mandate strict tab semantics for the scope toggle (tabpanel + keyboard interactions), and if so should that be addressed in this PR or tracked separately?

## Warnings

None.
