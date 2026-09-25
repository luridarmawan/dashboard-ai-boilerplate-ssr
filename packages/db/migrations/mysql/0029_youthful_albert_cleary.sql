ALTER TABLE `outbox_email` ADD `open_token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `opened_at` datetime(3);--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `open_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `clicked_at` datetime(3);--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `acted_at` datetime(3);--> statement-breakpoint
ALTER TABLE `outbox_email` ADD CONSTRAINT `outbox_email_open_token_uq` UNIQUE(`open_token`);