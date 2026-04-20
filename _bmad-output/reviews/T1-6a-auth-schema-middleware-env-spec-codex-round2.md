# Codex Review

- Generated: 2026-04-20T20:26:19.316Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md

## Summary

Spec is generally tighter than round-1 (composite UNIQUE includes tenant_id; CSRF origin normalization; time injection for deterministic tests). Remaining issues are mostly spec-level inconsistencies/omissions that could cause implementation drift or brittle CI/local execution—especially around env var requirements and Hono type augmentation guidance.

Overall risk: medium

## Findings

1. [medium] Hono ContextVariableMap augmentation guidance is internally inconsistent (risk of type augmentation not being applied)
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:88-186
   - Confidence: high
   - Why it matters: AC #10 allows augmentation in a middleware file or a shared `src/types/hono.ts`, while Dev Notes explicitly recommend a dedicated `.d.ts` file (`src/types/hono.d.ts`) because `.ts` module augmentation can silently fail if the file isn’t included in the import graph. Leaving AC #10 permissive re-introduces the original failure mode (types compile only if some file happens to import the augmentation). This can make downstream `c.get('session')`/`c.get('player')` appear `any`/unknown or fail in CI depending on import order.
   - Suggested fix: Tighten AC #10 to require a `.d.ts` augmentation under `src/types/hono.d.ts` (or equivalent) and remove the `src/types/hono.ts` option. Also ensure the TS config includes `src/**/*.d.ts` (it usually does via `include: ["src"]`, but make it explicit if needed).

2. [medium] Env vars marked REQUIRED with fail-fast parsing, but spec doesn’t concretely ensure tests/CI/local non-docker runs provide them before module import
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:56-66
   - Confidence: high
   - Why it matters: AC #7 requires `AUTH_COOKIE_DOMAIN` and `PUBLIC_APP_URL` with no defaults and states parse failures throw at module-load. That is enforceable, but it also means `pnpm -F @tournament/api test` and `typecheck` will hard-fail if vitest/tsc imports any module that imports `env.ts` before the test harness sets `process.env`. The spec currently hand-waves “CI workflow and local dev either set them explicitly or run against a `.env` file Node loads via `--env-file`”, but there’s no acceptance criteria ensuring the tournament-api test command actually runs with those env vars set (or a vitest setup file sets them prior to imports). This is a common source of CI-only breakage.
   - Suggested fix: Add an explicit AC note that tournament-api test/typecheck commands must set `AUTH_COOKIE_DOMAIN` and `PUBLIC_APP_URL` (and `NODE_ENV`) in the test runner environment, e.g. via a vitest `setupFiles` that sets `process.env` before importing app modules, or by adding `--env-file` to the workspace scripts. Also consider whether `AUTH_COOKIE_DOMAIN` should truly be required in non-production given AC #9 explicitly omits Domain in dev/test; if it stays required, document the canonical local/test value.

3. [low] Composite UNIQUE index column order is fine for tenant-scoped lookups, but spec should lock in the expected query pattern to avoid inefficient scans
   - File: _bmad-output/implementation-artifacts/tournament/T1-6a-auth-schema-middleware-env.md:25-35
   - Confidence: high
   - Why it matters: You asked to verify ordering `(tenant_id, provider, provider_sub)`. For multi-tenant correctness and for index efficiency, this ordering is optimal if lookups are always tenant-scoped (equality on tenant_id, provider, provider_sub). If any code later tries to find an identity by `(provider, provider_sub)` without tenant_id, SQLite can’t use the leftmost-prefix efficiently and may scan. The spec currently implies tenant scoping but doesn’t mandate it at query sites.
   - Suggested fix: Keep the index order as-is, but add a short requirement/dev note that all oauth identity lookups must include `tenant_id` in the WHERE clause (or otherwise ensure the current-tenant is always known and applied).

## Strengths

- Composite UNIQUE on `(tenant_id, provider, provider_sub)` directly addresses the prior multi-tenant correctness issue.
- `new URL(env.PUBLIC_APP_URL).origin` requirement correctly normalizes CSRF origin comparisons (path/trailing-slash issues).
- Injectable `now?: () => number` in session helpers is a concrete, minimal mechanism to eliminate time-based test flakiness.
- Explicit device_info truncation requirement + test assertion reduces risk of unbounded storage regression.
- Clear separation of T1-6a (infra) vs T1-6b (OAuth) reduces churn and avoids premature dependencies.

## Warnings

None.
