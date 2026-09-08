CREATE TABLE `ai_credit_ledger` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`amount_micro` bigint NOT NULL,
	`balance_after_micro` bigint,
	`note` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
	`actor_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_credit_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_credits` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`balance_micro` bigint,
	`spent_micro` bigint NOT NULL DEFAULT 0,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_credits_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_credits_client_id_uq` UNIQUE(`client_id`)
);
--> statement-breakpoint
CREATE INDEX `ai_credit_ledger_client_id_created_at_idx` ON `ai_credit_ledger` (`client_id`,`created_at`);