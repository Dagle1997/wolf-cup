---
title: 'CTP Per-Par-3 Prompt'
slug: 'ctp-per-par3-prompt'
created: '2026-04-22'
status: 'proposed'
stepsCompleted: []
tech_stack: ['Hono API', 'Drizzle ORM + SQLite', 'React 19 + TanStack Router/Query', 'Vitest', 'IndexedDB (idb)', 'shadcn/ui + Tailwind v4']
files_to_modify:
  - 'apps/api/src/db/schema.ts'
  - 'apps/api/src/db/migrations/NNNN_side_game_ctp_entries.sql (new)'
  - 'apps/api/src/schemas/side-game.ts'
  - 'apps/api/src/routes/rounds.ts'               # highlights endpoint: add Par 3 Champion
  - 'apps/api/src/routes/leaderboard.ts'
  - 'apps/api/src/routes/admin/rounds.ts'
  - 'apps/api/src/routes/admin/side-games.ts'
  - 'apps/api/src/routes/stats.ts'                # season Par 3 Champion stat
  - 'apps/api/src/lib/badges.ts'
  - 'apps/api/src/routes/history.ts'
  - 'apps/web/src/routes/score-entry-hole.tsx'
  - 'apps/web/src/routes/stats.tsx'               # season Par 3 Champion card
  - 'apps/web/src/routes/index.tsx'
  - 'apps/web/src/lib/offline-queue.ts'
  - 'apps/web/src/hooks/useOfflineQueue.ts'
  - 'new: apps/api/src/lib/ctp.ts'
  - 'new: apps/web/src/components/CtpPrompt.tsx'
code_patterns:
  - 'side game detection via scheduledRoundIds JSON'
  - 'score entry conditional UI via PAR3_HOLES set + sideGame.calculationType'
  - 'offline queue: IndexedDB entry + drain on online event, sequential by holeNumber'
  - 'upsert pattern: onConflictDoUpdate via unique index'
  - 'leaderboard card: current in-play + post-finalize winner banner'
test_patterns:
  - 'Vitest with in-memory SQLite for API routes'
  - 'side-games.test.ts has 20 existing tests'
  - 'pairings.test.ts has 6 tests (just added)'
  - 'practice-round.integration.test.ts for per-hole flows'
---

# Tech-Spec: CTP Per-Par-3 Prompt

**Created:** 2026-04-22

## Revision 2 — 2026-04-22 (post codex-review)

Codex review returned 5 design-level findings (3 High, 2 Med). All applied. Key changes from Revision 1:

