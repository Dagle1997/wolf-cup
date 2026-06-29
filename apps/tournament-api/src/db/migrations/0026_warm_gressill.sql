CREATE TABLE `snake_holder_writes` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`foursome_number` integer NOT NULL,
	`holder_player_id` text NOT NULL,
	`taken_by_player_id` text NOT NULL,
	`client_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`holder_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`taken_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_snake_holder_writes_round_foursome` ON `snake_holder_writes` (`round_id`,`foursome_number`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_snake_holder_writes_round_client_event` ON `snake_holder_writes` (`round_id`,`client_event_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sub_games` (
	`id` text PRIMARY KEY NOT NULL,
	`event_round_id` text NOT NULL,
	`type` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`buy_in_per_participant` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_sub_games_type" CHECK("__new_sub_games"."type" IN ('skins', 'ctp', 'sandies', 'putting_contest', 'snake')),
	CONSTRAINT "check_sub_games_buy_in_non_negative" CHECK("__new_sub_games"."buy_in_per_participant" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_sub_games`("id", "event_round_id", "type", "config_json", "buy_in_per_participant", "created_at", "tenant_id", "context_id") SELECT "id", "event_round_id", "type", "config_json", "buy_in_per_participant", "created_at", "tenant_id", "context_id" FROM `sub_games`;--> statement-breakpoint
DROP TABLE `sub_games`;--> statement-breakpoint
ALTER TABLE `__new_sub_games` RENAME TO `sub_games`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_sub_games_event_round_id` ON `sub_games` (`event_round_id`);