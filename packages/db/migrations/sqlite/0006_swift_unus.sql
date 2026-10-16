CREATE TABLE `regions` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`code` text(16) NOT NULL,
	`parent_code` text(16),
	`country_code` text(3) DEFAULT 'ID' NOT NULL,
	`level` integer NOT NULL,
	`name` text(191) NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regions_code_uq` ON `regions` (`code`);--> statement-breakpoint
CREATE INDEX `regions_parent_code_idx` ON `regions` (`parent_code`);--> statement-breakpoint
CREATE INDEX `regions_country_code_level_idx` ON `regions` (`country_code`,`level`);