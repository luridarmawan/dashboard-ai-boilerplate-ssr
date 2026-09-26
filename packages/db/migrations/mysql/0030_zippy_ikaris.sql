CREATE TABLE `example_categories` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`slug` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`description` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`sort` int NOT NULL DEFAULT 100,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `example_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `example_categories_client_id_slug_uq` UNIQUE(`client_id`,`slug`)
);
--> statement-breakpoint
ALTER TABLE `example_products` ADD `category_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
CREATE INDEX `example_categories_client_id_sort_idx` ON `example_categories` (`client_id`,`sort`);--> statement-breakpoint
CREATE INDEX `example_products_client_id_category_id_idx` ON `example_products` (`client_id`,`category_id`);