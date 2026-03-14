# Story P2.3.4: Handicap Auto-Refresh & Manual Refresh

Status: done

## Story

As an admin,
I want handicaps to auto-refresh from GHIN on Friday morning and to be able to manually trigger a refresh anytime,
so that course handicaps are always current and players don't have to look up their own handicap.

## Acceptance Criteria

1. **Given** a round is scheduled for a Friday with confirmed players **When** 6:00am ET on that Friday arrives **Then** the system performs a bulk GHIN refresh for all confirmed players **And** "Handicaps updated [timestamp]" reflects the refresh time

2. **Given** the admin clicks "Refresh Handicaps" **When** the refresh completes **Then** all player handicaps are updated from GHIN **And** the timestamp updates

3. **Given** handicaps are more than 12 hours old **When** the pairings page loads **Then** a visual stale indicator is shown

## Tasks / Subtasks

- [x]Task 1: Bulk handicap refresh API endpoint (AC: #1, #2)
  - [x]Add `POST /admin/rounds/:roundId/refresh-handicaps` — refreshes all round_players' HIs from GHIN
  - [x]Update each player's `handicapIndex` and round's `handicapUpdatedAt`
  - [x]Return `{ refreshed: number, failed: number, handicapUpdatedAt: number }`

- [x]Task 2: Scheduled auto-refresh with node-cron (AC: #1)
  - [x]Add `node-cron` dependency
  - [x]Schedule job for 6:00am ET every Friday
  - [x]Job finds today's scheduled round, calls internal refresh logic
  - [x]Log success/failure

- [x]Task 3: Manual refresh button on pairings page (AC: #2, #3)
  - [x]Add "Refresh Handicaps" button on pairings page (admin only)
  - [x]Show stale indicator when handicapUpdatedAt > 12 hours old
  - [x]On click, call refresh endpoint + invalidate pairings query

- [x]Task 4: Tests (AC: #1, #2)
  - [x]API: refresh-handicaps updates handicapUpdatedAt
  - [x]API: refresh returns count of refreshed players

## Dev Notes

### Bulk Refresh Logic

The existing GHIN client (`apps/api/src/lib/ghin-client.ts`) fetches one player at a time. The bulk refresh loops through round_players, looks up each player's GHIN number, and fetches current HI.

```typescript
for (const rp of roundPlayerRows) {
  if (player.ghinNumber) {
    const hi = await ghinClient.getHandicapIndex(player.ghinNumber);
    if (hi !== null) {
      await tx.update(players).set({ handicapIndex: hi }).where(eq(players.id, rp.playerId));
      await tx.update(roundPlayers).set({ handicapIndex: hi }).where(eq(roundPlayers.id, rp.id));
      refreshed++;
    }
  }
}
await tx.update(rounds).set({ handicapUpdatedAt: Date.now() }).where(eq(rounds.id, roundId));
```

### Cron Setup

In `apps/api/src/index.ts`, after server start:
```typescript
import cron from 'node-cron';
cron.schedule('0 6 * * 5', refreshHandler, { timezone: 'America/New_York' });
```

### GHIN Client Note

GHIN env vars (`GHIN_USERNAME`, `GHIN_PASSWORD`) may not be set in test/dev. The refresh endpoint should gracefully handle GHIN unavailability — return 503 GHIN_NOT_CONFIGURED if env vars absent.

### Project Structure
- Route: `apps/api/src/routes/admin/rounds.ts` (add refresh endpoint)
- Cron: `apps/api/src/index.ts` (add scheduled job)
- UI: `apps/web/src/routes/pairings.$roundId.tsx` (add refresh button + stale indicator)
- No schema changes (handicapUpdatedAt already on rounds from P2.3.2)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Completion Notes List
- 21 tests pass. Typecheck + lint clean. node-cron added as dependency.

### File List
- `apps/api/src/routes/admin/rounds.ts` — POST /rounds/:id/refresh-handicaps endpoint
- `apps/api/src/index.ts` — Friday 6am ET cron job for auto-refresh
- `apps/web/src/routes/pairings.$roundId.tsx` — stale indicator + admin refresh button
- `apps/api/package.json` — added node-cron + @types/node-cron

### Change Log
- 2026-03-14: Implemented P2.3.4 — Bulk GHIN refresh endpoint, Friday 6am cron, stale indicator, admin manual refresh
