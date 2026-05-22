/**
 * T5-1 scoring-domain schema (rounds, hole_scores, score_corrections,
 * round_states, scorer_assignments). Schema-only; no routes / no UI / no
 * middleware. Downstream T5 stories (T5-2, T5-3, T5-6, T5-7, T5-8, T5-9)
 * wire reads + writes.
 *
 * `hole_scores` is PORTED from Wolf Cup `apps/api/src/db/schema.ts`
 * (`holeScores` table) @ commit f4dbb558a89d26efeaf4c9ebf7311fda91ed1e33,
 * dated 2026-04-27.
 *
 * Other tables in this file (rounds, score_corrections, round_states,
 * scorer_assignments) are GREENFIELD — no Wolf Cup analogue exists.
 *
 * Deltas vs Wolf Cup `holeScores`:
 *   - id: integer autoIncrement → text UUID (FD-6)
 *   - round_id, player_id: integer → text (FK target type aligned)
 *   - group_id: REMOVED (tournament uses pairings → pairing_members for
 *     foursome context, T4-2)
 *   - gross_score → gross_strokes (rename per epic AC line 1260;
 *     semantically more correct — it's strokes, not score)
 *   - ADDED scorer_player_id: FR-B10 attribution
 *   - ADDED client_event_id: FD-3 / FD-5 offline idempotency
 *   - ADDED UNIQUE(round_id, player_id, hole_number, client_event_id):
 *     dedupe target for ON CONFLICT DO NOTHING
 *   - ADDED CHECK(gross_strokes >= 1): positivity guard
 *
 * Two-UNIQUE design (epic AC line 1273-1275): T5.6 idempotent replay
 * uses `INSERT ... ON CONFLICT(round_id, player_id, hole_number,
 * client_event_id) DO NOTHING` — identical client_event_id dedupes;
 * different client_event_id at same cell falls back to default
 * conflict resolution (ABORT) on the cell-level UNIQUE → 409 path.
 *
 * `chk_rounds_event_pairing` enforces (event_id IS NULL) = (event_round_id IS NULL):
 * v1 always writes both non-null; v1.5 standalone-round writes both NULL;
 * partial-NULL is invalid (event without event_round = no holes/tees;
 * event_round without event contradicts the FK chain). Future v2+
 * asymmetric flow would drop this CHECK in a future migration with
 * explicit ADR.
 *
 * `score_corrections` is append-only by app-layer convention (T5.9 owns
 * the INSERT-only invariant). NO updated_at column. Trigger-based
 * enforcement was considered + deferred (T5-1 spec Risks section).
 *
 * `request_id` on score_corrections has NO uniqueness constraint here —
 * T5.9 will decide whether to add UNIQUE(request_id) or treat it as
 * diagnostic-only.
 */

import {
  integer,
  sqliteTable,
  text,
  index,
  primaryKey,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql, desc } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { events, eventRounds } from './events.js';
import { players } from './players.js';

// ---------------------------------------------------------------------------
// rounds — scoring runtime instance, optionally bound to an event_round
// ---------------------------------------------------------------------------

export const rounds = sqliteTable(
  'rounds',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }),
    eventRoundId: text('event_round_id').references(() => eventRounds.id, {
      onDelete: 'cascade',
    }),
    holesToPlay: integer('holes_to_play').notNull().default(18),
    openedAt: integer('opened_at'),
    openedByPlayerId: text('opened_by_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventIdx: index('idx_rounds_event_id').on(t.eventId),
    eventRoundIdx: index('idx_rounds_event_round_id').on(t.eventRoundId),
    // T13-2: at most one scoring round per event_round. Partial (WHERE NOT
    // NULL) because event_round_id is nullable for legacy Wolf-Cup-shaped
    // rounds. Makes start-round idempotency race-safe (insert-then-recover).
    eventRoundUniq: uniqueIndex('uniq_rounds_event_round_id')
      .on(t.eventRoundId)
      .where(sql`${t.eventRoundId} IS NOT NULL`),
    holesToPlayCheck: check(
      'chk_rounds_holes_to_play',
      sql`${t.holesToPlay} IN (9, 18)`,
    ),
    eventPairingCheck: check(
      'chk_rounds_event_pairing',
      sql`(${t.eventId} IS NULL) = (${t.eventRoundId} IS NULL)`,
    ),
  }),
);

