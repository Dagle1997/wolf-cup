import { integer, sqliteTable, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
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
  ...ecosystemColumns(),
});

export type Event = typeof events.$inferSelect;

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
