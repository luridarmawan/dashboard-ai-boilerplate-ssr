CREATE TABLE `files` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`key` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`storage` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`mime` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`size` int NOT NULL,
	`sha256` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`kind` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'generic',
	`visibility` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'private',
	`meta` json,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `files_id` PRIMARY KEY(`id`),
	CONSTRAINT `files_client_id_key_uq` UNIQUE(`client_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `themes` ADD `assets` json;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `files_client_id_user_id_created_at_idx` ON `files` (`client_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_client_id_kind_idx` ON `files` (`client_id`,`kind`);