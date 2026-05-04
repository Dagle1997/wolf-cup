import {
  integer,
  sqliteTable,
  text,
  index,
  primaryKey,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { events, eventRounds } from './events.js';
import { players } from './players.js';

/**
 * T6-3 cross-foursome individual bets schema.
 *
 * Three tables:
 *   - `individual_bets` — the bet metadata (players, type, stake).
 *   - `individual_bet_rounds` — which event_rounds the bet applies to (M:N).
 *   - `individual_bet_presses` — append-only press fire log (auto + manual).
 *
 * Naming convention: `(player_a_id, player_b_id)` is stored in CANONICAL
 * ALPHABETICAL ORDER — the route handler enforces; A↔B and B↔A are the
 * SAME bet via the UNIQUE constraint. Followup T6-3c may add a DB-level
 * CHECK to enforce the ordering at the schema layer.
 *
 * **`individual_bet_presses.multiplier` is INTEGER** (overriding the
 * epic AC's `REAL`) for integer-cents discipline consistency across
 * epic T6. T6-2's `team_press_log` (T6-4 will create) uses INTEGER for
 * the same reason.
 *
 * **`fired_at` is the timestamp** when the press fired (epoch ms). The
 * UNIQUE constraint on `(bet_id, fired_at_round_id, fired_at_hole,
 * trigger_type)` provides the idempotent-replay safety net (engine
 * dedupes against persisted rows; UNIQUE is the last-resort guard).
 *
 * FK delete posture:
 *   - `individual_bets.event_id → events.id`: CASCADE. Bets disappear when
 *     the event is deleted.
 *   - `individual_bets.player_a/b_id → players.id`: RESTRICT. Audit
 *     attribution preserved.
 *   - `individual_bet_rounds.bet_id → individual_bets.id`: CASCADE.
 *   - `individual_bet_rounds.event_round_id → event_rounds.id`: CASCADE.
 *   - `individual_bet_presses.bet_id → individual_bets.id`: CASCADE.
 *   - `individual_bet_presses.fired_at_round_id → event_rounds.id`: CASCADE.
 */

export const individualBets = sqliteTable(
  'individual_bets',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    playerAId: text('player_a_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    playerBId: text('player_b_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    betType: text('bet_type').notNull(),
    stakePerHoleCents: integer('stake_per_hole_cents').notNull(),
    configJson: text('config_json').notNull(),
    createdByPlayerId: text('created_by_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventIdx: index('idx_individual_bets_event_id').on(t.eventId),
    pairsUniq: uniqueIndex(
      'uniq_individual_bets_event_a_b_type',
    ).on(t.eventId, t.playerAId, t.playerBId, t.betType),
    betTypeCheck: check(
      'check_individual_bets_bet_type',
      sql`${t.betType} IN ('match_play_per_hole', 'match_play_with_auto_press')`,
    ),
    stakePositiveCheck: check(
      'check_individual_bets_stake_positive',
      sql`${t.stakePerHoleCents} > 0`,
    ),
  }),
);

export type IndividualBet = typeof individualBets.$inferSelect;

export const individualBetRounds = sqliteTable(
  'individual_bet_rounds',
  {
    betId: text('bet_id')
      .notNull()
      .references(() => individualBets.id, { onDelete: 'cascade' }),
    eventRoundId: text('event_round_id')
      .notNull()
      .references(() => eventRounds.id, { onDelete: 'cascade' }),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.betId, t.eventRoundId] }),
    eventRoundIdx: index('idx_individual_bet_rounds_event_round_id').on(t.eventRoundId),
  }),
);

export type IndividualBetRound = typeof individualBetRounds.$inferSelect;

export const individualBetPresses = sqliteTable(
  'individual_bet_presses',
  {
    id: text('id').primaryKey(),
    betId: text('bet_id')
      .notNull()
      .references(() => individualBets.id, { onDelete: 'cascade' }),
    firedAtRoundId: text('fired_at_round_id')
      .notNull()
      .references(() => eventRounds.id, { onDelete: 'cascade' }),
    firedAtHole: integer('fired_at_hole').notNull(),
    triggerType: text('trigger_type').notNull(),
    multiplier: integer('multiplier').notNull(),
    firedAt: integer('fired_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    betIdx: index('idx_individual_bet_presses_bet_id').on(t.betId),
    fireDedupeUniq: uniqueIndex(
      'uniq_individual_bet_presses_dedupe',
    ).on(t.betId, t.firedAtRoundId, t.firedAtHole, t.triggerType),
    holeCheck: check(
      'check_individual_bet_presses_fired_at_hole',
      sql`${t.firedAtHole} BETWEEN 1 AND 18`,
    ),
    triggerCheck: check(
      'check_individual_bet_presses_trigger_type',
      sql`${t.triggerType} IN ('auto', 'manual')`,
    ),
    multiplierCheck: check(
      'check_individual_bet_presses_multiplier_positive',
      sql`${t.multiplier} >= 1`,
    ),
  }),
);

export type IndividualBetPress = typeof individualBetPresses.$inferSelect;
