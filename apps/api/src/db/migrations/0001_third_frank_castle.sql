CREATE TABLE `score_corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_user_id` integer NOT NULL,
	`round_id` integer NOT NULL,
	`hole_number` integer NOT NULL,
	`player_id` integer,
	`field_name` text NOT NULL,
	`old_value` text NOT NULL,
	`new_value` text NOT NULL,
	`corrected_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admins`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_score_corrections_round_id` ON `score_corrections` (`round_id`);