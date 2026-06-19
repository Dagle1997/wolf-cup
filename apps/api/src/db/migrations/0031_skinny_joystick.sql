CREATE TABLE `bets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`bet_type` text NOT NULL,
	`basis` text DEFAULT 'net' NOT NULL,
	`amount_dollars` integer NOT NULL,
	`subject_a_player_id` integer NOT NULL,
	`subject_b_player_id` integer,
	`line` integer,
	`side_a_player_id` integer NOT NULL,
	`side_b_player_id` integer NOT NULL,
	`note` text,
	`created_by_admin_id` integer,
	`created_at` integer NOT NULL,
	`context_id` text DEFAULT 'league:guyan-wolf-cup-friday' NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_a_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_b_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`side_a_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`side_b_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bets_round_id` ON `bets` (`round_id`);