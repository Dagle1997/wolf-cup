# Codex Critique

- Generated: 2026-06-23T16:50:30.376Z
- Critiquing: gemini-pro-latest
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx

## Verdict

**SHIP** — overall agreement: low

## Summary

Gemini’s “no issues” conclusion doesn’t hold up: there are a couple of real (though mostly UX/a11y) concerns in the provided code. The only potentially serious item is the cents→dollars conversion for `moneyNet`, but whether it’s a true bug depends on a backend/config invariant that is asserted only in comments, not proven by the supplied evidence.

## Critiques of prior findings

1. [disagree] No concrete findings were identified / Solid, well-tested implementation
   - Reasoning: Even from the single file provided, there are a few correctness/UX/a11y nits that Gemini missed (expand state persistence across scope toggles; ARIA relationship targeting a `<tr>`; moneyNet unit conversion relying on an invariant only stated in comments). Also, Gemini claims test coverage that is not shown in the supplied evidence, so “well-tested” is not verifiable from what we have here.

## Additional findings (Codex caught, prior reviewer missed)

1. [medium] moneyNet cents→dollars conversion can yield non-integer dollars if the backend ever returns non-whole-dollar amounts; invariant is only documented in comments
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:188-224
   - Confidence: high
   - Why it matters: The adapter does `moneyNet: api.moneyNet / 100` (line ~218) while the comment says `ScorecardGrid` expects WHOLE DOLLARS. If `moneyNet` can be 50 cents, this becomes `0.5` dollars, which may render incorrectly or violate assumptions in `ScorecardGrid` (rounding, formatting, sign display, etc.). This is money-display correctness, but it is only a *real* risk if the backend can produce non-multiple-of-100 cent values. The file asserts “F1 Guyan money is whole-dollar” but does not prove it.
   - Suggested fix: Either (a) enforce the invariant defensively: `if (api.moneyNet % 100 !== 0) throw` / log + display fallback; or (b) change `ScorecardGrid` to accept cents (preferred long-term), or (c) round explicitly and document the rounding rule. Also add a unit test for a non-multiple-of-100 case if it’s possible.

2. [medium] Expanded row state persists across scope changes, causing auto-reopen when switching back to round scope
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:289-531
   - Confidence: high
   - Why it matters: `expandedPlayerId` is not cleared when `scope` changes. When switching to `event` scope, expand buttons disappear (`roundId` becomes null), but `expandedPlayerId` remains. When switching back to `current`, the previously expanded player will immediately reopen, which can feel like stale UI state and may unexpectedly trigger a scorecard fetch.
   - Suggested fix: On scope change, clear expansion: `useEffect(() => setExpandedPlayerId(null), [scope, eventId])`. Optionally also clear it if `roundId` changes.

3. [low] ARIA: aria-controls points to a <tr>; better to reference a region element inside the expanded cell (tabpanel/disclosure pattern)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:488-530
   - Confidence: medium
   - Why it matters: `aria-controls={panelId}` references `id={panelId}` on a `<tr>` (line ~526). While an id reference can technically target any element, many assistive-tech patterns expect a region-like element (e.g., `<div role="region">` or a proper `role="tabpanel"` paired with the tab trigger pattern). This is more about semantics/robustness than a functional break.
   - Suggested fix: Move `id={panelId}` onto a `<div role="region">` inside the expanded `<td>` and consider `aria-labelledby` pointing back to the trigger. Alternatively adopt the WAI-ARIA disclosure pattern explicitly.

4. [low] A11y pattern mismatch: uses role=tablist/tab without tabpanel semantics or keyboard behavior
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:370-400
   - Confidence: medium
   - Why it matters: The scope toggle is implemented as `role="tablist"` with `role="tab"`, but there is no associated `tabpanel` and no arrow-key navigation handling typical of tabs. Screen readers may announce “tab” UI that doesn’t behave like tabs.
   - Suggested fix: Either implement full tab semantics (tabpanel + keyboard interactions) or switch to a simpler/accurate pattern (e.g., `role="group"` with pressed buttons / segmented control using `aria-pressed`).

5. [low] Privacy hardening (theoretical): RowScorecard fetches regardless of showMoney; relies on server to omit moneyNet when not allowed
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:235-281
   - Confidence: low
   - Why it matters: Even when `showMoney` is false, the client still fetches the scorecard. If the backend mistakenly includes `moneyNet` while money is disabled, the client would still possess that data (even if the UI hides it). This is primarily a defense-in-depth point; the main protection must be server-side.
   - Suggested fix: Optionally strip/zero money fields client-side when `showMoney` is false, or include `showMoney` in the endpoint/response contract so the server can assert correctness; keep server authorization as the real guard.

## Consensus recommendations

- Do not treat any of the identified items as a HIGH based on the supplied evidence alone; the only candidate (money display) becomes HIGH only if non-whole-dollar `moneyNet` can occur in production today.
- Confirm the F1 Guyan “whole-dollar” invariant in a source of truth (backend code/config/tests). The frontend comment is not evidence; if the invariant is real, encode it defensively (assert `% 100 === 0` or accept cents end-to-end).
- Reset `expandedPlayerId` when scope changes (and possibly when `roundId` changes) to avoid surprising auto-reopen + incidental fetches.
- Tighten accessibility semantics: avoid tab roles if not implementing tab behavior; make the expanded content a proper region and reference it from the trigger.

## Warnings

None.
