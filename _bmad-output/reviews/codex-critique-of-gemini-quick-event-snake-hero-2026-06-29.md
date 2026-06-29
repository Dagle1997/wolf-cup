# Codex Critique

- Generated: 2026-06-29T15:02:12.473Z
- Critiquing: gemini-pro-latest
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-web/src/routes/admin.events.quick.tsx, apps/tournament-web/src/routes/index.tsx, apps/tournament-api/src/engine/games/registry.ts

## Verdict

**HOLD** — overall agreement: partial

## Summary

Gemini correctly spotted two UX/logic issues (foursome-group cap and home auto-redirect condition), but its point-value recommendation is directionally wrong given the engine’s hard whole-dollar constraint. The real risk in the Quick Event wizard is not “lost cents,” it’s silent coercion/rounding of user input into a different whole-dollar amount (including defaulting invalid input to $1) rather than validating and blocking Start.

## Critiques of prior findings

1. [partial] Decimal Point Values Are Incorrectly Rounded Before Converting to Cents (admin.events.quick.tsx:226)
   - Reasoning: There is a real bug: the UI accepts decimal-looking input, but the code rounds to the nearest whole dollar before multiplying by 100 (`Math.round(Number(pointDollars)||0) * 100`), so `2.50` becomes `$3` (and `2.49` becomes `$2`). That’s a user-intent violation in a real-money setting. However, Gemini’s proposed fix (`Math.round(dollars*100)`) is incompatible with the supplied engine constraint: `validateSchedule` rejects any cents not divisible by 100 (`point_value_not_whole_dollar`). Implementing Gemini’s fix would cause legitimate user flows to fail validation whenever they enter non-integer dollars (e.g., $2.50 → 250 cents → rejected). The correct remediation is to enforce/validate a positive *integer* dollar amount and block Start (surface an error) rather than trying to preserve decimal cents.

2. [partial] Arrange Foursomes Dropdown Prevents Creating New Groups for Multiples of 4 (admin.events.quick.tsx:401)
   - Reasoning: The limitation is real: options are capped at `Math.max(numFoursomes, ceil(numPlayers/4))`, so with 4 players you cannot ever select “Group 2” to split into 2+2 (or create any extra group beyond the default ceiling). This impacts the main purpose of the step (manual arrangement). Gemini’s suggested fix of `numFoursomes + 1` is basically the right idea (always offer one more group than currently used), but should likely be `Math.max(Math.ceil(numPlayers/4), numFoursomes + 1)` (and optionally capped at `numPlayers`) to preserve the default minimum while still allowing “add a new group” behavior.

3. [agree] Auto-Redirect Fails for Players with Past Archived Events (index.tsx:137-139)
   - Reasoning: Correct: redirect is gated by `events.length === 1`, but the UI semantics elsewhere are “active vs archived.” A player with exactly one active event plus archived history won’t auto-enter the active event, despite there being only one *current* destination. Using `activeEvents.length === 1` (and redirecting to `activeEvents[0].id`) matches the intent described in comments (single active event auto-enters; archived-only should not).

## Additional findings (Codex caught, prior reviewer missed)

1. [critical] Point value silently coerces invalid/decimal input to a different whole-dollar amount (including defaulting junk to $1) instead of blocking Start
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:223-235
   - Confidence: high
   - Why it matters: This is a real-money configuration. Today: `Number(pointDollars) || 0` turns non-numeric strings into 0, then `Math.max(1, ...)` forces $1/point; decimals are rounded to a different dollar amount. An organizer can accidentally start a locked money game with the wrong stake without any warning, and the engine will happily accept it because it’s a whole-dollar multiple of 100 cents.
   - Suggested fix: Parse and validate strictly: require a positive integer dollar amount (no decimals, no empty, no NaN). If invalid, show a field error and disable Start (or block in `handleStart` before the API call). Also change the input UI to `type="number" step={1} min={1} inputMode="numeric"` to discourage decimals.

2. [high] Quick Event wizard has no Step 4 validation despite money-sensitive inputs; Start is always enabled (unless busy)
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:415-465
   - Confidence: high
   - Why it matters: Unlike Steps 1–2 (which gate Next), Step 4 does not validate Guyan configuration at all before allowing `handleStart`. Combined with the coercion behavior, this increases the chance of incorrect locked config reaching the backend.
   - Suggested fix: Add a `step4Valid` that (when `guyanOn`) requires `pointDollars` to be a valid positive integer string (and maybe also validates modifier selections if needed). Disable the Start button when invalid and show inline error messaging.

3. [medium] Home auto-redirect uses `events[0]` ordering assumption; safer to redirect from the filtered active list
   - File: apps/tournament-web/src/routes/index.tsx:113-143
   - Confidence: medium
   - Why it matters: Even after switching to `activeEvents.length === 1`, using `events[0]` could redirect to the wrong event if the API order ever changes or if archived sorting differs from active sorting. The page already computes `activeEvents`; redirect should source from that list directly.
   - Suggested fix: Compute `const autoRedirectId = !explicitList && !isOrganizer && activeEvents.length === 1 ? activeEvents[0].id : null;`.

## Consensus recommendations

- Do NOT implement Gemini’s cents-preserving fix; the engine rejects non-whole-dollar cents. Instead, enforce a positive integer dollar point value and block Start on invalid input.
- Remove silent coercion: don’t round user input into a different dollar amount; validate and require explicit correction.
- Fix the foursome-group dropdown to always offer “one more group” than currently used (e.g., `max(ceil(n/4), numFoursomes+1)`), so organizers can create new groups even when `n` is a multiple of 4.
- Change home auto-redirect to use `activeEvents.length === 1` and redirect to `activeEvents[0]`, preserving the `explicitList` and organizer exceptions.

## Warnings

None.
