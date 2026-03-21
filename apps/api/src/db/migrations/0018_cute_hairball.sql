CREATE TABLE `gallery_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer,
	`player_id` integer,
	`r2_key` text NOT NULL,
	`public_url` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`caption` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gallery_photos_r2_key_unique` ON `gallery_photos` (`r2_key`);--> statement-breakpoint
CREATE INDEX `idx_gallery_photos_round_id` ON `gallery_photos` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_gallery_photos_created` ON `gallery_photos` (`created_at`);