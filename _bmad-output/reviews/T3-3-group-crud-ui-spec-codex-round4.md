# Codex Review

- Generated: 2026-04-27T15:36:34.003Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-3-group-crud-ui.md

## Summary

Two spec-level contract inconsistencies remain that can plausibly cause incorrect implementation: (1) the POST add-member request body shape is contradictory (sometimes includes `mode`, sometimes not), and (2) the manual smoke step for money visibility refers to a POST with `mode=participant` even though the API is a PATCH with `moneyVisibilityMode`. One smaller low-severity mismatch remains around the stated backend test count in the footprint summary.

Overall risk: medium

## Findings

1. [medium] POST /groups/:groupId/members request body shape is inconsistent (mode discriminator missing in multiple ACs/UI steps)
   - File: _bmad-output/implementation-artifacts/tournament/T3-3-group-crud-ui.md:45-227
   - Confidence: high
   - Why it matters: The spec alternates between requiring a discriminator (`mode: 'ghin' | 'manual'`) and describing bodies without it. This is a real contract ambiguity: an implementer could build Zod schemas/handlers/tests expecting no `mode`, while the frontend (and other parts of the spec) send `mode`, leading to 400s in production or mismatched tests. It also undermines the “exactly one shape” requirement called out later.
   - Suggested fix: Pick one contract and make it consistent everywhere. If the intended contract is `mode` (per §2 and AC #5’s discrimination guidance), update all relevant ACs/examples:
- AC #4 header/body text at lines ~154-155 should say `{ mode: 'ghin', ghin, firstName, lastName }`.
- AC #5 header/body text at lines ~165-166 should say `{ mode: 'manual', name, manualHandicapIndex? }`.
- UI flow AC #13 at lines ~217-223 currently says POST `{ ghin, firstName, lastName }`; update to include `mode: 'ghin'`.
Also align Dev Notes wording at ~307 to avoid implying a non-discriminated XOR-by-keys approach if `mode` is required.

2. [medium] Manual smoke step uses wrong method/fields for money visibility guard (POST + mode vs PATCH + moneyVisibilityMode)
   - File: _bmad-output/implementation-artifacts/tournament/T3-3-group-crud-ui.md:257-266
   - Confidence: high
   - Why it matters: AC #22 is intended to validate the API’s defense-in-depth for v1.5 visibility modes. But it currently instructs “curl POST with mode=participant → 400 mode_not_v1” (line ~265), which does not match the earlier endpoint design: the visibility mode is updated via `PATCH /api/admin/groups/:groupId` and the field is `moneyVisibilityMode`. This can cause a false negative/positive during acceptance testing and leaves the real guard unverified.
   - Suggested fix: Update AC #22 bullet to reflect the actual endpoint and payload, e.g. “curl PATCH /api/admin/groups/<groupId> with { moneyVisibilityMode: 'participant' } → 400 mode_not_v1”. Ensure wording matches AC #3 / endpoint design at lines ~39-43 and ~145-152.

3. [low] Footprint summary still says backend tests are "10+" while spec requires ≥12
   - File: _bmad-output/implementation-artifacts/tournament/T3-3-group-crud-ui.md:117-125
   - Confidence: high
   - Why it matters: The file’s path footprint summary says `admin-groups.test.ts` is “NEW (10+ tests)” (line ~121), but §6 and AC #17 require ≥12. This is minor, but it can confuse implementers at a glance and undermine the “spec is the contract” principle stated later.
   - Suggested fix: Change line ~121 to “NEW (12+ tests)” to match §6 (line ~95) and AC #17 (line ~237+).

## Strengths

- The GHIN-handicap snapshot vs manual handicap semantics are now consistent across Story/UI/Dev Notes: GHIN-bound players store only the binding; v1 UI shows “—” for handicap until a future refresh action.
- Defense-in-depth for v1.5 money visibility modes is clearly specified (UI disables + API rejects with `mode_not_v1`).
- Pre-flight group existence check on POST add-member is explicitly required to avoid leaking FK violations as 500s.
- Test coverage requirements are concrete (route-level and component-level), with explicit baseline counts to prevent silent regressions.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T3-3-group-crud-ui.md
