CREATE INDEX `agent_runs_task_id_idx` ON `agent_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `approvals_task_id_idx` ON `approvals` (`task_id`);--> statement-breakpoint
CREATE INDEX `approvals_state_idx` ON `approvals` (`state`);--> statement-breakpoint
CREATE INDEX `artifacts_task_id_idx` ON `artifacts` (`task_id`);--> statement-breakpoint
CREATE INDEX `events_task_id_idx` ON `events` (`task_id`);--> statement-breakpoint
CREATE INDEX `project_folder_grants_project_id_idx` ON `project_folder_grants` (`project_id`);--> statement-breakpoint
CREATE INDEX `routines_state_idx` ON `routines` (`state`);--> statement-breakpoint
CREATE INDEX `tasks_state_idx` ON `tasks` (`state`);