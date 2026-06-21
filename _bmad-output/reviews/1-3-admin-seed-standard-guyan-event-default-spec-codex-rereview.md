# Codex Review

- Generated: 2026-06-21T21:58:16.991Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md

## Summary

The three prior HIGH findings called out in the previous review appear addressed in the spec: (1) the preset is now explicitly a single DB-seeded `rule_set_revision` source-of-truth that the write reads (not an inline code object), (2) the cascade resolver now requires explicit hierarchy + tenant validation before any config load to prevent cross-event leakage, and (3) the resolved-config endpoint contract is now explicit about auth gating and non-500 failure modes. The two MEDs (lock derived-vs-toggle and seed-vs-update activity emission) are also explicitly resolved, and the app-router registration file is named.

That said, the updated spec introduces (or still leaves) a couple concrete gaps/ambiguities that can bite correctness/security in implementation: tenant scoping for the seeded preset is unspecified (risk of cross-tenant confusion if `rule_set` is tenant-scoped), and error/status semantics for invalid `foursomeNumber` (and some hierarchy mismatch cases) are not fully specified even though `roundId` is. These are fixable via small clarifications in AC2/AC5/AC7 and test requirements.

Overall risk: medium

## Findings

1. [medium] Tenant scoping for the DB-seeded preset (`rule_set`/`rule_set_revision`) is unspecified (could become cross-tenant or duplicate-seed ambiguity)
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:23-24
   - Confidence: high
   - Why it matters: AC2 makes the preset a DB-seeded canonical `rule_set` + `rule_set_revision` and says the write reads that revision’s config at runtime. However, the spec does not state whether the preset rows are global (shared across tenants) or tenant-scoped. If your `rules.ts` schema includes `tenant_id` (common in multi-tenant setups), then “find-or-create by a stable key” can either (a) accidentally create one preset per tenant, (b) read the wrong tenant’s preset, or (c) fail uniqueness depending on constraints. Even if the preset is intended to be global, the spec should state how it’s represented (e.g., `tenant_id = NULL` / `system` tenant) to prevent accidental cross-tenant reads or seed drift.
   - Suggested fix: In AC2/Task 1, explicitly define the preset tenancy model and uniqueness key, e.g.:
- Option A (global preset): `rule_set.tenant_id IS NULL` (or a dedicated system tenant), unique key `(slug)`; runtime read explicitly targets the global preset.
- Option B (per-tenant preset): unique key `(tenant_id, slug)`; runtime read always filters by caller’s `tenantId`.
Also require a test that a tenant cannot cause the write to read another tenant’s preset revision (if tenant-scoped).

2. [medium] Hierarchy-validation result codes are fully specified for `roundId` mismatch but not for invalid `foursomeNumber` (and other mismatch cases)
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:29-35
   - Confidence: high
   - Why it matters: AC5 requires rejecting `roundId` not belonging to `eventId` and `foursomeNumber` not belonging to the round, before loading any config. AC7 then specifies: `GET resolved-config` returns 404 if `roundId` is not under the event, and 200 `{ok:false, reason}` for unsettleable/orphan/unseeded. But the status/shape for an invalid `foursomeNumber` (not in that round) is not specified. If this is left to implementation, different handlers may diverge (404 vs 400 vs 200 ok:false), and you risk inconsistent behavior and/or information leakage semantics across endpoints. Also, AC5 says “rejected” for mismatch, but AC7 only pins 404 for one mismatch type.
   - Suggested fix: Extend AC7 to explicitly define behavior for invalid `foursomeNumber` (and optionally `roundId` present but not found):
- e.g., 404 when `(roundId)` not found under event; 404 (or 400) when `foursomeNumber` is not valid for the validated round.
- keep 200 `{ok:false, reason}` exclusively for *valid hierarchy but not resolvable due to config state* (unseeded/orphan/unsettleable).
Add a required test for invalid `foursomeNumber` rejection analogous to the cross-event roundId test in Task 4.

3. [low] PUT contract requires `pointValueSchedule` even for lock-only edits; may force clients to re-send schedule and can cause accidental overwrites
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:34-42
   - Confidence: medium
   - Why it matters: AC7 defines PUT body as `{ pointValueSchedule: ..., lockState?: ... }`. AC9 describes a “single toggle” lock/unlock flow. As written, a lock-only toggle still must send `pointValueSchedule`, which can lead to (a) UI needing to always hydrate current schedule before toggling, and (b) accidental overwrites if the UI has stale schedule state. This is not necessarily wrong, but it’s a concrete behavioral constraint that can create bugs/regressions if not intentional.
   - Suggested fix: Either (1) explicitly state PUT is a full replace of the event-level config inputs and the UI must always send schedule + lockState, or (2) allow partial updates by making `pointValueSchedule` optional when an event-level row already exists (and define precedence). If you keep it required, add a route/service test ensuring toggling lock does not change schedule (i.e., service reads existing schedule when not provided, if you choose option 2).

## Strengths

- AC2 resolves the prior seeded-vs-in-code contradiction by making the DB-seeded `rule_set_revision` canonical and explicitly stating the write reads it at runtime (lines 23–24, 77–78).
- AC5/Task 4 add explicit hierarchy validation and tenant checks before any config load, and explicitly restrict loaded rows to matching `ref_id`, addressing cross-event leakage (lines 29–30, 57–58).
- AC7 now specifies 401/403/404 gating and makes resolved-config failure modes non-500 with an explicit `{ok:false, reason}` shape (lines 34–35).
- AC9 clarifies single source of truth for lock state (JSON), with the column derived/checked for consistency, resolving the derived-vs-toggle tension (lines 42–43).
- AC4 clarifies seeded-vs-updated activity emission semantics and requires registering the types in the Zod union (lines 25–26, 55–56).
- Scope/boundary and file edit list are clean and limited to the stated apps plus tracking/spec files (lines 50–51, 97–114).

## Warnings

None.
