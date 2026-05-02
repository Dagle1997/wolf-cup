# Codex Review

- Generated: 2026-05-02T13:03:24.544Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md

## Summary

Spec is mostly complete and stays within the 2-file allowlist, but two areas look likely to cause real-world friction/flakiness: (1) the proposed new audit-log assertion in the strengthened 409 test is underspecified and may be non-deterministic if the DB isn’t fully reset per test; (2) the drill’s step 7 “Audit verify” is not currently executable by a non-developer scorer without additional concrete instructions/role-splitting. Also, the drill procedure lacks a few operational specifics (which environment/round to use, how to verify offline state, what to do without a second device).

Overall risk: medium

## Findings

1. [high] 409-test AC-2 audit assertion is likely under-scoped and could be flaky (counts all score.committed rows globally)
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:102-113
   - Confidence: high
   - Why it matters: AC-2’s proposed query filters only by `auditLog.eventType = 'score.committed'` and then expects `audits.length === 1` (lines 107–112). If the integration test DB is not fully truncated between tests (or if other tests in the same file create score commits in the same test run), this assertion will intermittently fail. Even if today’s harness resets DB, this assertion bakes in a fragile global assumption and can regress when new tests are added.
   - Suggested fix: Scope the audit query to the seeded round/event/tenant. Examples: add `eq(auditLog.roundId, seed.roundId)` (preferred) or filter on the specific cell identifiers if available (roundId + playerId + holeNumber) or on a request correlation id/clientEventId if audit rows store it. The dedupe test’s existing audit assertion should be mirrored exactly if it already uses a safer filter.

2. [medium] 409-test AC-1 first-writer-wins assertion depends on row ordering / assumes a single row but doesn’t prove the row is the original write
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:82-100
   - Confidence: medium
   - Why it matters: AC-1 checks `rows.length === 1` and `rows[0]!.grossStrokes === 4` (lines 97–99). If the query returns a row but there’s any possibility of multiple rows in other schemas (or if ordering is non-deterministic in a future schema change), `rows[0]` is a weak way to assert “the winner is the first insert.” You do assert length==1, which helps, but you still don’t explicitly tie the persisted row to the first request beyond grossStrokes.
   - Suggested fix: Keep `rows.length === 1`, but also assert on a stable identifier that must belong to the first write (e.g., `clientEventId`, `createdAt` range, or an `id` captured from the first response if available). If no such column exists in `hole_scores`, consider asserting additional persisted fields that differ between the two attempted writes (not just strokes) to make the check robust.

3. [medium] Drill step 7 (Audit verify) is not currently actionable for a non-developer scorer; spec itself flags the gap
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:134-136
   - Confidence: high
   - Why it matters: AC-5 step 7 requires querying `audit_log` “via Hostinger Browser Terminal OR via a temporary admin endpoint” (line 135). Most scorers will not have SSH/DB access, and the “temporary admin endpoint” is explicitly deferred to followup T5-10b (lines 207–209). That makes the drill, as written, hard to execute end-to-end by the intended audience without extra undocumented coordination, which conflicts with AC-5’s requirement that the doc is self-contained.
   - Suggested fix: Make step 7 explicitly role-based (e.g., “Organizer/tech lead performs this sub-step”) and include exact copy/paste commands (SQL + how to locate roundId/eventId) that work in the Hostinger terminal today. Alternatively, mark step 7 as optional until T5-10b exists—but that would require updating the ACs since they currently require it.

4. [medium] Drill procedure lacks key operational specifics (which environment/round to use, how to get a 'test round', and what constitutes 'offline')
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:125-136
   - Confidence: high
   - Why it matters: Steps refer to “the test round’s score-entry page” (line 130) and later audit counts “on this round” (line 135), but the spec doesn’t define how the executor obtains/identifies that round, whether this is in prod vs staging, and how to avoid contaminating real tournament data. Also, step 3 says to enable airplane mode, but doesn’t explicitly confirm Wi‑Fi is off (iOS allows re-enabling Wi‑Fi while in airplane mode), which can invalidate the offline portion while still ‘feeling’ offline.
   - Suggested fix: In the drill markdown, add: (1) explicit environment (staging vs prod) and URL; (2) how to select/create the drill round and where to find `eventId`/`roundId`; (3) an explicit check that both cellular and Wi‑Fi are disabled (and no network indicator), or a quick ‘try to load a known uncached page’ check; (4) a warning not to run against a live event unless intended.

5. [low] Step 6 requires a “SECOND online device” without offering a fallback verification path
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:133-136
   - Confidence: high
   - Why it matters: Requiring a second device is sensible for verifying server propagation, but in the field the executor may only have one phone. Without a documented fallback (e.g., check leaderboard from a laptop browser, or from same device after sync), the drill can stall even if the system works.
   - Suggested fix: Add an explicit fallback: “Second device may be a laptop/desktop browser logged into the same event; if unavailable, verify by refreshing leaderboard view after sync and/or checking server-side totals via the organizer terminal.”

6. [low] Platform assumption is iOS-specific; clarify whether Android is supported or intentionally excluded
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:129-133
   - Confidence: high
   - Why it matters: Step 1 is explicitly “iOS Safari → Add to Home Screen” (line 129). If any scorer devices are Android/Chrome, the doc will be incomplete and may block drill execution. If iOS-only is intended, it should be stated to avoid confusion.
   - Suggested fix: Either (a) add Android equivalents (Chrome ‘Install app’) and airplane-mode notes, or (b) state at the top: “This drill is written for iOS Safari PWA; Android not supported for v1.”

## Strengths

- Clear 2-file footprint and explicit allowlist discipline (lines 19–27, 213–218).
- Good separation of in-scope template vs out-of-scope SHARED-path drill record storage (`reference/drills/`) with followup tracking (lines 58–63, 191–209).
- Automated portion is explicitly additive and limited to strengthening assertions, reducing regression risk (lines 28–36, 192–193).
- ACs for the drill are concrete (7 numbered steps + drill record block + pre-trip gate text), which should make implementation straightforward.

## Warnings

None.
