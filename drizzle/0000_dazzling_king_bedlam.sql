CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`external_key` text NOT NULL,
	`type` text NOT NULL,
	`text` text,
	`comment` text,
	`page_label` text,
	`color` text,
	`position_json` text,
	`modified_at` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `document_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `annotations_instance_idx` ON `annotations` (`instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotations_instance_external_uq` ON `annotations` (`instance_id`,`external_key`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`external_key` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_library_external_uq` ON `collections` (`library_id`,`external_key`);--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connectors_key_unique` ON `connectors` (`key`);--> statement-breakpoint
CREATE TABLE `document_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`collection_id` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_collections_uq` ON `document_collections` (`document_id`,`collection_id`);--> statement-breakpoint
CREATE TABLE `document_instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`library_id` integer NOT NULL,
	`external_key` text NOT NULL,
	`uri` text NOT NULL,
	`file_path` text,
	`meta_json` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `instances_document_idx` ON `document_instances` (`document_id`);--> statement-breakpoint
CREATE INDEX `instances_library_idx` ON `document_instances` (`library_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `instances_library_external_uq` ON `document_instances` (`library_id`,`external_key`);--> statement-breakpoint
CREATE TABLE `document_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_tags_uq` ON `document_tags` (`document_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_sha256` text,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`modified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_content_sha256_unique` ON `documents` (`content_sha256`);--> statement-breakpoint
CREATE INDEX `documents_title_idx` ON `documents` (`title`);--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connector_id` integer NOT NULL,
	`stable_key` text NOT NULL,
	`display_name` text NOT NULL,
	`availability` text DEFAULT 'live' NOT NULL,
	`sync_cursor` text,
	`last_seen_at` integer,
	`last_scan_at` integer,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `libraries_connector_key_uq` ON `libraries` (`connector_id`,`stable_key`);--> statement-breakpoint
CREATE TABLE `meta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meta_key_unique` ON `meta` (`key`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);