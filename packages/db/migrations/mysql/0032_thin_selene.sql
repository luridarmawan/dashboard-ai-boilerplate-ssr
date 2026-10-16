CREATE TABLE `regions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`code` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`parent_code` varchar(16) CHARACTER SET ascii COLLATE ascii_bin,
	`country_code` varchar(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ID',
	`level` int NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `regions_id` PRIMARY KEY(`id`),
	CONSTRAINT `regions_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `regions_parent_code_idx` ON `regions` (`parent_code`);--> statement-breakpoint
CREATE INDEX `regions_country_code_level_idx` ON `regions` (`country_code`,`level`);