import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { ecosystemColumns } from './_columns.js';
import { players } from './players.js';
import { sessions } from './auth.js';

/**
 * Device bindings (T3-1 per epic line 852).
 *
 * **Lives in its own file** to avoid a circular import: it FKs both to
 * `players.id` AND `sessions.session_id`; `auth.ts` (sessions) already
 * imports `players.js`. Co-locating in players.ts would cycle
 * players.ts ↔ auth.ts at module load.
 *
 * One row per (player, device) pairing. Used by the T3-6 invite-link
 * "that's me" claim flow + T3-7 post-SSO rebind.
 *
 * **`session_id` is NULLABLE — load-bearing.** The T3-6 invite-claim flow
 * runs BEFORE any SSO has happened: a guest opens the invite link on a
 * device, claims a player_id, and a device_binding row is inserted with
 * `session_id = NULL`. Later (T3-7), when the same device's session is
 * created via OAuth, the binding's session_id is updated to point at the
 * new sessions row.
 *
 * **`session_id` FK ON DELETE SET NULL:** if a session expires and is
 * deleted, the device_binding survives with session_id = NULL — matching
 * the pre-SSO claim state. T3-7's rebind can then re-populate it.
 *
 * **`player_id` FK ON DELETE CASCADE:** if a player row is removed (rare;
 * RESTRICT FKs from group_members / oauth_identities normally prevent it),
 * the orphan bindings are useless and should go with the parent.
 */
export const deviceBindings = sqliteTable(
  'device_bindings',
  {
    id: text('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.sessionId, { onDelete: 'set null' }),
    deviceInfo: text('device_info').notNull(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    playerIdx: index('idx_device_bindings_player_id').on(t.playerId),
  }),
);

export type DeviceBinding = typeof deviceBindings.$inferSelect;
