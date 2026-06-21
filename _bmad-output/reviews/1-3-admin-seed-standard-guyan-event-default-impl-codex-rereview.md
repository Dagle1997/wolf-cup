# Codex Review

- Generated: 2026-06-21T22:34:25.027Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/standard-guyan-seed.ts, apps/tournament-api/src/services/game-config-write.ts, apps/tournament-api/src/services/resolve-game-config.ts, apps/tournament-api/src/services/game-config-write.test.ts, apps/tournament-api/src/services/resolve-game-config.test.ts

## Summary

The main fixes you described are present in the provided code: (1) Standard Guyan seeding now uses deterministic PKs with `onConflictDoNothing()` + re-select (idempotent under concurrency), (2) `seedOrUpdateEventGameConfig` validates the candidate config + denormalized columns before any writes/side-effects, and (3) the resolver now guards JSON parsing and surfaces corrupt config as `{ok:false, kind:'unsettleable', reason:'corrupt_config'}` rather than throwing.

Remaining risks are mostly around unguarded `JSON.parse` in the write/seed paths (can still 500 if DB contains corrupt JSON) and a mismatch between the stated “DB-seeded source of truth” contract and the write path currently building configs from the in-code constant rather than the seeded revision’s `config_json`.

Overall risk: medium

## Findings

1. [medium] Write path can still throw/500 on corrupt existing event config (unguarded JSON.parse)
   - File: apps/tournament-api/src/services/game-config-write.ts:92-97
   - Confidence: high
   - Why it matters: If an existing `game_config` row’s `config_json` is non-JSON (or otherwise causes `JSON.parse` to throw), `seedOrUpdateEventGameConfig` will throw instead of returning `{ ok:false, reason: ... }`. That turns a single corrupt row into a persistent 500/DoS for updates to that event, and it bypasses the function’s fail-closed error contract (even though it still avoids side effects because it happens before writes).
   - Suggested fix: Wrap `JSON.parse(existing.configJson)` in try/catch and return a structured failure (e.g. `{ ok:false, reason:'existing_config_corrupt' }`), or reuse the resolver-style helper that returns `'corrupt'` when parsing/schema validation fails.

2. [medium] Preset seed can still throw/500 if the seeded revision’s config_json is corrupt (unguarded JSON.parse)
   - File: apps/tournament-api/src/services/standard-guyan-seed.ts:126-139
   - Confidence: high
   - Why it matters: `seedStandardGuyan` re-selects the revision and does `JSON.parse(rev[0].configJson)` without a try/catch. If the DB row is corrupted (manual edit, bad migration, etc.), this will throw. Because `seedOrUpdateEventGameConfig` calls `seedStandardGuyan` after validation, a corrupt preset row can brick config writes with a 500 even though the candidate config is otherwise valid.
   - Suggested fix: Guard the JSON parse (try/catch) and throw a clearer error or return a typed failure. If you want to keep exceptions, throw an explicit `seedStandardGuyan: seeded revision config is non-JSON` rather than letting a raw `SyntaxError` bubble.

3. [medium] Event config is built from the in-code base constant, not from the seeded revision config_json (source-of-truth drift risk)
   - File: apps/tournament-api/src/services/game-config-write.ts:81-114
   - Confidence: high
   - Why it matters: The story/header comments (and `standard-guyan-seed.ts` doc) state the DB-seeded revision is the single source of truth and the write path reads it and overlays organizer deltas. However, `seedOrUpdateEventGameConfig` currently builds `candidate` from `STANDARD_GUYAN_BASE_CONFIG` (code constant) and never uses `preset.baseConfig` returned by `seedStandardGuyan`. This creates drift risk if the seeded revision differs from the constant (e.g., hotfix to DB seed, partial seed, manual correction), and it undermines provenance because `seedRuleSetRevisionId` is recorded while the actual base used came from code.
   - Suggested fix: After validating user-provided deltas (e.g., validate `pointValueSchedule`/`lockState` inputs independently), load the base from the seeded revision (`seedStandardGuyan(...).baseConfig`) and build/validate the candidate from that. Alternatively, if you must validate the full candidate before any seeding write, first attempt a read-only load of the deterministic revision id; if present, use it as base; if absent, only then seed after input-level validation.

4. [low] `created` flag in seedStandardGuyan is race-prone under concurrency
   - File: apps/tournament-api/src/services/standard-guyan-seed.ts:89-96
   - Confidence: high
   - Why it matters: Two concurrent callers can both observe `before[0] === undefined` and return `created: true` even though only one actually inserted the row. That’s not a data integrity issue (PK idempotence still holds), but it can mislead callers/telemetry if they rely on `created` for behavior.
   - Suggested fix: Compute `created` based on insert result/returning (if supported), or re-check after insert (e.g., check `changes()`/rowcount), or document that `created` is best-effort under concurrency.

5. [low] Resolver has a small TOCTOU gap: pairing existence is validated then re-queried later and silently skipped if missing
   - File: apps/tournament-api/src/services/resolve-game-config.ts:74-130
   - Confidence: medium
   - Why it matters: `resolveEventGameConfig` validates the pairing exists for `(eventRoundId, foursomeNumber)` (lines 79–93), but later re-queries pairings (lines 110–122). If the pairing disappears between the two reads (when using `db` rather than a transaction), the function will proceed without loading the foursome-level row instead of returning the earlier hierarchy error. This is unlikely but can lead to confusing resolution behavior.
   - Suggested fix: Reuse the pairing id from the validation query (store it) and avoid the second lookup, or require callers to pass a `tx` for consistent reads.

## Strengths

- Seeding is now structurally idempotent: deterministic IDs + `onConflictDoNothing()` + re-select prevents duplicate `rule_sets` under concurrent calls (standard-guyan-seed.ts:84–141).
- Write path now validates the candidate config and checks denormalized columns consistency before any inserts/updates/audit/activity emissions, so invalid input produces no committed side effects (game-config-write.ts:81–128; asserted by test at game-config-write.test.ts:150–166).
- Resolver now guards JSON.parse and treats both non-JSON and schema-invalid JSON as corrupt, surfacing a typed unsettleable error rather than throwing (resolve-game-config.ts:169–177; asserted by resolve-game-config.test.ts:200–213).

## Warnings

None.
