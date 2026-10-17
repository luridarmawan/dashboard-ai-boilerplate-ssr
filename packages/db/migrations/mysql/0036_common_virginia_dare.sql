ALTER TABLE `pages_pages` ADD `image_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `pages_pages` ADD `image_alt` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
CREATE INDEX `pages_pages_client_id_image_id_idx` ON `pages_pages` (`client_id`,`image_id`);