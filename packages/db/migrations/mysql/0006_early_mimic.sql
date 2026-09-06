CREATE TABLE `example_inquiries` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`email` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`source` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`ip` varchar(45) CHARACTER SET ascii COLLATE ascii_bin,
	`state` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'new',
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `example_inquiries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `example_products` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`slug` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`summary` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`price` int NOT NULL DEFAULT 0,
	`currency` varchar(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'IDR',
	`image_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`featured` boolean NOT NULL DEFAULT false,
	`sort` int NOT NULL DEFAULT 100,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `example_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `example_products_client_id_slug_uq` UNIQUE(`client_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `example_testimonials` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`author` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`role` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`quote` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`avatar_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`sort` int NOT NULL DEFAULT 100,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `example_testimonials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `example_inquiries_client_id_created_at_idx` ON `example_inquiries` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `example_inquiries_client_id_state_idx` ON `example_inquiries` (`client_id`,`state`);--> statement-breakpoint
CREATE INDEX `example_products_client_id_featured_sort_idx` ON `example_products` (`client_id`,`featured`,`sort`);--> statement-breakpoint
CREATE INDEX `example_testimonials_client_id_sort_idx` ON `example_testimonials` (`client_id`,`sort`);