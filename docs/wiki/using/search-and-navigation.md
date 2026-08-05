# Search and navigation

With no query, the document list is sorted newest first. Search uses SQLite FTS5. Folder, tag, and library filters apply to both browsing and search.

- **All** shows non-ghost documents by default.
- **Uncategorized** shows documents in no Astrolabe folder.
- Result rows show kind, source copies, tags, and search snippets.
- Click for details; double-click to open the first available source copy.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| <kbd>⌘/Ctrl</kbd> <kbd>K</kbd> | Jump to a folder, document, or library. |
| <kbd>⌘/Ctrl</kbd> <kbd>F</kbd> | Focus and select the main search field. |
| <kbd>⌘/Ctrl</kbd> <kbd>[</kbd> / <kbd>]</kbd> | Move backward or forward through selection history. |
| <kbd>⌘/Ctrl</kbd> + click | Toggle rows in a multi-selection. |
| <kbd>Shift</kbd> + click | Select a range from the last anchor. |
| <kbd>F</kbd> | File the current selection to a folder. |
| <kbd>Enter</kbd> or <kbd>O</kbd> | Open the anchored result in its source app. |
| <kbd>Esc</kbd> | Clear the selection. |

The command palette matches folder paths and library names by substring. Document results begin after two characters and are returned by the same full-text index.

See [Astrolabe folders](folders.md) for filing and membership behavior and [Current limitations](../reference/limitations.md) for result limits.
