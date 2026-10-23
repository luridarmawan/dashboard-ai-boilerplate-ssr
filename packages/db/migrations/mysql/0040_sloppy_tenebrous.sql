ALTER TABLE `clients` ADD `short_code` varchar(3) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_short_code_uq` UNIQUE(`short_code`);