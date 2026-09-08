CREATE TABLE `ai_models` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`provider_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`model` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`label` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`price_in_micro` bigint NOT NULL DEFAULT 0,
	`price_out_micro` bigint NOT NULL DEFAULT 0,
	`enabled` boolean NOT NULL DEFAULT true,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_models_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_models_client_id_provider_id_model_uq` UNIQUE(`client_id`,`provider_id`,`model`)
);
--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`code` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`base_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`api_key` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`default_model` varchar(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`is_default` boolean NOT NULL DEFAULT false,
	`last_status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin,
	`last_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`last_tested_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `ai_providers_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_providers_client_id_code_uq` UNIQUE(`client_id`,`code`)
);
--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `provider` varchar(40) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD `provider_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `ai_models` ADD CONSTRAINT `ai_models_provider_id_ai_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_provider_id_ai_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON DELETE set null ON UPDATE no action;