/**
 * T8-1 activity-spine schema. Append-only event spine consumed by T8-2
 * (API + provider + toast/banner), T8-3 (player-home feed), and T8-4
 * (award triggers).
 *
 * `event_id NOT NULL` is the load-bearing invariant — every activity
 * scopes to an event. Audit-only events (e.g. `install_prompt.shown`)
 * live in `audit_log`, NOT here.
 *
 * The 13-type allowlist is enforced at the application layer via the
 * discriminated union + Zod schemas at `engine/types/activity-events.ts`,
 * NOT a SQL CHECK constraint (mirrors `audit_log.entityType`'s posture).
 *
 * Composite index `(event_id, created_at DESC, id DESC)` supports both
 * T8-2's live polling (`?after=cursor`) and historical backfill
 * (`?before=cursor`); the `id DESC` tiebreaker keeps the cursor stable
 * across rows sharing the same `created_at` ms.
 */

import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { desc } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { events } from './events.js';
import { rounds } from './scoring.js';
import { players } from './players.js';

export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    roundId: text('round_id').references(() => rounds.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorPlayerId: text('actor_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    feedIdx: index('idx_activity_event_created_id').on(
      t.eventId,
      desc(t.createdAt),
      desc(t.id),
    ),
  }),
);

export type Activity = typeof activity.$inferSelect;
