# Codex Review

- Generated: 2026-04-20T18:25:21.798Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md

## Summary

Spec is generally concrete and scope-disciplined (explicit allow/forbid, additive-only compose edits, isolation via separate volume, internal-only API). Two issues stand out: (1) an internal contradiction in Traefik label count/text, and (2) a forward-reference risk where the API Dockerfile is over-specified to `dist/index.js` without proving the T1-2 scaffold actually emits that path/name. There are also a couple deploy-time reliability risks (depends_on not waiting for health; healthcheck tooling assumptions) that are acceptable if explicitly acknowledged.

Overall risk: medium

## Findings

1. [high] Contradictory Traefik label count/spec text (six vs seven labels)
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:44-55
   - Confidence: high
   - Why it matters: This is a concrete inconsistency inside the acceptance criteria: line 44 says “labels: six entries”, the code block shows 7 labels, and line 54/55 also conflicts (“Seven labels total with … — same count as Wolf Cup’s block.”). A dev-agent can ‘pass’ one interpretation while failing another, and reviewers won’t have a single source of truth to validate against.
   - Suggested fix: Make AC #4.7 consistent by stating the exact number and listing them once. If the intended count is 7, change “six entries” to “seven entries” and remove the parenthetical ambiguity at line 54/55, or vice versa. Also verify the Wolf Cup block count and explicitly match it (“exactly N labels, listed below”).

2. [high] API Dockerfile is tightly pinned to `node dist/index.js` without evidence the scaffold outputs that exact entrypoint
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:15-18
   - Confidence: medium
   - Why it matters: AC #1 requires `CMD [
   - Suggested fix: In the story, cite the exact T1-2 scaffolded output/tsconfig/build script behavior (e.g., from the referenced T1-2 artifact) and confirm the emitted file path. If uncertain, loosen the AC to “CMD runs the built API entrypoint produced by `pnpm --filter @tournament/api build`” and explicitly define where `tsc` outputs (e.g., `outDir=dist` and `rootDir=src`, producing `dist/index.js`).

3. [medium] Healthcheck tooling assumption: `wget -qO-` compatibility on node:22-alpine should be explicitly verified
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:36-37
   - Confidence: medium
   - Why it matters: The spec asserts “Alpine ships wget by default” (line 128), but on Alpine this is typically BusyBox `wget`, and option compatibility (`-qO-` combined flags) can differ from GNU wget depending on image contents. If the healthcheck fails, Compose will mark the container unhealthy even if the API works, complicating deploy diagnostics.
   - Suggested fix: In Dev Notes/AC, either (a) explicitly state that BusyBox wget in node:22-alpine supports the exact flags (and was tested), or (b) use a more universally compatible healthcheck (e.g., `wget -q -O - ...` with separated flags) or install curl explicitly (though that adds surface/size).

4. [medium] depends_on condition does not wait for API readiness; first deploy may intermittently serve 502 until API is up
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:42-43
   - Confidence: high
   - Why it matters: `condition: service_started` only ensures the container starts, not that `:3000/api/health` is reachable. On cold start (first boot, dependency install quirks, sqlite file creation), nginx may proxy to an unavailable upstream briefly, causing transient 502s right after deploy and potentially failing a quick post-deploy curl if run immediately.
   - Suggested fix: If you want to mirror Wolf Cup, keep it—but explicitly document expected transient behavior and recommend waiting for health before validating. Alternatively, switch to `service_healthy` (if supported in your Compose version) to align with the presence of a healthcheck, but that would diverge from the stated parity goal.

5. [low] Potential container_name collision risk on a shared VPS
   - File: _bmad-output/implementation-artifacts/tournament/T1-4-docker-compose-traefik-tournament-dagle-cloud.md:28-33
   - Confidence: medium
   - Why it matters: Forcing `container_name: tournament-api` / `tournament-web` can conflict with any other Compose project or manually-run container using the same names on the host. This is especially relevant on a ‘sibling apps’ VPS where multiple stacks may coexist.
   - Suggested fix: If explicit names are required, consider prefixing with the compose project (e.g., `wolf-cup-tournament-api`) or omit `container_name` and rely on Compose’s scoped naming. If you must keep as-is per AC, at least add a note calling out the collision risk and confirming no other containers use those names on the VPS.

## Strengths

- Clear scope discipline and path boundaries (explicit ALLOWED/SHARED/FORBIDDEN lists) with a hard-stop approval gate for docker-compose.yml (lines 101-106).
- Isolation intent is well-specified: separate named volume (`tournament_sqlite_data`) and internal-only API network posture reduce accidental cross-app data exposure (lines 33-37, 55-58).
- Acceptance criteria are operationally testable (`docker compose config`, build commands, post-deploy curl) and explicitly distinguish local vs VPS verification (lines 72-80).
- Explicitly avoids forward-feature creep (no migrations/seed, no env sprawl, no deploy.sh/CI edits) which reduces regression risk for Wolf Cup.

## Warnings

None.
