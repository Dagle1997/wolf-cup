CREATE TABLE `attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_week_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`season_week_id`) REFERENCES `season_weeks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_attendance_week_player` ON `attendance` (`season_week_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_attendance_season_week` ON `attendance` (`season_week_id`);