CREATE TABLE `example_categories` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`slug` text(120) NOT NULL,
	`name` text(191) NOT NULL,
	`description` text(512),
	`sort` integer DEFAULT 100 NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `example_categories_client_id_slug_uq` ON `example_categories` (`client_id`,`slug`);--> statement-breakpoint
CREATE INDEX `example_categories_client_id_sort_idx` ON `example_categories` (`client_id`,`sort`);--> statement-breakpoint
ALTER TABLE `example_products` ADD `category_id` text(36);--> statement-breakpoint
CREATE INDEX `example_products_client_id_category_id_idx` ON `example_products` (`client_id`,`category_id`);