CREATE TABLE `oauth_accounts` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`provider` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`provider_user_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`email` varchar(191) CHARACTER SET ascii COLLATE ascii_bin,
	`last_login_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `oauth_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_accounts_provider_provider_user_id_uq` UNIQUE(`provider`,`provider_user_id`)
);
--> statement-breakpoint
ALTER TABLE `oauth_accounts` ADD CONSTRAINT `oauth_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `oauth_accounts_user_id_idx` ON `oauth_accounts` (`user_id`);