export type Round = typeof rounds.$inferSelect;

// ---------------------------------------------------------------------------
// hole_scores — PORTED from Wolf Cup with the deltas listed in the file header
// ---------------------------------------------------------------------------

export const holeScores = sqliteTable(
  'hole_scores',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    holeNumber: integer('hole_number').notNull(),
    grossStrokes: integer('gross_strokes').notNull(),
    putts: integer('putts'),
    scorerPlayerId: text('scorer_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    clientEventId: text('client_event_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    roundIdx: index('idx_hole_scores_round_id').on(t.roundId),
    scorerIdx: index('idx_hole_scores_scorer_player_id').on(t.scorerPlayerId),
    cellUniq: uniqueIndex('uniq_hole_scores_cell').on(
      t.roundId,
      t.playerId,
      t.holeNumber,
    ),
    dedupeUniq: uniqueIndex('uniq_hole_scores_dedupe').on(
      t.roundId,
      t.playerId,
      t.holeNumber,
      t.clientEventId,
    ),
    holeNumberCheck: check(
      'chk_hole_scores_hole_number',
      sql`${t.holeNumber} BETWEEN 1 AND 18`,
    ),
    grossStrokesCheck: check(
      'chk_hole_scores_gross_strokes_positive',
      sql`${t.grossStrokes} >= 1`,
    ),
  }),
);

export type HoleScore = typeof holeScores.$inferSelect;

// ---------------------------------------------------------------------------
// score_corrections — append-only audit of cell-level corrections
// ---------------------------------------------------------------------------

export const scoreCorrections = sqliteTable(
  'score_corrections',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    holeNumber: integer('hole_number').notNull(),
    actorPlayerId: text('actor_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    priorValueJson: text('prior_value_json').notNull(),
    newValueJson: text('new_value_json').notNull(),
    requestId: text('request_id').notNull(),
    reason: text('reason'),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    roundHoleCreatedIdx: index('idx_score_corrections_round_hole_created').on(
      t.roundId,
      t.holeNumber,
      desc(t.createdAt),
    ),
    holeNumberCheck: check(
      'chk_score_corrections_hole_number',
      sql`${t.holeNumber} BETWEEN 1 AND 18`,
    ),
  }),
);

export type ScoreCorrection = typeof scoreCorrections.$inferSelect;

// ---------------------------------------------------------------------------
// round_states — current lifecycle state per round; history goes to audit_log
// ---------------------------------------------------------------------------

export const roundStates = sqliteTable(
  'round_states',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    enteredAt: integer('entered_at').notNull(),
    enteredByPlayerId: text('entered_by_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    ...ecosystemColumns(),
  },
  (t) => ({
    stateCheck: check(
      'chk_round_states_state',
      sql`${t.state} IN ('not_started','in_progress','complete_editable','finalized','cancelled')`,
    ),
  }),
);

export type RoundState = typeof roundStates.$inferSelect;

// ---------------------------------------------------------------------------
// scorer_assignments — composite PK (round_id, foursome_number)
// ---------------------------------------------------------------------------

export const scorerAssignments = sqliteTable(
  'scorer_assignments',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    foursomeNumber: integer('foursome_number').notNull(),
    scorerPlayerId: text('scorer_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    assignedAt: integer('assigned_at').notNull(),
    assignedByPlayerId: text('assigned_by_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roundId, t.foursomeNumber] }),
    scorerIdx: index('idx_scorer_assignments_scorer_player_id').on(t.scorerPlayerId),
    foursomeNumberCheck: check(
      'chk_scorer_assignments_foursome_number_positive',
      sql`${t.foursomeNumber} >= 1`,
    ),
  }),
);

export type ScorerAssignment = typeof scorerAssignments.$inferSelect;
