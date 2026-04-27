import { integer, sqliteTable, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { players } from './players.js';
import { eventRounds } from './events.js';

/**
 * Rule sets + revisions schema (T3-1, FD-8 revisioning).
 *
 * Tenant-scoped (context_id = `'library:{tenant_id}'`, parallel to courses).
 * Application code stamps context_id at insert; this story does not enforce
 * it at runtime (no triggers).
 *
 * **FK delete posture:**
 *   - `rule_set_revisions.rule_set_id → rule_sets.id`: **RESTRICT**. Don't
 *     delete a rule_set with revisions — preserves audit trail.
 *   - `rule_set_revisions.effective_from_round_id → event_rounds.id`:
 *     **SET NULL** (load-bearing). When an event is deleted, its
 *     event_rounds CASCADE-delete; rule_set_revisions referencing them
 *     fall back to "from event start" semantics (NULL = baseline). Without
 *     SET NULL, the cascade would be RESTRICT-blocked and event deletion
 *     would fail.
 *   - `rule_set_revisions.created_by_player_id → players.id`: **RESTRICT**.
 *     Audit attribution is preserved — players can't be deleted while
 *     they have authored revisions.
 *
 * **`effective_from_round_id` NULLABLE semantics** (per epic + T5.11):
 *   - NULL → "effective from event start (round 1, hole 1)" — baseline
 *     revision created at rule-set creation time.
 *   - Non-NULL → points at the scheduled `event_rounds.id` where the
 *     boundary falls.
 *
 * **`effective_from_hole CHECK BETWEEN 1 AND 19`:**
 *   - 1..18 → effective from that hole onward in the round.
 *   - 19 → "effective from the NEXT scheduled round onward" (sentinel;
 *     no effect on `effective_from_round_id`).
 *
 * **FK target is event_rounds.id (T3-1 setup-time entity), NOT a future
 * scoring rounds.id (T5.1).** The scheduled round is the stable identity
 * across the edit lifecycle; T6 money recompute joins through to scoring
 * rounds at dispatch time.
 */
export const ruleSets = sqliteTable('rule_sets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  ...ecosystemColumns(),
});

export type RuleSet = typeof ruleSets.$inferSelect;

export const ruleSetRevisions = sqliteTable(
  'rule_set_revisions',
  {
    id: text('id').primaryKey(),
    ruleSetId: text('rule_set_id')
      .notNull()
      .references(() => ruleSets.id, { onDelete: 'restrict' }),
    revisionNumber: integer('revision_number').notNull(),
    configJson: text('config_json').notNull(),
    effectiveFromRoundId: text('effective_from_round_id').references(
      () => eventRounds.id,
      { onDelete: 'set null' },
    ),
    effectiveFromHole: integer('effective_from_hole').notNull().default(1),
    createdByPlayerId: text('created_by_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    ruleSetIdx: index('idx_rule_set_revisions_rule_set_id').on(t.ruleSetId),
    revisionNumberUniq: uniqueIndex('uniq_rule_set_revisions_rule_set_id_revision_number').on(
      t.ruleSetId,
      t.revisionNumber,
    ),
    effectiveFromHoleCheck: check(
      'check_rule_set_revisions_effective_from_hole',
      sql`${t.effectiveFromHole} BETWEEN 1 AND 19`,
    ),
  }),
);

export type RuleSetRevision = typeof ruleSetRevisions.$inferSelect;
