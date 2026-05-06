CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`round_id` text,
	`type` text NOT NULL,
	`actor_player_id` text,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_activity_event_created_id` ON `activity` (`event_id`,"created_at" desc,"id" desc);