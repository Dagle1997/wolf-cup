import { integer, sqliteTable, text, index, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { eventRounds } from './events.js';
import { players } from './players.js';

/**
 * Sub-games + sub_game_participants schema (T3-1, FD-6).
 *
 * **FK targets `event_rounds.id` (T3-1 setup-time entity), NOT a future
 * scoring rounds.id (T5.1).** Sub-games are a setup-time entity; T6.13
 * dispatcher joins `sub_games` via `event_round_id` to the scoring `rounds`
 * row at compute time. T6.13 narrows to adding `sub_game_results` + the
 * dispatcher; the opt-in setup schema lives here.
 *
 * **`type CHECK IN ('skins','ctp','sandies','putting_contest')`:** the v1
 * sub-game type catalog. New types extend the CHECK in a future migration.
 *
 * **`buy_in_per_participant` integer-cents discipline + CHECK >= 0:** mirrors
 * Wolf Cup's engine money posture. v1 default is 0 ($0); future stories may
 * enable buy-in pots. The CHECK guards against negative-cents data corruption
 * at the schema layer (defense-in-depth before app validation).
 *
 * **FK delete posture:**
 *   - `sub_games.event_round_id → event_rounds.id`: **CASCADE**. Sub-games
 *     are round-scoped.
 *   - `sub_game_participants.sub_game_id → sub_games.id`: **CASCADE**.
 *   - `sub_game_participants.player_id → players.id`: **RESTRICT**. Players
 *     are shared infrastructure.
 *
 * **Composite primary key on (sub_game_id, player_id):** a player can opt
 * into a sub-game at most once. The `idx_sub_game_participants_player_id`
 * index supports the reverse lookup ("which sub-games is this player in?").
 */
export const subGames = sqliteTable(
  'sub_games',
  {
    id: text('id').primaryKey(),
    eventRoundId: text('event_round_id')
      .notNull()
      .references(() => eventRounds.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    configJson: text('config_json').notNull().default('{}'),
    buyInPerParticipant: integer('buy_in_per_participant').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventRoundIdx: index('idx_sub_games_event_round_id').on(t.eventRoundId),
    typeCheck: check(
      'check_sub_games_type',
      sql`${t.type} IN ('skins', 'ctp', 'sandies', 'putting_contest')`,
    ),
    buyInCheck: check('check_sub_games_buy_in_non_negative', sql`${t.buyInPerParticipant} >= 0`),
  }),
);

export type SubGame = typeof subGames.$inferSelect;

export const subGameParticipants = sqliteTable(
  'sub_game_participants',
  {
    subGameId: text('sub_game_id')
      .notNull()
      .references(() => subGames.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    optedInAt: integer('opted_in_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subGameId, t.playerId] }),
    playerIdx: index('idx_sub_game_participants_player_id').on(t.playerId),
  }),
);

export type SubGameParticipant = typeof subGameParticipants.$inferSelect;

/**
 * T6-13 sub_game_results — append-only history of computed sub-game results.
 *
 * Multiple rows per sub_game_id are allowed; latest-by-`computed_at` is the
 * current truth. No UPDATE / DELETE paths in v1 — score-correction-triggered
 * recomputes INSERT a new row (history preserved per FD-10/11).
 *
 * **`config_snapshot_json`** — captures the rule-set/config in effect at
 * compute time so historical rows remain reproducible even if the rule-set
 * changes via T5-11 mid-event-edit.
 *
 * **`results_json`** — the full output of the sub-game-specific compute
 * function (e.g., calcSkins output). Schema-less per type to keep new
 * sub-game types additive.
 *
 * **`created_by_player_id` NULLABLE** — null for system-computed (auto-
 * compute on T5-8 finalize); populated for user-triggered POST .../compute.
 *
 * FK delete posture:
 *   - sub_game_id → sub_games.id: CASCADE.
 *   - created_by_player_id → players.id: RESTRICT (preserve audit attribution).
 */
export const subGameResults = sqliteTable(
  'sub_game_results',
  {
    id: text('id').primaryKey(),
    subGameId: text('sub_game_id')
      .notNull()
      .references(() => subGames.id, { onDelete: 'cascade' }),
    computedAt: integer('computed_at').notNull(),
    configSnapshotJson: text('config_snapshot_json').notNull(),
    resultsJson: text('results_json').notNull(),
    totalPotCents: integer('total_pot_cents').notNull(),
    createdByPlayerId: text('created_by_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }),
    ...ecosystemColumns(),
  },
  (t) => ({
    subGameIdx: index('idx_sub_game_results_sub_game_id').on(t.subGameId),
    // For "latest-by-sub-game" queries: sub_game_id + computed_at desc.
    subGameComputedAtIdx: index('idx_sub_game_results_sub_game_id_computed_at').on(
      t.subGameId,
      t.computedAt,
    ),
    totalPotCheck: check(
      'check_sub_game_results_total_pot_non_negative',
      sql`${t.totalPotCents} >= 0`,
    ),
  }),
);

export type SubGameResult = typeof subGameResults.$inferSelect;
