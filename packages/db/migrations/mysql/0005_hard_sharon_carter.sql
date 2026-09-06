CREATE TABLE `outbox_email` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`to_address` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`to_name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`subject` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`template` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`locale` varchar(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'id',
	`payload` json,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3),
	`sent_at` datetime(3),
	`last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`transport` varchar(16) CHARACTER SET ascii COLLATE ascii_bin,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `outbox_email_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `outbox_email` ADD CONSTRAINT `outbox_email_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `outbox_email_status_next_attempt_at_idx` ON `outbox_email` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbox_email_to_address_idx` ON `outbox_email` (`to_address`);--> statement-breakpoint
CREATE INDEX `outbox_email_created_at_idx` ON `outbox_email` (`created_at`);