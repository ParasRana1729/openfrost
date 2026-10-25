CREATE TABLE `routine_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`state` text NOT NULL,
	`task_id` text,
	`reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_occurrences_routine_key` ON `routine_occurrences` (`routine_id`,`occurrence_key`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project_id` text NOT NULL,
	`timezone` text NOT NULL,
	`schedule_json` text NOT NULL,
	`template_json` text NOT NULL,
	`state` text NOT NULL,
	`window_start_at` text NOT NULL,
	`last_occurrence_key` text,
	`last_occurrence_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `routine_id` text;