CREATE TABLE `invitations` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`email` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`invited_by` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`expires_at` datetime(3) NOT NULL,
	`accepted_at` datetime(3),
	`accepted_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`revoked_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_invited_by_users_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_accepted_user_id_users_id_fk` FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `invitations_client_id_email_idx` ON `invitations` (`client_id`,`email`);--> statement-breakpoint
CREATE INDEX `invitations_expires_at_idx` ON `invitations` (`expires_at`);