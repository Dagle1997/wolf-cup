# Codex Review

- Generated: 2026-04-28T16:46:11.495Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md

## Summary

Spec is detailed and largely pins down the critical behaviors (route branches, offline queue wiring, and the iOS Safari focus ordering). Main risks/ambiguities are around (1) score input constraints likely being too strict for real golf scores, (2) the “Skip hole” feature conflicting with the spec’s server-derived `currentHole` computation (can snap the UI back to the skipped hole on refetch), and (3) assumptions about stable member ordering that affect ref-indexed focus/auto-advance and the iOS keyboard fix. Backend GET decision (adding to `scoresRouter`) is workable for v1, but the auth contract (200 + `myFoursome:null` for any tenant user) should be explicitly acknowledged as an information-leak tradeoff or tightened to participants-only.

Overall risk: medium

## Findings

1. [high] Score input is constrained to a single digit (1–9) which can be invalid for real gross strokes
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:143-146
   - Confidence: high
   - Why it matters: The spec mandates `maxLength={1}` and “accept single digit 1-9”. In real play, gross strokes can exceed 9 on a hole (especially for higher handicaps/beginners). This would make the UI unable to record valid scores, leading to data loss / inability to complete scoring on trip day.
   - Suggested fix: Loosen the constraint: allow 1–2 (or 3) digits and validate a reasonable range (e.g., 1–20 or 1–30) while keeping `inputMode="numeric"`. Update AC #6/#7 and frontend tests accordingly.

2. [high] “Skip hole” conflicts with `currentHole` being computed from server `holeScores` (can revert to skipped hole on refetch)
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:141-155
   - Confidence: high
   - Why it matters: Spec defines `currentHole` as “first hole where any of the 4 cells is missing” based on `myFoursome.holeScores` (line 142), but also adds “Skip hole” that advances without enqueueing anything (line 154). Since skipped holes never get server scores, any subsequent GET refetch (15s polling or focus refetch) will still report that hole as missing and can snap `currentHole` back, creating a loop and confusing UX.
   - Suggested fix: Specify persistence semantics for skipping: either (a) track skipped holes locally and incorporate into `currentHole` computation, (b) remove Skip hole from v1, or (c) add a server-side ‘hole skipped’ marker (not in current scope). Add an explicit AC + test for skip + refetch behavior to prevent regressions.

3. [medium] Member ordering is not specified but focus refs depend on stable positional ordering across renders/refetches
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:141-149
   - Confidence: medium
   - Why it matters: The iOS keyboard fix and auto-advance rely on `scoreInputRefs.current[idx]` mapping to player N (lines 143–148). Stable React keys prevent DOM recreation, but if `members` order changes between renders (e.g., backend returns different ordering after a refetch), the ref array can point to the wrong player index, breaking auto-advance and potentially focusing the wrong input (and undermining the keyboard fix).
   - Suggested fix: Pin an ordering contract: backend returns `members` sorted by a stable field (pairing seat/position), and frontend does not re-sort inconsistently. Add an AC/test asserting stable order for `members` in GET and/or explicit `sort` in frontend with documented key.

4. [medium] Backend GET authorization contract (200 for any tenant session, `myFoursome:null` for non-participants) may leak round existence/state
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:61-104
   - Confidence: medium
   - Why it matters: Spec explicitly avoids 403 and returns `myFoursome:null` for a user not in the round (lines 97–98, 104–105), while still returning `roundId/state/holesToPlay`. Within a tenant, this leaks that a round exists and its state/holesToPlay to any authenticated user, even if not a participant. That may or may not be acceptable; right now it’s a security/privacy tradeoff not clearly called out as such.
   - Suggested fix: Either (a) explicitly accept/record this as a privacy risk in the spec (and ensure product agrees), or (b) restrict GET to participants/organizers and return 404 for non-participants (keeping the UI placeholder achievable via an alternate mechanism). If keeping current approach, consider minimizing returned fields when `myFoursome:null` (e.g., omit state) to reduce leakage.

5. [medium] Undefined behavior when a participant’s foursome has no scorer assignment (GET response shape requires scorerName/scorerPlayerId)
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:73-106
   - Confidence: medium
   - Why it matters: GET `myFoursome` shape requires `scorerPlayerId` and `scorerName` (lines 75–78). But the data model may temporarily have no scorer assignment (and POST has an explicit 422 `foursome_has_no_scorer`, registered as terminal (lines 124–126, 170–171)). The spec doesn’t define what GET should return in that case (null scorer? setup-error placeholder?), which can lead to runtime errors or misleading placeholders.
   - Suggested fix: Define a v1 behavior: either return `myFoursome` with `isScorer:false` and `scorerName/scorerPlayerId` nullable, or return a dedicated view flag (e.g., `myFoursome: { ..., scorer: null }`) and add a corresponding UI branch + test.

6. [low] Ambiguity in round state defaulting (round_states missing) contradicts itself
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:99-102
   - Confidence: high
   - Why it matters: The spec first says if `round_states` is absent the UI sees `state: null` and should show a setup-error placeholder, then immediately overrides to “Actually — return 200 with `state: 'not_started'` as a default” (lines 101–102). AC #2 later mandates defaulting to `not_started` (line 209). This internal contradiction can cause divergent implementations/tests.
   - Suggested fix: Remove the `state:null` notion and make the defaulting rule authoritative (and tested), or explicitly require a setup-error placeholder and do not default. Align Risk Acceptance §3 with AC #2 and test list.

7. [medium] Test plan omits coverage for Skip hole despite being an epic-anchored behavior
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:154-301
   - Confidence: high
   - Why it matters: Skip hole is called out as epic AC line 1313 (line 154) but none of the enumerated 11 frontend tests covers it (lines 290–301). Given the logic tension with `currentHole` computation, this is especially likely to regress or ship broken without a focused test.
   - Suggested fix: Add at least one frontend test: click “Skip hole” with incomplete inputs advances hole locally and does not enqueue; optionally also assert behavior after a simulated refetch so the app doesn’t jump back (once semantics are clarified).

8. [low] Polling behavior is under-specified re: background tabs and bandwidth/battery
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:112-113
   - Confidence: medium
   - Why it matters: Spec sets `refetchInterval: 15000` with `staleTime: 0` (line 112) but doesn’t specify `refetchIntervalInBackground` or whether polling should pause when offline/hidden. Defaults may be acceptable, but different TanStack Query versions/config can behave differently and impact battery on mobile.
   - Suggested fix: Pin intended settings explicitly (e.g., `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`) and consider pausing polling when `document.visibilityState !== 'visible'` if needed.

## Strengths

- Explicitly nails the iOS Safari keyboard requirement with both implementation constraints (sync focus in click handler + stable keys) and a dedicated ordering test (lines 54–55, 146–149, 236–246, 298–300).
- Clear risk acknowledgment for per-player enqueue (partial drain inconsistency) and deliberate non-terminal handling of 403s with queue failsafe (lines 164–172, 347–357).
- Path footprint and allowlist constraints are enumerated up front, making it easy to audit against scope creep (lines 17–37).
- Backend GET response contract is mostly well-specified (tenant scoping, error taxonomy, participant vs non-participant semantics) and includes a concrete minimum test matrix (lines 57–107, 183–188, 279–288).

## Warnings

None.
