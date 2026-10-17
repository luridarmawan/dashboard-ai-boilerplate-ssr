CREATE TABLE `pages_pages` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`title` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`slug` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`summary` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'draft',
	`published_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `pages_pages_id` PRIMARY KEY(`id`),
	CONSTRAINT `pages_pages_client_id_slug_uq` UNIQUE(`client_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `pages_redirects` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`page_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`old_slug` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pages_redirects_id` PRIMARY KEY(`id`),
	CONSTRAINT `pages_redirects_client_id_old_slug_uq` UNIQUE(`client_id`,`old_slug`)
);
--> statement-breakpoint
CREATE INDEX `pages_pages_client_id_status_idx` ON `pages_pages` (`client_id`,`status`);--> statement-breakpoint
CREATE INDEX `pages_redirects_client_id_page_id_idx` ON `pages_redirects` (`client_id`,`page_id`);