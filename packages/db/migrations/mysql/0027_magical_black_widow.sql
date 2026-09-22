ALTER TABLE `users` ADD `last_active_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `last_active_ip` varchar(45) CHARACTER SET ascii COLLATE ascii_bin;