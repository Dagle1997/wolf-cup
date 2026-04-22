import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ecosystemColumns } from './_columns.js';

/**
 * Minimal tournament players slice per epic AC #1 (T1-6a scope).
 *
 * Note on identity: there is intentionally NO `google_sub` column here —
 * provider-specific identifiers live in `oauth_identities` per Fork 2b.
 * That split keeps this table provider-agnostic (future Apple SSO, any
 * other provider) and avoids column churn when a second provider lands.
 *
 * `id` is an app-generated UUID (crypto.randomUUID()) assigned at insert
 * time. Opaque; used for context_id stamping and as the target for all
 * foreign keys to players (oauth_identities.player_id, sessions.player_id).
 */
export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  isOrganizer: integer('is_organizer', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  ...ecosystemColumns(),
});

export type Player = typeof players.$inferSelect;
