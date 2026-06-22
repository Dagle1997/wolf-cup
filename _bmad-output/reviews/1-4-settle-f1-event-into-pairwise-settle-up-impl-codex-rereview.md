# Codex Review

- Generated: 2026-06-21T23:48:31.103Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/services/pin-round-at-start.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/services/games-money.disjointness.test.ts

## Summary

The core Story 1.4 invariants you called out appear to hold: for F1-classified events, both leaderboard net computation and money-detail foursome results route through pinned inputs and explicitly fail-close when a round lacks a valid pin; games-money settles per-foursome with isolation and no live-HI/course fallback; and roundPins reads are tenant-scoped in the reviewed files.

One money-safety gap remains: leaderboard.ts and money-detail.ts call allocateStrokesFromCourseHandicap on the pinned path without guarding against its documented throw conditions, and the pin schema currently allows non-integer / out-of-range CH values (finite but invalid). That means a “schema-valid but engine-invalid” pin can still crash read endpoints (leaderboard and /foursome-results), violating the intended fail-closed behavior for corrupt pins (availability + determinism risk).

Overall risk: medium

## Findings

1. [high] Pinned F1 read paths can still throw (not fail-closed) if pinned CH/SI are finite-but-invalid
   - File: apps/tournament-api/src/services/leaderboard.ts:381-473
   - Confidence: high
   - Why it matters: You explicitly rely on `allocateStrokesFromCourseHandicap` throwing on invalid inputs (games-money.ts documents this), and you rely on pins being “fail-closed” when corrupt. However, leaderboard’s F1 net path does not wrap `allocateStrokesFromCourseHandicap(ch, si)` in a try/catch. Because `perPlayerHandicapsSchema` only enforces `.finite()` (not integer/range), a pin can be JSON-parseable + Zod-valid but still contain a fractional/invalid CH (or a course hole SI that is out of range). In that case, leaderboard computation can hard-throw and 500 the endpoint instead of returning `netThroughHole: null`.

This is a money-safety risk in practice because it reintroduces “bad pin breaks read surfaces” (availability/operability) and breaks the stated invariant that corrupt pins fail-close rather than crash. It also makes behavior inconsistent with games-money.ts, which correctly isolates these throws per foursome.
   - Suggested fix: Fail-close on allocation exceptions in leaderboard’s F1 branch:
- Wrap the per-hole loop (or the single call) in try/catch; on error set `netComputable=false` and break.
- Additionally (recommended), tighten validation at ingestion by making pinned `ch` an integer: change `perPlayerHandicapsSchema` to `z.number().int().finite().nullable()` (and consider range checks if your allocator expects bounds).

Also apply the same guard in money-detail’s F1 per-hole net display (see next note).

2. [high] F1 /foursome-results per-hole net display can throw on invalid pinned CH/SI (no try/catch)
   - File: apps/tournament-api/src/services/money-detail.ts:369-452
   - Confidence: high
   - Why it matters: `computeF1FoursomeResults` computes per-hole net with `gross - allocateStrokesFromCourseHandicap(ch, si)` (line ~449–451) without guarding against allocator throws. Just like the leaderboard, pins can pass `perPlayerHandicapsSchema` while still having a non-integer CH, and course hole SI can be corrupted. That would 500 this endpoint even though the intended behavior for corrupt/incomplete pins is “fail-closed / unsettleable / zeroed,” not a crash.

While dollars are gated (you zero totals unless flag-on + locked), this is still a money-safety reliability issue: a single corrupt pin can take down the money presentation surface instead of returning safe-null nets/zeros.
   - Suggested fix: Wrap the net calculation in try/catch and set `net: null` when allocation fails. Pair with tightening `perPlayerHandicapsSchema` to require integer `ch` to prevent these pins from being treated as valid in the first place.

3. [medium] Leaderboard F1 net may include hole_scores beyond holesToPlay, diverging from settlement’s holes-in-play filter
   - File: apps/tournament-api/src/services/leaderboard.ts:392-475
   - Confidence: medium
   - Why it matters: games-money.ts explicitly filters course holes to `holeNumber <= er.holesToPlay` before building `siByHole` and ignores scores with SI missing (games-money.ts lines ~242–244, 390–392). In contrast, leaderboard’s `loadF1RoundPins` loads SI for all holes in the pinned course revision (no holesToPlay filter), and the F1 net sum iterates over whatever hole_scores exist in `perRoundHoleGross`.

If hole_scores rows exist outside the round’s intended holes_to_play (data corruption, UI bug, or late scoring edits), the leaderboard could compute an F1 net that includes those extra holes while settlement correctly ignores them. That breaks the stated “leaderboard net matches settled money” expectation for F1.
   - Suggested fix: Carry `holesToPlay` into the F1 pin context and filter:
- In `loadF1RoundPins`, join `rounds -> eventRounds` to fetch `holesToPlay` per roundId.
- Either restrict `siByHole` to holes `<= holesToPlay`, or during net summation ignore holeNumbers `> holesToPlay`.

This keeps leaderboard F1 net aligned with settlement’s definition of holes-in-play.

## Strengths

- F1 routing/fail-closed ordering in leaderboard net computation is correct: once `isF1Event` is true, missing/invalid pin contexts prevent any legacy `calcCourseHandicap` fallback (leaderboard.ts ~441–485).
- games-money.ts provides true per-foursome blast-radius isolation: `settleFoursome` is called inside a try/catch, and allocation + engine calls are also protected (games-money.ts ~259–295, 386–418).
- Pinned handicap null-handling on the F1 path avoids silent `null -> 0` coercion: F1 readers treat missing/`null` pinned CH as non-computable rather than scratch (games-money.ts ~343–358; leaderboard.ts ~385–390, 446–452; money-detail.ts ~376–379, 445–451).
- All reviewed roundPins reads are tenant-scoped (games-money.ts ~188–197; leaderboard.ts ~363–371; money-detail.ts ~361–368).
- /foursome-results dual-read routing for F1 events avoids legacy 2v2 money computation entirely by early-returning into the F1 builder (money-detail.ts ~126–134).

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/money-detail.ts
