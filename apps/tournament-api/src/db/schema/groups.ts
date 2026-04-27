import { integer, sqliteTable, text, index, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { events } from './events.js';
import { players } from './players.js';

/**
 * Groups + group_members schema (T3-1, FD-6).
 *
 * **`money_visibility_mode CHECK IN ('open','participant','self_only')`:**
 * v1 only exercises `'open'`; T3-3 UI accepts only open on save (the other
 * modes display a "v1.5" tooltip and are disabled). The CHECK accepts all
 * three values so v1.5 enabling is zero-migration.
 *
 * **FK delete posture:**
 *   - `groups.event_id → events.id`: **CASCADE**. Groups are event-scoped.
 *   - `group_members.group_id → groups.id`: **CASCADE**. Membership rows
 *     are useless without their group.
 *   - `group_members.player_id → players.id`: **RESTRICT**. Players are
 *     shared infrastructure across groups + events.
 *
 * **Composite primary key on (group_id, player_id):** a player can be in
 * a group at most once. The `idx_group_members_player_id` index supports
 * the reverse lookup ("which groups is this player in?").
 */
export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    moneyVisibilityMode: text('money_visibility_mode').notNull().default('open'),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventIdx: index('idx_groups_event_id').on(t.eventId),
    visibilityCheck: check(
      'check_groups_money_visibility_mode',
      sql`${t.moneyVisibilityMode} IN ('open', 'participant', 'self_only')`,
    ),
  }),
);

export type Group = typeof groups.$inferSelect;

export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.playerId] }),
    playerIdx: index('idx_group_members_player_id').on(t.playerId),
  }),
);

export type GroupMember = typeof groupMembers.$inferSelect;
