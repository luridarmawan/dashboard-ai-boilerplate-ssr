ALTER TABLE `clients` ADD `description` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `balance` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `total_receipts` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `address` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `rt` text(8);--> statement-breakpoint
ALTER TABLE `clients` ADD `rw` text(8);--> statement-breakpoint
ALTER TABLE `clients` ADD `kelurahan` text(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `kelurahan_id` text(32);--> statement-breakpoint
ALTER TABLE `clients` ADD `kecamatan` text(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `kecamatan_id` text(32);--> statement-breakpoint
ALTER TABLE `clients` ADD `city` text(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `city_id` text(32);--> statement-breakpoint
ALTER TABLE `clients` ADD `regency` text(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `province` text(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `province_id` text(32);--> statement-breakpoint
ALTER TABLE `clients` ADD `region` text(191);--> statement-breakpoint
ALTER TABLE `clients` ADD `region_id` text(32);--> statement-breakpoint
ALTER TABLE `clients` ADD `country_id` text(32);--> statement-breakpoint
ALTER TABLE `clients` ADD `latitude` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `longitude` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `maps_url` text(2048);--> statement-breakpoint
ALTER TABLE `clients` ADD `url` text(2048);