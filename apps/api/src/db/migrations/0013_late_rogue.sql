CREATE TABLE `sub_bench` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`round_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_sub_bench_season_player` ON `sub_bench` (`season_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_sub_bench_season` ON `sub_bench` (`season_id`);