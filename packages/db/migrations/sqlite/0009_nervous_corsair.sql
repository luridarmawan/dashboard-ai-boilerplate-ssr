CREATE TABLE `pages_pages` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`title` text(191) NOT NULL,
	`slug` text(120) NOT NULL,
	`summary` text(512),
	`body` text,
	`status` text(16) DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_pages_client_id_slug_uq` ON `pages_pages` (`client_id`,`slug`);--> statement-breakpoint
CREATE INDEX `pages_pages_client_id_status_idx` ON `pages_pages` (`client_id`,`status`);--> statement-breakpoint
CREATE TABLE `pages_redirects` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`page_id` text(36) NOT NULL,
	`old_slug` text(120) NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_redirects_client_id_old_slug_uq` ON `pages_redirects` (`client_id`,`old_slug`);--> statement-breakpoint
CREATE INDEX `pages_redirects_client_id_page_id_idx` ON `pages_redirects` (`client_id`,`page_id`);