# Codex Review

- Generated: 2026-06-21T23:33:16.964Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/services/pin-round-at-start.ts, apps/tournament-api/src/services/money.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/routes/money.ts, apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-api/src/engine/handicap-strokes.ts, apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/services/games-money.test.ts, apps/tournament-api/src/services/games-money.disjointness.test.ts

## Summary

The overall integration direction is solid (single chokepoint, recompute-on-read from pins, dual-read suppression of legacy 2v2, and good integration tests). However, there are several money-critical correctness and safety gaps where F1 reads can fall back to live handicap/course inputs, plus a couple of places where “fail-closed / never throw” is not actually guaranteed. There is also at least one endpoint that can leak (or compute) legacy dollars for an F1 event even when the exposure flag is OFF or the F1 lock state is UNLOCKED.

Overall risk: high

## Findings

1. [critical] Leaderboard F1 net computation falls back to LIVE HI/course when a pin is missing/corrupt/unloaded (violates AC2 + fail-closed)
   - File: apps/tournament-api/src/services/leaderboard.ts:296-463
   - Confidence: high
   - Why it matters: AC2’s money-safety invariant is that F1 reads must never re-derive net using live handicap index or live course tee/rating; they must use the pinned CH + pinned course_revision_id. In `assignRanksAndBuildRows`, if a round has no valid pin context (`f1RoundPins?.get(roundId)` is falsy), the code drops into the legacy path which calls `calcCourseHandicap` using `accum.handicapIndex` and `roundCtxMap` (live tee/rating/slope/par). For an F1 event, a missing/corrupt pin (or a pin not loaded due to query issues) should be fail-closed (net not computable / paused), not silently computed off live data—otherwise settled money can shift invisibly when HI/course data changes.
   - Suggested fix: When the event is F1, do not ever use the legacy net path for any in-scope round. Instead: (a) detect F1 once (you already query `gameConfig` in `loadF1RoundPins`) and return `{ isF1, pinsByRound, unpinnedOrInvalidRoundIds }`; then (b) in `assignRanksAndBuildRows`, if `isF1` and a round is missing/invalid-pin, set `netComputable = false` (or compute gross-only with `netThroughHole:null`) rather than calling `calcCourseHandicap`. Add a test that corrupt/missing pin keeps leaderboard net `null`/paused rather than live-derived.

2. [critical] games-money.ts is not actually “never-throw”/per-foursome isolated: allocateStrokesFromCourseHandicap can throw and crash the whole event compute
   - File: apps/tournament-api/src/services/games-money.ts:328-370
   - Confidence: high
   - Why it matters: `computeF1EventEdges` promises “NEVER throws on bad foursome data” and “per-foursome isolation”. But `settleFoursome` calls `allocateStrokesFromCourseHandicap(ch, si)` without guarding against its exceptions. You only check `Number.isFinite(h.ch)` (not integer) and never validate `si` is an integer in [1,18]. If a pin has non-integer CH (or the schema permits floats), or the pinned course holes have an out-of-range/invalid SI, `allocateStrokesFromCourseHandicap` will throw a RangeError/TypeError and bubble out, causing `/money` to 500 (money page blank) and violating AC11 isolation.
   - Suggested fix: Wrap the per-score allocation block in try/catch and return `{ kind:'unsettleable', reason:'bad_pin'|'bad_course_data', detail:... }` for that foursome on any allocation error. Also tighten validation before calling allocation: require `Number.isInteger(h.ch)` and `Number.isInteger(si)` and `1<=si<=18`. Consider tightening `perPlayerHandicapsSchema` to require integer CH at pin-write time too. Add an integration test with a corrupt pin (e.g., `ch: 6.5` or `si: 19`) asserting `computeF1EventEdges` does not throw and reports `unsettleable` instead.

3. [high] Missing tenant scoping on roundPins reads (cross-tenant data exposure / wrong-pin risk)
   - File: apps/tournament-api/src/services/games-money.ts:186-196
   - Confidence: high
   - Why it matters: `computeF1EventEdges` is described as tenant-scoped on every query, but the `roundPins` lookup filters only by `roundId` and does not include `tenantId`. In multi-tenant scenarios (or even just defense-in-depth), this can read the wrong tenant’s pin if IDs collide or data is mishandled. Even if UUID collisions are unlikely, this is a concrete scoping hole compared to the rest of the module which consistently filters `tenantId`.
   - Suggested fix: Change the pin query to `where(and(eq(roundPins.roundId, roundId), eq(roundPins.tenantId, tenantId)))`. Also audit other `roundPins` reads (see leaderboard’s `loadF1RoundPins`) for the same issue. Add a test that enforces tenant scoping (e.g., seed two tenants with same roundId in a controlled test harness) if your test infra supports it.

4. [high] Leaderboard loadF1RoundPins reads roundPins without tenant filter; can also trigger live fallback due to pin not loaded
   - File: apps/tournament-api/src/services/leaderboard.ts:340-347
   - Confidence: high
   - Why it matters: `loadF1RoundPins` selects from `roundPins` with `where(inArray(roundPins.roundId, roundIds))` and no tenant predicate. This is both a scoping hole and a reliability hazard: if pin rows fail to load/parse for any reason, the code currently falls back to the legacy (live) net path for that round, violating AC2 (see the critical finding above).
   - Suggested fix: Add `eq(roundPins.tenantId, tenantId)` to the query. Also, for F1 events, treat “pin missing/invalid for a round” as fail-closed for net (do not legacy fallback).

