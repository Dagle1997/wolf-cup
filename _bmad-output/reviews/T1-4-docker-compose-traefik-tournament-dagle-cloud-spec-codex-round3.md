# Codex Review

- Generated: 2026-04-20T18:31:07.207Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md

## Summary

Spec is much tighter than round 2 (Corepack/pnpm pinning + manifest COPY set + semantic nginx.conf ACs are solid). However, there is a remaining internal contradiction around whether engine *source* is copied at all, and that contradiction can directly cause a dev-agent to implement the wrong Dockerfile shape. There are also a couple of brittleness/verification issues that could unnecessarily block implementation or acceptance.

Overall risk: high

## Findings

1. [high] Contradiction: spec says engine source is NOT copied, but Dockerfile steps REQUIRE copying packages/engine/
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:23-45
   - Confidence: high
   - Why it matters: AC #1 explicitly frames `packages/engine/package.json` as a workspace-graph manifest copy and later states engine source/build artifacts are NOT copied (line 43), but the builder-stage source COPY step includes `COPY packages/engine/ ./packages/engine/` (line 25). That is engine source. This is a direct, in-file contradiction that will confuse implementation and can lead to either (a) a Dockerfile that violates the documented “deliberate divergences” section, or (b) a Dockerfile that omits engine files and then fails if any build tooling/workspace resolution expects them.
   - Suggested fix: Pick one and make it consistent across AC #1 and the divergence notes:
- If the intent is truly “do not copy engine source”, remove `COPY packages/engine/ ./packages/engine/` from builder-stage source copies (AC #1 line 25; AC #2 line 58) and keep only `packages/engine/package.json`.
- If copying engine source is acceptable/desired for parity, then update the divergence bullets to say “engine is copied but not built / dist not copied”, and remove wording implying engine source is not copied (line 43; similarly line 70).

2. [medium] Runtime-stage `pnpm install --prod` may still require engine workspace contents if @wolf-cup/engine is a prod dependency
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:32-43
   - Confidence: medium
   - Why it matters: Runtime stage installs production deps from the workspace (line 33) but the spec’s intent is to avoid engine source/dist in the image (lines 41–43). If `apps/tournament-api/package.json` (or its transitive deps) includes `@wolf-cup/engine` as a production dependency via `workspace:*`, pnpm can require more than just the engine’s `package.json` to correctly link/install, and the app could fail at runtime if it ever resolves that import. The spec asserts “Tournament-api does not import from @wolf-cup/engine at T1.4” (line 41), but does not explicitly require that `@wolf-cup/engine` is absent from prod dependencies.
   - Suggested fix: Add an explicit guard to AC #1 (or Dev Notes) such as: “`apps/tournament-api/package.json` MUST NOT list `@wolf-cup/engine` under `dependencies` at T1.4; if it does, this story must either copy engine dist into runtime or remove that dependency.” Alternatively, if you want maximal safety, copy only what’s needed (engine dist) when it is a prod dep, and keep the ‘no engine build’ optimization conditional.

3. [medium] Traefik label count requirement (“exactly seven entries”) is unnecessarily brittle and may block implementation if upstream compose differs
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:113-123
   - Confidence: high
   - Why it matters: Requiring “exactly seven entries” ties this story to a very specific existing compose state (referencing `docker-compose.yml:54-61`, which is not in this artifact). If Wolf Cup’s compose labels change (e.g., adding middleware headers, compression, or redirect labels), this AC can fail even when routing is correct. This is especially risky given the story’s goal is “without disrupting Wolf Cup’s routing” and with a strict additive diff requirement (AC #12).
   - Suggested fix: Relax to “must include at least these required labels” (enable, docker.network, router rule/entrypoints/tls/certresolver, service port) and allow additional labels. If you want parity, state “match Wolf Cup’s web labels set” without hard-coding the count.

4. [low] AC #9 claims “runtime stage boots” but only runs `docker compose build`
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:145-146
   - Confidence: high
   - Why it matters: `docker compose build` validates image build success but does not start containers. As written, the AC asserts more than the command proves, which can create acceptance ambiguity.
   - Suggested fix: Reword AC #9 to only assert build success, or add an optional local run step (e.g., `docker compose up -d tournament-api tournament-web` and a local curl) if you truly want a “boots” claim locally.

## Strengths

- Corepack/pnpm pinning is explicitly required in every stage that runs pnpm, closing a common monorepo Docker failure mode (AC #1/#2).
- Manifest-first COPY sets are detailed enough to be reproducible and cache-friendly, and they explicitly include `packages/engine/package.json` for workspace graph resolution.
- Nginx.conf AC moved from brittle line-count matching to a semantic directive checklist (good improvement).
- Compose changes are well-scoped: separate volume for tournament DB, internal-only API, Traefik routing only on web, and explicit regression guards for Wolf Cup services (AC #7/#12/#13).

## Warnings

None.
