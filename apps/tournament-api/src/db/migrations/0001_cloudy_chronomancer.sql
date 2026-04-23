CREATE TABLE `course_holes` (
	`id` text PRIMARY KEY NOT NULL,
	`course_revision_id` text NOT NULL,
	`hole_number` integer NOT NULL,
	`par` integer NOT NULL,
	`si` integer NOT NULL,
	`yardage_per_tee_json` text NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`course_revision_id`) REFERENCES `course_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "check_course_holes_hole_number" CHECK("course_holes"."hole_number" BETWEEN 1 AND 18),
	CONSTRAINT "check_course_holes_si" CHECK("course_holes"."si" BETWEEN 1 AND 18)
);
--> statement-breakpoint
CREATE INDEX `idx_course_holes_course_revision_id` ON `course_holes` (`course_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_course_holes_revision_hole_number` ON `course_holes` (`course_revision_id`,`hole_number`);--> statement-breakpoint
CREATE TABLE `course_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`source_url` text,
	`extraction_date` integer,
	`verified` integer DEFAULT false NOT NULL,
	`out_total` integer NOT NULL,
	`in_total` integer NOT NULL,
	`course_total` integer NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_course_revisions_course_id` ON `course_revisions` (`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_course_revisions_course_id_revision_number` ON `course_revisions` (`course_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `course_tees` (
	`id` text PRIMARY KEY NOT NULL,
	`course_revision_id` text NOT NULL,
	`tee_color` text NOT NULL,
	`rating` integer NOT NULL,
	`slope` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL,
	FOREIGN KEY (`course_revision_id`) REFERENCES `course_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_course_tees_course_revision_id` ON `course_tees` (`course_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_course_tees_revision_color` ON `course_tees` (`course_revision_id`,`tee_color`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`club_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`tenant_id` text DEFAULT 'guyan' NOT NULL,
	`context_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_courses_tenant_club_name` ON `courses` (`tenant_id`,`club_name`,`name`);