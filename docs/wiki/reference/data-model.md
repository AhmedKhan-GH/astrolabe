# Data model

Astrolabe uses a local SQLite index to augment knowledge work across Zotero, Obsidian, and Eagle. It stores its generated database and its own folder definitions under `~/Astrolabe/.astrolabe/` by default.

Set `ASTROLABE_WORKSPACE` before launch to use another workspace root.

## Indexed documents

The index supports browsing and filtering documents, searching indexed text, inspecting document details, and opening items in their source applications. Matching Zotero and Eagle files may be combined by SHA-256.

Astrolabe folder definitions are JSON files under `.astrolabe/folders/`. Folder membership is local organization metadata and does not move, rename, or delete a source item. A document can belong to more than one Astrolabe folder.

## Dormant libraries and ghosts

When a connector cannot reach a previously indexed library, Astrolabe keeps that library dormant while the other connectors continue to work. An unavailable library does not become a ghost solely because it is unreachable.

A ghost is an indexed document with no remaining source copy. It retains its title, kind, search entry, and folder membership, but it cannot be opened and is hidden by default.

Read [Connectors](../using/connectors.md) for source-specific indexing behavior and [Astrolabe folders](../using/folders.md) for organization controls.
