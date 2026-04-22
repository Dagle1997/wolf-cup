CREATE TABLE `oauth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_sub` text NOT NULL,
	`player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_oauth_identities_tenant_provider_sub` ON `oauth_identities` (`tenant_id`,`provider`,`provider_sub`);--> statement-breakpoint
CREATE INDEX `idx_oauth_identities_player_id` ON `oauth_identities` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`is_organizer` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`device_info` text,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_player_id` ON `sessions` (`player_id`);