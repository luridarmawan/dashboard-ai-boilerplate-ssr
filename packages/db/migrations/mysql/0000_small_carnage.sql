CREATE TABLE `audit_log` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`actor_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`action` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`resource` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`resource_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`ip` varchar(45) CHARACTER SET ascii COLLATE ascii_bin,
	`request_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`before` json,
	`after` json,
	`note` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`parent_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`code` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`settings` json,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `audit_log_client_id_created_at_idx` ON `audit_log` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_client_id_resource_resource_id_idx` ON `audit_log` (`client_id`,`resource`,`resource_id`);--> statement-breakpoint
CREATE INDEX `audit_log_client_id_actor_id_idx` ON `audit_log` (`client_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `clients_parent_id_idx` ON `clients` (`parent_id`);