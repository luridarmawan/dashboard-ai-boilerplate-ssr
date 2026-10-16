ALTER TABLE `clients` ADD `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `balance` decimal(18,4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `total_receipts` decimal(18,4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `rt` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `rw` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `kelurahan` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `kelurahan_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `clients` ADD `kecamatan` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `kecamatan_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `clients` ADD `city` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `city_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `clients` ADD `regency` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `province` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `province_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `clients` ADD `region` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `region_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `clients` ADD `country_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `clients` ADD `latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `clients` ADD `longitude` decimal(11,7);--> statement-breakpoint
ALTER TABLE `clients` ADD `maps_url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `clients` ADD `url` varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;