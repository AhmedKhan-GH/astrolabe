# Astrolabe folders

Folders are local organization metadata, stored as JSON files under `.astrolabe/folders/`. Filing a document changes only its Astrolabe membership; it never moves, renames, or deletes the source item.

1. Create a top-level folder with **+ New Folder**.
2. Right-click a folder to create a child, rename it, move it, or delete it.
3. Select one or more document rows, then choose **File to folder…**.
4. While browsing a folder, use **Remove from this folder** to unfile the selection.
5. On a selected parent folder, toggle **⊂** to include or exclude its descendants.

A document can belong to more than one folder. Deleting a folder leaves its documents untouched and reparents its child folders to the deleted folder's parent.

## Ghosts

A ghost is an indexed document with no remaining source copy. Ghosts are hidden by default.

- **Show ghosts** reveals hidden ghost records.
- A ghost retains its title, kind, search entry, and folder membership but cannot be opened.
- An unavailable library is marked dormant and does not become a ghost solely because it is unreachable.

See [Data model](../reference/data-model.md) for the workspace location and generated index.
