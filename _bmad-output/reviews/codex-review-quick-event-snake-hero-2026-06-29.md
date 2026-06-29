# Codex Review

- Generated: 2026-06-29T14:59:06.897Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/migrations/0026_warm_gressill.sql, apps/tournament-api/src/db/schema/subgames.ts, apps/tournament-web/src/routes/admin.events.quick.tsx, apps/tournament-web/src/routes/index.tsx

## Summary

Three changes reviewed (web landing hero + quick event wizard + DB schema/migration for snake). Biggest concrete risk is in the Quick Event wizard’s money config: the per-point $ input is converted to cents incorrectly (rounding dollars, forcing a $1 minimum), which can create wrong real-money point values. There’s also a likely safety/validation issue where the wizard always sends `confirmNoModifiers: true` even when it enables modifiers, and it allows creating an event with an empty tee color when the course has no tee list. Migration 0026 looks structurally sound and no longer contains the stray `bets.line` alter.

Overall risk: medium

## Findings

1. [critical] Quick Event wizard converts per-point dollars → cents incorrectly (rounding + forced $1 minimum)
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:223-234
   - Confidence: high
   - Why it matters: This app is real-money. The wizard builds the locked Guyan config, and the line

`cents: Math.max(1, Math.round(Number(pointDollars) || 0)) * 100`

(1) rounds to whole dollars, so inputs like `2.50` become `$3.00` (300 cents), and `0.50` becomes `$1.00` (100 cents).
(2) forces a minimum of $1 even if the organizer intended $0 (or typed an invalid/blank value).

That’s a direct, user-visible money correctness bug that can change settlement amounts.
   - Suggested fix: Parse as a decimal dollar amount and convert directly to cents, with explicit validation and UI error messaging.
Example:
- `const dollars = Number.parseFloat(pointDollars)`
- validate finite and >= 0 (or >= 0.01 if you require non-zero)
- `const cents = Math.round(dollars * 100)`
Also consider preventing start if invalid, instead of silently coercing to $1.

2. [high] Wizard always sends `confirmNoModifiers: true` even when it enables modifiers
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:261-269
   - Confidence: medium
   - Why it matters: On start, the wizard posts:

`confirmNoGame: !guyanOn,
 confirmNoModifiers: true`

But when `guyanOn` is true, the wizard also sends a `game-config` with a `modifiers` array (net-skins/greenie/polie/sandie) (lines 225–234). If the backend uses `confirmNoModifiers` as a safety interlock (“you are starting a game with no modifiers”), sending `true` here is inconsistent and could bypass intended confirmation logic or create misleading audit trails.
   - Suggested fix: Set `confirmNoModifiers` based on the actual intended configuration (e.g., true only when all modifiers are disabled / no modifier types are present). If the backend expects the flag only for the no-modifiers case, omit it otherwise.

3. [medium] Step 1 validation allows empty tee color for courses with no tee list, potentially creating invalid event rounds
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:171-193
   - Confidence: high
   - Why it matters: When a selected course has `tees.length === 0`, the UI shows a free-text tee input (lines 330–334), but `step1Valid` does not require `teeColor` in that case:

`(tees.length === 0 || teeColor !== '')`

So organizers can proceed with an empty `tee_color`, and the create payload always sends `tee_color: teeColor` (line 192). If the API expects a non-empty tee color (common for handicap calc / course setup), this can cause failed start flows or malformed rounds.
   - Suggested fix: Require `teeColor !== ''` whenever a course is selected (regardless of whether tees are listed), or align the UI and API by explicitly allowing null/omitting tee_color when unavailable (and ensuring backend accepts that).

4. [low] Quick Event route is not blocked for anonymous users (leads to confusing dead-end UI)
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:279-285
   - Confidence: high
   - Why it matters: The access check only blocks when `session.player !== null && session.player.isOrganizer !== true`. If `session.player === null` (anonymous), the page still renders, but courses won’t load (`enabled` is false) and the user can’t progress meaningfully. While API calls should still be protected server-side, this is a footgun UX-wise and may increase support/debug noise.
   - Suggested fix: Treat `session.player === null` as not authorized for this route and render a clear sign-in CTA (or redirect to `/`).

## Strengths

- Migration 0026 cleanly adds `snake_holder_writes` and rebuilds `sub_games` solely to extend the CHECK constraint to include `snake`; the provided SQL no longer includes the stray `ALTER TABLE bets ADD line` statement, so it should apply cleanly on databases that already have `bets.line` (apps/tournament-api/src/db/migrations/0026_warm_gressill.sql:1–37).
- `snake_holder_writes` schema includes an idempotency guard via UNIQUE(round_id, client_event_id) and retains audit attribution (holder_player_id, taken_by_player_id) with RESTRICT deletes (apps/tournament-api/src/db/schema/subgames.ts:103–132).
- Home page change correctly limits auto-redirect to non-organizers, ensuring organizers can reach Quick Event even with exactly one active event (apps/tournament-web/src/routes/index.tsx:131–144).
- Phone-first tap targets look intentionally sized (minHeight control-height-lg / 44px toggles) across the hero and wizard (index.tsx OrganizerHero; admin.events.quick.tsx shared styles).

## Warnings

None.
