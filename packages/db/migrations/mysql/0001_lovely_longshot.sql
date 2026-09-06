CREATE TABLE `dummy_notes` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`title` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`state` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
	`tags` json,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `dummy_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `dummy_notes_client_id_state_idx` ON `dummy_notes` (`client_id`,`state`);