ALTER TABLE `pages_pages` ADD `image_id` text(36);--> statement-breakpoint
ALTER TABLE `pages_pages` ADD `image_alt` text(191);--> statement-breakpoint
CREATE INDEX `pages_pages_client_id_image_id_idx` ON `pages_pages` (`client_id`,`image_id`);