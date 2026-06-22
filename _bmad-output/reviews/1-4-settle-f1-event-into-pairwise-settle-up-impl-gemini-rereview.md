# Gemini Review

- Generated: 2026-06-21T23:50:28.118Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/services/pin-round-at-start.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/services/games-money.disjointness.test.ts

## Summary

The re-review verifies that the previous safety/isolation issues (missing handicap treated as scratch, live fallback on missing pin, engine crashes) have been addressed effectively at the settlement core (games-money.ts). However, the read-only presentation paths (leaderboard and money-detail) replicate the F1 per-hole stroke allocation without the try/catch isolation that was added to games-money.ts. As a result, corrupt data (e.g., float handicaps or out-of-bounds course stroke indexes) will still cause 500 errors and crash the event-wide presentation APIs.

Overall risk: medium

## Findings

1. [high] Uncaught `allocateStrokesFromCourseHandicap` throws crash F1 leaderboard API
   - File: apps/tournament-api/src/services/leaderboard.ts:466-471
   - Confidence: high
   - Why it matters: The isolation fix in `games-money.ts` successfully wrapped `allocateStrokesFromCourseHandicap` because it intentionally throws on corrupt pins (non-integer `ch`) or bad course data (out-of-bounds `si`). However, `leaderboard.ts` invokes the identical function on the exact same DB data without a try/catch. A corrupt pin or missing/bad course hole will throw an unhandled error, taking down the entire event's leaderboard API (500 crash).
   - Suggested fix: Wrap `allocateStrokesFromCourseHandicap` in a `try/catch`. On catch, set `netComputable = false` and `break;` so the player safely degrades to an unscored/null net. Additionally, tightening `ch` in `perPlayerHandicapsSchema` to use `z.number().int().nullable()` would structuraly reject floats on read.

2. [high] Uncaught `allocateStrokesFromCourseHandicap` throws crash F1 money-detail API
   - File: apps/tournament-api/src/services/money-detail.ts:448-451
   - Confidence: high
   - Why it matters: Similar to the leaderboard issue, the F1 money-detail path calls `allocateStrokesFromCourseHandicap` without a try/catch. If a foursome encounters a float `ch` (which the Zod schema technically permits) or an out-of-bounds `si`, the function throws. This will crash the `/foursome-results` API (and subsequently the viewer's My Money page), defeating the blast-radius isolation requirement.
   - Suggested fix: Wrap the `gross - allocateStrokesFromCourseHandicap(ch, si)` calculation in a `try/catch`. Fall back to `net = null` if the allocation throws.

## Strengths

- Dual-read routing appropriately separates the F1 calculations from legacy behavior, ensuring zero double-counting (AC10).
- Missing handicap (`null`) check gracefully marks affected foursomes as `missing_handicap` (unsettleable) and protects them from erroneously settling as scratch.
- The core money settlement path (`games-money.ts`) successfully wraps the net-build and engine invocations in robust try/catch blocks, ensuring event-wide calculations won't fail due to individual bad data.
- Tenant-isolation has been meticulously added to the round_pins queries, closing cross-tenant leakage risks.

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/money-detail.ts
