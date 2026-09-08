CREATE TABLE `queue_jobs` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`payload` json,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`priority` int NOT NULL DEFAULT 0,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`run_at` datetime(3) NOT NULL,
	`locked_by` varchar(128) CHARACTER SET ascii COLLATE ascii_bin,
	`locked_until` datetime(3),
	`last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`dedupe_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`request_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`result` json,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `queue_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `queue_jobs` ADD CONSTRAINT `queue_jobs_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `queue_jobs_status_run_at_priority_idx` ON `queue_jobs` (`status`,`run_at`,`priority`);--> statement-breakpoint
CREATE INDEX `queue_jobs_name_status_idx` ON `queue_jobs` (`name`,`status`);--> statement-breakpoint
CREATE INDEX `queue_jobs_client_id_created_at_idx` ON `queue_jobs` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `queue_jobs_dedupe_key_idx` ON `queue_jobs` (`dedupe_key`);