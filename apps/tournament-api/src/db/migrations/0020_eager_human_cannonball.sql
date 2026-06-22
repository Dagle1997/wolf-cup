CREATE TABLE `hole_claim_writes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`hole_number` integer NOT NULL,
	`claim_type` text NOT NULL,
	`op` text NOT NULL,
	`scorer_player_id` text NOT NULL,
	`client_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`scorer_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_hole_claim_writes_cell_seq` ON `hole_claim_writes` (`round_id`,`player_id`,`hole_number`,`claim_type`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_hole_claim_writes_round_id` ON `hole_claim_writes` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_hole_claim_writes_id` ON `hole_claim_writes` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_hole_claim_writes_client_event_id` ON `hole_claim_writes` (`client_event_id`);