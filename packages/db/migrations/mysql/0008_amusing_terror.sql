CREATE TABLE `ai_mcp_tools` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`mcp_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`wire` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`input_schema` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_mcp_tools_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_mcp_tools_client_id_mcp_id_wire_uq` UNIQUE(`client_id`,`mcp_id`,`wire`)
);
--> statement-breakpoint
CREATE TABLE `ai_mcps` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`code` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`transport` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'http',
	`url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`headers` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`last_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin,
	`last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`last_synced_at` datetime(3),
	`tools_count` int NOT NULL DEFAULT 0,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `ai_mcps_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_mcps_client_id_code_uq` UNIQUE(`client_id`,`code`)
);
--> statement-breakpoint
ALTER TABLE `ai_mcp_tools` ADD CONSTRAINT `ai_mcp_tools_mcp_id_ai_mcps_id_fk` FOREIGN KEY (`mcp_id`) REFERENCES `ai_mcps`(`id`) ON DELETE cascade ON UPDATE no action;