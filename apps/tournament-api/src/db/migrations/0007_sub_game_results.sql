CREATE TABLE `sub_game_results` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_game_id` text NOT NULL,
	`computed_at` integer NOT NULL,
	`config_snapshot_json` text NOT NULL,
	`results_json` text NOT NULL,
	`total_pot_cents` integer NOT NULL,
	`created_by_player_id` text,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`sub_game_id`) REFERENCES `sub_games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_sub_game_results_total_pot_non_negative" CHECK("sub_game_results"."total_pot_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sub_game_results_sub_game_id` ON `sub_game_results` (`sub_game_id`);--> statement-breakpoint
CREATE INDEX `idx_sub_game_results_sub_game_id_computed_at` ON `sub_game_results` (`sub_game_id`,`computed_at`);