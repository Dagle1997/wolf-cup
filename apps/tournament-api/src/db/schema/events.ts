import { integer, real, sqliteTable, text, index, uniqueIndex, check, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { players } from './players.js';
import { courseRevisions } from './courses.js';

/**
 * Event + event_round + invite schema (T3-1, FD-6 + FD-8 ecosystem).
 *
 * Three tables in one file because they share the same context_id parent
 * (`'event:' + events.id`) and FK chain. Splitting would force three
 * mutually-importing files for no architectural gain.
 *
 * **FK delete posture:**
 *   - `event_rounds.event_id → events.id`: **CASCADE**. Round rows are
 *     useless without their event.
 *   - `event_rounds.course_revision_id → course_revisions.id`: **RESTRICT**.
 *     Course revisions are shared infrastructure; deleting one out from
 *     under an event would invalidate audit trails.
 *   - `events.organizer_player_id → players.id`: **RESTRICT**. An event
 *     without a recorded organizer has no audit trail; force the deletion
 *     of dependent events first if you really want to remove a player.
 *   - `invites.event_id → events.id`: **CASCADE**.
 *   - `invites.created_by_player_id → players.id`: **RESTRICT**.
 *
 * **`holes_to_play CHECK IN (9, 18)`:** supports 9-hole rounds (Emergency 9
 * after 18; Member-Member two-9-match days; Fall 9-hole tournaments). All
 * 4 Pinehurst rounds default to 18. Locked at creation — no v1 mutation
 * path. Multiple event_rounds may share a `round_date` (no UNIQUE on date)
 * to enable 27-hole days (18 + 9) via two consecutive rows.
 *
 * **`invites` is event-scoped only** — no `player_id` column. Per-player
 * invites are a v1.5+ feature; the v1 token is event-wide and any clicker
 * can claim any open player slot.
 *
 * **`tenantId` defaults to 'guyan'; `contextId` is required.** Application
 * code stamps `events.context_id = 'event:' + events.id` at insert; child
 * rows (event_rounds, invites) inherit the parent event's context_id.
 */
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startDate: integer('start_date').notNull(),
  endDate: integer('end_date').notNull(),
  timezone: text('timezone').notNull(),
  organizerPlayerId: text('organizer_player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at').notNull(),
  // T13-4 scorer policy: who is ELIGIBLE to be a foursome's designated
  // scorer. 'foursome' (default = today's behavior: members + organizer),
  // 'designated' (an organizer-curated pool in event_scorer_designees +
  // organizer; how a walking caddie is allowed), 'open' (any participant).
  // Single-writer is unchanged — this only gates who may BECOME the scorer.
  // NO DB CHECK constraint on purpose: a CHECK forces drizzle into a
  // table-REBUILD migration (DROP + RENAME events), which on SQLite
  // intermittently corrupts the FK-referencing `rounds` table on the shared
  // in-memory test cache ("no such table: rounds"). The enum is validated by
  // env/Zod at the route + isScorerPolicy() at every read.
  scorerPolicy: text('scorer_policy').notNull().default('foursome'),
  // Soft-cancellation (organizer-scoped event lifecycle). `cancelled_at` NULL
  // = active; a unix-ms timestamp = cancelled. A cancelled event is hidden
  // from participants' lists and refuses new invite claims, but the row +
  // all children survive so the action is fully reversible (restore clears
  // both columns). `cancelled_by_player_id` is an audit stamp recording WHICH
  // organizer cancelled it.
  //
  // NO inline `.references()` on cancelled_by_player_id on purpose: a FK added
  // to an existing table can only be expressed via a SQLite table-REBUILD
  // (DROP + RENAME), which is exactly the migration shape that intermittently
  // corrupts the FK-referencing `rounds` table on the shared in-memory test
  // cache (see scorer_policy note above). The value is always a valid
  // player.id (the authenticated organizer), validated at the route layer.
  cancelledAt: integer('cancelled_at'),
  cancelledByPlayerId: text('cancelled_by_player_id'),
  // Handicap lock (trip fairness): when set (unix-ms cutoff date), every
  // player's handicap index for THIS event is frozen to the value effective
  // on/before this date — snapshotted into `event_handicaps`. NULL = not
  // locked (scoring falls back to players.manual_handicap_index, today's
  // behavior). The snapshot, not this column, is what scoring reads; this
  // column records WHICH cutoff produced the snapshot + drives the "locked"
  // UI state. Plain ADD COLUMN (no FK/CHECK → no table rebuild).
  handicapLockDate: integer('handicap_lock_date'),
  // Handicap allowance % (integer, e.g. 80) the organizer sets per event. Applied
  // to every player's course handicap BEFORE stroke allocation — and, for the
  // Guyan 2v2 game, before the off-the-low subtraction. NULL = not set, which the
  // money engine treats as 100 (no reduction). The organizer sets this on the
  // handicaps-lock screen; pin-round-at-start freezes the effective value into the
  // round pin's resolved config so recompute-on-read can never drift. The UI
  // clamps to 50–150; the engine's config schema bounds it to [1,200]. Plain ADD
  // COLUMN (no FK/CHECK → no table rebuild — matches handicapLockDate above).
  handicapAllowancePct: integer('handicap_allowance_pct'),
  ...ecosystemColumns(),
});

