CREATE TABLE `ai_attachments` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`message_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`conversation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`file_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
	`mime` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`size` int NOT NULL,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `parent_id` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `ai_attachments` ADD CONSTRAINT `ai_attachments_message_id_ai_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_attachments` ADD CONSTRAINT `ai_attachments_conversation_id_ai_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_attachments` ADD CONSTRAINT `ai_attachments_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_attachments_client_id_conversation_id_idx` ON `ai_attachments` (`client_id`,`conversation_id`);--> statement-breakpoint
CREATE INDEX `ai_attachments_client_id_message_id_idx` ON `ai_attachments` (`client_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `ai_messages_client_id_parent_id_idx` ON `ai_messages` (`client_id`,`parent_id`);