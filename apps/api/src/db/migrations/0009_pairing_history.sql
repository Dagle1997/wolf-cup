CREATE TABLE `pairing_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL REFERENCES `seasons`(`id`),
	`player_a_id` integer NOT NULL REFERENCES `players`(`id`),
	`player_b_id` integer NOT NULL REFERENCES `players`(`id`),
	`pair_count` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_pairing_history` ON `pairing_history` (`season_id`,`player_a_id`,`player_b_id`);
--> statement-breakpoint
CREATE INDEX `idx_pairing_history_season_id` ON `pairing_history` (`season_id`);
