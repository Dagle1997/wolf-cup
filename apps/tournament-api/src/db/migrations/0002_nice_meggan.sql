CREATE TABLE `device_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`session_id` text,
	`device_info` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`session_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_device_bindings_player_id` ON `device_bindings` (`player_id`);--> statement-breakpoint
CREATE TABLE `event_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`round_date` integer NOT NULL,
	`course_revision_id` text NOT NULL,
	`tee_color` text NOT NULL,
	`holes_to_play` integer DEFAULT 18 NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_revision_id`) REFERENCES `course_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_event_rounds_holes_to_play" CHECK("event_rounds"."holes_to_play" IN (9, 18))
);
--> statement-breakpoint
CREATE INDEX `idx_event_rounds_event_id` ON `event_rounds` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_event_rounds_event_round_number` ON `event_rounds` (`event_id`,`round_number`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer NOT NULL,
	`timezone` text NOT NULL,
	`organizer_player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`organizer_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`player_id` text NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `player_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_group_members_player_id` ON `group_members` (`player_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`money_visibility_mode` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_groups_money_visibility_mode" CHECK("groups"."money_visibility_mode" IN ('open', 'participant', 'self_only'))
);
--> statement-breakpoint
CREATE INDEX `idx_groups_event_id` ON `groups` (`event_id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by_player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE INDEX `idx_invites_event_id` ON `invites` (`event_id`);--> statement-breakpoint
CREATE TABLE `rule_set_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_set_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`config_json` text NOT NULL,
	`effective_from_round_id` text,
	`effective_from_hole` integer DEFAULT 1 NOT NULL,
	`created_by_player_id` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`rule_set_id`) REFERENCES `rule_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`effective_from_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_rule_set_revisions_effective_from_hole" CHECK("rule_set_revisions"."effective_from_hole" BETWEEN 1 AND 19)
);
--> statement-breakpoint
CREATE INDEX `idx_rule_set_revisions_rule_set_id` ON `rule_set_revisions` (`rule_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_rule_set_revisions_rule_set_id_revision_number` ON `rule_set_revisions` (`rule_set_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `rule_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sub_game_participants` (
	`sub_game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`opted_in_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`sub_game_id`, `player_id`),
	FOREIGN KEY (`sub_game_id`) REFERENCES `sub_games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_sub_game_participants_player_id` ON `sub_game_participants` (`player_id`);--> statement-breakpoint
CREATE TABLE `sub_games` (
	`id` text PRIMARY KEY NOT NULL,
	`event_round_id` text NOT NULL,
	`type` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`buy_in_per_participant` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_sub_games_type" CHECK("sub_games"."type" IN ('skins', 'ctp', 'sandies', 'putting_contest')),
	CONSTRAINT "check_sub_games_buy_in_non_negative" CHECK("sub_games"."buy_in_per_participant" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sub_games_event_round_id` ON `sub_games` (`event_round_id`);--> statement-breakpoint
ALTER TABLE `players` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `ghin` text;--> statement-breakpoint
ALTER TABLE `players` ADD `manual_handicap_index` real;--> statement-breakpoint
ALTER TABLE `players` ADD `preferred_tee_color` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_players_ghin` ON `players` (`ghin`) WHERE "players"."ghin" IS NOT NULL;