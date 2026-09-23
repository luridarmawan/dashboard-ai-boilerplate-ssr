CREATE TABLE `ai_attachments` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`message_id` text(36) NOT NULL,
	`conversation_id` text(36) NOT NULL,
	`file_id` text(36) NOT NULL,
	`name` text(255) NOT NULL,
	`mime` text(128) NOT NULL,
	`size` integer NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_attachments_client_id_conversation_id_idx` ON `ai_attachments` (`client_id`,`conversation_id`);--> statement-breakpoint
CREATE INDEX `ai_attachments_client_id_message_id_idx` ON `ai_attachments` (`client_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `ai_calls` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`user_id` text(36),
	`conversation_id` text(36),
	`endpoint` text(64) NOT NULL,
	`provider` text(40),
	`model` text(120),
	`tokens_in` integer,
	`tokens_out` integer,
	`tokens_total` integer,
	`latency_ms` integer,
	`first_token_ms` integer,
	`status` text(16) NOT NULL,
	`error` text,
	`cost_micro` integer,
	`streamed` integer DEFAULT false NOT NULL,
	`upstream_endpoint` text(16),
	`reasoning_tokens` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_calls_client_id_created_at_idx` ON `ai_calls` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_calls_client_id_user_id_idx` ON `ai_calls` (`client_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`user_id` text(36) NOT NULL,
	`title` text(191) NOT NULL,
	`provider_id` text(36),
	`model` text(120),
	`archived_at` integer,
	`last_message_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_client_id_user_id_last_message_at_idx` ON `ai_conversations` (`client_id`,`user_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `ai_credit_ledger` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`amount_micro` integer NOT NULL,
	`balance_after_micro` integer,
	`note` text(255),
	`actor_id` text(36),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_credit_ledger_client_id_created_at_idx` ON `ai_credit_ledger` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_credits` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`balance_micro` integer,
	`spent_micro` integer DEFAULT 0 NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_credits_client_id_uq` ON `ai_credits` (`client_id`);--> statement-breakpoint
CREATE TABLE `ai_mcp_tools` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`mcp_id` text(36) NOT NULL,
	`name` text(191) NOT NULL,
	`wire` text(64) NOT NULL,
	`description` text,
	`input_schema` text,
	`enabled` integer DEFAULT true NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`mcp_id`) REFERENCES `ai_mcps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_mcp_tools_client_id_mcp_id_wire_uq` ON `ai_mcp_tools` (`client_id`,`mcp_id`,`wire`);--> statement-breakpoint
CREATE TABLE `ai_mcps` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`code` text(40) NOT NULL,
	`name` text(191) NOT NULL,
	`transport` text(16) DEFAULT 'http' NOT NULL,
	`url` text(512) NOT NULL,
	`headers` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_status` text(16),
	`last_error` text,
	`last_synced_at` integer,
	`tools_count` integer DEFAULT 0 NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_mcps_client_id_code_uq` ON `ai_mcps` (`client_id`,`code`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`conversation_id` text(36) NOT NULL,
	`parent_id` text(36),
	`role` text(16) NOT NULL,
	`content` text NOT NULL,
	`tokens_in` integer,
	`tokens_out` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_messages_client_id_conversation_id_created_at_idx` ON `ai_messages` (`client_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_client_id_parent_id_idx` ON `ai_messages` (`client_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `ai_models` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`provider_id` text(36) NOT NULL,
	`model` text(120) NOT NULL,
	`label` text(191),
	`price_in_micro` integer DEFAULT 0 NOT NULL,
	`price_out_micro` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`capabilities` text,
	`capabilities_at` integer,
	`preferred_endpoint` text(16),
	`last_status` text(16),
	`last_error` text,
	`last_tested_at` integer,
	`last_probe_ms` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_models_client_id_provider_id_model_uq` ON `ai_models` (`client_id`,`provider_id`,`model`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`code` text(40) NOT NULL,
	`name` text(191) NOT NULL,
	`base_url` text(512) NOT NULL,
	`api_key` text,
	`default_model` text(120) NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`last_status` text(16),
	`last_error` text,
	`last_tested_at` integer,
	`capabilities` text,
	`capabilities_at` integer,
	`preferred_endpoint` text(16),
	`last_probe_error` text,
	`last_probe_ms` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_client_id_code_uq` ON `ai_providers` (`client_id`,`code`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`user_id` text(36) NOT NULL,
	`client_id` text(36),
	`name` text(100) NOT NULL,
	`token_hash` text(64) NOT NULL,
	`scopes` text,
	`expires_at` integer,
	`last_used_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_uq` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_id_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`actor_id` text(36),
	`action` text(64) NOT NULL,
	`resource` text(64) NOT NULL,
	`resource_id` text(64),
	`ip` text(45),
	`request_id` text(64),
	`before` text,
	`after` text,
	`note` text,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_client_id_created_at_idx` ON `audit_log` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_client_id_resource_resource_id_idx` ON `audit_log` (`client_id`,`resource`,`resource_id`);--> statement-breakpoint
CREATE INDEX `audit_log_client_id_actor_id_idx` ON `audit_log` (`client_id`,`actor_id`);--> statement-breakpoint
CREATE TABLE `cache_versions` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`name` text(64) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cache_versions_name_uq` ON `cache_versions` (`name`);--> statement-breakpoint
CREATE TABLE `client_user_maps` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`user_id` text(36) NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_user_maps_client_id_user_id_uq` ON `client_user_maps` (`client_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`parent_id` text(36),
	`code` text(32) NOT NULL,
	`name` text(191) NOT NULL,
	`settings` text,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_code_uq` ON `clients` (`code`);--> statement-breakpoint
CREATE INDEX `clients_parent_id_idx` ON `clients` (`parent_id`);--> statement-breakpoint
CREATE TABLE `configurations` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`scope` text(36) NOT NULL,
	`client_id` text(36),
	`section` text(64) NOT NULL,
	`sub` text(64),
	`key` text(191) NOT NULL,
	`value` text,
	`type` text(16) NOT NULL,
	`title` text(191),
	`note` text,
	`order` integer DEFAULT 100 NOT NULL,
	`public` integer DEFAULT false NOT NULL,
	`updated_by` text(36),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `configurations_scope_key_uq` ON `configurations` (`scope`,`key`);--> statement-breakpoint
CREATE INDEX `configurations_section_idx` ON `configurations` (`section`);--> statement-breakpoint
CREATE TABLE `dummy_notes` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`title` text(191) NOT NULL,
	`body` text,
	`state` text(16) DEFAULT 'draft' NOT NULL,
	`tags` text,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `dummy_notes_client_id_state_idx` ON `dummy_notes` (`client_id`,`state`);--> statement-breakpoint
CREATE TABLE `email_verification_tokens` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`user_id` text(36) NOT NULL,
	`token_hash` text(64) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verification_tokens_token_hash_uq` ON `email_verification_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_verification_tokens_user_id_idx` ON `email_verification_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `example_inquiries` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`name` text(191) NOT NULL,
	`email` text(191) NOT NULL,
	`message` text NOT NULL,
	`source` text(191),
	`ip` text(45),
	`state` text(16) DEFAULT 'new' NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `example_inquiries_client_id_created_at_idx` ON `example_inquiries` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `example_inquiries_client_id_state_idx` ON `example_inquiries` (`client_id`,`state`);--> statement-breakpoint
CREATE TABLE `example_products` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`slug` text(120) NOT NULL,
	`name` text(191) NOT NULL,
	`summary` text(512),
	`description` text,
	`price` integer DEFAULT 0 NOT NULL,
	`currency` text(3) DEFAULT 'IDR' NOT NULL,
	`image_url` text(512),
	`featured` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 100 NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `example_products_client_id_slug_uq` ON `example_products` (`client_id`,`slug`);--> statement-breakpoint
CREATE INDEX `example_products_client_id_featured_sort_idx` ON `example_products` (`client_id`,`featured`,`sort`);--> statement-breakpoint
CREATE TABLE `example_testimonials` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`author` text(191) NOT NULL,
	`role` text(191),
	`quote` text NOT NULL,
	`avatar_url` text(512),
	`sort` integer DEFAULT 100 NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `example_testimonials_client_id_sort_idx` ON `example_testimonials` (`client_id`,`sort`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`user_id` text(36),
	`key` text(255) NOT NULL,
	`storage` text(16) NOT NULL,
	`name` text(255) NOT NULL,
	`mime` text(128) NOT NULL,
	`size` integer NOT NULL,
	`sha256` text(64) NOT NULL,
	`kind` text(64) DEFAULT 'generic' NOT NULL,
	`visibility` text(16) DEFAULT 'private' NOT NULL,
	`meta` text,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_client_id_user_id_created_at_idx` ON `files` (`client_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_client_id_kind_idx` ON `files` (`client_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_client_id_key_uq` ON `files` (`client_id`,`key`);--> statement-breakpoint
CREATE TABLE `group_permissions` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`group_id` text(36) NOT NULL,
	`permission` text(191) NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_permissions_client_id_group_id_permission_uq` ON `group_permissions` (`client_id`,`group_id`,`permission`);--> statement-breakpoint
CREATE TABLE `group_user_maps` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`group_id` text(36) NOT NULL,
	`user_id` text(36) NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_user_maps_client_id_group_id_user_id_uq` ON `group_user_maps` (`client_id`,`group_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `group_user_maps_client_id_user_id_idx` ON `group_user_maps` (`client_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`code` text(64) NOT NULL,
	`name` text(191) NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_client_id_code_uq` ON `groups` (`client_id`,`code`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`email` text(191) NOT NULL,
	`token_hash` text(64) NOT NULL,
	`invited_by` text(36),
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text(36),
	`revoked_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_uq` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_client_id_email_idx` ON `invitations` (`client_id`,`email`);--> statement-breakpoint
CREATE INDEX `invitations_expires_at_idx` ON `invitations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mfa_challenges` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`user_id` text(36) NOT NULL,
	`token_hash` text(64) NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`ip` text(45),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mfa_challenges_token_hash_uq` ON `mfa_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mfa_challenges_expires_at_idx` ON `mfa_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`scope` text(36) NOT NULL,
	`client_id` text(36),
	`module` text(64) NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_by` text(36),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modules_scope_module_uq` ON `modules` (`scope`,`module`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`user_id` text(36) NOT NULL,
	`type` text(64) NOT NULL,
	`title` text(191) NOT NULL,
	`body` text,
	`link` text(512),
	`data` text,
	`read_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_client_id_user_id_read_at_created_at_idx` ON `notifications` (`client_id`,`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_client_id_created_at_idx` ON `notifications` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`user_id` text(36) NOT NULL,
	`provider` text(32) NOT NULL,
	`provider_user_id` text(191) NOT NULL,
	`email` text(191),
	`last_login_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_accounts_provider_provider_user_id_uq` ON `oauth_accounts` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `oauth_accounts_user_id_idx` ON `oauth_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `outbox_email` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36),
	`to_address` text(191) NOT NULL,
	`to_name` text(191),
	`subject` text(255) NOT NULL,
	`template` text(64) NOT NULL,
	`locale` text(8) DEFAULT 'en' NOT NULL,
	`payload` text,
	`status` text(16) DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`sent_at` integer,
	`last_error` text,
	`transport` text(16),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `outbox_email_status_next_attempt_at_idx` ON `outbox_email` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbox_email_to_address_idx` ON `outbox_email` (`to_address`);--> statement-breakpoint
CREATE INDEX `outbox_email_created_at_idx` ON `outbox_email` (`created_at`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`user_id` text(36) NOT NULL,
	`token_hash` text(64) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_uq` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_id_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `queue_jobs` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`name` text(128) NOT NULL,
	`payload` text,
	`client_id` text(36),
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text(16) DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`run_at` integer NOT NULL,
	`locked_by` text(128),
	`locked_until` integer,
	`last_error` text,
	`dedupe_key` text(191),
	`request_id` text(64),
	`started_at` integer,
	`finished_at` integer,
	`result` text,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `queue_jobs_status_run_at_priority_idx` ON `queue_jobs` (`status`,`run_at`,`priority`);--> statement-breakpoint
CREATE INDEX `queue_jobs_name_status_idx` ON `queue_jobs` (`name`,`status`);--> statement-breakpoint
CREATE INDEX `queue_jobs_client_id_created_at_idx` ON `queue_jobs` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `queue_jobs_dedupe_key_idx` ON `queue_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`key` text(191) NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_key_uq` ON `rate_limits` (`key`);--> statement-breakpoint
CREATE INDEX `rate_limits_window_start_idx` ON `rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `scheduler_jobs` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`name` text(128) NOT NULL,
	`locked_by` text(128),
	`locked_until` integer,
	`run_started_at` integer,
	`last_run_at` integer,
	`last_status` text(8),
	`last_error` text,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduler_jobs_name_uq` ON `scheduler_jobs` (`name`);--> statement-breakpoint
CREATE TABLE `scheduler_runs` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`job` text(128) NOT NULL,
	`instance_id` text(128) NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`status` text(8) NOT NULL,
	`error` text,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduler_runs_job_started_at_idx` ON `scheduler_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`user_id` text(36) NOT NULL,
	`client_id` text(36),
	`token_hash` text(64) NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ip` text(45),
	`user_agent` text(512),
	`revoked_at` integer,
	`impersonator_id` text(36),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`impersonator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`scope` text(36) NOT NULL,
	`client_id` text(36),
	`code` text(64) NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`base` text(64) NOT NULL,
	`tokens` text NOT NULL,
	`icons` text(64) NOT NULL,
	`layouts` text NOT NULL,
	`assets` text,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_by` text(36),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `themes_scope_code_uq` ON `themes` (`scope`,`code`);--> statement-breakpoint
CREATE TABLE `user_mfa` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`user_id` text(36) NOT NULL,
	`secret` text NOT NULL,
	`enabled_at` integer,
	`recovery_codes` text,
	`last_step` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_mfa_user_id_uq` ON `user_mfa` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`email` text(191) NOT NULL,
	`password_hash` text,
	`name` text(191) NOT NULL,
	`phone` text(32),
	`avatar_url` text(512),
	`locale` text(8),
	`theme` text(64),
	`sidebar_collapsed` integer DEFAULT false NOT NULL,
	`is_superadmin` integer DEFAULT false NOT NULL,
	`email_verified_at` integer,
	`last_login_at` integer,
	`last_login_ip` text(45),
	`last_active_at` integer,
	`last_active_ip` text(45),
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`webhook_id` text(36) NOT NULL,
	`event` text(64) NOT NULL,
	`payload` text NOT NULL,
	`status` text(16) DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`response_status` integer,
	`last_error` text,
	`delivered_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_client_id_webhook_id_created_at_idx` ON `webhook_deliveries` (`client_id`,`webhook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_client_id_status_next_attempt_at_idx` ON `webhook_deliveries` (`client_id`,`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text(36) PRIMARY KEY NOT NULL,
	`client_id` text(36) NOT NULL,
	`name` text(191) NOT NULL,
	`url` text(512) NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_status` text(16),
	`last_error` text,
	`last_delivered_at` integer,
	`status_id` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `webhooks_client_id_enabled_idx` ON `webhooks` (`client_id`,`enabled`);