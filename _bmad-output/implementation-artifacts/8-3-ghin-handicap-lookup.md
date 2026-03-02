# Story 8.3: GHIN Handicap Index Lookup & Per-Round HI Management

Status: ready-for-dev

## Story

As an admin,
I want to look up a player's current Handicap Index from GHIN by their GHIN number
and apply it to a round,
so that I can quickly set accurate handicap indexes day-of without manual entry.

## Background / Context

Handicap indexes are stored in `round_players.handicap_index` — set once when a
player joins a round. Currently there is no UI to set or view these values before or
during a round, and no way to pull them from the USGA GHIN system.

The `n8io/ghin` npm package provides an unofficial TypeScript wrapper around the GHIN
web API. It authenticates with a GHIN.com username + password (not a developer API
key). The admin's personal GHIN credentials are stored server-side in `.env` — never
exposed to the client.

Additionally, the admin rounds UI has no way to view or set player handicap indexes
for a given round — this story adds that capability.

## Acceptance Criteria

1. **Backend — GHIN lookup endpoint**
   - `GET /admin/ghin/:ghinNumber` (admin auth required)
   - Calls `ghin.handicaps.getOne(ghinNumber)` using credentials from env
   - Returns `{ ghinNumber, handicapIndex: number, retrievedAt: string }`
   - 404 if GHIN number not found
   - 503 with `code: 'GHIN_UNAVAILABLE'` if GHIN API is unreachable
   - Credentials loaded from `GHIN_USERNAME` + `GHIN_PASSWORD` env vars
   - The GhinClient is initialized once at server startup (not per-request) and reused

2. **Backend — set handicap index on round player**
   - `PATCH /admin/rounds/:roundId/players/:playerId/handicap`
   - Body: `{ handicapIndex: number }` (0.0–54.0)
   - Admin auth required
   - Round must not be finalized (use corrections flow for finalized rounds)
   - Updates `round_players.handicap_index`
   - Returns `{ playerId, roundId, handicapIndex }`

3. **Backend — get round players with HI**
   - `GET /admin/rounds/:roundId/players` — list all players in the round with their
     current `handicapIndex`, `groupId`, `groupNumber`, `isSub`
   - Admin auth required

4. **Admin Roster UI — GHIN fetch button**
   - Each player row that has a `ghinNumber` shows a "Fetch HI" icon button
   - Clicking calls `GET /admin/ghin/:ghinNumber`
   - Shows fetched HI inline: "Current HI: 14.2 (as of today)"
   - Button to dismiss; no auto-save to roster (HI is per-round, not per-player global)

5. **Admin Rounds UI — round handicaps panel**
   - Active rounds show a "Handicaps" expandable section per round
   - Lists each player in the round: name, group #, current HI in DB, "Fetch" button (if GHIN #)
   - Inline edit field for HI (numeric, step 0.1)
   - "Save" button calls `PATCH /admin/rounds/:roundId/players/:playerId/handicap`
   - "Fetch" button auto-populates the edit field with live GHIN value (admin still clicks Save)
   - Changes take effect immediately (no round restart needed for scheduled/active rounds)

6. **`.env` additions** (document in `.env.example`)
   ```
   GHIN_USERNAME=your-ghin-email@example.com
   GHIN_PASSWORD=your-ghin-password
   ```
   If env vars are absent, the GHIN fetch endpoint returns 503 with
   `code: 'GHIN_NOT_CONFIGURED'`.

7. **Error handling**
   - GHIN API rate limit or auth failure: surface as toast error in UI "GHIN lookup
     failed — check credentials or try again"
   - Network timeout: 10s timeout on GHIN API calls

8. **Tests**
   - Mock `n8io/ghin` in unit tests (never call real GHIN in CI)
   - Test: successful lookup returns handicap_index
   - Test: 404 for unknown GHIN number
   - Test: 503 when env vars missing
   - Test: PATCH handicap endpoint updates round_players

9. **Typecheck**: `pnpm --filter @wolf-cup/api typecheck` and `pnpm --filter @wolf-cup/web typecheck` pass.

## Dev Notes

### Installing the package
```
pnpm --filter @wolf-cup/api add ghin
```
Check if `@spicygolf/ghin` (fork) has more recent fixes — prefer whichever resolves
GHIN auth correctly as of implementation date. Both have the same API surface.

### GhinClient singleton
Initialize in `apps/api/src/lib/ghin-client.ts`:
```typescript
import { GhinClient } from 'ghin';
export const ghinClient = process.env.GHIN_USERNAME && process.env.GHIN_PASSWORD
  ? new GhinClient({ username: process.env.GHIN_USERNAME, password: process.env.GHIN_PASSWORD })
  : null;
```

### HI vs Course Handicap
GHIN returns `handicap_index` (the portable index). The app stores this directly in
`round_players.handicap_index` and uses it with the engine's `calculateCourseHandicap`
to derive the stroke allocation per hole. Do NOT confuse with Course Handicap.

### No GHIN calls in CI
Vitest tests must mock the `ghin` module. Use `vi.mock('ghin', ...)` to return a fake
client. The real GHIN API is only called from the live server.

### Relationship to Story 8.2
If a round is already finalized and the HI needs correcting, use the Story 8.2
`handicapIndex` correction flow (not this endpoint). The `PATCH` endpoint in this
story is for pre-finalization adjustments only.

## Tasks / Subtasks

- [ ] Task 1: Install ghin package
  - [ ] `pnpm --filter @wolf-cup/api add ghin` (or @spicygolf/ghin)
  - [ ] Create `apps/api/src/lib/ghin-client.ts` singleton

- [ ] Task 2: Backend — GHIN lookup endpoint
  - [ ] `GET /admin/ghin/:ghinNumber` in admin routes
  - [ ] Handle missing credentials (503), not found (404), network error (503)

- [ ] Task 3: Backend — set HI endpoint
  - [ ] `PATCH /admin/rounds/:roundId/players/:playerId/handicap`
  - [ ] Validate range, update round_players, return updated record

- [ ] Task 4: Backend — get round players with HI
  - [ ] `GET /admin/rounds/:roundId/players`
  - [ ] Join groups table for groupNumber

- [ ] Task 5: API tests (mocked GHIN)

- [ ] Task 6: Admin Roster UI — Fetch HI button
  - [ ] Icon button on rows with ghinNumber
  - [ ] Show fetched HI inline

- [ ] Task 7: Admin Rounds UI — Handicaps panel
  - [ ] Expandable section per active round
  - [ ] Fetch + inline edit + save per player

- [ ] Task 8: .env.example update, quality gates
