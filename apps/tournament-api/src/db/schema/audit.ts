/**
 * T5-1 audit_log schema. Append-only event sink for state transitions,
 * score commits, install-prompt-shown events, and any other auditable
 * domain action.
 *
 * Polymorphic association via (entity_type, entity_id) — NOT FK'd to
 * specific entities so deletes preserve audit history (and so a single
 * table can audit every entity type without schema explosion).
 *
 * `actor_player_id` IS FK'd (RESTRICT, NULLABLE) — players are shared
 * infrastructure; system-emitted events leave actor NULL.
 *
 * Callers (T5.8 / T5.9 / T7-6 / T8) MUST use a shared constant module
 * for `event_type` and `entity_type` values to avoid string-typo
 * fragmentation. T5-1 ships the table; the constant module lives with
 * the first writer (T5.8 likely).
 *
 * Greenfield — no Wolf Cup analogue.
 */

import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { desc } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { players } from './players.js';

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    actorPlayerId: text('actor_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    entityIdx: index('idx_audit_log_entity').on(
      t.entityType,
      t.entityId,
      desc(t.createdAt),
    ),
    eventTypeIdx: index('idx_audit_log_event_type').on(
      t.eventType,
      desc(t.createdAt),
    ),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
