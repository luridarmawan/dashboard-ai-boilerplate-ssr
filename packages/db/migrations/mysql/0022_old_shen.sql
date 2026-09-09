ALTER TABLE `ai_calls` ADD `upstream_endpoint` varchar(16) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `reasoning_tokens` int;--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `capabilities` json;--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `capabilities_at` datetime(3);--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `preferred_endpoint` varchar(16) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `last_probe_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;--> statement-breakpoint
ALTER TABLE `ai_providers` ADD `last_probe_ms` int;