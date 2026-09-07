CREATE TABLE `notifications` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`type` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`title` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`link` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`data` json,
	`read_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notifications_client_id_user_id_read_at_created_at_idx` ON `notifications` (`client_id`,`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_client_id_created_at_idx` ON `notifications` (`client_id`,`created_at`);