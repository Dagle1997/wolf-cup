# Codex Review

- Generated: 2026-04-20T18:27:48.948Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md

## Summary

Round-1 fixes addressed the two prior high-severity contradictions (Traefik label count and CMD/entrypoint evidence) cleanly. The spec is close to gate-ready, but there’s still one implementability risk: the Dockerfile requirements are under-specified around how pnpm is made available and how production deps are installed in the runtime stage. If implemented “literally” without copying the right manifests/lockfile and enabling corepack/pnpm, builds can fail or the runtime container can boot without required deps. A couple of smaller ambiguities/brittleness issues remain.

Overall risk: medium

## Findings

1. [high] Dockerfile ACs under-specify pnpm availability + runtime production install inputs (risk: build failure or missing runtime deps)
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:15-20
   - Confidence: high
   - Why it matters: AC #1 and #2 require `pnpm install ...` in builder and (for API) `pnpm install --frozen-lockfile --prod` in the runtime stage, but they don’t explicitly require the steps/files that make this work reliably in a multi-stage monorepo image:
- Node images do not guarantee `pnpm` is available unless you enable Corepack (`corepack enable`) or install pnpm globally; if the implementer misses this, the Docker build fails (`pnpm: not found`).
- A runtime-stage `pnpm install --frozen-lockfile --prod` requires that the runtime stage has the relevant lockfile + workspace manifests + the package.json set needed for dependency resolution. The AC describes copying some manifests into the builder for layer caching, but it does not state what must be copied into the runtime stage before running the production install (or alternatively that `node_modules` should be copied from the builder).
Because the spec is prescriptive (“mirrors shape”) but not explicit on these critical mechanics, two reasonable implementations could both “look like” the intended shape while one is broken at build/runtime.
   - Suggested fix: Make the Dockerfile acceptance criteria explicitly inherit the working Wolf Cup pattern for pnpm/runtime deps, e.g. require one of:
- (Preferred, if Wolf Cup does this) `corepack enable` in any stage that runs pnpm, and in the runtime stage copy `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` (+ any needed workspace package.json files) before `pnpm install --prod`, OR
- copy the pruned `node_modules` from builder to runtime (or use `pnpm deploy --prod` if that’s the established repo pattern).
Also explicitly call out that the runtime stage must have pnpm available (via Corepack or install).

2. [medium] Potential spec ambiguity: “Engine package is NOT copied” vs “copies packages/engine/package.json for layer-cache”
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:17-20
   - Confidence: medium
   - Why it matters: AC #1 says the builder copies `packages/engine/package.json` for caching, then later states “Engine package is NOT copied into the tournament-api runtime image…”. That’s likely intended (manifest-only vs source/build output), but the wording can be read as contradictory and may cause an implementer to remove the engine manifest copy (potentially breaking pnpm workspace resolution, depending on how the repo is wired).
   - Suggested fix: Clarify terminology: e.g., “Engine *source/build artifacts* are not copied or built; copying `packages/engine/package.json` is allowed/required only as a workspace manifest for pnpm layer caching and dependency graph resolution.”

3. [medium] Nginx.conf acceptance criteria are brittle (“53 lines” / “all other blocks identical”) and can block implementation unnecessarily
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:21-25
   - Confidence: high
   - Why it matters: AC #3 pins an exact line count and “all other blocks identical” to the current root nginx.conf. If the root nginx.conf changes slightly (even whitespace/comments or an unrelated improvement), this story becomes impossible to satisfy without rework, despite still being functionally correct. This is a spec-gate risk rather than a runtime bug.
   - Suggested fix: Replace “53 lines”/“identical” with a semantic checklist of required directives/locations (which you already largely have) and allow harmless differences like comments/formatting. Keep the key divergence (`proxy_pass tournament-api`) as the hard requirement.

4. [low] AC #10 shows a JSON example using single quotes (not valid JSON)
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:78-80
   - Confidence: high
   - Why it matters: You say “JSON body satisfying …” but the example uses `{ status: 'ok', ... }`. It’s clear what you mean, but it can create unnecessary debate during verification if someone interprets it strictly.
   - Suggested fix: Change to valid JSON shape, e.g. `{ "status": "ok", "startupTime": <positive integer> }` (or describe it as an object shape, not “JSON”).

## Strengths

- Round-1 fixes removed the prior label-count contradiction; the label block is now precise (“exactly seven entries”) and self-contained (lines 44-53).
- CMD/entrypoint rationale is now grounded in stated scaffold evidence and includes a clear fail-fast instruction to avoid papering over upstream scaffold issues (line 17).
- Compose change safety rails are strong: explicit ‘SHARED path’ approval gate, additive-only diff requirement, and ‘byte-unchanged’ guard for Wolf Cup services (lines 26-33, 69-72, 84-86).
- Clear isolation story (separate volume + internal-only API) and explicit non-scope boundaries reduce risk of accidental Wolf Cup disruption (lines 34-37, 118-133, 153-160).

## Warnings

None.