5. [high] /foursome-results endpoint can leak/compute legacy 2v2 dollars for F1 events (even when F1 exposure flag is OFF or lockState is UNLOCKED)
   - File: apps/tournament-api/src/routes/money.ts:130-180
   - Confidence: high
   - Why it matters: Story 1.4’s dual-read intent is that an F1 event’s 2v2 dollars come from the pinned chokepoint and are exposure-gated by `TOURNAMENT_F1_MONEY_ENABLED`, with UNLOCKED mode being scores-only. But `GET /:eventId/event-rounds/:eventRoundId/foursome-results` always calls `computeFoursomeResults`, which (a) uses the legacy best-ball engine and live handicap/course inputs (see money-detail.ts), and (b) returns per-hole money and per-pair cents. That means a roster participant can fetch dollars via this endpoint even when `TOURNAMENT_F1_MONEY_ENABLED` is false, and even when the F1 lock state is `unlocked` (scores-only). This is a server-side redaction/gating gap on a dollar-returning endpoint (audience-bounding concern #4).
   - Suggested fix: Gate `/foursome-results` for F1 events: if F1 and `!f1MoneyEnabled()`, return an explicit `{ error/code }` or empty results with a “not enabled” marker; if F1 and lockState is `unlocked`, redact all cents fields to 0 or disable the endpoint. Longer-term: implement an F1-aware pinned `computeF1FoursomeResults` based on the same pin + settled edges, or explicitly document this endpoint as non-F1 only and enforce that in code. Add route-level tests covering: (1) F1 + flag off ⇒ no dollars, (2) F1 + unlocked ⇒ no dollars, (3) non-F1 ⇒ legacy behavior unchanged.

6. [high] pin-round-at-start does not match its own contract for missing handicaps (hi=0/ch=0) and can grant strokes to players with no HI
   - File: apps/tournament-api/src/services/pin-round-at-start.ts:148-166
   - Confidence: high
   - Why it matters: The module header states: “A player with NO handicap at all is pinned with hi=0/ch=0”. The implementation sets `effectiveHi = hi ?? 0`, but then still computes `ch = calcCourseHandicap({ handicapIndex: effectiveHi, ...tee })`. With HI=0, USGA formula includes `(rating - coursePar)` which can yield a positive CH (often 0 or 1+ depending on the course), meaning a no-handicap player may incorrectly receive strokes and affect settled money. Separately, games-money’s fail-closed check for missing handicap (`missing_handicap`) only checks for finite `ch` (not “was a real handicap present”), so this path effectively prevents the intended fail-closed behavior for truly missing handicaps.
   - Suggested fix: If `hi === null`, either: (a) pin `{ hi: 0, ch: 0 }` explicitly (true “plays gross”), or (b) treat it as genuinely missing and return `{ ok:false, reason:'missing_handicap' }` so the round becomes unsettleable (fail-closed) as designed. Align the settle-time gate in games-money.ts with whatever “missing” semantics you choose (e.g., store an explicit `hasHandicap:boolean` in the pin, or allow `hi:null` in the schema and fail-closed on it). Add an integration test where one player has `manualHandicapIndex = null` at pin time and assert the settled edges either pause (unsettleable) or treat them as CH=0 (never as CH derived from rating-par).

7. [medium] Leaderboard surfaces pinned HI/CH even in event-scope (last pinned round wins), contrary to comment and likely misleading
   - File: apps/tournament-api/src/services/leaderboard.ts:404-473
   - Confidence: high
   - Why it matters: The code comment says “Surface a single pinned CH only when the player has exactly one F1 round in scope (round-scope reads); otherwise null (event-scope mixes rounds).” The implementation does not enforce this: it overwrites `pinnedCH`/`pinnedHI` for each pinned round encountered and returns the last one even when multiple rounds are in scope. That can misreport a player’s pinned course handicap/HI on event-scope leaderboard views.
   - Suggested fix: Track how many pinned rounds contributed for the player in-scope; only set `courseHandicap`/`pinnedHandicapIndex` when `opts.scope === 'round'` (pass scope info into `assignRanksAndBuildRows`) or when exactly one pinned round is present; otherwise return null/omit.

## Strengths

- Clear architectural separation: `games-money.ts` as a single settlement chokepoint with recompute-on-read and edge production is the right shape for money safety.
- Dual-read switch in `computeMoneyMatrix` is structurally non-overlapping (F1 suppresses legacy 2v2), and the disjointness test would catch obvious double-production for checked pairs.
- Pinned-input parsing in games-money (`parsePin` with schema validation) is fail-closed and avoids live recompute within the chokepoint.
- Good integration coverage: golden fixtures run through `computeF1EventEdges` (DB + pin + engine), and there are explicit tests for exposure gating and basic audience bounding on `/money`.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/admin-event-rounds.ts
