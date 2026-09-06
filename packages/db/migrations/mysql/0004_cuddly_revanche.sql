CREATE TABLE `cache_versions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `cache_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `cache_versions_name_uq` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `configurations` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`scope` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`section` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`sub` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`type` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`title` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`note` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`order` int NOT NULL DEFAULT 100,
	`public` boolean NOT NULL DEFAULT false,
	`updated_by` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `configurations_id` PRIMARY KEY(`id`),
	CONSTRAINT `configurations_scope_key_uq` UNIQUE(`scope`,`key`)
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`scope` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`module` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`updated_by` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `modules_id` PRIMARY KEY(`id`),
	CONSTRAINT `modules_scope_module_uq` UNIQUE(`scope`,`module`)
);
--> statement-breakpoint
ALTER TABLE `configurations` ADD CONSTRAINT `configurations_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modules` ADD CONSTRAINT `modules_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `configurations_section_idx` ON `configurations` (`section`);