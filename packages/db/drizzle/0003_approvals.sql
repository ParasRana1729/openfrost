CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`action` text NOT NULL,
	`artifact_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`destination_path` text NOT NULL,
	`filename` text NOT NULL,
	`content_sha256` text NOT NULL,
	`risk_tier` text NOT NULL,
	`state` text NOT NULL,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`executed_at` text,
	`outcome_json` text,
	`refusal_reason` text
);
--> statement-breakpoint
CREATE TABLE `export_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `export_args` text;