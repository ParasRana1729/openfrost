CREATE TABLE `project_folder_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`instructions` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `kind` text DEFAULT 'research_brief' NOT NULL;