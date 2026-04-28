CREATE TABLE `pairing_members` (
	`pairing_id` text NOT NULL,
	`player_id` text NOT NULL,
	`slot_number` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`pairing_id`, `player_id`),
	FOREIGN KEY (`pairing_id`) REFERENCES `pairings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "check_pairing_members_slot_number_positive" CHECK("pairing_members"."slot_number" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_pairing_members_player_id` ON `pairing_members` (`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_pairing_members_pairing_slot` ON `pairing_members` (`pairing_id`,`slot_number`);--> statement-breakpoint
CREATE TABLE `pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`event_round_id` text NOT NULL,
	`foursome_number` integer NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_pairings_foursome_number_positive" CHECK("pairings"."foursome_number" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_pairings_event_round_id` ON `pairings` (`event_round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_pairings_event_round_foursome` ON `pairings` (`event_round_id`,`foursome_number`);