export type Event = typeof events.$inferSelect;

/**
 * Per-event handicap snapshot (the "locked" handicaps). One row per roster
 * player when the organizer locks handicaps as of a date. `handicap_index` is
 * the frozen value carried into EVERY round of the event; scoring/leaderboard
 * COALESCE this over players.manual_handicap_index. `source` records where the
 * value came from ('ghin' = pulled from GHIN revision history as-of the lock
 * date; 'manual' = the player's stored manual index, for non-GHIN players).
 * `ghin_value_date` is the actual GHIN revision date the value came from
 * (≤ lock date) for transparency. Re-locking overwrites (DELETE-then-INSERT).
 */
export const eventHandicaps = sqliteTable(
  'event_handicaps',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    handicapIndex: real('handicap_index'), // e.g. 8.2; NULL = no index available (matches players.manual_handicap_index type)
    source: text('source').notNull(), // 'ghin' | 'manual'
    asOfDate: integer('as_of_date').notNull(), // the lock cutoff (unix-ms)
    ghinValueDate: text('ghin_value_date'), // revision_date the value came from
    capturedAt: integer('captured_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.playerId] }),
    eventIdx: index('idx_event_handicaps_event_id').on(t.eventId),
  }),
);

export type EventHandicap = typeof eventHandicaps.$inferSelect;

export const eventRounds = sqliteTable(
  'event_rounds',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    roundDate: integer('round_date').notNull(),
    courseRevisionId: text('course_revision_id')
      .notNull()
      .references(() => courseRevisions.id, { onDelete: 'restrict' }),
    teeColor: text('tee_color').notNull(),
    holesToPlay: integer('holes_to_play').notNull().default(18),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventIdx: index('idx_event_rounds_event_id').on(t.eventId),
    eventRoundNumberUniq: uniqueIndex('uniq_event_rounds_event_round_number').on(
      t.eventId,
      t.roundNumber,
    ),
    holesCheck: check('check_event_rounds_holes_to_play', sql`${t.holesToPlay} IN (9, 18)`),
  }),
);

export type EventRound = typeof eventRounds.$inferSelect;

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    createdByPlayerId: text('created_by_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventIdx: index('idx_invites_event_id').on(t.eventId),
  }),
);

export type Invite = typeof invites.$inferSelect;

/**
 * T13-4 — the per-event pool of allowed scorers when `events.scorer_policy =
 * 'designated'`. A designee is any roster player the organizer approves to
 * score (incl. a non-playing walking caddie added via the normal roster
 * tools). Ignored under 'foursome' / 'open' policies. PK (event_id, player_id)
 * makes membership idempotent.
 */
export const eventScorerDesignees = sqliteTable(
  'event_scorer_designees',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.playerId] }),
    eventIdx: index('idx_event_scorer_designees_event_id').on(t.eventId),
  }),
);

export type EventScorerDesignee = typeof eventScorerDesignees.$inferSelect;

/**
 * Per-player join CODE (B0 — non-Google join). One short, human-typeable
 * code per (event, player). A player enters their code on /join → we bind
 * THAT player to their device (device_bindings) and they get full access
 * without Google. Per-player (not one event code) so a player who later
 * self-creates side games is provably that exact player — an event-wide
 * code + name-pick would let anyone act as anyone.
 *
 * `code` is globally UNIQUE (the lookup key from the public /join endpoint,
 * which has no event context). PK (event_id, player_id) makes generation
 * idempotent (one code per roster slot). Plain table — no rebuild risk.
 */
export const playerJoinCodes = sqliteTable(
  'player_join_codes',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.playerId] }),
    eventIdx: index('idx_player_join_codes_event_id').on(t.eventId),
  }),
);

export type PlayerJoinCode = typeof playerJoinCodes.$inferSelect;
