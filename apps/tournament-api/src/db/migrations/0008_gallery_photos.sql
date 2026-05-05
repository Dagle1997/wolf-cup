CREATE TABLE `gallery_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`round_id` text,
	`uploaded_by_player_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_gallery_photos_event_id_uploaded_at` ON `gallery_photos` (`event_id`,"uploaded_at" desc);--> statement-breakpoint
CREATE INDEX `idx_gallery_photos_round_id` ON `gallery_photos` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_gallery_photos_r2_key` ON `gallery_photos` (`r2_key`);