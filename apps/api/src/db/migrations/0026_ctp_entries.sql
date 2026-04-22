-- CTP per-par-3 prompt: two new tables.
-- side_game_ctp_entries: one row per (group, par-3 hole) answer for a round.
--   winner_player_id IS NULL  = "nobody hit the green"
--   row absent                = "this group has not answered yet"
-- hole_completions: server-captured timestamp of when the last roster score
--   for (round, group, hole) was upserted. CTP rows copy completed_at into
--   their own hole_completed_at column to anchor the "current winner" ordering
--   rule against real-world play time (offline-safe).

CREATE TABLE `side_game_ctp_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `round_id` integer NOT NULL,
  `group_id` integer NOT NULL,
  `hole_number` integer NOT NULL,
  `winner_player_id` integer,
  `winner_name` text,
  `entered_by_player_id` integer,
  `hole_completed_at` integer NOT NULL,
  `finalized_at` integer,
  `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday',
  `tenant_id` text NOT NULL DEFAULT 'guyan',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `chk_ctp_entries_hole_number` CHECK (hole_number IN (6, 7, 12, 15)),
  FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`),
  FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`),
  FOREIGN KEY (`winner_player_id`) REFERENCES `players`(`id`),
  FOREIGN KEY (`entered_by_player_id`) REFERENCES `players`(`id`)
);--> statement-breakpoint

CREATE UNIQUE INDEX `uniq_ctp_entries_tenant_round_group_hole` ON `side_game_ctp_entries` (`tenant_id`, `context_id`, `round_id`, `group_id`, `hole_number`);--> statement-breakpoint
CREATE INDEX `idx_ctp_entries_round` ON `side_game_ctp_entries` (`round_id`);--> statement-breakpoint
CREATE INDEX `idx_ctp_entries_round_hole_completed` ON `side_game_ctp_entries` (`round_id`, `hole_number`, `hole_completed_at`);--> statement-breakpoint

CREATE TABLE `hole_completions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `round_id` integer NOT NULL,
  `group_id` integer NOT NULL,
  `hole_number` integer NOT NULL,
  `completed_at` integer NOT NULL,
  `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday',
  `tenant_id` text NOT NULL DEFAULT 'guyan',
  CONSTRAINT `chk_hole_completions_hole_number` CHECK (hole_number BETWEEN 1 AND 18),
  FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`),
  FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`)
);--> statement-breakpoint

CREATE UNIQUE INDEX `uniq_hole_completions_tenant_round_group_hole` ON `hole_completions` (`tenant_id`, `context_id`, `round_id`, `group_id`, `hole_number`);--> statement-breakpoint
CREATE INDEX `idx_hole_completions_round` ON `hole_completions` (`round_id`);
