CREATE TABLE `scheduler_jobs` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`locked_by` varchar(128) CHARACTER SET ascii COLLATE ascii_bin,
	`locked_until` datetime(3),
	`run_started_at` datetime(3),
	`last_run_at` datetime(3),
	`last_status` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `scheduler_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduler_jobs_name_uq` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `scheduler_runs` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`job` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`instance_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`duration_ms` int,
	`status` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `scheduler_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `scheduler_runs_job_started_at_idx` ON `scheduler_runs` (`job`,`started_at`);