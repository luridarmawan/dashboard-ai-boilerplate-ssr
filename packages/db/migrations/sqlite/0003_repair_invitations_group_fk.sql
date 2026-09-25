-- Rebuild `invitations` so `group_id` carries the foreign key the schema declares. drizzle-kit
-- wrote 0001's `ADD group_id` with an unquoted target table, so TABLE_PREFIX left the target
-- unprefixed (every insert then failed with "no such table: main.groups"), and dropped
-- `ON DELETE set null`. SQLite cannot alter a column's foreign key, hence the table copy.
-- Nothing references `invitations`, so the drop is safe with foreign keys enforced.
CREATE TABLE `__new_invitations` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`email` text(191) NOT NULL,
	`token_hash` text(64) NOT NULL,
	`invited_by` text(36),
	`group_id` text(36),
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text(36),
	`revoked_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_invitations` (`id`, `client_id`, `email`, `token_hash`, `invited_by`, `group_id`, `expires_at`, `accepted_at`, `accepted_user_id`, `revoked_at`, `status_id`, `created_at`, `updated_at`) SELECT `id`, `client_id`, `email`, `token_hash`, `invited_by`, `group_id`, `expires_at`, `accepted_at`, `accepted_user_id`, `revoked_at`, `status_id`, `created_at`, `updated_at` FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_uq` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_client_id_email_idx` ON `invitations` (`client_id`,`email`);--> statement-breakpoint
CREATE INDEX `invitations_expires_at_idx` ON `invitations` (`expires_at`);
