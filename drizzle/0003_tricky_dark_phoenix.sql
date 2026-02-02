PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer DEFAULT 0 NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_folders`("id", "name", "parent_id", "created_at") SELECT "id", "name", COALESCE("parent_id", 0), "created_at" FROM `folders`;--> statement-breakpoint
DROP TABLE `folders`;--> statement-breakpoint
ALTER TABLE `__new_folders` RENAME TO `folders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;