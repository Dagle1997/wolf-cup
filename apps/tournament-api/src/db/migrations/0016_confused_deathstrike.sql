CREATE TABLE `player_join_codes` (
	`event_id` text NOT NULL,
	`player_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `player_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_join_codes_code_unique` ON `player_join_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_player_join_codes_event_id` ON `player_join_codes` (`event_id`);