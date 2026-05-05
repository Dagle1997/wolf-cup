# Codex Review

- Generated: 2026-05-05T14:35:30.131Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/export.ts, apps/tournament-api/src/routes/export.ts

## Summary

Re-review confirms the two targeted fixes are present and consistent in the provided files:
- The export route now constructs the filename inside the try/catch, so `Intl.DateTimeFormat`/timezone `RangeError` is caught and returned as the structured 500 (`code: 'export_failed'`).
- Tenant scoping (`eq(<table>.tenantId, tenantId)`) is applied across all queries in `buildEventExport`, including closure tables (courses, players) and `auditLog`.
No new concrete bugs/regressions are evidenced in the provided snippets.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Route-level try/catch now covers filename creation (`exportFilename` → `exportYmd` → `Intl.DateTimeFormat`), preventing uncaught exceptions (routes/export.ts:43-75).
- Consistent defense-in-depth tenant scoping added to every query path, including `auditLog` and closure tables (services/export.ts:144-484).
- Empty-safe handling for `inArray([])`/`or(...[])` in audit-log query composition prevents malformed SQL (services/export.ts:424-435).
- Filename is derived from a strict slug + YYYYMMDD, avoiding header injection risks in `Content-Disposition` (services/export.ts:827-855; routes/export.ts:60).

## Warnings

None.
