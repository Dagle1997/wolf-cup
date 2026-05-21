# Codex Review

- Generated: 2026-05-21T19:46:55.764Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md

## Summary

The spec is close to a mechanical migration plan, but it has several ambiguity points that will make implementation and verification interpretive rather than purely “swap the component” work. The biggest gaps are (a) the audit methodology for empty states (only `.length === 0`), (b) branch-level uncertainty (“if it has a loading branch”, “:395 only”), and (c) a non–machine-parseable file list due to the prose “plus colocated tests” clause. The test-update intent (re-point, don’t delete) is good, but it needs a more concrete/stable assertion contract tied to the primitives’ actual defaults.

Overall risk: medium

## Findings

1. [high] §2 audit method (`.length === 0` grep) is not sufficient to cleanly separate UI empty-states from logic checks
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:19-28
   - Confidence: high
   - Why it matters: The spec’s “migrate UI, exclude logic” distinction is correct in principle, but the mechanism described is incomplete: only `.length === 0` is discussed, while empty checks commonly appear as `!items.length`, `items?.length === 0`, `items.length < 1`, `items?.length`, `!items?.length`, or derived booleans. Relying on a single grep risks (1) missing page-level empty UI that should be migrated (leaving inconsistent states and failing AC-3/AC-5 intent), or (2) accidentally migrating non-page UI that doesn’t match the pattern. This undermines the claim that the migration is “mechanical, not interpretive” (line 90).
   - Suggested fix: Broaden the audit criteria and make it explicit: list the exact included UI sites as file+line+snippet (not just exclusions). Consider adding a checklist rule like: “Any branch that returns early with JSX containing the empty copy for the page’s primary collection is migrated,” and explicitly enumerate the empty-state render branches for each of the AC-3 routes.

2. [high] Route/branch scope is ambiguous (“if it has a loading branch”, “score-entry :395 only”), making AC-1/AC-2 not fully testable
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:49-60
   - Confidence: high
   - Why it matters: AC-1 names specific files but includes conditional language: “plus `admin.events.$eventId.index.tsx` if it has a loading branch” (line 53). Also `rounds.$roundId.score-entry.tsx` is scoped to “the `:395` primary-query loading only” (line 53), while AC-2’s error migration list does not mention score-entry at all (lines 55–60). This makes it unclear what the implementer must change, what reviewers should expect, and what tests should assert. If the page does have an error branch or additional loading branches, the spec could allow accidental partial migration or inconsistent state UI.
   - Suggested fix: Remove conditionality by pinning the exact branches: for each listed route, specify which query/state branches are in-scope (loading/error/empty) with file+line anchors and the existing copy. If score-entry has a page-level error state, either include it in AC-2 or explicitly exclude it (with rationale) the same way §2 exclusions are documented.

3. [medium] “Files this story will edit” list is not machine-parseable due to prose wildcard for tests; allowlist enforcement becomes manual
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:101-121
   - Confidence: high
   - Why it matters: The bullet list (lines 103–118) is parseable, but line 120 adds a prose clause: “Plus the colocated `.test.tsx` for any of the above…” and references being “appended to the Dev Agent Record File List.” If your gate tooling expects an explicit, machine-readable list of touched files, this breaks that expectation and creates room for accidental edits outside `apps/tournament-web/**` (even if unintended). It also makes pre-review of the exact touched tests impossible.
   - Suggested fix: Either (a) enumerate the exact `.test.tsx` files expected to change (preferred), or (b) express the additional files in a machine-parseable glob form that your tooling accepts (e.g., a dedicated field like `tests: apps/tournament-web/src/routes/**/*.test.tsx` but bounded to the listed routes). Keep the sprint-status path explicit (it already is) and avoid additional prose in the list section.

4. [medium] Copy-preservation and “default message insufficient” rules are subjective; risk of silent UX/copy regression
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:49-66
   - Confidence: high
   - Why it matters: The spec intends to preserve meaningful route-specific copy (lines 36–38, 52, 64), but the criteria for when to provide `LoadingCard message`, what EmptyState `title/body` should be, and when to pass a fixed string vs `query.error` are not enumerated per-route. That makes the migration non-mechanical: two developers could make different “meaningful” choices, and tests may or may not catch it depending on what they assert. Also, AC-4 says “No behavior or copy regression” (line 66) but doesn’t define the baseline copy that must remain for each route.
   - Suggested fix: Add a per-route mapping table: existing loading/error/empty copy → new primitive props (`message`, `error` string vs object, `title/body`). This both makes review objective and gives tests a stable target. If the intention is to standardize copy (not preserve), state that explicitly and update AC-4 wording accordingly.

5. [medium] ErrorCard behavior assumptions (“string passthrough”, safe extraction) are referenced but not verifiable here; could force forbidden primitive edits
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:38-45
   - Confidence: medium
   - Why it matters: The spec relies on specific primitive behaviors: (a) `ErrorCard` can accept `unknown` and safely extract a message (line 95), and (b) it supports a “string passthrough” mode to preserve intentional fixed copy (line 38). If either behavior is not actually present in T11-1 primitives, the migration will either regress UX (fixed copy replaced by generic extraction) or tempt the implementer to modify the primitives—explicitly disallowed by §5 (line 42).
   - Suggested fix: Add an explicit contract excerpt for `ErrorCard` and `LoadingCard` defaults (prop types + default copy + roles) into the spec, or link to the exact T11-1 acceptance criteria. Also list which routes require fixed-string preservation so reviewers can confirm no primitive changes are needed.

6. [medium] Test-update plan is directionally correct, but the assertion contract should be tightened to avoid brittleness and ensure coverage
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:29-75
   - Confidence: high
   - Why it matters: §3/AC-4 correctly says tests should be updated (not deleted) and should assert by role (lines 29–32, 66–70). However, the plan also says to assert “role + the message text” (line 31) without specifying the exact default strings from the primitives. If the primitives’ copy differs (e.g., ellipsis variants, punctuation), tests will churn unnecessarily. Conversely, if tests only assert role, they may not protect against copy flattening called out as a risk (line 98).
   - Suggested fix: Define a stable test contract per primitive: e.g., `LoadingCard` renders an element with `role="status"` and includes either default text `Loading…` (exact) or the passed `message`; `ErrorCard` renders `role="alert"` and includes either extracted message or provided fixed string; `EmptyState` renders a heading/title with specific semantics. Then require per-route tests to assert both role and the route-specific title/copy only where the spec says it must be preserved.

## Strengths

- Clear path-allowlist intent: edits constrained to `apps/tournament-web/**` plus the tournament sprint-status file; explicit statement of forbidden areas (lines 15–18, 120).
- Good emphasis on updating tests in lockstep and explicitly forbidding deleting tests just to pass (lines 29–32, 66–70).
- Good behavioral guardrails: preserve PageShell, avoid fabricating `onRetry`, and pass through real error objects where possible (lines 35–38).
- The explicit documentation of the ghin dropdown exclusion (line 27) is reasonable and helps avoid an inappropriately framed EmptyState inside a non-page UI surface.

## Warnings

None.
