CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`file_key` text NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`source_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`content_sha256` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_files` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`path` text NOT NULL,
	`sha256` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`project_id` text,
	`content` text,
	`source_json` text NOT NULL,
	`source_run_id` text,
	`state` text NOT NULL,
	`proposed_at` text NOT NULL,
	`decided_at` text,
	`memory_entry_id` text,
	`proposed_content_sha256` text NOT NULL,
	`decided_content_sha256` text
);
