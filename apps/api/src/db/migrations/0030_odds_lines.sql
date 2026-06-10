CREATE TABLE `odds_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`model_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`computed_at` integer NOT NULL,
	`context_id` text DEFAULT 'league:guyan-wolf-cup-friday' NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_odds_lines_round` ON `odds_lines` (`round_id`);