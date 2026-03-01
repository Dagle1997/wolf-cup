PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_wolf_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`hole_number` integer NOT NULL,
	`wolf_player_id` integer NOT NULL,
	`decision` text NOT NULL,
	`partner_player_id` integer,
	`outcome` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wolf_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`partner_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_wolf_decisions_decision" CHECK(decision IN ('partner', 'alone', 'blind_wolf')),
	CONSTRAINT "chk_wolf_decisions_outcome" CHECK(outcome IS NULL OR outcome IN ('win', 'loss', 'push'))
);
--> statement-breakpoint
INSERT INTO `__new_wolf_decisions`("id", "round_id", "group_id", "hole_number", "wolf_player_id", "decision", "partner_player_id", "outcome", "created_at") SELECT "id", "round_id", "group_id", "hole_number", "wolf_player_id", "decision", "partner_player_id", "outcome", "created_at" FROM `wolf_decisions`;--> statement-breakpoint
DROP TABLE `wolf_decisions`;--> statement-breakpoint
ALTER TABLE `__new_wolf_decisions` RENAME TO `wolf_decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_wolf_decisions_round_id` ON `wolf_decisions` (`round_id`);