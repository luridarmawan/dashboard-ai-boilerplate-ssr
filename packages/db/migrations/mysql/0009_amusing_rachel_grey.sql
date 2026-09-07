CREATE TABLE `themes` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`scope` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` json NOT NULL,
	`description` json,
	`base` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`tokens` json NOT NULL,
	`icons` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`layouts` json NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`updated_by` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `themes_id` PRIMARY KEY(`id`),
	CONSTRAINT `themes_scope_code_uq` UNIQUE(`scope`,`code`)
);
--> statement-breakpoint
ALTER TABLE `themes` ADD CONSTRAINT `themes_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;