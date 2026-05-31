---
title: 'Per-Round Tee & Side-Game Override + Rainout-Hold Rotation'
slug: 'round-tee-sidegame-override'
created: '2026-05-29'
status: 'draft'
stepsCompleted: [1]
tech_stack: ['Hono API', 'Drizzle ORM + libsql/SQLite', 'React 19 + TanStack Router/Query', 'Vitest', 'shadcn/ui + Tailwind v4']
files_to_modify:
  - 'apps/api/src/routes/admin/rounds.ts'
  - 'apps/api/src/routes/admin/side-games.ts'
  - 'apps/api/src/schemas/round.ts'
  - 'apps/web/src/routes/admin/rounds.tsx'
  - 'apps/web/src/routes/admin/season.tsx'
  - 'apps/api/src/lib/ (tee-rotation recalc — confirm location)'
code_patterns:
  - 'side game detection via scheduledRoundIds JSON (leaderboard.ts:216-219, side-game-calc-db.ts:38-47)'
  - 'round PATCH already supports tee change (admin/rounds.ts:354)'
  - 'side-games PATCH already accepts scheduledRoundIds (admin/side-games.ts:139-199)'
  - 'rainout = round.status cancelled + cancellation_reason (admin/rounds.ts:309-388)'
test_patterns:
  - 'Vitest with file::memory:?cache=shared for API routes'
  - 'side-games.test.ts has existing rotation tests'
---

# Tech-Spec: Per-Round Tee & Side-Game Override + Rainout-Hold Rotation

**Created:** 2026-05-29

## Motivating Incident

On **2026-05-29**, last week's round (2026-05-22, round 46, White / Most Polies) had been
marked **cancelled / "Rained out."** The auto-rotation worked **as designed** — per FR68 /
Story P2.1.2 the rule is *"rainouts rotate, skipped weeks hold,"* so the tee + side-game cycle
**advanced past** the washed-out week and 2026-05-29 (round 47) came up Blue / Most Net Pars.

The players decided they did **not** want that: they wanted to **replay last week's
assignment** (White tee + Most Polies) this week and push the **entire** remaining rotation
down by one Friday — i.e. treat the rainout like a *skipped* week (**hold**), not a rotate.

**UPDATE 2026-05-29 — forensic correction.** An audit of the 2024 + 2025 Final scorecards
(`reference/.../Wolf Cup 2025 Final Sheet Season Ended.xlsm`, `reference/Wolf Cup 2024 Final.xlsm`)
showed the league **always HELD** the rotation across a missed week: the 2025 May-30 rainout (ghost
col DA) resumed June 13 on the *due* tee+game (Black / CTP), and the Blue·Black·White tee cycle +
side-game cycle are **unbroken** across the gap in both years. So FR68's "rainouts rotate" was
**never the real rule** — the app implemented behavior the league never used. The 2026-05-29 fix
**restored** historical practice; it did not invent a policy. (Settled a Josh↔Jason dispute: Jason —
"we've always used the rained-out week's tee" — was right.) FR68 corrected in `epics-phase2.md`.

This was resolved **manually via direct DB edits** on prod:
- Round 47 moved from Most Net Pars (`scheduled_round_ids` id 2) to Most Polies (id 7).
- `season_weeks.tee` for the 14 remaining active weeks (2026-05-29 → 2026-09-04) shifted forward one slot.
- Each `side_games.scheduled_fridays` future portion rewritten to the shifted mapping.
- Tail consequence (organizer decision): **Closest to Pin loses its 2026-09-04 slot — plays 3× this year instead of 4×.** No makeup week added.
- DB backed up first: `wolf-cup.db.bak.before-rotation-shift.20260529`.

The manual fix is correct and live, but it is **fragile** (see Risk below) and **not repeatable**
without a developer. This spec makes the capability first-class.

## Problem Statement

1. There is **no admin UI** to set or change a round's **side game** — the rotation is computed
   at season init and only editable by hand-patching `scheduled_round_ids` JSON. Josh's words:
   *"we should have the side game as a clickable option too."* (Tee is already pickable at round
   create/edit; side game is not.)

2. **FR68 was mis-specified — the code never matched the real rule.** FR68 / P2.1.2 codifies
   *"rainouts rotate, skipped weeks hold,"* and the app implements exactly that. But the 2024 +
   2025 Final scorecards prove the league **always HELD** rainouts (see Motivating Incident
   update). So this is a **correction**, not a policy flip: bring the code in line with how the
   league has actually always played. The rule is **rainouts HOLD, identical to skipped weeks**.
   The system has no way to express it without a ~20-row hand edit.

