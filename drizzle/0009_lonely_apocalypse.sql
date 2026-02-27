ALTER TABLE `files` ADD `is_deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `folders` ADD `is_deleted` integer DEFAULT false NOT NULL;