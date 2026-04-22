import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { players } from './players.js';
import { ecosystemColumns } from './_columns.js';

/**
 * Server-side session store. The session cookie's value IS the primary
 * key (`session_id`) — an opaque 256-bit token from
 * `crypto.randomBytes(32).toString('base64url')`. No HMAC signing is
 * used or needed; the token's entropy is the whole authentication story.
 *
 * `magic_link_tokens` is intentionally NOT defined here — magic-link is
 * deferred to a future T3.x story per Fork 1c. T1-6b adds Google OAuth
 * handlers that INSERT into `sessions` but does not add any new auth
 * tables.
 *
 * Lifetime: rolling 7-day expiration with a 30-day hard cap per D2-4.
 * Enforced in `src/lib/session.ts#validateSession`, not in any cleanup
 * job. Expired-row purging can land in T1-7 if DB size becomes a concern.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    // Truncated user-agent + IP summary. Nullable so we can still accept
    // sessions when the request carries no UA (curl, cli tests).
    deviceInfo: text('device_info'),
    ...ecosystemColumns(),
  },
  (t) => ({
    playerIdx: index('idx_sessions_player_id').on(t.playerId),
  }),
);

export type Session = typeof sessions.$inferSelect;
