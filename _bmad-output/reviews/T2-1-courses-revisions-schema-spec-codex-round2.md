# Codex Review

- Generated: 2026-04-23T16:47:44.911Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md

## Summary

Only the spec markdown was provided (no schema TS, migration SQL, or tests), so I can’t verify that the fixes are actually implemented—only that the spec/AC text reflects them. The spec does reflect the 5 intended fixes (v1-gap documented + [v1-gap] test, tenant-scoped course uniqueness index, mixed FK delete posture, UNIQUE error-shape pinned, DB CHECK constraints). However, there are a couple of internal inconsistencies/stale notes that could cause incorrect implementation or test-count gate confusion.

Overall risk: medium

## Findings

1. [medium] Stale Dev Notes contradict updated MIXED FK delete posture (may cause incorrect implementation)
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:251-253
   - Confidence: high
   - Why it matters: The spec’s risk-acceptance section explicitly switches to MIXED FK behavior (RESTRICT on course_revisions → courses, CASCADE on tees/holes → revisions) (lines 15–26, 152–156). But Dev Notes still says “Why CASCADE on all FKs” (line 251), which contradicts the updated posture. This kind of contradiction is a common source of dev-agent drift (implementing CASCADE everywhere) and would directly regress Fix 3.
   - Suggested fix: Update/remove the Dev Notes bullet at lines 251–252 to match MIXED posture (or point to the MIXED section explicitly).

2. [medium] Test-count gating and task instructions are internally inconsistent (≥84 vs ≥81; “8 test cases” vs 11 listed)
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:172-241
   - Confidence: high
   - Why it matters: AC #8 enumerates 11 tests (line 189) and AC #10 expects total tests ≥84 (line 197). But Task 6.3 says `pnpm -F @tournament/api test` → ≥81 (line 240), and Task 5.2 says “Implement the 8 test cases enumerated” (line 234) even though 11 are enumerated. This can lead to either under-implementation (missing required tests) or CI gate confusion when checking counts.
   - Suggested fix: Align tasks with ACs: change Task 5.2 wording to 11 tests (or “all tests enumerated”), and update Task 6.3 threshold to ≥84 (or compute dynamically / remove the hard number).

## Strengths

- Fix 2 is clearly specified: tenant-scoped uniqueness on (tenant_id, club_name, name) via `uniqueIndex('uniq_courses_tenant_club_name').on(t.tenantId, t.clubName, t.name)` (lines 61–68).
- Fix 3 is clearly specified: RESTRICT on course_revisions → courses and CASCADE on tees/holes → revisions, and AC #4/#8 explicitly test both behaviors (lines 71–110, 152–156, 184–186).
- Fix 5 is clearly specified with explicit DB-level CHECK constraints for hole_number and si and guidance for migration-level fallback if ORM API drifts (lines 130–138).
- Fix 1 is explicitly acknowledged as a v1-gap with a dedicated [v1-gap] test that documents the current cross-tenant mismatch possibility (lines 30–41, 187–188).

## Warnings

None.
