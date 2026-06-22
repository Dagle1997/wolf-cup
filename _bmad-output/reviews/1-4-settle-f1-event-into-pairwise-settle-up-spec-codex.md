# Codex Review

- Generated: 2026-06-21T22:47:47.261Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md

## Summary

Spec is strong on the intended architecture (single settlement chokepoint + pin-time CH + recompute-on-read) but there are several money-critical ambiguities/gaps that could allow silent drift, double-counting, or exposure/crashes if implemented as written—especially if shipping 1.4a without parts of 1.4b.

Overall risk: high

## Findings

1. [high] Money-safety invariant is not fully closed over all net consumers; AC4 net-reconciliation test can be tautological
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:21-29
   - Confidence: high
   - Why it matters: The invariant requires that read-time net derives ONLY from pinned CH (no live HI, no read-time calcCourseHandicap/buildTeeByPlayer). The spec states this for `games-money.ts` (lines 21–23) but does not explicitly require the leaderboard’s own net computation (and any other net-using money producers like skins/bets if they rely on net) to also use the same pinned CH for the same F1 rounds. AC4 proposes a test that `games-money.ts` net matches the leaderboard net (line 24). If the leaderboard continues to derive CH/net from live HI/course data, AC4 would still pass if `games-money.ts` accidentally does the same—making it a weak/tautological guard rather than a safety tripwire. This creates a real risk of silently moving money after a course rating/slope edit or HI change.
   - Suggested fix: Make the invariant explicit for ALL read surfaces: leaderboard net for F1 rounds MUST be derived from round_pin’s pinned CH (and pinned course-rev) as well. Strengthen tests beyond AC4: add an integration test that (1) pins round, (2) changes player HI or course rating/slope / tee data, and (3) asserts F1 money + leaderboard net remain unchanged. This directly guards against accidental read-time CH recomputation or live HI reads.

2. [critical] 1.4a/1.4b split is not safe as written: shipping 1.4a without dual-read isolation and fail-closed can double-count or crash money pages
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:31-55
   - Confidence: high
   - Why it matters: The spec says 1.4a is the ‘happy path’ and suggests it can ship alone (line 104), but dual-read isolation (AC10), fail-closed behavior (AC11), and audience-bounded visibility (AC12) are deferred to 1.4b (lines 31–36, 51–55). In practice, once 1.4a routes F1 edges into existing money surfaces (AC7, lines 27–28; Task 3 line 47), if legacy `services/money.ts` still also produces 2v2 edges/presses for the same event/round, users can see doubled or conflicting dollars. Separately, if pin is missing for some rounds or inputs are incomplete (DNF/incomplete holes), pages can crash/empty-render without AC11’s guard. This is “money-critical” and the split as stated risks shipping an unsafe intermediate state.
   - Suggested fix: Treat AC10 (dual-read switch that disables legacy 2v2+presses for F1 events) and the minimal non-crashing unsettleable surface (AC11) as prerequisites for shipping anything that surfaces dollars (AC7/AC8). If you must split, constrain 1.4a to “engine wiring behind a feature flag with no dollars emitted” or “F1-only isolated route not visible to end users” until AC10+AC11 are in.

3. [high] Dual-read switch and producer-disjointness test are underspecified; keying collisions on (debtor, creditor, reason) is ambiguous and may miss real double-counting or false-fail
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:33-35
   - Confidence: high
   - Why it matters: AC10 defines producer-disjointness as “no (debtor, creditor, reason) edge is emitted by two producers” (line 33) but it’s unclear whether `reason` is guaranteed unique and stable across producers and across multiple edges in the same producer. If a producer emits multiple edges with the same pair+reason (e.g., per-hole vs aggregate), the test may false-fail. Conversely, true double-counting can occur even when `reason` differs (e.g., legacy 2v2 edges and F1 edges both represent the same underlying obligation but use different reason labels), and the test would not catch it. Also, the spec turns off legacy 2v2+presses, but is silent on whether bets/skins remain active for F1 events and how their edges should coexist without collisions or duplicated obligations (lines 65–66, 71–73).
   - Suggested fix: Define a canonical edge identity for disjointness: include `sourceType` (already planned, line 21) and/or an explicit `producer` field, plus a semantic `edgeKind`/`gameId`/`roundId`/`segmentId` as needed. Clarify whether bets/skins are (a) disabled for F1 events, or (b) remain enabled and must be disjoint by design. Update the disjointness test to reflect the real invariant you need (e.g., “legacy 2v2 producer yields zero edges for F1 events” + “presses yield zero edges,” rather than only matching on reason strings).

