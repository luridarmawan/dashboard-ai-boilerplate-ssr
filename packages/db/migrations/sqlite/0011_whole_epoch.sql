CREATE TABLE `permalinks` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`path` text(255) NOT NULL,
	`module` text(64) NOT NULL,
	`target` text(64) NOT NULL,
	`kind` text(16) DEFAULT 'canonical' NOT NULL,
	`live` integer DEFAULT false NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permalinks_client_id_path_uq` ON `permalinks` (`client_id`,`path`);--> statement-breakpoint
CREATE INDEX `permalinks_client_id_module_target_idx` ON `permalinks` (`client_id`,`module`,`target`);