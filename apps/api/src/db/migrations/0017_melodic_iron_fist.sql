CREATE TABLE `season_standings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`points` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_season_standings_season_player` ON `season_standings` (`season_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_season_standings_season` ON `season_standings` (`season_id`);--> statement-breakpoint
ALTER TABLE `seasons` ADD `year` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `seasons` ADD `champion_player_id` integer REFERENCES players(id);--> statement-breakpoint
UPDATE `seasons` SET `year` = CAST(SUBSTR(`start_date`, 1, 4) AS INTEGER) WHERE `year` = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_seasons_year` ON `seasons` (`year`);