4. [medium] Pin timing/backfill for rounds already in_progress (or completed) when F1 is enabled is not specified; recompute-on-read may have no pinned CH to use
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:25-26
   - Confidence: high
   - Why it matters: AC5/Task 2 pins on the `in_progress` transition (lines 25–26, 46–47). If F1 is enabled for an event after a round is already `in_progress` (or if the transition was done before this feature deploy), there may be no `round_pin` record with CH/course-rev/resolved config. Since AC6 says money is derived on read with no stored money (line 26), reads could fail or (worse) fall back to live computation unless explicitly prohibited. This can also impact shared money pages: a single unpinned round in an F1 event could crash the entire event’s money view unless fail-closed is in place (AC11 is currently in 1.4b).
   - Suggested fix: Specify required behavior for “unpinned but F1” rounds: either (1) a backfill pin operation (admin action or migration-like job) that pins immediately using the same deterministic inputs, or (2) strict fail-closed: treat as unsettleable with a non-crashing message until pinned. Add an integration test covering the scenario: event has game_config, round is already in_progress without pin, money routes must not crash and must not compute from live HI.

5. [medium] Fail-closed boundary for ‘unlocked handicap’ conflicts with money-safety goals unless explicitly framed as provisional and isolated from settled money
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:28-35
   - Confidence: medium
   - Why it matters: AC8 allows an unlocked event to show “scores-only + private My Money” (line 28), while AC11 says unlocked handicap is NOT fail-closed and net uses “most-recent GHIN default” (line 34). If “My Money” is shown while handicaps can change, users will see moving dollars across reads; that’s acceptable only if the product explicitly treats it as provisional and ensures it never blends into the same settlement surfaces as locked/pinned money. Otherwise, this undermines trust and can be misinterpreted as a settled obligation.
   - Suggested fix: Clarify that any money shown for unlocked events is explicitly provisional, may change, and must not be used for settle-up. Alternatively, enforce: money mode (any dollars beyond a per-player private preview) requires the event/round to be pinned/locked, or require pinning even in unlocked mode. Add tests that changing HI after pin does not change locked money, and that unlocked mode is clearly segregated/flagged.

6. [medium] Audience-bounded money visibility must be enforced server-side; spec currently reads as a UI requirement and may leak via API responses
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:35-36
   - Confidence: high
   - Why it matters: AC12 says non-roster/cross-group viewers “never receives dollar figures” (line 35), but does not state where enforcement occurs. If the API routes (`routes/money.ts`, leaderboard endpoints) still return dollars and only the web UI hides them, non-roster users can still fetch them directly. For money/privacy, this must be enforced in the tournament-api response shaping/authorization layer.
   - Suggested fix: Make AC12 explicit: tournament-api money/leaderboard endpoints must redact/omit dollar amounts unless requester is in roster (and appropriate audience rules). Add HTTP integration tests asserting a non-roster token/user gets 200 responses with no dollar fields (or consistent redaction), not just hidden UI.

7. [medium] Pinned course-rev is mentioned, but spec doesn’t explicitly require all course-dependent net inputs (stroke indexes / hole count) to be read from that revision
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:21-26
   - Confidence: medium
   - Why it matters: AC2 focuses on not recomputing CH from live rating/slope (line 22), and AC5 mentions pinning course-rev (line 25). However, `getHandicapStrokes` / `allocateNetThroughHole` require hole handicap/stroke-index data and segment length assumptions. If those are fetched from a “current course” table rather than the pinned course revision, net allocation can still drift even if CH is pinned. That would violate the stated safety intent (“later course rating/slope edit can never silently move… money,” line 22) because course edits may include hole indexes and tee definitions too.
   - Suggested fix: Add a requirement: all net allocation inputs (hole handicap indexes, hole count/segment definition, tee used) must be sourced from the pinned `course-rev` snapshot, not live course tables. Add a test: edit hole handicap indexes after pin and assert net + money unchanged for the pinned round.

## Strengths

- Explicitly identifies the money-safety invariant and calls out the exact forbidden functions at read-time (`calcCourseHandicap`/`buildTeeByPlayer`) (lines 22–23, 68–70).
- Defines a single settlement chokepoint (`services/games-money.ts`) and namespaces edges with `sourceType: 'f1_game'`, which is a solid foundation for auditability and disjointness (line 21).
- Recompute-on-read with pinned immutable inputs is clearly stated, reducing risk of stale cached money (line 26).
- Calls for property testing (zero-sum) and reuse of approved goldens, which is appropriate for money-critical math (line 38–39, 49–50).

## Warnings

None.