- **Ordering anchor (Codex #1, High):** Replaced fragile `updated_at` (server sync time; wrong under offline backfill) with `hole_completed_at` — a server-captured timestamp of the moment the 4th score for that group+hole landed. CTP entries attach to that completion event; ordering is deterministic and matches real-world play order regardless of sync timing.
- **No writes to `side_game_results` for CTP (Codex #3, High):** Per-par-3 winners live ONLY in the new `side_game_ctp_entries` table. The Season Par 3 Champion stat reads directly from that table. The existing Side Game Champion trophy's CTP credit is synthesized in `computeAllAwards` by joining `side_game_ctp_entries` and awarding 1 credit per (round, unique winner). Zero data-shape change to `side_game_results`; no downstream audit burden.
- **Admin override dropped from v1 (Codex #2, High):** Legacy `POST /rounds/:roundId/side-game-results` path no longer applies to CTP. If a CTP correction is needed, admin edits `side_game_ctp_entries` directly (future admin UI; out of scope here). Keeps the source-of-truth single.
- **Unique index includes tenant+context (Codex #6, Med):** `UNIQUE (tenant_id, context_id, round_id, group_id, hole_number)`. Consistent with migration 0025 ecosystem-identity foundation.
- **Prompt trigger compares against actual group size (Codex #7, Med):** Fires when `scoresForHole.length === group.players.length`, not literal 4. Handles 3-player no-show groups correctly.

Status: `proposed → approved-pending-josh-sign-off`.

## Overview

### Problem Statement

Closest-to-Pin (CTP) is one of six side games in the 2026 season rotation. The current implementation is a single admin-entered manual winner via `POST /rounds/:roundId/side-game-results` recorded after the round. This does not match real-world play: at Guyan each of the 4 par 3s (holes 6, 7, 12, 15) has its own CTP competition, groups use a physical tee-marker on the green that later groups can displace if they land closer, and it is common for nobody to hit the green on a given par 3 (no winner for that hole).

### Solution

Replace the single-winner flow with an in-play per-par-3 prompt. After a group finishes scoring a par 3 on CTP weeks, any player in the round is prompted: "Was anyone closest to the pin on hole X?" with a roster picker (group members first) and a prominent "No one" button. Each group's answer is stored. The round's live "current winner" for a hole is the most recent positive answer across all groups. No winner for a hole is a valid terminal state. Leaderboard shows the 4 par 3s with current winners (or an em-dash) during play and on the finalized-round banner.

### Scope

**In Scope**
- New `side_game_ctp_entries` table with one row per `(round, group, hole)` answer
- New endpoint `POST /rounds/:roundId/ctp-entries` — any round-joined player can record/overwrite their group's answer for a par 3
- New endpoint `GET /rounds/:roundId/ctp-entries` — list all entries for leaderboard + score-entry prompt state
- Score-entry modal prompt that fires when all 4 players have a score for a par 3 on CTP weeks (per-group, one prompt per group per par 3)
- Offline queue support: CTP entry enqueued + drained same as score submissions
- Leaderboard Side Game card renders 4 par-3 rows with current winner or "—" during play and after finalization
- Finalization: set `finalized_at` on every `side_game_ctp_entries` row for the round. NO writes to `side_game_results` (source of truth stays in the CTP table — see Revision 2 note). Post-finalize POSTs are rejected with `ROUND_FINALIZED`.
- **Round-level "Par 3 Champion" highlight** — when a player wins ≥2 par 3s in a single CTP round, include a "🎯 Par 3 Champion" entry in the round's highlight reel crediting them
- **Season "Par 3 Champion" stat** — new card on `/stats` listing top players by total CTPs won across all CTP rounds in the current season. Leader + tied leaders labeled "Par 3 Champion"
- **Per-par-3 counting** — every par-3 CTP win counts individually toward the season stat and any badge pipeline; a round where one player wins 3 of 4 par 3s counts as 3 CTPs, not 1
- Practice rounds: prompt does NOT fire (practice rounds are not in the rotation)
- Admin override: OUT of v1. CTP does not route through `side_game_results`. Corrections via direct SQL until a v2 admin UI ships.
- "Side Game Champion" (existing season trophy) counting for CTP rounds: **1 credit per unique CTP-winning player in that round** (keeps consistency with other side games — otherwise a CTP round over-weights; the Par 3 Champion track is where per-hole wins are rewarded)

**Out of Scope**
- Historical backfill — 2026 rounds before this feature ships keep their single admin-entered winner if any
- Per-hole "Par 3 Specialist" hole-specific awards (e.g., "Master of Hole 12" — future)
- Champions & History page trophy for season Par 3 Champion (future polish — stat card on /stats is sufficient for v1)
- Payout tracking / ledger — the league pays CTP winners outside the app; the app only reports counts
- CTP for other courses (single-course app today)
- Replay/scoreboard-style display of who displaced whom
- SMS/push notifications when someone sets a new CTP
- CTP on casual/practice rounds

## Context for Development

### Codebase Patterns

- **Par-3 detection:** `PAR3_HOLES = new Set([6, 7, 12, 15])` is declared redundantly in at least 5 files. This spec keeps the redundancy (local-copy pattern is established); no new shared constant is introduced.
- **Side game detection:** Leaderboard (`leaderboard.ts:202-223`) and pairings (`pairings.ts:50-68`, just added) parse `sideGames.scheduledRoundIds` JSON and match current round ID.
- **Score entry per-hole:** `score-entry-hole.tsx` is the per-hole React view. It already has `PAR3_HOLES` and a conditional `sideGame.calculationType` input (putts on Least Putts weeks). CTP prompt plugs in the same place.
- **Offline queue:** IndexedDB via `idb` (`lib/offline-queue.ts`). Each entry is `{ roundId, groupId, holeNumber, scores, wolfDecision?, entryCode }`. Drain in `useOfflineQueue.ts:31-88` is sequential by holeNumber. CTP drain runs **after** score and wolf-decision submissions for the same hole.
- **Finalization hook:** `POST /rounds/:id/finalize` in `admin/rounds.ts` runs status → Harvey → pairings → side-game auto-calc. CTP finalization sets `finalized_at` on all CTP entries for the round; no `side_game_results` writes (non-fatal).
- **Award pipeline:** `computeAllAwards()` in `badges.ts` currently reads `side_game_results` for all side-game wins. This spec adds a CTP branch that additionally queries `side_game_ctp_entries` (joined by `sideGames.name = 'Closest to Pin'` + season) and awards 1 credit per unique winner per CTP round. Non-CTP side games continue reading `side_game_results` unchanged.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/api/src/db/schema.ts:367-386` | `sideGames` table (for reference — CTP is `calculationType: 'manual'`) |
| `apps/api/src/routes/admin/side-games.ts:418-425` | `SIDE_GAME_DEFINITIONS` — CTP entry is `{ name: 'Closest to Pin', format: 'Closest tee shot on par 3s', calculationType: 'manual' }` |
| `apps/api/src/routes/leaderboard.ts:202-223` | Side game lookup pattern — CTP card reads from new table |
| `apps/api/src/routes/admin/rounds.ts:706-758` | Finalization hook — set `finalized_at` on CTP entries for the round (no `side_game_results` writes) |
| `apps/api/src/lib/badges.ts` | `computeAllAwards()` — add CTP branch that reads `side_game_ctp_entries` (1 credit per unique winner per round); non-CTP path unchanged |
| `apps/web/src/routes/score-entry-hole.tsx:19-22` | `PAR3_HOLES` + hole advance — prompt trigger point |
| `apps/web/src/hooks/useOfflineQueue.ts:31-88` | Queue drain — add CTP POST after wolf-decision |
| `apps/web/src/lib/offline-queue.ts` | `QueueEntry` shape — add optional `ctpEntry` field |

### Technical Decisions

- **One row per `(tenant_id, context_id, round_id, group_id, hole_number)` — not append-only log.** Re-submit overwrites. Unique index enforces. Simpler than audit log; sufficient because the physical tee-marker + honor system is the source of truth, not app history.
- **"Current winner" resolution uses `hole_completed_at`, NOT `updated_at`.** `hole_completed_at` is a server-set `INTEGER NOT NULL` captured the instant the 4th score for that group+hole is upserted (see "Hole completion timestamp" below). Current winner = entry with `MAX(hole_completed_at)` across groups for `(round_id, hole_number)` WHERE `winner_player_id IS NOT NULL`. Rationale: `updated_at` reflects server sync time, so an offline-queued entry that drains at noon could incorrectly beat an entry actually submitted at 11:30am online. Anchoring to the hole-completion event makes ordering match real-world play regardless of when the client syncs. Ties broken by `MAX(group_id)`.
- **Hole completion timestamp:** On `POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/scores`, after a successful upsert, the server checks whether `COUNT(hole_scores WHERE round_id=R AND group_id=G AND hole_number=H) === group.players.length`. If so AND a `hole_completions` row does not yet exist, insert one. Schema: new `hole_completions(round_id, group_id, hole_number, completed_at)` table with unique `(round_id, group_id, hole_number)`. On CTP POST, the server copies `hole_completions.completed_at` into the `side_game_ctp_entries.hole_completed_at` column. If the completion row is missing at CTP POST time (e.g., a score was deleted, or the client submitted before the 4th score), reject with 422 `CODE: 'HOLE_NOT_COMPLETE'` — the UI should not have shown the prompt in that state anyway.
- **"No one" is stored as a row with `winner_player_id IS NULL`, NOT absence of a row.** Absence means "this group has not answered yet, prompt them." Explicit null means "this group answered 'nobody'." Frontend distinguishes.
- **Prompt trigger:** Fires when every player on the group roster has a score for the par 3 AND the group has not already answered for that par 3. The size comparison uses actual group size, not a hard-coded 4: `scoresForHole.length === currentGroup.players.length && par3 && !hasCtpEntry(groupId, holeNumber)`. This handles 3-player no-show groups correctly. Modal is dismissible (tap outside) so it can reappear on next hole-load if the player wants to defer; suppressed once an entry exists.
- **Authorization:** Any player whose `session.roundId === roundId` (i.e., joined the round via entry code) can POST. Not restricted to that player's own group — real-world a player from group 1 might tap in group 2's answer, or an admin's device is in use. Middleware check: `session.roundId === roundId`. No admin token required.
- **Admin override is OUT OF v1.** The legacy `POST /rounds/:roundId/side-game-results` path is NOT used for CTP in this feature — CTP is moving to a dedicated table and does not route through `side_game_results` at all. If an admin needs to correct a CTP outcome before v2, they can UPDATE `side_game_ctp_entries` directly (SQL / future admin UI). Rationale: the legacy single-winner endpoint cannot cleanly express up to 4 per-hole winners, and attempting a "clobber-for-display" rule creates ambiguity about which system is authoritative. Keep it single-sourced.
- **Finalization: NO writes to `side_game_results` for CTP.** Per-par-3 winners stay in `side_game_ctp_entries` as the single source of truth. At finalize time, we simply mark the entries as locked (optional `finalized_at` column; see "Finalization locking" below) — no data reshape, no rows copied. Rationale: the existing `side_game_results` shape of "0 or 1 winner per (round, sideGame)" is baked into multiple readers (history, standings, leaderboard banner, badges pipeline). Expanding it to "0–4 rows per CTP round" risks silently double-counting or breaking renders. Keeping CTP out of `side_game_results` entirely sidesteps the audit burden.
- **Finalization locking:** Add optional `finalized_at INTEGER` to `side_game_ctp_entries`. Finalize hook sets it to `Date.now()` on all CTP entries for the round. `POST /rounds/:id/ctp-entries` checks the round status AND `finalized_at IS NOT NULL` on the target row; rejects with 422 `CODE: 'ROUND_FINALIZED'` if either signal says locked. This guards against late offline-queued entries draining after finalize.
- **Season Side Game Champion (existing trophy) counting for CTP:** In `badges.ts`, when aggregating wins per player for a CTP round, query `side_game_ctp_entries` directly — award 1 credit per unique `winnerPlayerId` per `(round_id)` where `winner_player_id IS NOT NULL`. This preserves parity with other side games (one round = at most one credit per player per game). Per-par-3 recognition flows through the Par 3 Champion track.
- **Round-level Par 3 Champion highlight:** Append to `GET /rounds/:roundId/highlights` output. Query `side_game_ctp_entries` for the round, derive per-hole winners (using the `hole_completed_at` ordering rule), then group-count per winner. Triggered when any player has ≥2 CTP wins in the round. Emoji `🎯`, category `'bonus'`, title `"Par 3 Champion"`, detail format `"{Name} — {N} CTPs (holes {list})"` (e.g., `"Jason — 2 CTPs (holes 7, 12)"`). If multiple players hit ≥2 on the same day (unlikely), list each on its own highlight entry.
- **Season Par 3 Champion stat:** Derive each CTP round's per-hole winners from `side_game_ctp_entries` (ordering rule above). Sum wins per player across all CTP rounds in the current season. Return top 5 with ties. Surface as a new card on `/stats`, format-mirroring existing "Most X" cards (e.g., "Most Birdies"). Label the top row "🎯 Par 3 Champion" when count ≥ 1; if no CTPs recorded for the season yet, hide the card.
- **Helper library `apps/api/src/lib/ctp.ts`:** Pure function `resolvePerHoleWinners(entries)` — given all `side_game_ctp_entries` rows for a round, returns `Record<6|7|12|15, { playerId: number, playerName: string, holeCompletedAt: number } | null>`. Single source of truth used by the live leaderboard endpoint, the finalized banner, the round highlight, and the season stat. Keeps ordering semantics in one place.
- **Practice rounds:** The prompt fires only when the round has an active CTP side game assigned via `scheduledRoundIds`. Practice rounds are never assigned to the rotation, so the prompt naturally never fires. No extra guard needed, but spec tests assert it.
- **Offline behavior:** CTP entries queue under the same `(roundId, groupId)` scope as scores. Drain order per entry: scores → wolf-decision → CTP. CTP drain failure does not block score/wolf sync (CTP is additive; record is idempotent via unique index).
- **Score corrections:** CTP entries are independent of scores — correcting a par 3 score does NOT invalidate the CTP entry. The tee-marker reflects tee-shot outcome, not scoring; these are orthogonal.
- **Player deletion:** CTP entries hold `winner_player_id` as FK; on player delete we LEFT JOIN players in reads and fall back to a stored `winner_name` snapshot (match `side_game_results` convention).

## Data Model

### New Table

```sql
CREATE TABLE side_game_ctp_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL CHECK (hole_number IN (6, 7, 12, 15)),
  winner_player_id INTEGER REFERENCES players(id),
  winner_name TEXT,
  entered_by_player_id INTEGER REFERENCES players(id),
  hole_completed_at INTEGER NOT NULL,          -- copied from hole_completions; anchors ordering
  finalized_at INTEGER,                         -- set on round finalize; NULL = still open
  context_id TEXT NOT NULL DEFAULT 'league:guyan-wolf-cup-friday',
  tenant_id TEXT NOT NULL DEFAULT 'guyan',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Multi-tenant-safe unique index (matches migration 0025 identity foundation)
CREATE UNIQUE INDEX uniq_ctp_entries_tenant_round_group_hole
  ON side_game_ctp_entries (tenant_id, context_id, round_id, group_id, hole_number);

CREATE INDEX idx_ctp_entries_round
  ON side_game_ctp_entries (round_id);

CREATE INDEX idx_ctp_entries_round_hole_completed
  ON side_game_ctp_entries (round_id, hole_number, hole_completed_at);

-- Hole-completion audit table (also consumed by CTP; could serve future features)
CREATE TABLE hole_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  completed_at INTEGER NOT NULL,
  context_id TEXT NOT NULL DEFAULT 'league:guyan-wolf-cup-friday',
  tenant_id TEXT NOT NULL DEFAULT 'guyan'
);

CREATE UNIQUE INDEX uniq_hole_completions_tenant_round_group_hole
  ON hole_completions (tenant_id, context_id, round_id, group_id, hole_number);
```

**Rationale for columns:**
- `winner_player_id NULL` = "nobody hit green"; absence of row = "not answered yet"
- `winner_name` snapshots the name at write time; guards against player rename/delete between entry and finalization
- `entered_by_player_id` — audit field, shown on admin screen only (future); helps dispute resolution
- `hole_completed_at` — copied from `hole_completions` on POST; powers the offline-safe ordering rule. NOT NULL because every CTP entry requires the hole to be complete.
- `finalized_at` — marks entries as locked post-finalize; guards against late offline drains overwriting a finalized round
- `context_id` / `tenant_id` — mirror ecosystem-identity foundation (migration 0025); included in unique index for multi-tenant safety
- `hole_completions` is a new thin audit table; CTP is its first consumer. Insert happens server-side in the score-submission handler when the `(round,group,hole)` scores row count equals the group's roster size. Idempotent via unique index.

### Schema file changes

Add `sideGameCtpEntries` Drizzle table in `apps/api/src/db/schema.ts` using the `sqliteTable` pattern matching `sideGameResults`.

### Migration

Next sequential migration number (check `apps/api/src/db/migrations/` at implementation time — currently 0025 is the latest noted; confirm).

## API Endpoints

### POST /rounds/:roundId/ctp-entries

**Auth:** any player with `session.roundId === roundId` in cookie-backed session (middleware: `playerSessionMiddleware` or equivalent — confirm exact name at impl time). No admin token required. Round must be status `active` or `scheduled`; reject on `finalized`/`cancelled`.

**Body:**
```ts
{
  groupId: number,      // player's own group OR any group in the round
  holeNumber: 6 | 7 | 12 | 15,
  winnerPlayerId: number | null,   // null = "nobody"
}
```

**Behavior:**
- Validate hole is one of the 4 par 3s; else 422 `CODE: 'INVALID_HOLE'`
- Validate groupId belongs to roundId; else 404
- Validate `winnerPlayerId` (if not null) is on the round roster (`roundPlayers`); else 422 `CODE: 'PLAYER_NOT_ON_ROUND'` — reason: a player in group 2 shouldn't be able to credit someone not in the round
- Validate round status is not `finalized`/`cancelled`; else 422 `CODE: 'ROUND_FINALIZED'`
- Fetch `hole_completions` row for `(round_id, group_id, hole_number)`. If missing → 422 `CODE: 'HOLE_NOT_COMPLETE'` (UI should never reach this state)
- Upsert by unique `(tenant_id, context_id, round_id, group_id, hole_number)`: insert new row, or UPDATE `winner_player_id, winner_name, updated_at`. If updating, preserve original `hole_completed_at` (it's a property of when the hole was played, not when CTP was claimed).
- If inserting a new row: copy `hole_completed_at` from `hole_completions.completed_at`
- Reject if `finalized_at IS NOT NULL` on the existing row → 422 `CODE: 'ROUND_FINALIZED'`
- Snapshot `winner_name` from the `players` row
- Return the full entry

**Response:** `201` on create, `200` on update, with `{ entry: { id, roundId, groupId, holeNumber, winnerPlayerId, winnerName, holeCompletedAt, updatedAt } }`.

### GET /rounds/:roundId/ctp-entries

**Auth:** public (pairings-style — no auth). Leaderboard needs to render live winners.

**Response:**
```ts
{
  entries: Array<{
    id, roundId, groupId, holeNumber,
    winnerPlayerId: number | null,
    winnerName: string | null,
    holeCompletedAt: number,
    updatedAt: number
  }>,
  currentWinners: Record<6 | 7 | 12 | 15, { playerId: number, playerName: string, holeCompletedAt: number } | null>
}
```

`currentWinners` is computed server-side via `resolvePerHoleWinners(entries)` in `apps/api/src/lib/ctp.ts`: for each par 3, return the entry with `MAX(hole_completed_at)` WHERE `winnerPlayerId IS NOT NULL`, ties broken by `MAX(group_id)`, or `null` if no group has claimed. Leaderboard, round highlights, and the season Par 3 Champion stat all call this helper — single source of truth for ordering semantics.

### Admin override path — NOT applicable to CTP in v1

The legacy `POST /rounds/:roundId/side-game-results` path is NOT used for CTP. The existing manual side-game result record flow (admin-entered winner with free-text notes) is incompatible with the per-par-3 model. If admin correction is needed before a v2 admin UI ships, operators edit `side_game_ctp_entries` directly via SQL. The legacy endpoint still works for any non-CTP manual side games (none currently in the 2026 rotation besides CTP, but the code path is preserved).

## UI

### CtpPrompt component (`apps/web/src/components/CtpPrompt.tsx`)

Modal overlay. Props:
```ts
{
  roundId: number,
  groupId: number,
  holeNumber: 6 | 7 | 12 | 15,
  groupPlayers: Player[],     // first in the picker
  rosterPlayers: Player[],    // other round-joined players below
  existingEntry: CtpEntry | null,
  onSubmit: (winnerPlayerId: number | null) => Promise<void>,
  onClose: () => void,
}
```

Layout:
- Heading: `Hole {N} — Closest to Pin?`
- Prominent **"No one"** button at top (emphasize this is common)
- Player picker: group members first (larger buttons), rest of roster collapsible
- If `existingEntry`: header reads "Change your answer?" with current pick shown
- Submit button disabled until a choice is made; "No one" button submits immediately on tap

### score-entry-hole.tsx integration

After successful score submit:
```ts
if (
  sideGame?.name === 'Closest to Pin' &&
  PAR3_HOLES.has(holeNumber) &&
  scoresForHole.length === 4 &&
  !ctpEntries.some((e) => e.groupId === currentGroupId && e.holeNumber === holeNumber)
) {
  setCtpPromptOpen(true);
}
```

TanStack Query key: `['ctp-entries', roundId]` — refetch on round load + invalidate on POST success.

### Leaderboard (`index.tsx` Side Game card)

When `sideGame.name === 'Closest to Pin'`:
- Render 4 rows: `Hole 6`, `Hole 7`, `Hole 12`, `Hole 15`
- Each row: current winner name or `—`
- Group-entries count badge: `(2/3 groups answered)` during play; hidden after finalization

### Finalized banner

After finalization, render from `side_game_ctp_entries` via `resolvePerHoleWinners` — the same helper used during play. 4 rows, one per par 3, with winner name or em-dash. `side_game_results` is NOT consulted for CTP.

## Acceptance Criteria

1. On a CTP week, after a group enters a score for every player on its roster for a par 3 (hole 6, 7, 12, or 15), a prompt appears asking if anyone was closest to the pin. The trigger uses the actual group-roster size, not a hard-coded 4; 3-player groups also trigger correctly.
2. The prompt has a prominent "No one" option; choosing it records an entry with `winner_player_id = NULL`.
3. Choosing a player records an entry with that player's id and a snapshot of their name.
4. Re-opening the prompt shows the group's current answer and allows changing it.
5. The prompt does NOT fire again for a group+hole once an entry exists (unless reopened manually — manual reopen path may be via tapping the hole's row in the side-game card; flag as optional polish).
6. Any player with an active session on the round can submit an entry for any group in that round.
7. The leaderboard Side Game card shows each of the 4 par 3s with the current winner name, or an em-dash if no group has claimed that hole.
8. The current winner for a hole is the entry with the latest `hole_completed_at` (server-captured at the time the last roster score for that group+hole landed) across all groups with a non-null `winner_player_id`. Ties broken by `MAX(group_id)`. Offline-queued entries that drain later do NOT jump ahead of entries whose hole was actually played later.
9. If every group answers "No one" for a hole, the card shows an em-dash — NOT a co-winner.
10. **No CTP rows are written to `side_game_results` at any stage.** Per-par-3 winners live exclusively in `side_game_ctp_entries`. Existing `side_game_results` consumers see no shape change.
11. At finalize, every `side_game_ctp_entries` row for the round has `finalized_at` set. Subsequent POSTs to that round return 422 `CODE: 'ROUND_FINALIZED'`.
12. Offline: submitting a CTP answer while offline queues it; coming back online drains it after any queued scores/wolf-decisions for the same hole. The CTP entry's `hole_completed_at` is copied from the server-side `hole_completions.completed_at` row at POST time, so ordering remains correct regardless of sync timing.
13. The prompt does NOT fire on practice rounds (they have no assigned side game).
14. Season "Side Game Champion" (existing trophy) counts a CTP round as 1 win per unique player who won at least one par 3 that round — NOT per-hole. Implementation reads `side_game_ctp_entries` directly in `computeAllAwards`.
15. Finalized rounds are read-only: POST to `/rounds/:id/ctp-entries` on a finalized round returns 422 with `CODE: 'ROUND_FINALIZED'`.
16. A player not on the round's `roundPlayers` cannot be submitted as a winner (422 `CODE: 'PLAYER_NOT_ON_ROUND'`).
17. POST to a group+hole whose `hole_completions` row does not exist returns 422 `CODE: 'HOLE_NOT_COMPLETE'`. (UI guards against this by only showing the prompt after the 4th-score upsert.)
18. **Round-level Par 3 Champion highlight:** When the finalize-time CTP tally shows a player with ≥2 par-3 wins in the same round, `GET /rounds/:roundId/highlights` includes a `🎯 Par 3 Champion` entry listing that player + hole numbers. A round where every player won at most 1 par 3 does NOT produce the highlight.
19. **Season Par 3 Champion stat card** appears on `/stats` for any season with ≥1 CTP recorded, listing top 5 players by total CTPs won across all CTP rounds in the current season with ties shown as co-leaders. Leader row is labeled "🎯 Par 3 Champion". Card is hidden when the season has no CTPs recorded.
20. Per-par-3 counting: every par-3 win flows into the Par 3 Champion season stat as a single CTP unit. A round where one player wins 3 of 4 par 3s contributes 3 to their season total.
21. Schema: the `side_game_ctp_entries` uniqueness constraint includes `tenant_id` and `context_id` so future multi-tenant deployments do not collide.

## Test Plan

### API (Vitest)

New file: `apps/api/src/routes/ctp-entries.test.ts` (or add to `admin/side-games.test.ts`).

- Score-submit side-effect: when the Nth score lands for (round, group, hole) where N === group size, a `hole_completions` row is created; idempotent on repeat submits
- POST creates entry for a valid group+par3
- POST updates existing entry (same groupId, holeNumber); `hole_completed_at` is preserved on update
- POST with `winnerPlayerId: null` stores "nobody"
- POST rejects non-par-3 holes (422 `INVALID_HOLE`)
- POST rejects `winnerPlayerId` not on round roster (422 `PLAYER_NOT_ON_ROUND`)
- POST rejects unauthenticated request (401)
- POST rejects player not on round (403)
- POST rejects finalized round (422 `ROUND_FINALIZED`)
- POST rejects when `hole_completions` row is missing (422 `HOLE_NOT_COMPLETE`)
- POST rejects when `finalized_at` is set on the existing row (422 `ROUND_FINALIZED`), even mid-drain from offline queue
- GET returns all entries + `currentWinners` map
- GET `currentWinners[hole]` resolves to latest `hole_completed_at` entry with non-null winner across groups — NOT by `updated_at`
- GET `currentWinners[hole]` unaffected when a later-synced offline entry has older `hole_completed_at`
- GET `currentWinners[hole]` is null when all entries are "nobody"
- GET `currentWinners[hole]` is null when no entries exist
- Finalization sets `finalized_at` on every CTP row for the round
- Finalization does NOT write any CTP rows into `side_game_results` (assert row count unchanged)
- `computeAllAwards` counts a CTP round as 1 win per unique winner player (not per-hole); sources from `side_game_ctp_entries`
- `GET /rounds/:id/highlights` includes a `"Par 3 Champion"` entry when a player has ≥2 CTP wins that round
- `GET /rounds/:id/highlights` does NOT include Par 3 Champion when each player has at most 1 CTP that round
- `resolvePerHoleWinners` pure helper: covers ties, null winners, offline-late-arrival scenarios
- `GET /stats` season Par 3 Champion card: returns top 5 by total CTPs with ties as co-leaders
- `GET /stats` season Par 3 Champion card: omitted entirely when season has 0 CTPs
- Multi-tenant uniqueness: inserting identical `(round_id, group_id, hole_number)` under a different `tenant_id` does NOT violate the unique constraint (isolated test against raw DB)

### Web (manual)

- Open score-entry on par 3 during CTP week, enter 4 scores, confirm prompt appears
- Tap "No one" — prompt closes, entry saved, card shows em-dash
- Enter 4 scores on next par 3, tap a player — entry saved, card shows their name
- From another group's phone, enter the next par 3 and overwrite with a closer player — card updates
- Go offline mid-entry, submit CTP, come online, verify drain
- Practice round: enter par 3 scores, confirm no prompt

### Regression

- Wolf decision flow still works on par 3s (CTP is additive, not a replacement)
- Greenie selection on par 3s still works
- Existing `POST /rounds/:id/side-game-results` for admin CTP override still succeeds

## Open Decisions (require Josh sign-off before implementation)

1. **Summary-row `source` enum value** — reuse `'manual'` (simpler, no CHECK-constraint migration) or add `'ctp_hole'`? Recommend reuse.
2. **Prompt dismissibility** — should tap-outside dismiss the modal (allowing defer) or should it be modal-blocking until answered? Recommend dismissible; players can re-open from the side-game card.
3. **Side Game Champion counting rule for CTP rounds** — *Resolved 2026-04-22 by Josh:* per-par-3 counting applies to the new **Par 3 Champion** track (round highlight + season stat); existing Side Game Champion trophy keeps its per-round-per-unique-player semantics to avoid over-weighting CTP weeks. Both tracks coexist.
4. **Admin override UX** — *Resolved 2026-04-22 (Revision 2): dropped from v1 per codex review #2.* Admin corrections via direct SQL on `side_game_ctp_entries` until v2.
5. **"Change your answer" flow** — can a group freely overwrite their own answer indefinitely, or is there a cutoff (e.g., once the next group answers, earlier groups can't change)? Recommend no cutoff; app is thin over physical state.
6. **Player picker scope** — group members only, or full round roster? Recommend group-first-then-roster because guests and subs sometimes get credited across groups.
7. **Payout tracking** — the league pays from communal funds; app only reports counts. Do we need a per-round "CTP Payouts" admin view that Jason uses to cut checks (or pay out of dues)? Recommend defer until Jason asks for it; finalize-banner + season stat card are likely enough for the first CTP weeks.
8. **Champions & History trophy for season Par 3 Champion** — do we want a trophy on the Champions & History page at end of season, or is the `/stats` card sufficient? Recommend defer to end-of-season polish; current scope keeps it on `/stats` only.

## Implementation Steps

1. Schema + migration: `side_game_ctp_entries` + `hole_completions` tables, tenant-aware unique indexes
2. Score-submission handler — insert `hole_completions` row when last-player score lands; unit test the idempotence
3. `resolvePerHoleWinners` pure helper in `apps/api/src/lib/ctp.ts` + unit tests covering ordering edge cases
4. `POST` + `GET` `/rounds/:roundId/ctp-entries` endpoints + route tests (including all error codes)
5. `CtpPrompt` component + integration in `score-entry-hole.tsx` (trigger based on actual group size)
6. Leaderboard Side Game card par-3 rows (uses `resolvePerHoleWinners`)
7. Offline queue support + drain ordering (scores → wolf-decision → CTP)
8. Finalization hook — set `finalized_at` on CTP rows; add `computeAllAwards` CTP counting rule
9. Round-level "Par 3 Champion" highlight in `GET /rounds/:id/highlights` (uses `resolvePerHoleWinners`)
10. Season Par 3 Champion stat — `GET /stats` endpoint addition + `/stats` page card
11. Regression + manual test pass (online + offline-queue + multi-group displace scenarios)
12. Deploy, monitor first CTP round (Apr 24 if shipped in time; else next CTP week per 6-round rotation)

## Risks

- **Tight Apr 24 deadline.** Steps 1-6 realistically ~1 day of focused work; offline drain testing on iOS Safari is the most fragile piece (historic pattern). If not ready by Thursday night, manual admin entry remains a fallback — Apr 24 CTP gets recorded the old way, feature ships for the next CTP week.
- **Race condition on prompt trigger.** If two phones in the same group both reach the 4th-score state at the same instant, both may show the prompt. Unique-index upsert makes the write safe, but two submits in quick succession could overwrite each other's answer. Acceptable — matches the physical tee-marker (whoever speaks last wins).
- **Admin-only manual CTP path becomes undiscoverable.** Mitigation: keep the endpoint working and note in admin guide PDF; no UI regression.