3. Manual `season_weeks.tee` edits are **not durable** — **CONFIRMED in code (2026-05-29 audit)**:
   `apps/api/src/routes/admin/season.ts:297` recalculates **all** future week tees via
   `calculateTeeRotation(allWeeks)` on **every** week-toggle PATCH
   (`PATCH /seasons/:seasonId/weeks/:weekId`). `calculateTeeRotation`
   (`apps/api/src/utils/tee-rotation.ts:16-34`) keys **only** on `is_active` and advances the
   cycle through any active week regardless of round status — so toggling any Friday would
   **overwrite** the hand-shifted 2026 holds back to the rotated values. The comment at
   `tee-rotation.ts:22-24` encodes the old rule verbatim: *"Cancelled rounds still have their
   week active, so rotation advances naturally."* (Note: the never-implemented optional
   `cancelledDates` param sketched in the P2.1.2 Dev Notes was exactly this hold hook — it was
   dropped as "not needed" under the old rule.)

## Solution

Three capabilities, smallest-blast-radius first:

1. **Side-game picker on the admin round screen** — a dropdown of the season's 6 games; selecting
   one **moves** the round's id between `scheduled_round_ids` arrays (removes from any current
   game, adds to the chosen one) so a round is never in two games at once. Backed by the existing
   `PATCH /side-games/:id` mechanics — no schema change.

2. **Rainout cancel → choose Rotate or Hold.** When an admin cancels a round with reason
   "Rainout," offer the policy choice:
   - **Rotate** (current FR68 default): downstream unchanged.
   - **Hold / replay** (the 2026-05-29 case): shift the next active week's tee **and** side game
     to this cancelled week's assignment, cascade the shift forward, and absorb the tail (last
     game drops a playing) OR optionally append a makeup Friday. One operation instead of 20 edits.

3. **Override durability.** Per-round tee + side-game overrides and any hold-shift must **survive
   the tee-rotation recalc** triggered by calendar edits (P2.1.2). Either mark shifted/overridden
   weeks as "manually pinned" (recalc skips them) or persist the policy choice per cancelled week
   so recalc reproduces the hold deterministically.

## Scope

**In scope:**
- Admin UI side-game dropdown on round create + edit (`admin/rounds.tsx`).
- "Move round to side game" endpoint behavior that is **single-membership** (move, not add).
- Rainout cancel flow: Rotate vs Hold choice; Hold performs the cascade shift (tee + side game).
- Tail handling on Hold: default **absorb** (last cycle game loses its final playing); optional **makeup-week** append.
- Durability: shifted/overridden weeks are not clobbered by calendar-edit tee recalc.

**Out of scope:**
- Changing the default rotation rule itself (FR68 stays the default; Hold is opt-in per rainout).
- Retroactive recompute of already-finalized rounds (5/08, 5/15 stay as played).
- Multi-tenant / multi-league generalization.

## Context for Development

### Verified code locations (2026-05-29)

| Aspect | File | Detail |
| ------ | ---- | ------ |
| Side game resolved purely by `scheduledRoundIds` (display) | `apps/api/src/routes/leaderboard.ts:216-219` | `.find(sg => ids.includes(round.id))` — first match wins, so a round must be in exactly one game |
| Side game resolved purely by `scheduledRoundIds` (finalize) | `apps/api/src/lib/side-game-calc-db.ts:38-47` | loops all games, computes each whose ids include the round — being in two games double-computes |
| **Tee recalc that reverts hand edits (HIGH RISK)** | `apps/api/src/routes/admin/season.ts:297` | week-toggle PATCH overwrites all future week tees via `calculateTeeRotation(allWeeks)` |
| **Tee cycle keys only on is_active** | `apps/api/src/utils/tee-rotation.ts:16-34` | advances through any active week; comment lines 22-24 encode "cancelled rounds still advance" |
| Tee recalc tests (isActive only, no status) | `apps/api/src/routes/admin/season.test.ts:721-813` | new cancelled-round cases needed |
| Round tee already PATCH-able | `apps/api/src/routes/admin/rounds.ts:354` | `if (result.data.tee !== undefined) updates.tee = result.data.tee` |
| Side-game `scheduledRoundIds` PATCH | `apps/api/src/routes/admin/side-games.ts:139-199` | accepts new array wholesale |
| Tee per week (source of round tee at creation) | `apps/api/src/db/schema.ts:104` | `season_weeks.tee` |
| Rotation rule (FR68) | `_bmad-output/planning-artifacts/epics-phase2.md:196-199` | "rainouts rotate, skipped weeks hold" |
| No auto re-init of side games | `tech-spec-side-game-rotation-auto-calc.md:93` | rounds added after init must be assigned manually |

### Key invariant
A round must belong to **exactly one** side game. The picker and the hold-shift must both
preserve this (the leaderboard takes the first match; finalization double-computes otherwise).

