CREATE TABLE `mfa_challenges` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`ip` varchar(45) CHARACTER SET ascii COLLATE ascii_bin,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `mfa_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `mfa_challenges_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `user_mfa` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`secret` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`enabled_at` datetime(3),
	`recovery_codes` json,
	`last_step` int,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `user_mfa_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_mfa_user_id_uq` UNIQUE(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `mfa_challenges` ADD CONSTRAINT `mfa_challenges_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_mfa` ADD CONSTRAINT `user_mfa_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `mfa_challenges_expires_at_idx` ON `mfa_challenges` (`expires_at`);