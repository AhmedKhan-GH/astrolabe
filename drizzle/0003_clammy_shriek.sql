CREATE TABLE `virtual_collection_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vc_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	FOREIGN KEY (`vc_id`) REFERENCES `virtual_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vc_members_document_idx` ON `virtual_collection_members` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vc_members_uq` ON `virtual_collection_members` (`vc_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `virtual_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `virtual_collections_slug_unique` ON `virtual_collections` (`slug`);