## Implementation Plan (Tasks)

- [x] **Task 0 — Verify the recalc trigger (gate). DONE 2026-05-29.** Confirmed: `season.ts:297`
  recalcs all future tees via `calculateTeeRotation(allWeeks)` on every week-toggle PATCH;
  `tee-rotation.ts:16-34` keys only on `is_active` (no round-status awareness). This is the exact
  revert risk. The fix for the flipped rule: `calculateTeeRotation` must treat a week whose round
  is `cancelled` like an inactive week (return null tee, do NOT advance the index) — i.e. resurrect
  the dropped `cancelledDates` hook. Then the shift falls out naturally and the recalc reproduces
  the hold instead of reverting it.

- [ ] **Task 1 — Single-membership "set round side game" endpoint.** Add (or adapt) an admin
  endpoint `PATCH /rounds/:id/side-game { sideGameId }` that, in a transaction: removes the round
  id from every other game's `scheduled_round_ids` for the season, adds it to the target game.
  Reject if the round is finalized (would change history) unless explicitly forced. Idempotent.

- [ ] **Task 2 — Admin round-screen side-game dropdown.** In `admin/rounds.tsx`, show the current
  side game and a dropdown of the season's 6 games on round create + edit; on change call Task 1.
  Tee picker already exists — confirm it is exposed on the edit path, not just create.

- [ ] **Task 3 — Rainout cancel: Rotate vs Hold.** Extend the cancel flow (`admin/rounds.ts:309-388`)
  so that when `cancellation_reason` indicates a rainout, the admin picks Rotate (no-op downstream)
  or Hold. Hold runs the cascade: for the next active week onward, set each week's tee + side game
  to the prior active week's, absorbing the tail (or appending a makeup Friday if chosen). Reuse
  the exact transform applied manually on 2026-05-29 (documented above). All edits in one
  transaction; print/return a before→after schedule for confirmation.

- [ ] **Task 4 — Durability against recalc.** Per Task 0's finding, ensure Hold-shifted weeks and
  per-round overrides are not reverted by the calendar-edit tee recalc — pin them, or make the
  recalc reproduce the recorded Hold policy. Add a regression test that edits the calendar after a
  Hold and asserts the held tees survive.

- [ ] **Task 5 — Tests.** Unit/integration: move-not-duplicate membership; leaderboard shows the
  picked game; finalize computes only the picked game; Hold cascade produces the expected
  schedule incl. tail absorb; recalc-after-Hold preserves the hold.

## Acceptance Criteria

- **AC1** Given an admin on the round edit screen, when they pick a different side game from the
  dropdown, then the round's id is moved to that game's `scheduledRoundIds` and removed from all
  others, and the leaderboard for that round shows the picked game.
- **AC2** Given a round assigned to a side game, when finalization runs, then exactly one side
  game computes for that round (no double-compute from dual membership).
- **AC3** Given an admin cancels a round as "Rainout," when they choose **Hold**, then the next
  active week and every active week after it take the prior week's tee + side game, and the schedule
  shifts forward one Friday in a single transaction.
- **AC4** Given a Hold shift with no makeup week, when the shift completes, then the final-week
  cycle game loses one playing (tail absorbed) and this is surfaced to the admin before commit.
- **AC5** Given an admin chooses **Rotate** on a rainout cancel, then downstream tee + side-game
  assignments are unchanged (current FR68 behavior preserved).
- **AC6** Given a Hold shift has been applied, when an admin later un/re-checks a Friday in the
  calendar (triggering tee recalc), then the held tee assignments are **not** reverted.
- **AC7** Given a finalized round, when an admin attempts to change its side game, then the change
  is rejected (or requires explicit force) to protect historical results.

## Notes / Open Questions

- **Policy default — FLIPPING.** Josh confirmed 2026-05-29 the league has permanently changed
  the rule: rainouts now **hold** (like skipped weeks), not rotate. So **Hold becomes the new
  default** and Rotate becomes the legacy/opt-out path — the inverse of how the Solution above is
  ordered. This requires a **FR68 amendment** in `epics-phase2.md` (and the P2.1.2 AC text) so the
  docs match the league's actual rule. Keep Rotate selectable for the rare case, but pre-select
  Hold. **Confirm with Josh before flipping the default in code** — but plan for Hold-default.
- **Tail decision is per-incident.** On 2026-05-29 the organizer chose **absorb** (CTP → 3×).
  The Hold flow should ask each time rather than hard-code, since late-season rainouts may warrant
  a makeup Friday instead.
- **Manual 2026-05-29 state is already live** — this feature does not need to re-fix 2026; it
  prevents the next rainout from requiring a developer. The 2026 shifted schedule is the reference
  fixture for the Hold-cascade test.
