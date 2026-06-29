# Codex Review

- Generated: 2026-06-29T15:10:40.039Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/admin.events.quick.tsx, apps/tournament-web/src/routes/index.tsx

## Summary

Most director-requested fixes are present and appear correctly wired: point value is validated (integer dollars) and gates Start, arrange dropdown offers `numFoursomes + 1`, tee is required, `/admin/events/quick` is auth-gated, and home auto-redirect now keys off `activeEvents.length === 1` and never auto-redirects organizers. Remaining concerns are mainly “defense in depth” validation (money-safety) and a missing error state that can hard-block the wizard if courses fail to load.

Overall risk: medium

## Findings

1. [high] Start handler still allows invalid point value to reach API (UI-only gate); can send NaN→null cents and/or create partial events before failing
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:177-286
   - Confidence: high
   - Why it matters: You correctly disable the Start button when `pointValid` is false (and show an inline error), but `handleStart()` itself does not enforce `pointValid`. If the handler is triggered despite the disabled UI (future refactor, programmatic call, test harness, or DOM manipulation), it will compute `pointDollarsNum` from an invalid string (NaN) and then send `cents: pointDollarsNum * 100` (JSON.stringify will serialize NaN as `null`). That can produce money-unsafe config, or more likely fail at step 5 after step 1 already created an event, leaving more “half-created events” than necessary.
   - Suggested fix: Add a hard guard at the top of `handleStart()` (before creating the event) and compute cents defensively:
- `if (guyanOn && !pointValid) { setError('invalid_point_value'); setBusy(false); return; }`
- Optionally `const cents = Math.trunc(pointDollarsNum) * 100;` and ensure `Number.isSafeInteger(cents)`.
Also consider guarding other step prerequisites (`step1Valid`, `step2Valid`) similarly to avoid partial creation from impossible states.

2. [medium] Quick Event wizard has no visible error state if courses fail to load (can hard-block Step 1 with an empty select)
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:114-367
   - Confidence: high
   - Why it matters: Step 1 renders `LoadingCard` only while `coursesQuery.isPending` (line ~312), but if `/api/courses` errors, the UI falls through to the normal form with `courses = []`, making it look like there are no courses and leaving `step1Valid` permanently false (courseRevisionId can’t be selected). This is a functional blocker in real failure modes (auth/cookie issue, server transient, network).
   - Suggested fix: Handle `coursesQuery.isError` explicitly in Step 1 (e.g., show an `ErrorCard`/message with retry) and/or disable the form with a clear error until courses are available.

3. [medium] `confirmNoModifiers` logic may still misrepresent enabled bonus state when only Net skins is on
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:180-279
   - Confidence: medium
   - Why it matters: `noClaimsOn` is defined as `!greenie && !polie && !sandie` (line ~182) and used for `confirmNoModifiers: guyanOn && noClaimsOn` (line ~278). But the UI labels Net skins under “Bonuses” and it’s sent as a modifier (lines ~236–241). With Net skins enabled and the other three disabled, you will still send `confirmNoModifiers: true`, which contradicts “no modifiers/bonuses” semantics and could (depending on backend validation) bypass a guard or cause a start rejection.
   - Suggested fix: Align the flag with backend semantics:
- If the backend guard is truly “no *claim* bonuses”, rename variables/inline comment to match and ensure backend expects that.
- If it’s “no modifiers at all”, include `'net-skins'` in the check (e.g., `const noModifiersOn = Object.values(ruleEnabled).every(v => !v)`), then `confirmNoModifiers: guyanOn && noModifiersOn`.

4. [low] Tee is validated with `trim()` but sent untrimmed (free-text tee can carry leading/trailing spaces)
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:171-201
   - Confidence: high
   - Why it matters: Step 1 validity requires `teeColor.trim() !== ''` (line ~173), but the create payload sends `tee_color: teeColor` (line ~200) without trimming. For free-text tee entry, this can persist accidental whitespace, which can lead to mismatches if any downstream code compares tee_color strings exactly.
   - Suggested fix: Send `tee_color: teeColor.trim()` (and optionally trim on `setTeeColor` for the free-text input).

## Strengths

- Point value validation matches the stated intent: whole-dollar integer required when Guyan is on; Start is disabled and shows an inline error when invalid (apps/tournament-web/src/routes/admin.events.quick.tsx:177-443, 475-480).
- Arrange step now always offers one additional group option (`numFoursomes + 1`), enabling splitting a full foursome into multiple groups (apps/tournament-web/src/routes/admin.events.quick.tsx:168-414).
- Tee is now required at Step 1, with a free-text fallback when a course has no tees (apps/tournament-web/src/routes/admin.events.quick.tsx:171-345).
- Quick Event route is now auth-gated via `beforeLoad: requireAuthOrRedirect()` (apps/tournament-web/src/routes/admin.events.quick.tsx:498-503).
- Home page redirect logic now uses `activeEvents.length === 1` and excludes organizers from auto-redirect, matching the director review requirement (apps/tournament-web/src/routes/index.tsx:117-145).
- OrganizerHero provides clear CTAs for both Quick Event and full event creation, and is rendered in both empty and multi-event organizer states (apps/tournament-web/src/routes/index.tsx:52-270).

## Warnings

None.
