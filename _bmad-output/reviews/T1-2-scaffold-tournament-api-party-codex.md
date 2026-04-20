# Codex Review

- Generated: 2026-04-20T14:21:27.603Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T1-2-scaffold-tournament-api-party-review.md, apps/tournament-api/src/app.ts, apps/tournament-api/src/index.ts, apps/tournament-api/src/app.test.ts, apps/tournament-api/src/db/index.ts, apps/tournament-api/src/db/schema/_columns.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/eslint.config.js, apps/tournament-api/drizzle.config.ts, apps/tournament-api/package.json, apps/tournament-api/tsconfig.json, _bmad-output/implementation-artifacts/tournament/T1-2-scaffold-tournament-api.md

## Summary

Implementation mostly matches the scaffold spec (deps, health route + smoke test, Drizzle/libsql wiring, eslint engine-boundary rule, no bcrypt). However, AC #2a is written as a *literal required shape* for `src/index.ts`, and the implementation does not match it (uses `resolvePort()` and `serve({ fetch: app.fetch, port })` instead of `serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })`). The party-mode review explicitly notes this divergence but still marks AC #2a satisfied and concludes “No missed requirements” / “PASS”, which is not supported by the provided evidence under a strict reading of the ACs.

Overall risk: medium

## Findings

1. [medium] AC #2a not satisfied literally: `serve()` call shape differs from required `Number(process.env['PORT'] ?? 3000)` inline expression
   - File: apps/tournament-api/src/index.ts:4-19
   - Confidence: high
   - Why it matters: The story’s AC #2a is unusually precise and requires that `src/index.ts` (1) import `{ app }` from `./app.js` and (2) invoke `serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) })` at module scope. The current code does invoke `serve()` at module scope, but computes `port` via a helper (`resolvePort()`) and passes `port` as a variable. Under an evidence-first/retroactive acceptance check, this is a spec miss, and it weakens the “mechanically verifiable” claim made in the party review.
   - Suggested fix: If the intent is to satisfy AC #2a *verbatim*, change `src/index.ts` to call:

```ts
serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) });
```

at module scope. If you want to keep validation hardening, either (a) update the story AC to allow a helper (not possible retroactively unless you explicitly amend the spec), or (b) keep `resolvePort()` but also meet the literal requirement by restructuring the spec/acceptance expectations (preferred: amend AC text + re-review).

2. [medium] Party-mode review over-claims acceptance: states “No missed requirements” and PASS despite AC #2a divergence
   - File: _bmad-output/reviews/T1-2-scaffold-tournament-api-party-review.md:14-27
   - Confidence: high
   - Why it matters: The party review says all nine ACs are satisfied and “No missed requirements” (lines 14–27), yet later acknowledges a divergence from AC #2a’s literal shape (`resolvePort()` vs inline `Number(process.env['PORT'] ?? 3000)`) (lines 71–75). That is internally inconsistent. For a gate that flips `review` → `done`, this is a material review-quality issue: either AC #2a is strict (then it should be marked as not met / needs change), or the AC should be treated as minimum semantics rather than exact form (then the party review should justify that reinterpretation and ideally update the spec).
   - Suggested fix: Edit the party review to either:
1) Mark AC #2a as NOT satisfied and recommend a code change (or spec amendment) before `done`, OR
2) Explicitly justify why AC #2a is interpreted semantically (not literally), and revise the “mechanically verifiable / no missed requirements” language accordingly.
Also update the verdict section to match whichever stance you take.

3. [low] Exporting `STARTUP_TIME` is a spec divergence (though likely harmless)
   - File: apps/tournament-api/src/app.ts:3-11
   - Confidence: high
   - Why it matters: The spec/dev-notes text describes `const STARTUP_TIME = Date.now();` as a module-level constant. The implementation exports it (`export const STARTUP_TIME = Date.now();`). This doesn’t break the runtime contract (and can be useful for tests), but it is a literal divergence similar in nature to the AC #2a issue (just lower impact). In a process that values exactness in scaffolds, small divergences compound review ambiguity.
   - Suggested fix: If you want to align literally, change to:
```ts
const STARTUP_TIME = Date.now();
```
and leave only `export { app };`.
If you keep the export, update the party/spec commentary to explicitly allow it (to avoid future “AC is literal vs semantic” confusion).

## Strengths

- AC #1 dependency ranges match the spec exactly in `apps/tournament-api/package.json` (hono ^4, drizzle-orm ^0.45.1, @libsql/client ^0.17, vitest ^3, etc.).
- `/api/health` implementation and Vitest smoke test align with AC #2 (status ok + integer startupTime > 0, exercised via `app.request` without spawning a server).
- No `bcrypt` / `@types/bcrypt` present (AC #3).
- DB scaffold matches AC #4: `file:`-prefixed libsql URL in `src/db/index.ts` and `drizzle.config.ts`, and `schema: './src/db/schema/*'` glob.
- ESLint engine-boundary `no-restricted-imports` rule matches AC #6 verbatim and correctly blocks `@wolf-cup/engine` and all subpaths except `/stableford`.

## Warnings

None.
