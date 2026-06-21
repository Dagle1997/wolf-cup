CREATE TABLE `game_config` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`ref_id` text NOT NULL,
	`config_json` text NOT NULL,
	`seed_rule_set_revision_id` text,
	`lock_state` text,
	`config_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`seed_rule_set_revision_id`) REFERENCES `rule_set_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_game_config_level_ref` ON `game_config` (`level`,`ref_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_game_config_tenant_level_ref` ON `game_config` (`tenant_id`,`level`,`ref_id`);--> statement-breakpoint
CREATE TABLE `round_pin` (
	`round_id` text NOT NULL,
	`resolved_config_json` text NOT NULL,
	`seed_rule_set_revision_id` text,
	`course_revision_id` text NOT NULL,
	`tee` text NOT NULL,
	`per_player_handicaps_json` text NOT NULL,
	`team_composition_json` text,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seed_rule_set_revision_id`) REFERENCES `rule_set_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_revision_id`) REFERENCES `course_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_round_pin_round_id` ON `round_pin` (`round_id`);