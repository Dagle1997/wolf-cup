PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`entry_code_hash` text,
	`entry_code` text,
	`tee` text,
	`auto_calculate_money` integer DEFAULT 1 NOT NULL,
	`headcount` integer,
	`cancellation_reason` text,
	`handicap_updated_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_rounds_type" CHECK(type IN ('official', 'casual')),
	CONSTRAINT "chk_rounds_status" CHECK(status IN ('scheduled', 'active', 'finalized', 'cancelled', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_rounds`("id", "season_id", "type", "status", "scheduled_date", "entry_code_hash", "entry_code", "tee", "auto_calculate_money", "headcount", "cancellation_reason", "handicap_updated_at", "created_at") SELECT "id", "season_id", "type", "status", "scheduled_date", "entry_code_hash", "entry_code", "tee", "auto_calculate_money", "headcount", "cancellation_reason", "handicap_updated_at", "created_at" FROM `rounds`;--> statement-breakpoint
DROP TABLE `rounds`;--> statement-breakpoint
ALTER TABLE `__new_rounds` RENAME TO `rounds`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_rounds_season_id` ON `rounds` (`season_id`);