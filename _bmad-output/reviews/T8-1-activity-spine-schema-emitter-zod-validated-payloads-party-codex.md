# Codex Review

- Generated: 2026-05-06T01:58:51.871Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T8-1-activity-spine-schema-emitter-zod-validated-payloads-party-review.md, apps/tournament-api/src/engine/types/activity-events.ts, apps/tournament-api/src/lib/activity.test.ts

## Summary

Spot-check of the party review against the provided code (activity-events.ts + activity.test.ts) supports the PASS verdict. The 13 activity variants exist, ACTIVITY_TYPES matches them, per-variant Zod schemas are `.strict()` with concrete numeric ranges, and tests exercise valid/invalid payloads plus the press XOR refine, rollback, and an FK-negative assertion. Party “v1.5 followups” remain advisory and do not (as written) propose forbidden Wolf Cup or SHARED edits.

Two small, evidence-backed concerns remain: the FK-negative test’s matcher can produce false positives if future insert failures occur for non-FK reasons, and one comment about re-setting PRAGMA foreign_keys in beforeAll doesn’t match the actual code. Neither blocks sign-off today, but they’re worth tracking as Quinn/Amelia suggested.

Overall risk: low

## Findings

1. [low] FK-negative test matcher can become a false positive as schema evolves
   - File: apps/tournament-api/src/lib/activity.test.ts:410-420
   - Confidence: high
   - Why it matters: The FK enforcement test asserts only that the error message matches `/Failed query: insert into "activity"/`. That would also match many other insert failures (e.g., a future NOT NULL column without default, a CHECK constraint, unique constraint, etc.). In that scenario, the test could still pass without actually proving “FK enforcement on tx connection,” which is what the test name/comment claim.
   - Suggested fix: Tighten the assertion to check the underlying cause chain/message for an FK signal (e.g., `FOREIGN KEY`), or assert on an error code if exposed (SQLITE_CONSTRAINT_FOREIGNKEY). This aligns with the party followup suggestion.

2. [low] Comment claims PRAGMA foreign_keys is re-set in beforeAll, but code does not
   - File: apps/tournament-api/src/lib/activity.test.ts:38-41
   - Confidence: high
   - Why it matters: The mock comment says FK enforcement is re-set from the beforeAll hook, but no such PRAGMA call exists in beforeAll. This can mislead future maintainers when debugging libsql/drizzle multi-connection behavior (which is already subtle and called out elsewhere in the file).
   - Suggested fix: Either remove/adjust the comment, or actually re-run `PRAGMA foreign_keys = ON` in `beforeAll` (which would require importing/exposing the mocked `client`).

## Strengths

- Party review’s persona claims that are verifiable from code are accurate: Sally’s note that `subgame.computed` has no winner identifiers (apps/tournament-api/src/engine/types/activity-events.ts:115-122, 331-341) and Quinn’s brittleness framing of the FK matcher (apps/tournament-api/src/lib/activity.test.ts:410-420).
- ACTIVITY_TYPES enumerates exactly 13 variants and matches the ActivityEvent union (apps/tournament-api/src/engine/types/activity-events.ts:143-174).
- All per-variant Zod schemas are `.strict()` and enforce concrete numeric ranges; cross-field consistency on score.committed is present (apps/tournament-api/src/engine/types/activity-events.ts:192-219).
- Integration tests are comprehensive for this layer: per-type valid insert + per-type invalid parse failure, unknown-key strictness, discriminator invalidity, press XOR refine, rollback behavior, and an FK-negative assertion (apps/tournament-api/src/lib/activity.test.ts:262-434).
- No party “v1.5 followups” in the provided markdown propose edits in forbidden roots (apps/api, apps/web, packages/engine) or SHARED; they’re framed as optional polish.

## Warnings

None.
