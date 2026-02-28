CREATE TABLE `admins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`group_number` integer NOT NULL,
	`batting_order` text,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_groups_round_id` ON `groups` (`round_id`);--> statement-breakpoint
CREATE TABLE `harvey_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`stableford_rank` integer NOT NULL,
	`money_rank` integer NOT NULL,
	`stableford_points` real NOT NULL,
	`money_points` real NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_harvey_results` ON `harvey_results` (`round_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_harvey_results_round_id` ON `harvey_results` (`round_id`);--> statement-breakpoint
CREATE TABLE `hole_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`hole_number` integer NOT NULL,
	`gross_score` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_hole_scores_hole_number" CHECK(hole_number BETWEEN 1 AND 18)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_hole_scores` ON `hole_scores` (`round_id`,`player_id`,`hole_number`);--> statement-breakpoint
CREATE INDEX `idx_hole_scores_round_id` ON `hole_scores` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_hole_scores_group_id` ON `hole_scores` (`group_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`ghin_number` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `round_players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`handicap_index` real NOT NULL,
	`is_sub` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_round_players` ON `round_players` (`round_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_round_players_round_id` ON `round_players` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_round_players_player_id` ON `round_players` (`player_id`);--> statement-breakpoint
CREATE TABLE `round_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`stableford_total` integer NOT NULL,
	`money_total` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_round_results` ON `round_results` (`round_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_round_results_round_id` ON `round_results` (`round_id`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`entry_code_hash` text,
	`auto_calculate_money` integer DEFAULT 1 NOT NULL,
	`headcount` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_rounds_type" CHECK(type IN ('official', 'casual')),
	CONSTRAINT "chk_rounds_status" CHECK(status IN ('scheduled', 'active', 'finalized', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_rounds_season_id` ON `rounds` (`season_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`total_rounds` integer NOT NULL,
	`playoff_format` text NOT NULL,
	`harvey_live_enabled` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_admin_id` ON `sessions` (`admin_id`);--> statement-breakpoint
CREATE TABLE `side_game_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`side_game_id` integer NOT NULL,
	`round_id` integer NOT NULL,
	`winner_player_id` integer,
	`winner_name` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`side_game_id`) REFERENCES `side_games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_side_game_results_round_id` ON `side_game_results` (`round_id`);--> statement-breakpoint
CREATE TABLE `side_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`scheduled_round_ids` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_side_games_season_id` ON `side_games` (`season_id`);--> statement-breakpoint
CREATE TABLE `wolf_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`hole_number` integer NOT NULL,
	`wolf_player_id` integer NOT NULL,
	`decision` text NOT NULL,
	`partner_player_id` integer,
	`outcome` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wolf_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_wolf_decisions_decision" CHECK(decision IN ('partner', 'alone')),
	CONSTRAINT "chk_wolf_decisions_outcome" CHECK(outcome IS NULL OR outcome IN ('win', 'loss', 'push'))
);
--> statement-breakpoint
CREATE INDEX `idx_wolf_decisions_round_id` ON `wolf_decisions` (`round_id`);