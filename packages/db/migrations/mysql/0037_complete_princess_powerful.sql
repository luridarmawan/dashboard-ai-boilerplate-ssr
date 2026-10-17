CREATE TABLE `permalinks` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`client_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`path` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`module` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`target` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`kind` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'canonical',
	`live` boolean NOT NULL DEFAULT false,
	`status_id` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `permalinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `permalinks_client_id_path_uq` UNIQUE(`client_id`,`path`)
);
--> statement-breakpoint
CREATE INDEX `permalinks_client_id_module_target_idx` ON `permalinks` (`client_id`,`module`,`target`);