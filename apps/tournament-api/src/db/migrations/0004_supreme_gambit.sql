CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_player_id` text,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`actor_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_entity` ON `audit_log` (`entity_type`,`entity_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_audit_log_event_type` ON `audit_log` (`event_type`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `hole_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`hole_number` integer NOT NULL,
	`gross_strokes` integer NOT NULL,
	`putts` integer,
	`scorer_player_id` text NOT NULL,
	`client_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`scorer_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_hole_scores_hole_number" CHECK("hole_scores"."hole_number" BETWEEN 1 AND 18),
	CONSTRAINT "chk_hole_scores_gross_strokes_positive" CHECK("hole_scores"."gross_strokes" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_hole_scores_round_id` ON `hole_scores` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_hole_scores_scorer_player_id` ON `hole_scores` (`scorer_player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_hole_scores_cell` ON `hole_scores` (`round_id`,`player_id`,`hole_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_hole_scores_dedupe` ON `hole_scores` (`round_id`,`player_id`,`hole_number`,`client_event_id`);--> statement-breakpoint
CREATE TABLE `round_states` (
	`round_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`entered_at` integer NOT NULL,
	`entered_by_player_id` text,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entered_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_round_states_state" CHECK("round_states"."state" IN ('not_started','in_progress','complete_editable','finalized','cancelled'))
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`event_round_id` text,
	`holes_to_play` integer DEFAULT 18 NOT NULL,
	`opened_at` integer,
	`opened_by_player_id` text,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_round_id`) REFERENCES `event_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opened_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_rounds_holes_to_play" CHECK("rounds"."holes_to_play" IN (9, 18)),
	CONSTRAINT "chk_rounds_event_pairing" CHECK(("rounds"."event_id" IS NULL) = ("rounds"."event_round_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_rounds_event_id` ON `rounds` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_rounds_event_round_id` ON `rounds` (`event_round_id`);--> statement-breakpoint
CREATE TABLE `score_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`hole_number` integer NOT NULL,
	`actor_player_id` text NOT NULL,
	`prior_value_json` text NOT NULL,
	`new_value_json` text NOT NULL,
	`request_id` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_score_corrections_hole_number" CHECK("score_corrections"."hole_number" BETWEEN 1 AND 18)
);
--> statement-breakpoint
CREATE INDEX `idx_score_corrections_round_hole_created` ON `score_corrections` (`round_id`,`hole_number`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `scorer_assignments` (
	`round_id` text NOT NULL,
	`foursome_number` integer NOT NULL,
	`scorer_player_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	`assigned_by_player_id` text NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`round_id`, `foursome_number`),
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scorer_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_by_player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chk_scorer_assignments_foursome_number_positive" CHECK("scorer_assignments"."foursome_number" >= 1)
);
--> statement-breakpoint
CREATE INDEX `idx_scorer_assignments_scorer_player_id` ON `scorer_assignments` (`scorer_player_id`);