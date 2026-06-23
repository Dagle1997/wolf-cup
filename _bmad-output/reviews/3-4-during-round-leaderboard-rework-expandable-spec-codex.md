# Codex Review

- Generated: 2026-06-23T16:36:38.893Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md

## Summary

Spec is generally concrete and test-driven, with good upfront callouts for the cents→dollars seam and strict tournament-web-only scope. The main correctness risk is an internal contradiction around moneyNet nullability vs showMoney gating (“exactly when non-null”) which can mis-spec behavior/tests. A few areas remain decision/ambiguity points (single-open vs multi-open, refetch strategy) that should be resolved explicitly to avoid divergent implementations and perf surprises.

Overall risk: medium

## Findings

1. [high] Contradiction: showMoney gating vs API moneyNet nullability (unsettled holes)
   - File: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md:23-37
   - Confidence: high
   - Why it matters: The spec states the API returns moneyNet null when “money not exposed / hole unsettled” (line 23), but AC#4 asserts showMoney is true exactly when the API returns non-null moneyNet (line 37). Those cannot both be true in money mode: money can be exposed while some holes remain unsettled (moneyNet null), and the grid should still show the $ row with per-hole “—” where null. If implemented per AC#4 literally (e.g., infer showMoney by checking non-null moneyNet), it can hide the $ row incorrectly or produce brittle tests.
   - Suggested fix: Revise AC#4 wording to: showMoney is based solely on leaderboard f1 gating (`f1?.mode==='money' && f1.moneyEnabled===true`). Clarify that even when showMoney is true, individual holes may have `moneyNet: null` and must render as “—”. Update tests to reflect mixed null/non-null moneyNet in money mode.

2. [high] Test expectation for moneyNet=0 likely mismatched with described formatter output
   - File: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md:27-46
   - Confidence: medium
   - Why it matters: The spec describes ScorecardGrid.formatMoney rendering whole dollars like `+$${amount}` (line 27), but the test bullet says `moneyNet: 0 renders 0` (line 45). If the component prints `+$0`, `0`, or `$0` is an implementation detail; encoding the wrong expectation will cause failing tests or force a UI change not intended by the existing component contract.
   - Suggested fix: Align the AC/test to the actual current ScorecardGrid behavior. If the intent is “a settled push shows a non-dash value”, assert on the presence of `$0`/`+$0` consistently with the component’s existing output rather than specifying bare `0` without currency/sign.

3. [medium] Expansion behavior is explicitly undecided (single-open vs multi-open) and impacts performance + UX
   - File: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md:31-33
   - Confidence: high
   - Why it matters: AC#1 allows either single-open or multi-open (“pick one and test it”, line 31). This is a product/UX and performance decision: multi-open can trigger multiple concurrent scorecard polls (line 90–91) and increase layout/scroll complexity; single-open is simpler and bounds network load. Leaving it open risks inconsistent implementations and later rework.
   - Suggested fix: Make an explicit decision in AC#1 (recommend single-open given the polling concerns) and add an AC line defining what happens when opening a second row (e.g., previous collapses).

4. [medium] Freshness/refetch strategy is under-specified; “OR” options can yield stale open panels
   - File: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md:33-91
   - Confidence: high
   - Why it matters: AC#2 allows either a refetch interval comparable to 15s or “refetch-on-expand + on the leaderboard’s poll” (line 33). The latter is non-trivial to wire reliably (needs coordination with the leaderboard query) and can easily degrade to “fetch once then stay stale while expanded,” undermining the live during-round use case. Since the endpoint is `no-store` (line 23, 90), staleness control matters.
   - Suggested fix: Choose one required behavior: e.g., while expanded, set `refetchInterval: 15000` (or match the leaderboard interval) and `enabled: expanded`. Optionally add: on collapse, stop polling; on re-expand, refetch immediately.

5. [medium] Round identifier correctness is asserted but not enforced; 404 handling could mask an integration bug
   - File: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md:24-34
   - Confidence: medium
   - Why it matters: The spec claims `data.round.id` is the runtime `rounds.id` needed by `/api/rounds/:roundId/...` (line 24), but the implementation will rely on this contract. AC#2 then instructs 403/404 to show “scorecard unavailable” (line 33–34). If `round.id` is actually an eventRoundId (or otherwise mismatched), every fetch will 404 and the UI will quietly degrade without surfacing the integration bug.
   - Suggested fix: Add a test assertion that the scorecard request URL uses the exact `round.id` from the mocked leaderboard response (not `eventRoundId`). Consider differentiating “unavailable (403)” from “not found (possible bug)” via logging/telemetry or a more specific message in non-prod builds.

6. [low] Accessibility requirements could be tightened for table-row expansion (aria-controls/region semantics)
   - File: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md:31-74
   - Confidence: medium
   - Why it matters: AC#1 requires `aria-expanded` and keyboard operability (line 31), which is good, but table-based disclosure patterns are easy to implement in a way that is awkward for screen readers (e.g., clickable <tr>, missing relationship between control and panel). This can regress usability even if technically keyboard-clickable.
   - Suggested fix: Add an AC note: the toggle must be a real `<button>` inside a `<td>` (not on `<tr>`), and should include `aria-controls` pointing at the expanded panel container. Consider giving the panel `role="region"` and an accessible label tied to the player name.

## Strengths

- Clear, prominent callout of the cents→dollars seam with null-preserving adapter requirement and a concrete mapping snippet (lines 26–28, 75–87).
- Good scope containment and explicit FD-1/FD-2 boundary: tournament-web only, with forbidden directories called out (lines 41–42, 95–97).
- Acceptance criteria include failure modes (inline loading/error/unavailable) that prevent whole-page breakage (lines 33–34).
- Tests are explicitly enumerated and cover key behaviors (expand/collapse, gating, error states, event-scope non-expandable) (lines 43–49).
- Implementation guidance for table expansion via an extra <tr><td colSpan=…> is pragmatic and aligns with the existing table layout (lines 72–74).

## Warnings

None.
