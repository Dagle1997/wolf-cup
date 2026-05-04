CREATE TABLE `individual_bet_presses` (
	`id` text PRIMARY KEY NOT NULL,
	`bet_id` text NOT NULL,
	`fired_at_round_id` text NOT NULL,
	`fired_at_hole` integer NOT NULL,
	`trigger_type` text NOT NULL,
	`multiplier` integer NOT NULL,
	`fired_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`bet_id`) REFERENCES `individual_bets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fired_at_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_individual_bet_presses_fired_at_hole" CHECK("individual_bet_presses"."fired_at_hole" BETWEEN 1 AND 18),
	CONSTRAINT "check_individual_bet_presses_trigger_type" CHECK("individual_bet_presses"."trigger_type" IN ('auto', 'manual')),
	CONSTRAINT "check_individual_bet_presses_multiplier_positive" CHECK("individual_bet_presses"."multiplier" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_individual_bet_presses_bet_id` ON `individual_bet_presses` (`bet_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_individual_bet_presses_dedupe` ON `individual_bet_presses` (`bet_id`,`fired_at_round_id`,`fired_at_hole`,`trigger_type`);--> statement-breakpoint
CREATE TABLE `individual_bet_rounds` (
	`bet_id` text NOT NULL,
	`event_round_id` text NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`bet_id`, `event_round_id`),
	FOREIGN KEY (`bet_id`) REFERENCES `individual_bets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_individual_bet_rounds_event_round_id` ON `individual_bet_rounds` (`event_round_id`);--> statement-breakpoint
CREATE TABLE `individual_bets` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`player_a_id` text NOT NULL,
	`player_b_id` text NOT NULL,
	`bet_type` text NOT NULL,
	`stake_per_hole_cents` integer NOT NULL,
	`config_json` text NOT NULL,
	`created_by_player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_a_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_b_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_individual_bets_bet_type" CHECK("individual_bets"."bet_type" IN ('match_play_per_hole', 'match_play_with_auto_press')),
	CONSTRAINT "check_individual_bets_stake_positive" CHECK("individual_bets"."stake_per_hole_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_individual_bets_event_id` ON `individual_bets` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_individual_bets_event_a_b_type` ON `individual_bets` (`event_id`,`player_a_id`,`player_b_id`,`bet_type`);