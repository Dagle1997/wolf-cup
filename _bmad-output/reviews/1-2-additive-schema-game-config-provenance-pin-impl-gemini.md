# Gemini Review

- Generated: 2026-06-21T21:41:15.647Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/game-config.ts, apps/tournament-api/src/db/schema/round-pins.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/services/pin-round.ts, apps/tournament-api/src/db/migrations/0019_true_king_cobra.sql, apps/tournament-api/src/db/schema/game-config.test.ts, apps/tournament-api/src/services/pin-round.test.ts

## Summary

The implementation correctly introduces the additive tables (`game_config` and `round_pin`), avoids expensive CHECK constraints, and guarantees atomicity/idempotency for the round-pin writer via a well-constructed `ON CONFLICT DO NOTHING` query. However, there are data integrity gaps where raw/unvalidated data can bypass Zod protections before being stored in the database.

Overall risk: medium

## Findings

1. [high] Missing Zod validation for per-player handicaps
   - File: apps/tournament-api/src/services/pin-round.ts:40-49
   - Confidence: high
   - Why it matters: Acceptance criteria 6 (AC6) explicitly mandates that the per-player handicaps JSON is Zod-validated. The current code relies solely on TypeScript types and blindly serializes `input.perPlayerHandicaps`, creating a gap where malformed payload data can be persisted directly into the database.
   - Suggested fix: Define a Zod schema (e.g., `z.record(z.string(), z.object({ hi: z.number(), ch: z.number() }))`), parse `input.perPlayerHandicaps` through it, and stringify the validated result instead of the raw input.

2. [medium] Raw config is stringified instead of the Zod-parsed result
   - File: apps/tournament-api/src/services/pin-round.ts:40-45
   - Confidence: high
   - Why it matters: Although `parseGameConfig` uses Zod to validate and cleanly strip unknown keys from the config, the code then uses `JSON.stringify(input.resolvedConfig)` to populate the row. This writes the raw input directly to the DB, meaning any extra or unvalidated properties originally present in the payload will be saved, completely bypassing Zod's structural cleaning.
   - Suggested fix: Change line 45 to use the parsed output: `resolvedConfigJson: JSON.stringify(parsed.config)`.

3. [low] Zod schema looseness allows unknown keys
   - File: apps/tournament-api/src/engine/games/config-schema.ts:13-35
   - Confidence: medium
   - Why it matters: The `gameConfigSchema` and its nested schemas (like `modifierSchema`) use `z.object()` without `.strict()`. While Zod's `.safeParse()` removes unknown keys, the validation itself does not fail closed if structurally incorrect extra data is provided. This looseness violates the strict fail-closed intent.
   - Suggested fix: Append `.strict()` to `gameConfigSchema`, `modifierSchema`, and the objects within `pointValueScheduleSchema` to explicitly reject payloads with unrecognized keys.

## Strengths

- The DB migration strictly adheres to being additive (no ALTER or CHECK constraint rebuilds).
- The pin-round writer excellently handles concurrent immutability with an atomic `ON CONFLICT DO NOTHING` pattern.
- The drift test asserting identical verdicts between structural Zod validation and semantic Engine validation ensures strict alignment.

## Warnings

None.
