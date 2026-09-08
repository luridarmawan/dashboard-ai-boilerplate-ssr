CREATE TABLE `webhook_deliveries` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`webhook_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`event` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`payload` json NOT NULL,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3),
	`response_status` int,
	`last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`delivered_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`secret` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`events` json NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`last_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin,
	`last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`last_delivered_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `webhooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhook_id_webhooks_id_fk` FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `webhook_deliveries_client_id_webhook_id_created_at_idx` ON `webhook_deliveries` (`client_id`,`webhook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_client_id_status_next_attempt_at_idx` ON `webhook_deliveries` (`client_id`,`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhooks_client_id_enabled_idx` ON `webhooks` (`client_id`,`enabled`);