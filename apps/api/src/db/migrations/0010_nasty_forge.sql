CREATE TABLE `season_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`friday` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_season_week` ON `season_weeks` (`season_id`,`friday`);--> statement-breakpoint
CREATE INDEX `idx_season_weeks_season` ON `season_weeks` (`season_id`);
