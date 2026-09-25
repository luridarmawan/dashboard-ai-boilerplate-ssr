ALTER TABLE `outbox_email` ADD `open_token` text(64);--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `open_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `clicked_at` integer;--> statement-breakpoint
ALTER TABLE `outbox_email` ADD `acted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_email_open_token_uq` ON `outbox_email` (`open_token`);