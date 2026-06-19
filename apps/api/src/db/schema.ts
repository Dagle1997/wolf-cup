import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// admins
// ---------------------------------------------------------------------------

export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // UUID
    adminId: integer("admin_id")
      .notNull()
      .references(() => admins.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => ({
    adminIdx: index("idx_sessions_admin_id").on(t.adminId),
  }),
);

// ---------------------------------------------------------------------------
// seasons
// ---------------------------------------------------------------------------

export const seasons = sqliteTable(
  "seasons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    year: integer("year").notNull().default(0),
    startDate: text("start_date").notNull(), // ISO YYYY-MM-DD
    endDate: text("end_date").notNull(),
    totalRounds: integer("total_rounds").notNull(),
    playoffFormat: text("playoff_format").notNull(),
    harveyLiveEnabled: integer("harvey_live_enabled").notNull().default(0), // boolean 0/1
    championPlayerId: integer("champion_player_id").references(
      () => players.id,
    ),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    yearUniq: uniqueIndex("uniq_seasons_year").on(t.year),
  }),
);

// ---------------------------------------------------------------------------
// season_standings
// ---------------------------------------------------------------------------

export const seasonStandings = sqliteTable(
  "season_standings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    rank: integer("rank").notNull(),
    points: real("points"), // nullable — some historical years have rank only
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    seasonPlayerUniq: uniqueIndex("uniq_season_standings_season_player").on(
      t.seasonId,
      t.playerId,
    ),
    seasonIdx: index("idx_season_standings_season").on(t.seasonId),
  }),
);

// ---------------------------------------------------------------------------
// season_weeks
// ---------------------------------------------------------------------------

export const seasonWeeks = sqliteTable(
  "season_weeks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    friday: text("friday").notNull(), // ISO YYYY-MM-DD, must be a Friday
    isActive: integer("is_active").notNull().default(1), // 0=skipped, 1=active
    tee: text("tee"), // 'blue' | 'black' | 'white' | null (null for skipped weeks)
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    seasonWeekUniq: uniqueIndex("uniq_season_week").on(t.seasonId, t.friday),
    seasonIdx: index("idx_season_weeks_season").on(t.seasonId),
  }),
);

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------

export const players = sqliteTable(
  "players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    ghinNumber: text("ghin_number"),
    handicapIndex: real("handicap_index"), // last-known HI from GHIN; updated via roster admin
    isActive: integer("is_active").notNull().default(1), // boolean 0/1; kept in sync with status
    isGuest: integer("is_guest").notNull().default(0), // boolean 0/1; guests are round-only, not roster
    status: text("status").notNull().default("active"), // 'active' | 'sub' | 'inactive'
    appleSub: text("apple_sub"),
    googleSub: text("google_sub"),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    appleSubUniq: uniqueIndex("players_apple_sub_idx")
      .on(t.appleSub)
      .where(sql`${t.appleSub} IS NOT NULL`),
    googleSubUniq: uniqueIndex("players_google_sub_idx")
      .on(t.googleSub)
      .where(sql`${t.googleSub} IS NOT NULL`),
  }),
);

// ---------------------------------------------------------------------------
// rounds
// ---------------------------------------------------------------------------

