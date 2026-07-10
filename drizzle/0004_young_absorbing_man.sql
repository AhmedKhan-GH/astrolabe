CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_instance_id` integer NOT NULL,
	`target_name` text NOT NULL,
	`target_document_id` integer,
	FOREIGN KEY (`source_instance_id`) REFERENCES `document_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `links_target_document_idx` ON `links` (`target_document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `links_source_target_uq` ON `links` (`source_instance_id`,`target_name`);