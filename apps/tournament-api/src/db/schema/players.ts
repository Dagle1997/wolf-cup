import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';

/**
 * Tournament players. T1-6a established the minimal slice (id, isOrganizer,
 * createdAt, ecosystemColumns); T3-1 extends with profile/handicap columns
 * (name, ghin, manualHandicapIndex, preferredTeeColor).
 *
 * Note on identity: there is intentionally NO `google_sub` / `apple_sub`
 * column here — provider-specific identifiers live in `oauth_identities`
 * per Fork 2b. That split keeps this table provider-agnostic (future Apple
 * SSO, any other provider) and avoids the duplicated-identity-binding
 * footgun that having both players.google_sub AND oauth_identities would
 * introduce. T3-1 explicitly skips the epic's google_sub/apple_sub-on-players
 * bullet for this reason (see story spec AC #4 deviation note).
 *
 * `id` is an app-generated UUID (crypto.randomUUID()) assigned at insert
 * time. Opaque; used for context_id stamping and as the target for all
 * foreign keys to players (oauth_identities.player_id, sessions.player_id,
 * device_bindings.player_id, events.organizer_player_id, etc.).
 *
 * **`name TEXT NOT NULL DEFAULT ''`:** existing T1-6a rows (zero in
 * production at T3-1 land time) get an empty string on the additive
 * ALTER TABLE. Application code (T3-2 wizard, T3-3 group CRUD) rejects
 * empty names at write boundaries, so an empty name should never persist
 * after T3-2 ships.
 *
 * **`ghin TEXT` + `uniq_players_ghin WHERE ghin IS NOT NULL`:** GHIN is a
 * US-wide handicap identifier; global uniqueness mirrors real-world data
 * shape. Multi-tenant scoping is acknowledged as a v1.5+ hardening (see
 * spec AC #4 rationale).
 *
 * **`device_bindings` lives in its own file (`device_bindings.ts`)** to
 * avoid a circular import: it FKs both to players.id AND sessions.session_id;
 * sessions.ts already imports players.js for its own FK. Co-locating
 * deviceBindings here would cycle players.ts ↔ auth.ts.
 */
export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    isOrganizer: integer('is_organizer', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    name: text('name').notNull().default(''),
    ghin: text('ghin'),
    manualHandicapIndex: real('manual_handicap_index'),
    preferredTeeColor: text('preferred_tee_color'),
    ...ecosystemColumns(),
  },
  (t) => ({
    // Partial unique: only non-null GHIN values are constrained. Drizzle's
    // .where() lowers to SQLite's `WHERE ghin IS NOT NULL` partial index,
    // matching the spec AC #4 contract.
    ghinUniq: uniqueIndex('uniq_players_ghin').on(t.ghin).where(sql`${t.ghin} IS NOT NULL`),
  }),
);

export type Player = typeof players.$inferSelect;
