import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { ecosystemColumns } from './_columns.js';
import { rounds } from './scoring.js';
import { ruleSetRevisions } from './rules.js';
import { courseRevisions } from './courses.js';

/**
 * F1 round-pin (provenance) store (Story 1.2, additive; ADR D4/D5).
 *
 * One IMMUTABLE pin per scored round (UNIQUE round_id) — the frozen inputs a
 * round was/will be settled under, so recompute-on-read is deterministic
 * without re-deriving from live data. Written atomically at the round's
 * `in_progress` transition (wiring is Story 1.4; this story builds the store +
 * pin-writer and unit-tests atomicity/idempotency).
 *
 * Immutability (AC11): the pin is never overwritten by this story's writer — a
 * re-pin of an already-pinned round is a no-op returning the existing row. The
 * only legitimate re-pin (different data) is an Epic 4 correction.
 */
export const roundPins = sqliteTable(
  'round_pin',
  {
    /** One pin per round (rounds.id is globally unique → tenant not in the key, AC5). */
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    /** The fully-RESOLVED config snapshot (merged Event→Round→Foursome) the engine settles from. */
    resolvedConfigJson: text('resolved_config_json').notNull(),
    /** Provenance: the seed preset revision the config came from (nullable). */
    seedRuleSetRevisionId: text('seed_rule_set_revision_id').references(
      () => ruleSetRevisions.id,
      { onDelete: 'restrict' },
    ),
    /** Course revision + tee the round played (course_revisions verified to exist). */
    courseRevisionId: text('course_revision_id')
      .notNull()
      .references(() => courseRevisions.id, { onDelete: 'restrict' }),
    tee: text('tee').notNull(),
    /** Per-player HI+CH snapshot: { [playerId]: { hi, ch } } (AC6, Zod-validated). */
    perPlayerHandicapsJson: text('per_player_handicaps_json').notNull(),
    /** Global-team-composition seam (AC8): { teamKey, playerIds }[]; NULL until Epic 3. */
    teamCompositionJson: text('team_composition_json'),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    roundUnique: unique('uq_round_pin_round_id').on(t.roundId),
  }),
);

export type RoundPinRow = typeof roundPins.$inferSelect;
