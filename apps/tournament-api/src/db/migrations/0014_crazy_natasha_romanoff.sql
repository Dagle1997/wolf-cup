CREATE TABLE `event_scorer_designees` (
	`event_id` text NOT NULL,
	`player_id` text NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `player_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_scorer_designees_event_id` ON `event_scorer_designees` (`event_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `scorer_policy` text DEFAULT 'foursome' NOT NULL;