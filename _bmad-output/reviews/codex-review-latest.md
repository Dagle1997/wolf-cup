# Codex Review

- Generated: 2026-06-18T19:01:40.686Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-events.ts, apps/tournament-api/src/routes/courses.ts, apps/tournament-web/src/routes/admin.events.new.tsx

## Summary

The new pre-flight tee validation closes the reported “bogus tee persisted” hole for the normal wizard flow, but it introduces (or at least solidifies) a serious cross-tenant mismatch: course_revision_id existence is not tenant-scoped while tee lookup is tenant-scoped and the “tee-less carve-out” treats “no tees returned” as “can’t validate”. That combination can bypass tee validation (and allow cross-tenant courseRevisionIds) and can also cause confusing behavior if casing/whitespace differs between stored course_tees.teeColor and the client-submitted tee_color (which is trimmed).

Overall risk: high

## Findings

1. [high] Tenant scoping mismatch can bypass tee validation and allow cross-tenant courseRevisionIds
   - File: apps/tournament-api/src/routes/admin-events.ts:164-266
   - Confidence: high
   - Why it matters: The course revision existence check is not tenant-scoped (lines 174-178), but the tee lookup is tenant-scoped (lines 215-227) and the validator explicitly skips validation when no tees are found for a revision (line 239). An attacker (or buggy client) can submit a course_revision_id that exists in a different tenant: it will pass the existence check, but tees will be filtered out by tenantId='guyan', causing `validTees` to be undefined and the code to `continue` (line 239), thereby bypassing tee validation entirely. The transaction then persists an event_round with a cross-tenant courseRevisionId (lines 287-300). This can also lead to cross-tenant data exposure later because other queries join courseRevisions/courses without tenant filtering (e.g., admin-context joins at lines 481-488 only filter eventRounds by tenant).
   - Suggested fix: Make the pre-flight course revision check tenant-scoped (e.g., `where(and(inArray(courseRevisions.id, requestedRevisionIds), eq(courseRevisions.tenantId, TENANT_ID)))`) and treat any non-tenant match as missing/invalid. Consider additionally enforcing that the referenced courseRevisions.courseId (and courses.tenantId) match TENANT_ID. Once revisions are tenant-validated, the tee query’s tenant filter + tee-less carve-out can’t be abused to bypass validation.

2. [medium] Exact-match teeColor comparison can falsely reject legitimate tees due to trimming/case/whitespace normalization mismatches
   - File: apps/tournament-api/src/routes/admin-events.ts:71-252
   - Confidence: medium
   - Why it matters: The request schema trims `tee_color` (line 88), and the web wizard also trims it on submit (apps/tournament-web/src/routes/admin.events.new.tsx:280). The DB values from `course_tees.teeColor` are used as-is in the Set (line 235) and compared with `Set.has()` (line 240), which is case- and whitespace-sensitive. If `course_tees.teeColor` contains leading/trailing whitespace (e.g., from import) or differs by case from what the client submits (especially in the wizard’s free-text fallback), event creation will 400 `unknown_tee_color` even if the tee is “logically” correct. Worse: trimming on submit means a tee that *was* selected from a dropdown that included trailing spaces in its option value could be trimmed into a value that no longer matches the DB row, causing a regression that blocks creation.
   - Suggested fix: Normalize both sides consistently during validation (e.g., compare `normalize(tee) = tee.trim()` or `tee.trim().toLowerCase()` depending on desired semantics). Alternatively, enforce canonicalization at write/import time for `courseTees.teeColor` so DB values never contain stray whitespace/case variants. If you keep case-sensitive semantics, ensure the client does not trim (or trims exactly as DB does) and add an explicit data cleanup/migration.

3. [medium] “No tees → skip validation” can preserve the original money/handicap bug for incomplete imports and makes behavior inconsistent with pairings tee override validation
   - File: apps/tournament-api/src/routes/admin-events.ts:206-252
   - Confidence: medium
   - Why it matters: The carve-out `if (!validTees || validTees.size === 0) continue;` (line 239) is intended for truly tee-less manual courses, but it will also apply when tees are missing due to data issues (e.g., partial import) or due to the tenant mismatch described above. In those cases, you’ll still persist a tee_color that won’t match any course_tees row, recreating the slope/rating lookup failure you’re trying to prevent. Additionally, the pairings save step-4c does *not* have the same carve-out: if `validTees` is missing, it rejects overrides (lines 875-894, especially 880). So an event round could be created with a free-text tee (allowed), but later per-player overrides become impossible for that round (rejected) — surprising and potentially blocking admin workflows.
   - Suggested fix: If tee-less courses are a supported concept, consider explicitly detecting them via course revision metadata (or a dedicated flag) rather than inferring from “no course_tees rows returned”. If inference is the only option, consider returning a more explicit error when tees are expected but missing (e.g., based on course type/source) or at least log a warning with revisionId. Align pairings override validation semantics with event-round tee semantics for tee-less courses (either allow free-text overrides for tee-less courses or disallow tee-less rounds entirely).

4. [low] Wizard assumes latestRevision is non-null but /api/courses can return latestRevision: null
   - File: apps/tournament-web/src/routes/admin.events.new.tsx:67-525
   - Confidence: high
   - Why it matters: The courses API explicitly emits `latestRevision: null` when a course has no revision (apps/tournament-api/src/routes/courses.ts:85-96). The wizard’s types and rendering assume `latestRevision` is always present (e.g., `<option key={c.latestRevision.id} ...>` at lines 498-501), which would throw at runtime if that data anomaly occurs. This can indirectly increase the chance the wizard ends up in a state where tees aren’t loaded and the user uses free-text (the scenario you’re hardening).
   - Suggested fix: Make the client type reflect `latestRevision: {...} | null` and guard in rendering (skip courses with null latestRevision or show them disabled). Ideally also prevent such courses from being selectable for event creation.

## Strengths

- Validation is performed pre-transaction, so it avoids holding a write transaction open while doing reads (apps/tournament-api/src/routes/admin-events.ts:215-266 vs tx at 274+).
- The new error code `unknown_tee_color` is wired through to a user-facing wizard message (apps/tournament-web/src/routes/admin.events.new.tsx:335-342), reducing support/debug time.
- The validation logic mirrors the existing pairings tee validation shape (Map<revisionId, Set<teeColor>>), which reduces the chance of divergent rules over time.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/admin-events.ts
