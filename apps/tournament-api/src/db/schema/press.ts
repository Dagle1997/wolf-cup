import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { rounds } from './scoring.js';
import { players } from './players.js';

/**
 * T6-4 team_press_log — append-only log of fired team presses (auto + manual).
 *
 * Persists what `evaluatePresses` (T6-2) emits as `newlyFired` from the
 * score-commit hook orchestrator (T6-4 services/press-orchestrator.ts).
 *
 * **Persisted multiplier at fire-time** (T6-2 / T6-3 precedent):
 * `multiplier` is the value in effect when this press fired. A later
 * T5-11 mid-event rule edit that changes config.pressMultiplier does
 * NOT retroactively alter this row's value. The engine's carry-forward
 * path reads this column verbatim into PressLogEntry.multiplier.
 *
 * **`multiplier` is INTEGER** (overriding epic AC's REAL) for
 * integer-cents discipline consistency with T6-3's
 * `individual_bet_presses.multiplier`.
 *
 * **UNIQUE(round_id, team, start_hole, trigger_type)** is the last-line
 * defense against duplicate press fires when the engine's log-dedupe
 * misses (SQLite WAL snapshot residual). The orchestrator catches
 * UNIQUE violations + logs warning + continues; tx is NOT rolled back.
 *
 * **`fired_by_player_id` is nullable** for auto-presses (no user
 * filed them); manual presses populate with the filer's playerId.
 *
 * **`trigger`** is nullable for manual presses (no auto-trigger
 * descriptive label); auto presses populate with e.g. '2-down'.
 *
 * FK delete posture:
 *   - `round_id → rounds.id`: CASCADE. Press log disappears with round.
 *   - `fired_by_player_id → players.id`: RESTRICT. Audit attribution
 *     preserved when present.
 */
export const teamPressLog = sqliteTable(
  'team_press_log',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    team: text('team').notNull(),
    startHole: integer('start_hole').notNull(),
    triggerType: text('trigger_type').notNull(),
    trigger: text('trigger'),
    multiplier: integer('multiplier').notNull(),
    firedAt: integer('fired_at').notNull(),
    firedByPlayerId: text('fired_by_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    ...ecosystemColumns(),
  },
  (t) => ({
    roundIdx: index('idx_team_press_log_round_id').on(t.roundId),
    fireDedupeUniq: uniqueIndex(
      'uniq_team_press_log_dedupe',
    ).on(t.roundId, t.team, t.startHole, t.triggerType),
    teamCheck: check(
      'check_team_press_log_team',
      sql`${t.team} IN ('teamA', 'teamB')`,
    ),
    triggerTypeCheck: check(
      'check_team_press_log_trigger_type',
      sql`${t.triggerType} IN ('auto', 'manual')`,
    ),
    startHoleCheck: check(
      'check_team_press_log_start_hole',
      sql`${t.startHole} BETWEEN 1 AND 18`,
    ),
    multiplierCheck: check(
      'check_team_press_log_multiplier_positive',
      sql`${t.multiplier} >= 1`,
    ),
  }),
);

export type TeamPressLog = typeof teamPressLog.$inferSelect;
