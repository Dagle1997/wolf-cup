# Codex Review

- Generated: 2026-04-27T15:16:35.246Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/ghin-client.ts, apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/routes/players.ts, apps/tournament-api/src/routes/players.test.ts, apps/tournament-api/src/app.ts, apps/tournament-api/PORTS.md, apps/tournament-api/.env.example, docker-compose.yml

## Summary

Implementation largely matches the listed acceptance criteria: ported GHIN client exports a null-or-client singleton, 20-min token cache and error throws are preserved, env vars are optional with no Zod defaults, /api/players router is mounted, endpoints are requireSession-gated and return the expected status/code mappings, and there are 10+ route tests using the mutable getter vi.mock pattern.

Main gap vs your stated “PATH ALLOWLIST (only the 8 listed paths)” is that a 9th path (players route tests) is present in the provided changed files.

Overall risk: medium

## Findings

1. [medium] Path allowlist mismatch: extra file outside the 8 listed paths appears to be added/changed
   - File: apps/tournament-api/src/routes/players.test.ts:1-282
   - Confidence: high
   - Why it matters: Your review constraints explicitly call out an allowlist of “only the 8 listed paths.” The provided change set includes a 9th file (route tests) not in that list. Even though tests are required by AC #9, this is still a concrete mismatch against the stated gating/process requirement and can cause spec-gate churn if enforcement is strict.
   - Suggested fix: Update the story/allowlist to include `apps/tournament-api/src/routes/players.test.ts` (or whatever exact test path is expected) so the change set aligns with the stated constraint. No code change needed if the policy is updated.

2. [low] Test case description claims organizer but seeded player is non-organizer
   - File: apps/tournament-api/src/routes/players.test.ts:105-126
   - Confidence: high
   - Why it matters: The test name says “organizer + valid name” but `seedSession()` creates `isOrganizer: false` (line 57). This doesn’t break behavior (routes are only requireSession-gated per AC), but it’s misleading and could confuse future readers about intended authorization.
   - Suggested fix: Rename the test to remove “organizer” (or set `isOrganizer: true` in the seed for that test if you intended to assert organizer-only behavior).

## Strengths

- AC#1: `ghinClient` is correctly `env.GHIN_USERNAME && env.GHIN_PASSWORD ? new GhinDirectClient(...) : null` (apps/tournament-api/src/lib/ghin-client.ts:122-125) and provenance header includes SHA/date/scope/deltas (lines 1-15).
- AC#2: 20-minute token TTL preserved (ghin-client.ts:68) and error throws GHIN_AUTH_FAILED / GHIN_UNAVAILABLE / NOT_FOUND are present (lines 63-66, 86-89, 113-116).
- AC#3: `GHIN_USERNAME`/`GHIN_PASSWORD` added as `z.string().optional()` with a multi-line explanatory comment and no defaults (env.ts:110-120).
- AC#4: PORTS.md table has required columns; first row is ghin-client; WV hardcode called out in Deltas column (PORTS.md:7-10).
- AC#5: .env.example documents GHIN vars and the “empty → 503” behavior (apps/tournament-api/.env.example:36-40).
- AC#6: /search and /lookup are requireSession-gated; null-client → 503 ghin_unavailable; lookup NOT_FOUND → 404 ghin_not_found; other errors → 503 (players.ts:34-137).
- AC#7: app mounts `app.route('/api/players', playersRouter)` (app.ts:50-53).
- AC#8: docker-compose adds GHIN env lines with empty fallback `${VAR:-}` under tournament-api.environment (docker-compose.yml:76-81).
- AC#9: 14 route tests present and use a getter-based mutable vi.mock wrapper with beforeEach/afterEach resets to avoid cross-test leakage (players.test.ts:21-39, 85-103, 104-281).
- AC#14: Only one shared file shown as modified is docker-compose.yml (per provided diff).

## Warnings

None.
