CREATE TABLE `event_handicaps` (
	`event_id` text NOT NULL,
	`player_id` text NOT NULL,
	`handicap_index` real,
	`source` text NOT NULL,
	`as_of_date` integer NOT NULL,
	`ghin_value_date` text,
	`captured_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `player_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_handicaps_event_id` ON `event_handicaps` (`event_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `handicap_lock_date` integer;