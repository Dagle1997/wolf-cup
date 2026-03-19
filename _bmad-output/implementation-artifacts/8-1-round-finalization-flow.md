# Story 8.1: Round Finalization Flow

Status: done

## Story

As an admin,
I want to finalize an official round once all groups have submitted all 18 holes,
so that the round is locked, standings are frozen, and scorers can no longer edit scores.

## Background / Context

Currently, official rounds stay in `active` status forever — there is no finalization
mechanism. The scorer summary screen shows "Awaiting finalization by admin" but no admin
button exists to perform it. Standings and stats run on live data regardless.

A round must be finalized to:
- Lock scores (prevent further edits by scorers)
- Produce an immutable record for the season standings
- Enable post-round score corrections via the admin audit flow (corrections only apply to finalized rounds)

## Acceptance Criteria

1. **`POST /admin/rounds/:id/finalize` endpoint**
   - Requires admin session auth
   - Round must be `active` (not scheduled, finalized, or cancelled) → 422 if not
   - Marks round as `finalized` in DB
   - Returns `{ id, status: 'finalized' }` with 200

2. **Group completion status on admin rounds list**
   - `GET /admin/rounds` response includes per-round `groupCompletion` field:
     `{ total: number, complete: number }` where "complete" = groups with all 18 holes scored
   - Used to show progress in admin UI before finalization

3. **Admin Rounds UI — Finalize button**
   - Active official rounds show group completion progress: "2 / 3 groups complete"
   - A "Finalize Round" button appears when ALL groups are complete (complete === total && total > 0)
   - Button is disabled with tooltip "Waiting for all groups" when not all complete
   - Clicking shows a confirmation dialog: "Finalize round on [date]? Scores will be locked."
   - On confirm: calls `POST /admin/rounds/:id/finalize`, refreshes rounds list
   - Success: round row shows "Finalized" status badge, Finalize button disappears
   - Error: inline error message

4. **Scorer "Round Complete" screen — finalization awareness**
   - The summary screen (hole 19 view) polls `GET /rounds/:roundId` every 5 seconds
   - While round is `active`: shows "Awaiting finalization by admin" (current behavior)
   - Once round becomes `finalized`: banner changes to "Round Finalized ✓" in green
   - Polling stops after finalization is detected
   - No edit actions available on the summary screen (scores already posted per-hole)

5. **Score entry locked on finalized rounds**
   - All score POST/PUT endpoints already return 422 for finalized rounds — no change needed
   - Scorer who somehow navigates to score entry for a finalized round sees the summary screen (hole 19 state) with "Round Finalized ✓"

6. **Tests**: `pnpm --filter @wolf-cup/api test` passes; new tests cover:
   - Finalize endpoint happy path (active → finalized)
   - 422 when round not active
   - 422 when not all groups have 18 holes (admin should still be able to force-finalize — see Dev Notes)
   - Auth guard (401 without session)

7. **Typecheck**: `pnpm --filter @wolf-cup/api typecheck` and `pnpm --filter @wolf-cup/web typecheck` both pass.

## Dev Notes

### Force-finalize
The endpoint should finalize regardless of group completion — it's the admin's
responsibility to decide when to lock the round. The UI enforces the "all complete"
gate; the API does not. This allows edge cases (e.g., a group that had to leave early).

### Polling in scorer UI
Use `useQuery` with `refetchInterval: 5000` on the round detail fetch.
Stop polling with `refetchIntervalInBackground: false` and set `refetchInterval` to
`false` once `round.status === 'finalized'`.

### Admin rounds response
The `groupCompletion` field requires a subquery: for each round, count groups with
18 distinct holeScores vs total groups. Keep it simple — a `GROUP BY` on groups joined
to hole_scores.

### No stats/standings recalculation needed
Standings and stats are already computed on-the-fly from `round_results` /
`harvey_results` which are written atomically at score entry time. Finalization just
changes the round status flag — no recomputation required.

### Casual rounds
Casual rounds use `quit` (not `finalize`) — they cancel when the last group quits.
The finalize endpoint should reject casual rounds (422 with code `CASUAL_ROUND`).

## Tasks / Subtasks

- [ ] Task 1: Backend — finalize endpoint
  - [ ] Add `POST /admin/rounds/:id/finalize` to `apps/api/src/routes/admin/rounds.ts`
  - [ ] Validate admin auth, round exists, round is active (not casual)
  - [ ] Update status to 'finalized' in DB
  - [ ] Return `{ id, status }` 200

- [ ] Task 2: Backend — group completion in rounds list
  - [ ] Extend `GET /admin/rounds` to include `groupCompletion: { total, complete }`
  - [ ] `complete` = count of groups where holeScores count for that group = 18 (distinct holes)

- [ ] Task 3: API tests
  - [ ] Test finalize happy path, wrong status, casual round, no auth
  - [ ] Test groupCompletion field in rounds list

- [ ] Task 4: Admin rounds UI — finalize button
  - [ ] Show "X / Y groups complete" on active official rounds
  - [ ] "Finalize Round" button, disabled until all complete
  - [ ] Confirmation dialog
  - [ ] Call finalize endpoint, refresh list on success

- [ ] Task 5: Scorer summary screen — finalization polling
  - [ ] Add `refetchInterval: 5000` to round detail query on hole-19 summary screen
  - [ ] Swap "Awaiting finalization" → "Round Finalized ✓" on status change
  - [ ] Stop polling once finalized

- [ ] Task 6: Quality gates
  - [ ] `pnpm --filter @wolf-cup/api test`
  - [ ] `pnpm --filter @wolf-cup/api typecheck`
  - [ ] `pnpm --filter @wolf-cup/web typecheck`
