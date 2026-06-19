PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`bet_type` text NOT NULL,
	`basis` text DEFAULT 'net' NOT NULL,
	`amount_dollars` integer NOT NULL,
	`subject_a_player_id` integer NOT NULL,
	`subject_b_player_id` integer,
	`line` integer,
	`odds_market` text,
	`odds` integer,
	`side_a_player_id` integer NOT NULL,
	`side_b_player_id` integer,
	`note` text,
	`created_by_admin_id` integer,
	`created_at` integer NOT NULL,
	`context_id` text DEFAULT 'league:guyan-wolf-cup-friday' NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_a_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subject_b_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`side_a_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`side_b_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_bets_side_b_required" CHECK(side_b_player_id IS NOT NULL OR bet_type = 'odds_win')
);
--> statement-breakpoint
INSERT INTO `__new_bets`("id", "round_id", "bet_type", "basis", "amount_dollars", "subject_a_player_id", "subject_b_player_id", "line", "odds_market", "odds", "side_a_player_id", "side_b_player_id", "note", "created_by_admin_id", "created_at", "context_id", "tenant_id") SELECT "id", "round_id", "bet_type", "basis", "amount_dollars", "subject_a_player_id", "subject_b_player_id", "line", "odds_market", "odds", "side_a_player_id", "side_b_player_id", "note", "created_by_admin_id", "created_at", "context_id", "tenant_id" FROM `bets`;--> statement-breakpoint
DROP TABLE `bets`;--> statement-breakpoint
ALTER TABLE `__new_bets` RENAME TO `bets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_bets_round_id` ON `bets` (`round_id`);