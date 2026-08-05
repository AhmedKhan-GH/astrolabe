# Astrolabe

Astrolabe augments knowledge work across Zotero, Obsidian, and Eagle through a local SQLite index. The documentation covers setup and usage for the current macOS source build.

You can browse and filter documents, search indexed text, inspect document details, organize documents with Astrolabe folders, and open items in their source applications. Matching Zotero and Eagle files may be combined by SHA-256.

!!! note "Release status"
    No public installer is available. The current version is **0.0.0**.

## Choose a path

- <span id="getting-started"></span>**[Run Astrolabe from source](getting-started.md)** — install the requirements, start the desktop app, and run the source checks.
- <span id="connectors"></span>**[Connect Zotero, Obsidian, and Eagle](using/connectors.md)** — understand discovery, sync, source-specific behavior, and filesystem requirements.
- <span id="search-navigation"></span>**[Search and navigate](using/search-and-navigation.md)** — browse, filter, use full-text search, and work with keyboard shortcuts.
- <span id="folders"></span><span id="ghosts"></span>**[Organize with folders](using/folders.md)** — file documents without changing their source items and understand ghost records.
- <span id="data-model"></span>**[Review the data model](reference/data-model.md)** — see where Astrolabe stores its generated index and organization metadata.
- <span id="limitations"></span>**[Check current limitations](reference/limitations.md)** — review the boundaries of the current build.

## Current scope

- Zotero, Obsidian, and Eagle are indexed independently.
- Folder, tag, and library filters apply to browsing and search.
- Document details expose indexed metadata and available source copies.
- Open actions return to the source application.
- Sync runs locally at launch and when you choose **Sync**.

## Documentation map

- **Getting started** covers the macOS source build.
- **Using Astrolabe** covers connectors, search, navigation, folders, and ghosts.
- **Reference** covers the generated data model and current limitations.

<span id="developer-links"></span>

## Source

The rebuild branch contains the current implementation. Project notes also include future plans.

- **[Repository](https://github.com/AhmedKhan-GH/astrolabe/tree/rebuild)** — browse all source code.
- **[Connectors](https://github.com/AhmedKhan-GH/astrolabe/tree/rebuild/src/main/connectors)** — Zotero, Obsidian, and Eagle.
- **[Interface](https://github.com/AhmedKhan-GH/astrolabe/tree/rebuild/src/renderer/src/frame)** — navigation, results, detail, and command palette.
- **[Project notes](https://github.com/AhmedKhan-GH/astrolabe/tree/rebuild/docs)** — architecture, decisions, and marked plans.
