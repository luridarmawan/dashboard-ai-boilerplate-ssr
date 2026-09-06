CREATE TABLE `ai_calls` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`conversation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`endpoint` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`model` varchar(120) CHARACTER SET ascii COLLATE ascii_bin,
	`tokens_in` int,
	`tokens_out` int,
	`tokens_total` int,
	`latency_ms` int,
	`first_token_ms` int,
	`status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`cost_micro` int,
	`streamed` boolean NOT NULL DEFAULT false,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`title` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`model` varchar(120) CHARACTER SET ascii COLLATE ascii_bin,
	`archived_at` datetime(3),
	`last_message_at` datetime(3),
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`deleted_at` datetime(3),
	CONSTRAINT `ai_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`conversation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`role` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`tokens_in` int,
	`tokens_out` int,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_conversation_id_ai_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_calls_client_id_created_at_idx` ON `ai_calls` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_calls_client_id_user_id_idx` ON `ai_calls` (`client_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `ai_conversations_client_id_user_id_last_message_at_idx` ON `ai_conversations` (`client_id`,`user_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_client_id_conversation_id_created_at_idx` ON `ai_messages` (`client_id`,`conversation_id`,`created_at`);