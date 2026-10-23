ALTER TABLE `clients` ADD `short_code` text(3);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_short_code_uq` ON `clients` (`short_code`);