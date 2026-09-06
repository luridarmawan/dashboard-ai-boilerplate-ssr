CREATE TABLE `api_tokens` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`scopes` json,
	`expires_at` datetime(3),
	`last_used_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `api_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_tokens_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `client_user_maps` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`is_default` boolean NOT NULL DEFAULT false,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `client_user_maps_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_user_maps_client_id_user_id_uq` UNIQUE(`client_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `email_verification_tokens` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_verification_tokens_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `group_permissions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`group_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`permission` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `group_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_permissions_client_id_group_id_permission_uq` UNIQUE(`client_id`,`group_id`,`permission`)
);
--> statement-breakpoint
CREATE TABLE `group_user_maps` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`group_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `group_user_maps_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_user_maps_client_id_group_id_user_id_uq` UNIQUE(`client_id`,`group_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`is_system` boolean NOT NULL DEFAULT false,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `groups_client_id_code_uq` UNIQUE(`client_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_reset_tokens_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`window_start` datetime(3) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `rate_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `rate_limits_key_uq` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`ip` varchar(45) CHARACTER SET ascii COLLATE ascii_bin,
	`user_agent` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`revoked_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`email` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`password_hash` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`avatar_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`locale` varchar(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'id',
	`theme` varchar(64) CHARACTER SET ascii COLLATE ascii_bin,
	`is_superadmin` boolean NOT NULL DEFAULT false,
	`email_verified_at` datetime(3),
	`last_login_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD CONSTRAINT `api_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_tokens` ADD CONSTRAINT `api_tokens_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_user_maps` ADD CONSTRAINT `client_user_maps_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `group_permissions` ADD CONSTRAINT `group_permissions_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `group_user_maps` ADD CONSTRAINT `group_user_maps_group_id_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `group_user_maps` ADD CONSTRAINT `group_user_maps_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `api_tokens_user_id_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `email_verification_tokens_user_id_idx` ON `email_verification_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `group_user_maps_client_id_user_id_idx` ON `group_user_maps` (`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_id_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `rate_limits_window_start_idx` ON `rate_limits` (`window_start`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);