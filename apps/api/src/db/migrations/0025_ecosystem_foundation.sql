-- Ecosystem-identity foundation: context_id + tenant_id on every writable
-- domain table; SSO subject columns on players. Empty-DB safe; deploy before
-- first 2026 round (2026-04-17).

ALTER TABLE `seasons` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `seasons` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `season_weeks` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `season_weeks` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `groups` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `groups` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `round_players` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `round_players` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `harvey_results` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `harvey_results` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `pairing_history` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `pairing_history` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `sub_bench` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `sub_bench` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `side_games` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `side_games` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `hole_scores` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `hole_scores` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `rounds` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `rounds` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `players` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `players` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `round_results` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `round_results` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `wolf_decisions` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `wolf_decisions` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `side_game_results` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `side_game_results` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `score_corrections` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `score_corrections` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `gallery_photos` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `gallery_photos` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `attendance` ADD `context_id` text NOT NULL DEFAULT 'league:guyan-wolf-cup-friday';--> statement-breakpoint
ALTER TABLE `attendance` ADD `tenant_id` text NOT NULL DEFAULT 'guyan';--> statement-breakpoint

ALTER TABLE `players` ADD `apple_sub` text;--> statement-breakpoint
ALTER TABLE `players` ADD `google_sub` text;--> statement-breakpoint
CREATE UNIQUE INDEX `players_apple_sub_idx` ON `players` (`apple_sub`) WHERE `apple_sub` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `players_google_sub_idx` ON `players` (`google_sub`) WHERE `google_sub` IS NOT NULL;
