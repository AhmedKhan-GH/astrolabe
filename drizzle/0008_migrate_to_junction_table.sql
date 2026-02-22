-- Create the file_folders junction table
CREATE TABLE `file_folders` (
	`file_id` integer NOT NULL,
	`folder_id` integer NOT NULL,
	`added_at` integer,
	PRIMARY KEY(`file_id`, `folder_id`),
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);

-- Migrate existing data from JSON folderIds to junction table
-- This parses the JSON array and creates individual rows
INSERT INTO `file_folders` (`file_id`, `folder_id`, `added_at`)
SELECT
  f.id,
  CAST(json_each.value AS INTEGER),
  f.added_at
FROM files f, json_each(COALESCE(f.folder_ids, '[]'))
WHERE json_valid(COALESCE(f.folder_ids, '[]'));

-- For files with no folder_ids or invalid JSON, add them to root folder (0)
INSERT INTO `file_folders` (`file_id`, `folder_id`, `added_at`)
SELECT
  f.id,
  0,
  f.added_at
FROM files f
WHERE f.folder_ids IS NULL
   OR NOT json_valid(f.folder_ids)
   OR f.id NOT IN (SELECT file_id FROM file_folders);

-- Remove the old folder_ids column from files table
-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
CREATE TABLE `files_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`path` text NOT NULL,
	`filetype` text,
	`file_storage_type` text DEFAULT 'import' NOT NULL,
	`added_at` integer
);

-- Copy data from old table to new table (excluding folder_ids)
INSERT INTO `files_new` SELECT id, filename, path, filetype, file_storage_type, added_at FROM files;

-- Drop old table and rename new one
DROP TABLE files;
ALTER TABLE files_new RENAME TO files;
