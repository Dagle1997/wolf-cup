ALTER TABLE `players` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
UPDATE `players` SET `status` = 'inactive' WHERE `is_active` = 0;