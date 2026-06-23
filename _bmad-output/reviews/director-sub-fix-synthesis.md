# Gemini Synthesis (Debate Tribunal)

- Generated: 2026-06-23T02:25:07.710Z
- Synthesized sources: codex-review, gemini-review, rules-subagent
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\Wolf-cup
- Evidence files: (prior outputs only)

## Verdict

**HOLD** — confidence: high

## Executive summary

The code correctly implements the roster badge as the single source of truth for Wolf Cup official rounds, complying with all documented rules and successfully passing manual overrides. However, the verdict is 'hold' due to severe regressions in secondary flows: the add-sub endpoint can silently strip active members of their full status, and the season-sync logic incorrectly writes to previous seasons during the preseason. Known standings leaks and manual override behaviors are explicitly accepted per the product owner constraints and have been dismissed as defects.

## High-confidence findings (consensus)

1. [high] Add Sub endpoint can silently demote active members
   - File: attendance.ts
   - Affirming sources: gemini-review
   - Summary: If a submitted sub's GHIN matches an existing active player, the endpoint silently overwrites their global status to 'sub', effectively demoting a full member.
   - Recommended action: Return a 409 Conflict if the existing player's status is 'active', or add them to the week without mutating their global player status.

2. [medium] Add-sub flow lacks transaction safety
   - File: attendance.ts
   - Affirming sources: codex-review
   - Summary: Failures during bench or attendance insertion will leave a player's global status permanently set to 'sub' because the initial player PATCH and subsequent inserts are not wrapped in a single database transaction.
   - Recommended action: Wrap the add-sub player mutation and subsequent attendance/bench records in a database transaction.

3. [low] Legacy isActive mapping is a latent foot-gun
   - File: roster.ts
   - Affirming sources: gemini-review
   - Summary: Mapping isActive:1 to status='active' silently clobbers existing 'sub' statuses on benign updates. While the product owner confirmed the web app passes {status} directly (making this latent), the legacy handler remains unsafe.
   - Recommended action: Drop the legacy isActive mapping or restrict it to only apply if the existing status is 'inactive'.

## Divergent findings (need resolution)

1. Season Sub-Bench Sync Date Logic
   - Reviewers disagree on whether the `lte(startDate,today)` logic correctly handles season boundaries for syncing sub-bench data.
   - Positions:
     - **codex-review** (Logic is sound): The lte(startDate,today) combined with descending order effectively addresses future-season-steal.
     - **gemini-review** (Logic introduces bugs): Using lte(startDate,today) writes to the previous finalized season during preseason. Furthermore, toISOString() UTC flips the date boundary early in US timezones.
   - Synthesizer lean: gemini-review is correct. UTC timezone boundaries will cause early date flips in the US, and `lte(today)` fundamentally fails to target the correct season during the preseason gap when `today` is prior to the new season's start date.

## Dismissed findings

1. Existing leaked official rows are not repaired
   - Raised by: codex-review
   - Dismissal reason: disagreed_with_justification
   - Reasoning: Product owner constraint (b) explicitly states that repairing existing rows for known subs (Chatterton, Kluemper) is a separate, already-planned data-fix step, not a code defect.

2. Per-round sub toggle bypasses roster badge-wins rule
   - Raised by: gemini-review
   - Dismissal reason: disagreed_with_justification
   - Reasoning: Product owner constraint (a) explicitly identifies the per-round sub toggle as a deliberate manual admin override. Escaping the rule here is an accepted design choice, though low-cost guards against accidental usage are recommended as a hardening measure.

## Prioritized actions

1. [must_fix_before_send] Fix `attendance.ts` to prevent demoting active members: return a 409 Conflict (or skip global status mutation) if an added sub matches an existing active player.
2. [must_fix_before_send] Fix `roster.ts` season sync date logic to target the correct current/upcoming season (e.g., sort by desc(id) without the lte(today) constraint) and remove UTC toISOString() boundary flaws.
3. [should_fix] Wrap the add-sub flow in `attendance.ts` in a transaction to prevent partial state corruption on failure.
4. [optional] Add a low-cost guard to the per-round sub toggle (e.g., return 422 if attempting to set isSub=false for an official round when players.status !== 'active') to prevent accidental leaks while preserving the intentional admin override.
5. [optional] Remove the legacy `isActive: 1` mapping in `roster.ts` to neutralize the latent foot-gun.

## Open questions (for human judgment)

- Does the application fundamentally require a synced 'subBench' state, or could the UI and queries derive attendance entirely from `players.status === 'sub'` as suggested by gemini-review to eliminate the sync boundary bugs completely?

## Warnings

None.
