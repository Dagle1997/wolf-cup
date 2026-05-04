CREATE TABLE `team_press_log` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`team` text NOT NULL,
	`start_hole` integer NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger` text,
	`multiplier` integer NOT NULL,
	`fired_at` integer NOT NULL,
	`fired_by_player_id` text,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fired_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_team_press_log_team" CHECK("team_press_log"."team" IN ('teamA', 'teamB')),
	CONSTRAINT "check_team_press_log_trigger_type" CHECK("team_press_log"."trigger_type" IN ('auto', 'manual')),
	CONSTRAINT "check_team_press_log_start_hole" CHECK("team_press_log"."start_hole" BETWEEN 1 AND 18),
	CONSTRAINT "check_team_press_log_multiplier_positive" CHECK("team_press_log"."multiplier" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_team_press_log_round_id` ON `team_press_log` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_team_press_log_dedupe` ON `team_press_log` (`round_id`,`team`,`start_hole`,`trigger_type`);