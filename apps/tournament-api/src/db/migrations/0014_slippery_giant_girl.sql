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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer NOT NULL,
	`timezone` text NOT NULL,
	`organizer_player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`scorer_policy` text DEFAULT 'foursome' NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`organizer_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_events_scorer_policy" CHECK("__new_events"."scorer_policy" IN ('foursome', 'designated', 'open'))
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "name", "start_date", "end_date", "timezone", "organizer_player_id", "created_at", "tenant_id", "context_id") SELECT "id", "name", "start_date", "end_date", "timezone", "organizer_player_id", "created_at", "tenant_id", "context_id" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;