export const rounds = sqliteTable(
  "rounds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id),
    type: text("type").notNull(), // 'official' | 'casual'
    status: text("status").notNull(), // 'scheduled' | 'active' | 'finalized' | 'cancelled'
    scheduledDate: text("scheduled_date").notNull(), // ISO YYYY-MM-DD
    entryCodeHash: text("entry_code_hash"),
    entryCode: text("entry_code"), // plain text for admin display
    tee: text("tee"), // 'black' | 'blue' | 'white' — set by admin at round creation
    autoCalculateMoney: integer("auto_calculate_money").notNull().default(1),
    headcount: integer("headcount"),
    cancellationReason: text("cancellation_reason"), // set when status='cancelled'
    // Set-once snapshot of the engine's generated pairing at group creation
    // (from-attendance Generate). JSON: [{ groupNumber, playerIds:[...] }].
    // Null = round predates pairing tracking (or was never generated) → "not tracked".
    generatedPairing: text("generated_pairing"),
    handicapUpdatedAt: integer("handicap_updated_at"), // timestamp of last HI refresh
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    seasonIdx: index("idx_rounds_season_id").on(t.seasonId),
    typeCheck: check("chk_rounds_type", sql`type IN ('official', 'casual')`),
    statusCheck: check(
      "chk_rounds_status",
      sql`status IN ('scheduled', 'active', 'finalized', 'cancelled', 'completed')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// groups
// ---------------------------------------------------------------------------

export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    groupNumber: integer("group_number").notNull(),
    battingOrder: text("batting_order"), // JSON array of player IDs
    tee: text("tee"), // 'black' | 'blue' | 'white' — nullable, set at ball-draw time
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
  },
  (t) => ({
    roundIdx: index("idx_groups_round_id").on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// round_players
// ---------------------------------------------------------------------------

export const roundPlayers = sqliteTable(
  "round_players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    handicapIndex: real("handicap_index").notNull(),
    isSub: integer("is_sub").notNull().default(0), // boolean 0/1
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
  },
  (t) => ({
    roundPlayerUniq: uniqueIndex("uniq_round_players").on(
      t.roundId,
      t.playerId,
    ),
    roundIdx: index("idx_round_players_round_id").on(t.roundId),
    playerIdx: index("idx_round_players_player_id").on(t.playerId),
  }),
);

// ---------------------------------------------------------------------------
// hole_scores
// ---------------------------------------------------------------------------

export const holeScores = sqliteTable(
  "hole_scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    holeNumber: integer("hole_number").notNull(),
    grossScore: integer("gross_score").notNull(),
    putts: integer("putts"),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    roundPlayerHoleUniq: uniqueIndex("uniq_hole_scores").on(
      t.roundId,
      t.playerId,
      t.holeNumber,
    ),
    roundIdx: index("idx_hole_scores_round_id").on(t.roundId),
    groupIdx: index("idx_hole_scores_group_id").on(t.groupId),
    holeCheck: check(
      "chk_hole_scores_hole_number",
      sql`hole_number BETWEEN 1 AND 18`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// round_results  (computed, written atomically after each score entry)
// ---------------------------------------------------------------------------

export const roundResults = sqliteTable(
  "round_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    stablefordTotal: integer("stableford_total").notNull(),
    moneyTotal: integer("money_total").notNull(), // whole dollars
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    roundPlayerUniq: uniqueIndex("uniq_round_results").on(
      t.roundId,
      t.playerId,
    ),
    roundIdx: index("idx_round_results_round_id").on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// harvey_results  (computed Harvey Cup points; real for 0.5 tie-splits)
// ---------------------------------------------------------------------------

export const harveyResults = sqliteTable(
  "harvey_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    stablefordRank: integer("stableford_rank").notNull(),
    moneyRank: integer("money_rank").notNull(),
    stablefordPoints: real("stableford_points").notNull(), // can be 0.5 increments
    moneyPoints: real("money_points").notNull(),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    roundPlayerUniq: uniqueIndex("uniq_harvey_results").on(
      t.roundId,
      t.playerId,
    ),
    roundIdx: index("idx_harvey_results_round_id").on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// wolf_decisions  (per-hole wolf call recording for FR57 statistics)
// ---------------------------------------------------------------------------

export const wolfDecisions = sqliteTable(
  "wolf_decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    holeNumber: integer("hole_number").notNull(),
    wolfPlayerId: integer("wolf_player_id").references(() => players.id), // null on skins holes (1, 3)
    decision: text("decision"), // null on skins holes; 'partner'|'alone'|'blind_wolf' on wolf holes
    partnerPlayerId: integer("partner_player_id").references(() => players.id),
    bonusesJson: text("bonuses_json"), // JSON {greenies:[playerId,...], polies:[playerId,...]}
    outcome: text("outcome"), // 'win' | 'loss' | 'push' | null
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    roundDecisionUniq: uniqueIndex("uniq_wolf_decisions").on(
      t.roundId,
      t.groupId,
      t.holeNumber,
    ),
    roundIdx: index("idx_wolf_decisions_round_id").on(t.roundId),
    decisionCheck: check(
      "chk_wolf_decisions_decision",
      sql`decision IN ('partner', 'alone', 'blind_wolf')`,
    ),
    outcomeCheck: check(
      "chk_wolf_decisions_outcome",
      sql`outcome IS NULL OR outcome IN ('win', 'loss', 'push')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// odds_lines  (frozen "The Line" snapshot per round)
//
// Taken at finalize so a later model change can't silently rewrite the graded
// retrospective, and so a candidate model has a stable baseline to backtest
// against. payload_json is the serialized engine OddsResult (gated or full).
// ---------------------------------------------------------------------------

export const oddsLines = sqliteTable(
  "odds_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    modelVersion: text("model_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    computedAt: integer("computed_at").notNull(),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
  },
  (t) => ({
    roundUniq: uniqueIndex("uniq_odds_lines_round").on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// side_games
// ---------------------------------------------------------------------------

export const sideGames = sqliteTable(
  "side_games",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id),
    name: text("name").notNull(),
    format: text("format").notNull(),
    calculationType: text("calculation_type"), // auto_net_pars | auto_skins | auto_putts | auto_net_under_par | auto_polies | manual
    scheduledRoundIds: text("scheduled_round_ids"), // JSON array of round IDs (backfilled as rounds are created)
    scheduledFridays: text("scheduled_fridays"), // JSON array of ISO Friday dates — authoritative at season init
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    seasonIdx: index("idx_side_games_season_id").on(t.seasonId),
  }),
);

// ---------------------------------------------------------------------------
// side_game_results
// ---------------------------------------------------------------------------

export const sideGameResults = sqliteTable(
  "side_game_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sideGameId: integer("side_game_id")
      .notNull()
      .references(() => sideGames.id),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    winnerPlayerId: integer("winner_player_id").references(() => players.id),
    winnerName: text("winner_name"), // for guest winners not in roster
    notes: text("notes"),
    source: text("source"), // 'auto' | 'manual'
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    roundIdx: index("idx_side_game_results_round_id").on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// side_game_ctp_entries  (per-group per-par-3 closest-to-pin entries)
// ---------------------------------------------------------------------------

export const sideGameCtpEntries = sqliteTable(
  "side_game_ctp_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    holeNumber: integer("hole_number").notNull(),
    winnerPlayerId: integer("winner_player_id").references(() => players.id),
    winnerName: text("winner_name"),
    enteredByPlayerId: integer("entered_by_player_id").references(
      () => players.id,
    ),
    holeCompletedAt: integer("hole_completed_at").notNull(),
    finalizedAt: integer("finalized_at"),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    tenantRoundGroupHoleUniq: uniqueIndex(
      "uniq_ctp_entries_tenant_round_group_hole",
    ).on(t.tenantId, t.contextId, t.roundId, t.groupId, t.holeNumber),
    roundIdx: index("idx_ctp_entries_round").on(t.roundId),
    roundHoleCompletedIdx: index("idx_ctp_entries_round_hole_completed").on(
      t.roundId,
      t.holeNumber,
      t.holeCompletedAt,
    ),
    holeCheck: check(
      "chk_ctp_entries_hole_number",
      sql`hole_number IN (6, 7, 12, 15)`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// hole_completions  (server-captured: moment the last roster score for a group+hole lands)
// ---------------------------------------------------------------------------

export const holeCompletions = sqliteTable(
  "hole_completions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    holeNumber: integer("hole_number").notNull(),
    completedAt: integer("completed_at").notNull(),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
  },
  (t) => ({
    tenantRoundGroupHoleUniq: uniqueIndex(
      "uniq_hole_completions_tenant_round_group_hole",
    ).on(t.tenantId, t.contextId, t.roundId, t.groupId, t.holeNumber),
    roundIdx: index("idx_hole_completions_round").on(t.roundId),
    holeCheck: check(
      "chk_hole_completions_hole_number",
      sql`hole_number BETWEEN 1 AND 18`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// pairing_history  (tracks who played with whom per season for group suggestions)
// ---------------------------------------------------------------------------

export const pairingHistory = sqliteTable(
  "pairing_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id),
    playerAId: integer("player_a_id")
      .notNull()
      .references(() => players.id),
    playerBId: integer("player_b_id")
      .notNull()
      .references(() => players.id),
    pairCount: integer("pair_count").notNull().default(0),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
  },
  (t) => ({
    pairUniq: uniqueIndex("uniq_pairing_history").on(
      t.seasonId,
      t.playerAId,
      t.playerBId,
    ),
    seasonIdx: index("idx_pairing_history_season_id").on(t.seasonId),
  }),
);

// ---------------------------------------------------------------------------
// attendance  (weekly in/out tracking, independent of round existence)
// ---------------------------------------------------------------------------

export const attendance = sqliteTable(
  "attendance",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonWeekId: integer("season_week_id")
      .notNull()
      .references(() => seasonWeeks.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    status: text("status").notNull(), // 'in' | 'out'
    groupRequest: text("group_request"), // null | 'first' | 'last'
    groupRequestAt: integer("group_request_at"), // epoch ms; used to break ties when overflow
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    weekPlayerUniq: uniqueIndex("uniq_attendance_week_player").on(
      t.seasonWeekId,
      t.playerId,
    ),
    weekIdx: index("idx_attendance_season_week").on(t.seasonWeekId),
  }),
);

// ---------------------------------------------------------------------------
// sub_bench  (season-scoped sub tracking for attendance board)
// ---------------------------------------------------------------------------

export const subBench = sqliteTable(
  "sub_bench",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    roundCount: integer("round_count").notNull().default(0),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    seasonPlayerUniq: uniqueIndex("uniq_sub_bench_season_player").on(
      t.seasonId,
      t.playerId,
    ),
    seasonIdx: index("idx_sub_bench_season").on(t.seasonId),
  }),
);

// ---------------------------------------------------------------------------
// score_corrections  (immutable audit log for post-round corrections — FR64)
// ---------------------------------------------------------------------------

export const scoreCorrections = sqliteTable(
  "score_corrections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adminUserId: integer("admin_user_id")
      .notNull()
      .references(() => admins.id),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    holeNumber: integer("hole_number").notNull(),
    playerId: integer("player_id").references(() => players.id), // nullable (wolf fields)
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value").notNull(),
    newValue: text("new_value").notNull(),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    correctedAt: integer("corrected_at").notNull(),
  },
  (t) => ({
    roundIdx: index("idx_score_corrections_round_id").on(t.roundId),
  }),
);

// ---------------------------------------------------------------------------
// Gallery Photos
// ---------------------------------------------------------------------------

export const galleryPhotos = sqliteTable(
  "gallery_photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id").references(() => rounds.id),
    playerId: integer("player_id").references(() => players.id),
    r2Key: text("r2_key").notNull().unique(),
    publicUrl: text("public_url").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    caption: text("caption"),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    roundIdx: index("idx_gallery_photos_round_id").on(t.roundId),
    createdIdx: index("idx_gallery_photos_created").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Sent Emails — durable receipt log for outbound transactional emails.
// ---------------------------------------------------------------------------
//
// Single use case today: on-finalize round-results email to Jason. Container
// logs evaporate on every redeploy, so this table is how we answer "did
// the email actually fire?" without crawling the sender's Sent folder.
//
// kind='round_results' for now; reserved for future email types.
// recipients = comma-separated list captured at send time.
// Failures get status='failed' + error_message; a row is written either way
// so a missing email is detectable as an absent row.

export const sentEmails = sqliteTable(
  "sent_emails",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id").references(() => rounds.id),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    recipients: text("recipients").notNull(),
    status: text("status").notNull(),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    errorMessage: text("error_message"),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
    sentAt: integer("sent_at").notNull(),
  },
  (t) => ({
    statusCheck: check(
      "chk_sent_emails_status",
      sql`status IN ('sent', 'failed')`,
    ),
    roundIdx: index("idx_sent_emails_round_id").on(t.roundId),
    sentAtIdx: index("idx_sent_emails_sent_at").on(t.sentAt),
  }),
);

// ---------------------------------------------------------------------------
// bets  (side-action bet tracker — admin-entered v1, identity-ready)
//
// A bet has a PROPOSITION (subjects whose round SCORES settle it) and two
// STAKEHOLDERS (who has cash on each side). Stakeholders are independent of the
// subjects — e.g. Kyle (stakeholder) can back "Teddy beats Jaquint" without
// being either player. Every party is a player_id so per-person identity drops
// in later with no migration; v1 only an admin can create them.
//
// Side semantics by bet_type:
//   h2h        — side A = subject_a wins (lower score by basis), side B = subject_b wins; equal = push
//   over_under — side A = UNDER (subject_a's score < line), side B = OVER (> line); equal = push
//   per_hole   — match-play, lower (net/gross) wins each hole; payout = netHoles × stake
//   odds_win   — side A (bettor) backs subject_a to WIN a Line market at locked American
//                odds; side B (layer) takes the other side. Settles only when the round is
//                FINALIZED (the day-winner is then authoritative). Bettor wins → collects the
//                American PROFIT; loses → forfeits the STAKE (amount_dollars). No push.
// Outcome is NOT stored — it's recomputed from the round's scores (pure), so a
// score correction re-settles automatically.
// ---------------------------------------------------------------------------
export const bets = sqliteTable(
  "bets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    betType: text("bet_type").notNull(), // 'h2h' | 'over_under' | 'per_hole' | 'odds_win'
    basis: text("basis").notNull().default("net"), // 'net' | 'gross'
    amountDollars: integer("amount_dollars").notNull(), // whole dollars (matches money_total). odds_win: the STAKE the bettor risks.
    // Proposition — the player(s) whose 18-hole score decides it.
    subjectAPlayerId: integer("subject_a_player_id")
      .notNull()
      .references(() => players.id), // h2h: player A; over_under/odds_win: the subject
    subjectBPlayerId: integer("subject_b_player_id").references(() => players.id), // h2h: player B; over_under/odds_win: null
    line: integer("line"), // over_under: the number (e.g. 90); h2h: null
    // odds_win — bet a player to WIN a Line market at a locked American price.
    oddsMarket: text("odds_market"), // 'stableford' | 'money' | 'perfect_day' (which title)
    odds: integer("odds"), // locked American odds (e.g. +1650 longshot, -200 favorite)
    // Stakeholders — who has money on each side (identity-ready player refs).
    sideAPlayerId: integer("side_a_player_id")
      .notNull()
      .references(() => players.id), // backs side A ("A wins" / "under")
    sideBPlayerId: integer("side_b_player_id").references(() => players.id), // backs side B ("B wins" / "over"); NULL = The House (odds_win vs the book)
    note: text("note"),
    createdByAdminId: integer("created_by_admin_id"),
    createdAt: integer("created_at").notNull(),
    contextId: text("context_id")
      .notNull()
      .default("league:guyan-wolf-cup-friday"),
    tenantId: text("tenant_id").notNull().default("guyan"),
  },
  (t) => ({
    roundIdx: index("idx_bets_round_id").on(t.roundId),
    // A null layer (side B) means "vs The House" — only valid for odds_win. Every
    // other bet type must name a real second stakeholder.
    layerRequiredUnlessHouse: check(
      "chk_bets_side_b_required",
      sql`side_b_player_id IS NOT NULL OR bet_type = 'odds_win'`,
    ),
  }),
);
