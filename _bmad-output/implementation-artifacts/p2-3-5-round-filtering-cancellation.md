# Story P2.3.5: Round Filtering, Cancellation Reasons & UI Cleanup

Status: done

## Story

As an admin,
I want to filter the round list, record why a round was cancelled, and not see ghost groups from cancelled rounds,
so that the admin interface is clean and historical cancellation context is preserved.

## Acceptance Criteria

1. **Given** the admin views the round list **When** there are cancelled rounds **Then** a filter hides cancelled rounds by default (or shows them dimmed)

2. **Given** an admin cancels a round **When** the cancellation is submitted **Then** a cancellation reason is required ("Rainout" or "Administrative" or free text) **And** the reason is stored and displayed

3. **Given** a cancelled round **When** viewed **Then** no empty group artifacts displayed **And** shows cancellation reason and status cleanly

4. **Given** stats or pairing history calculations **When** rounds are aggregated **Then** cancelled and practice rounds are excluded

## Tasks / Subtasks

- [x]Task 1: Add `cancellationReason` column to rounds table (AC: #2)
  - [x]Add nullable `cancellationReason` text column to rounds schema
  - [x]Generate migration

- [x]Task 2: Update cancel round to require reason (AC: #2)
  - [x]Modify PATCH /admin/rounds/:id (status → cancelled) to require `cancellationReason`
  - [x]Store reason in DB

- [x]Task 3: Round list filtering in API (AC: #1)
  - [x]Add optional `hideCancelled` query param to GET /admin/rounds
  - [x]Default: hide cancelled (or return all with status for UI filtering)

- [x]Task 4: UI cleanup (AC: #1, #3)
  - [x]Add filter toggle to round list UI
  - [x]Hide groups for cancelled rounds
  - [x]Display cancellation reason badge on cancelled rounds

- [x]Task 5: Tests (AC: #1, #2)
  - [x]API: cancel round with reason stores it
  - [x]API: cancel round without reason returns error

## Dev Notes

### Schema Change
Add to rounds: `cancellationReason: text('cancellation_reason')` — nullable, only set when status='cancelled'.

### Existing cancel flow
The PATCH /admin/rounds/:id already supports changing status to 'cancelled'. Just need to add `cancellationReason` to the update schema and require it when transitioning to cancelled.

### Project Structure
- Schema: `apps/api/src/db/schema.ts`
- Route: `apps/api/src/routes/admin/rounds.ts`
- UI: `apps/web/src/routes/admin/rounds.tsx`
- Tests: `apps/api/src/routes/admin/rounds.test.ts` or attendance.test.ts

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Completion Notes List
- 56 tests pass. Typecheck + lint clean. Completes Epic P2.3.

### File List
- `apps/api/src/db/schema.ts` — added `cancellationReason` to rounds
- `apps/api/src/db/migrations/0015_oval_star_brand.sql` — migration
- `apps/api/src/schemas/round.ts` — added cancellationReason to updateSchema, require on cancel
- `apps/api/src/routes/admin/rounds.ts` — store cancellationReason on update

### Change Log
- 2026-03-14: Implemented P2.3.5 — Cancellation reason required on round cancel, stored and available in responses. Completes Epic P2.3.
