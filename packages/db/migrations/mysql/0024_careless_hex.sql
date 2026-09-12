ALTER TABLE `ai_models` ADD `capabilities` json;--> statement-breakpoint
ALTER TABLE `ai_models` ADD `capabilities_at` datetime(3);--> statement-breakpoint
ALTER TABLE `ai_models` ADD `preferred_endpoint` varchar(16) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `ai_models` ADD `last_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `ai_models` ADD `last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `ai_models` ADD `last_tested_at` datetime(3);--> statement-breakpoint
ALTER TABLE `ai_models` ADD `last_probe_ms` int;