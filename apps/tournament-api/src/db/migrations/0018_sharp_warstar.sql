CREATE TABLE `bet_sides` (
	`bet_id` text NOT NULL,
	`side` text NOT NULL,
	`stakeholder_player_id` text NOT NULL,
	`subject_player_id` text NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`bet_id`, `side`),
	FOREIGN KEY (`bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stakeholder_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_bet_sides_side" CHECK("bet_sides"."side" IN ('A', 'B'))
);
--> statement-breakpoint
CREATE INDEX `idx_bet_sides_stakeholder` ON `bet_sides` (`stakeholder_player_id`);--> statement-breakpoint
CREATE INDEX `idx_bet_sides_subject` ON `bet_sides` (`subject_player_id`);--> statement-breakpoint
CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_round_id` text NOT NULL,
	`parent_bet_id` text,
	`hole_scope` text NOT NULL,
	`bet_type` text NOT NULL,
	`basis` text NOT NULL,
	`stake_cents` integer NOT NULL,
	`state` text DEFAULT 'live' NOT NULL,
	`net_calc_version` integer,
	`resolution_json` text,
	`finalized_outcome_json` text,
	`created_by_player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`voided_at` integer,
	`voided_by_player_id` text,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voided_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_bets_hole_scope" CHECK("bets"."hole_scope" IN ('front', 'back', 'total', 'full18')),
	CONSTRAINT "check_bets_state" CHECK("bets"."state" IN ('live', 'provisional', 'settled', 'push', 'void', 'unsettleable', 'finalized')),
	CONSTRAINT "check_bets_stake_positive" CHECK("bets"."stake_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_bets_event_id` ON `bets` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_bets_event_round_id` ON `bets` (`event_round_id`);--> statement-breakpoint
CREATE INDEX `idx_bets_parent_bet_id` ON `bets` (`parent_bet_id`);