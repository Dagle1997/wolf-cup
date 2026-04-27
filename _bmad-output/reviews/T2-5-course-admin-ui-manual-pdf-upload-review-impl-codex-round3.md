# Codex Review

- Generated: 2026-04-27T12:59:01.043Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-courses.ts, apps/tournament-api/src/routes/admin-courses.test.ts, apps/tournament-web/src/routes/admin.courses.new.tsx, apps/tournament-web/src/routes/admin.courses.new.test.tsx

## Summary

T2-5 save endpoint + test coverage look solid (transactional write, Zod + validateCourse layering, UNIQUE conflict handling, bodyLimit mapping, source_url scheme hardening). New test suite is thorough and asserts atomicity and key error shapes. One new concrete issue found in the web form: tee-color renames/removals can silently drop/overwrite yardage data when tee colors collide (duplicates not prevented).

Overall risk: low

## Findings

1. [low] Tee color collisions can silently overwrite/drop hole yardages during rename/remove
   - File: apps/tournament-web/src/routes/admin.courses.new.tsx:166-201
   - Confidence: high
   - Why it matters: The form uses tee color as the key into each hole’s `yardages` map. In `setTeeField` when `field==='color'`, the code renames keys by rebuilding `yardages` from `Object.entries`. If the new color already exists as another tee (or already exists in a hole’s yardages), the assignment order will overwrite one of the values, causing silent client-side data loss before submit. Similarly, `removeTee` removes yardages by color; if two tees share the same color, removing one will delete yardages needed by the remaining tee. The UI currently doesn’t prevent duplicate tee colors in `isComplete()`, so this is reachable via normal interactions.
   - Suggested fix: Prevent duplicate tee colors at the UI layer (e.g., in `setTeeField` if `field==='color'` and another tee already has that trimmed color, block the change and surface an inline error). Also consider updating `isComplete()` to fail when tee colors are not unique. If you want to allow duplicates, yardages should be keyed by tee index/id instead of color (larger refactor). Add a component test that sets two tees to the same color and asserts no yardage gets clobbered (or that the UI blocks the edit).

## Strengths

- Backend: good middleware ordering (auth before bodyLimit) and distinct error shapes for upload vs JSON save.
- Backend: `.trim().min(1)` normalization on name/club_name/tee.color closes whitespace-only and leading/trailing whitespace UNIQUE-bypass.
- Backend: source_url scheme restriction (http/https) is a concrete stored-XSS mitigation at the API boundary.
- Backend: UNIQUE vs non-UNIQUE DB error classification is explicitly tested (409 vs 500) and avoids overbroad SQLITE_CONSTRAINT matching.
- Tests: save-route suite covers happy path persistence across all 4 tables, schema failures, validateCourse failures, authz, body size limits, and duplicate handling.

## Warnings

None.
