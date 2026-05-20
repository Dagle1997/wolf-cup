DROP INDEX IF EXISTS `uniq_team_press_log_dedupe`;--> statement-breakpoint
ALTER TABLE `team_press_log` ADD `foursome_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_team_press_log_dedupe` ON `team_press_log` (`round_id`,`foursome_number`,`team`,`start_hole`,`trigger_type`);