import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// admins
// ---------------------------------------------------------------------------

export const admins = sqliteTable('admins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // UUID
    adminId: integer('admin_id')
      .notNull()
      .references(() => admins.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => ({
    adminIdx: index('idx_sessions_admin_id').on(t.adminId),
  }),
);

// ---------------------------------------------------------------------------
// seasons
// ---------------------------------------------------------------------------

export const seasons = sqliteTable('seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(), // ISO YYYY-MM-DD
  endDate: text('end_date').notNull(),
  totalRounds: integer('total_rounds').notNull(),
  playoffFormat: text('playoff_format').notNull(),
  harveyLiveEnabled: integer('harvey_live_enabled').notNull().default(0), // boolean 0/1
  createdAt: integer('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------

export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ghinNumber: text('ghin_number'),
  isActive: integer('is_active').notNull().default(1), // boolean 0/1
  createdAt: integer('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// rounds
// ---------------------------------------------------------------------------

export const rounds = sqliteTable(
  'rounds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    type: text('type').notNull(), // 'official' | 'casual'
    status: text('status').notNull(), // 'scheduled' | 'active' | 'finalized' | 'cancelled'
    scheduledDate: text('scheduled_date').notNull(), // ISO YYYY-MM-DD
    entryCodeHash: text('entry_code_hash'),
    autoCalculateMoney: integer('auto_calculate_money').notNull().default(1),
    headcount: integer('headcount'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    seasonIdx: index('idx_rounds_season_id').on(t.seasonId),
    typeCheck: check('chk_rounds_type', sql`type IN ('official', 'casual')`),
    statusCheck: check(
      'chk_rounds_status',
      sql`status IN ('scheduled', 'active', 'finalized', 'cancelled')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

export const groups = sqliteTable(
  'groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id),
    groupNumber: integer('group_number').notNull(),
    battingOrder: text('batting_order'), // JSON array of player IDs
  },
  (t) => ({
    roundIdx: index('idx_groups_round_id').on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// round_players
// ---------------------------------------------------------------------------

export const roundPlayers = sqliteTable(
  'round_players',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    handicapIndex: real('handicap_index').notNull(),
    isSub: integer('is_sub').notNull().default(0), // boolean 0/1
  },
  (t) => ({
    roundPlayerUniq: uniqueIndex('uniq_round_players').on(t.roundId, t.playerId),
    roundIdx: index('idx_round_players_round_id').on(t.roundId),
    playerIdx: index('idx_round_players_player_id').on(t.playerId),
  }),
);

// ---------------------------------------------------------------------------
// hole_scores
// ---------------------------------------------------------------------------

export const holeScores = sqliteTable(
  'hole_scores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    holeNumber: integer('hole_number').notNull(),
    grossScore: integer('gross_score').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    roundPlayerHoleUniq: uniqueIndex('uniq_hole_scores').on(
      t.roundId,
      t.playerId,
      t.holeNumber,
    ),
    roundIdx: index('idx_hole_scores_round_id').on(t.roundId),
    groupIdx: index('idx_hole_scores_group_id').on(t.groupId),
    holeCheck: check(
      'chk_hole_scores_hole_number',
      sql`hole_number BETWEEN 1 AND 18`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// round_results  (computed, written atomically after each score entry)
// ---------------------------------------------------------------------------

export const roundResults = sqliteTable(
  'round_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    stablefordTotal: integer('stableford_total').notNull(),
    moneyTotal: integer('money_total').notNull(), // whole dollars
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    roundPlayerUniq: uniqueIndex('uniq_round_results').on(t.roundId, t.playerId),
    roundIdx: index('idx_round_results_round_id').on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// harvey_results  (computed Harvey Cup points; real for 0.5 tie-splits)
// ---------------------------------------------------------------------------

export const harveyResults = sqliteTable(
  'harvey_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    stablefordRank: integer('stableford_rank').notNull(),
    moneyRank: integer('money_rank').notNull(),
    stablefordPoints: real('stableford_points').notNull(), // can be 0.5 increments
    moneyPoints: real('money_points').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    roundPlayerUniq: uniqueIndex('uniq_harvey_results').on(t.roundId, t.playerId),
    roundIdx: index('idx_harvey_results_round_id').on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// wolf_decisions  (per-hole wolf call recording for FR57 statistics)
// ---------------------------------------------------------------------------

export const wolfDecisions = sqliteTable(
  'wolf_decisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    holeNumber: integer('hole_number').notNull(),
    wolfPlayerId: integer('wolf_player_id')
      .notNull()
      .references(() => players.id),
    decision: text('decision').notNull(), // 'partner' | 'alone'
    partnerPlayerId: integer('partner_player_id').references(() => players.id),
    outcome: text('outcome'), // 'win' | 'loss' | 'push' | null
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    roundIdx: index('idx_wolf_decisions_round_id').on(t.roundId),
    decisionCheck: check(
      'chk_wolf_decisions_decision',
      sql`decision IN ('partner', 'alone')`,
    ),
    outcomeCheck: check(
      'chk_wolf_decisions_outcome',
      sql`outcome IS NULL OR outcome IN ('win', 'loss', 'push')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// side_games
// ---------------------------------------------------------------------------

export const sideGames = sqliteTable(
  'side_games',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    name: text('name').notNull(),
    format: text('format').notNull(),
    scheduledRoundIds: text('scheduled_round_ids'), // JSON array of round IDs
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    seasonIdx: index('idx_side_games_season_id').on(t.seasonId),
  }),
);

// ---------------------------------------------------------------------------
// side_game_results
// ---------------------------------------------------------------------------

export const sideGameResults = sqliteTable(
  'side_game_results',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sideGameId: integer('side_game_id')
      .notNull()
      .references(() => sideGames.id),
    roundId: integer('round_id')
      .notNull()
      .references(() => rounds.id),
    winnerPlayerId: integer('winner_player_id').references(() => players.id),
    winnerName: text('winner_name'), // for guest winners not in roster
    notes: text('notes'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    roundIdx: index('idx_side_game_results_round_id').on(t.roundId),
  }),
);
