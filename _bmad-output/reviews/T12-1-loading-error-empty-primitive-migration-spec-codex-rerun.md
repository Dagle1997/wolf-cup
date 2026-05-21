# Codex Review

- Generated: 2026-05-21T19:49:21.159Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md

## Summary

The revised spec materially addresses the prior High/Medium findings by making per-file inspection authoritative, removing branch-scope hedges, bounding the test-file scope, and replacing subjective copy guidance with a “preserve existing words; container-only change” rule plus a stable testing contract (roles/title-text). The migration is now largely mechanical-by-inspection and testable via the role/title assertions.

Remaining issues are mostly spec-consistency/precision: there’s a small but real allowlist inconsistency (`apps/tournament-web/**` vs `apps/tournament-web/src/routes/**`), and a couple of terms (“primary query”, “whole-section”) still require human judgment that could lead to inconsistent implementations across the 16 routes. Also, the “verified against source” claim can’t be independently validated from the provided artifact alone (it’s an assertion about external files).

Overall risk: low

## Findings

1. [medium] Path allowlist statement is internally inconsistent (could be misread to allow edits outside routes)
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:15-18
   - Confidence: high
   - Why it matters: §1 says “Every edited file is under `apps/tournament-web/**`” (line 17), which—literally—includes `src/components/**` and other non-route areas. Later, the spec correctly tightens the allowlist to `apps/tournament-web/src/routes/**` + tournament sprint-status and explicitly forbids primitive edits (lines 129–131, 52–55). This inconsistency can cause scope creep or review disputes (“the spec allowed it”).
   - Suggested fix: Make §1 match the strict allowlist used later, e.g. “Every edited file is under `apps/tournament-web/src/routes/**` (route + same-basename `.test.tsx`) plus `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml`.”

2. [medium] Some remaining interpretation risk: “primary query” and “whole-page/section” are not fully objective
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:21-23
   - Confidence: medium
   - Why it matters: You tightened the process to per-file inspection and defined “page-level state render branch,” which resolves the earlier “grep is insufficient” issue. However, the definition still depends on judgment for routes that have multiple queries or multiple independently-loading sections (e.g., a page shell with subpanels). Two devs could disagree whether a particular branch is “primary query” fallback vs. “inline hint nested inside a live control,” especially with “whole-section” wording.
   - Suggested fix: Optionally add a short per-file checklist in the Dev Agent Record (or in the spec) identifying the intended migrated branches per route (e.g., “events.$eventId.money: migrate query X loading/error/empty return branches at …”), or clarify that “primary query” = the query that gates the route’s main content render (the one whose `isLoading/isError` triggers an early return for the page).

3. [low] Primitive contract verification is asserted but not auditable from this artifact alone
   - File: _bmad-output/implementation-artifacts/tournament/T12-1-loading-error-empty-primitive-migration.md:41-42
   - Confidence: high
   - Why it matters: This revision addresses the earlier concern by stating the primitives were verified against component source, including “string passthrough at step 2.” But reviewers reading only this spec still can’t confirm the contract without opening those component files, and the spec doesn’t include a snippet or exact reference to the relevant function/lines.
   - Suggested fix: If you want the spec to be self-auditing, include a short excerpt or a precise pointer (file + function name + line range) for the ErrorCard string passthrough behavior. Otherwise, this is acceptable as a process note.

## Strengths

- High #1 resolved: §2 makes per-file inspection authoritative and precisely defines “page-level state render branch,” with explicit logic exclusions (lines 19–30).
- High #2 resolved: AC scope is now “EVERY page-level state render branch in the 16 listed files, found by reading,” removing prior hedges (lines 57–60).
- Med #3 resolved: test edits are constrained to same-basename siblings under `apps/tournament-web/src/routes/` and must be enumerated when touched; primitives explicitly excluded (lines 129–131, 50–55).
- Med #4 resolved: copy rules are now deterministic (“preserve existing words; only container changes”) with state-specific rules (lines 43–49).
- Med #6 resolved: stable, less brittle test contract is defined via roles/title text and conditional message assertions (lines 31–37).
- Allowlist is explicitly stated at the end of the file and forbids edits to primitives/components (lines 129–131, 52–55).

## Warnings

None.
