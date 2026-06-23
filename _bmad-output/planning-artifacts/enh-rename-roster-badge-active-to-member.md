# Enhancement: Rename roster badge value `active` → `member`

- **Status:** Proposed / deferred (future enhancement — do NOT bundle with the sub-status standings fix)
- **Date:** 2026-06-23
- **Owner:** Josh
- **Related:** the "roster badge is the live source of truth for sub status" change (`apps/api/src/lib/sub-status.ts`, `standings.ts`, `stats.ts`)

## Problem

The word **active** is overloaded across the codebase, and it means two different
things on the `players` table alone:

| Usage                        | Meaning                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `players.status = 'active'`  | the player is a **full member** of the league (the roster badge) |
| `players.isActive` (0/1)     | soft-delete / not-deleted flag on the same row                   |
| `rounds.status = 'active'`   | a round is **in progress**                                       |
| `seasonWeeks.isActive` (0/1) | a week is active vs skipped                                      |

A single grep for `'active'` returns round-state checks (`eq(rounds.status,"active")`)
interleaved with roster-membership checks (`eq(players.status,'active')`). That
collision is a foot-gun: it's easy to read or edit the wrong "active," and it
makes the roster's three-state badge (`active | sub | inactive`) read ambiguously.

## Proposed change

Rename **only the roster badge value** `active` → `member`, giving the badge the
self-explanatory set **`member | sub | inactive`** ("what is this person's standing
in the league"). Nothing about rounds/weeks changes.

Definition stays the same: a player is a **sub** iff their badge is **not** `member`
(i.e. `sub` or `inactive`). Standings and stats already read this live; only the
literal value changes.

## Non-goals (explicitly do NOT do)

- Do **not** touch `players.isActive` (the boolean soft-delete column). It is a
  separate concept; renaming it would widen the blast radius for no real gain.
- Do **not** touch `rounds.status='active'`, `seasonWeeks.isActive`, or any
  round/week "active." Those are correct as-is and unrelated.

## Change inventory (implementation-ready)

The literal `'active'` as a **player badge** appears in these spots. Round-status
`'active'` sites are intentionally excluded.

### Backend (`apps/api`)

- `src/lib/sub-status.ts` — `isSubFromStatus`: `status !== 'active'` → `!== 'member'`.
- `src/routes/stats.ts:407` — `eq(players.status, 'active')` → `'member'`.
- `src/routes/standings.ts` — classification reads `players.status` via the helper;
  no literal to change if it routes through `isSubFromStatus` (it does), but verify.
- `src/routes/attendance.ts:75` — active-roster query `eq(players.status, 'active')`.
- `src/routes/admin/attendance.ts:63, 217` — active-roster queries.
- `src/routes/admin/roster.ts` — the legacy `isActive` → status mapping
  (`status = isActive === 1 ? 'active' : 'inactive'`) and any `status` default.
- `src/db/schema.ts` — `players.status` column `.default('active')` → `.default('member')`.
- `src/schemas/player.js` (or `.ts`) — if `createPlayerSchema`/`updatePlayerSchema`
  enumerate `status`, update the enum to `['member','sub','inactive']`.
- Seeds: `src/scripts/seed-live.ts:122`, `src/scripts/seed-demo.ts:143` — `status: 'active'`.

### Frontend (`apps/web`)

- `src/routes/admin/roster.tsx`:
  - `type PlayerStatus = 'active' | 'sub' | 'inactive'` → `'member' | 'sub' | 'inactive'`.
  - `STATUS_CYCLE` (the active→sub→inactive→active cycle) — update keys/values.
  - `STATUS_BADGE` label `'Active'` → `'Member'`.
  - Fallbacks `p.isActive === 0 ? 'inactive' : 'active'` → `... : 'member'` (lines ~310, ~361).
- Any other component that reads `player.status === 'active'` (grep the web app).

### Tests

- Update fixtures/assertions that create players with `status: 'active'` or assert
  on the `'active'`/`'Active'` value (api + web).

## Data migration

`players.status` has no CHECK constraint today (verify before shipping). Migration:

```sql
UPDATE players SET status = 'member' WHERE status = 'active';
```

Plus a drizzle migration to change the column default to `'member'`. If a CHECK
constraint is added in the interim, include it. **Deploy the migration and the
code together** — the app must agree with the data on the literal value.

## Make-it-cheap setup (optional, can land with the current fix)

Centralize the "is this a full member?" decision so the literal `'active'` lives
in exactly one place, turning the future rename into ~one constant + the migration:

- Keep `isSubFromStatus()` as the single chokepoint for sub vs member.
- Optionally add `export const FULL_MEMBER_STATUS = 'active'` in `sub-status.ts`
  and have the stats filter, attendance roster queries, and roster mapping import
  it instead of hardcoding `'active'`. Then the rename is: change the constant +
  the badge labels + the migration.

## Risk / rollback

- Low logical risk (pure value rename), but it touches data. Take a backup first
  (`POST /api/admin/backup/now`) per `project_backup_system.md`.
- Rollback = reverse migration (`UPDATE players SET status='active' WHERE status='member'`)
  - redeploy prior code.

## Acceptance criteria

- Roster badge shows **Member / Sub / Inactive**; cycling works.
- Standings: members above the line, subs/inactive below — unchanged behavior,
  new literal.
- Stats: only members get a stats page — unchanged behavior, new literal.
- No remaining `players.status === 'active'` (or `'Active'`) literals; round/week
  "active" untouched.
- All api + web tests green; typecheck clean.

## Effort

~1–2 hours: mechanical find/replace across the inventory above + one data
migration + test fixture updates. Best done as its own small PR.
