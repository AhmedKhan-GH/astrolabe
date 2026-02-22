CREATE TABLE `file_folders` (
	`file_id` integer NOT NULL,
	`folder_id` integer NOT NULL,
	`added_at` integer,
	PRIMARY KEY(`file_id`, `folder_id`),
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `folder_ids`;