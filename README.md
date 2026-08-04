# Astrolabe

Astrolabe is a local-first macOS desktop application for searching, organizing, and opening work across Zotero, Obsidian, and Eagle from one interface.

[Website](https://ahmedkhan-gh.github.io/astrolabe/) · [Current documentation](https://ahmedkhan-gh.github.io/astrolabe/docs/) · [Project notes](docs/README.md)

## Current build

The working rebuild provides:

- a unified, local SQLite/FTS index over Zotero, Obsidian, and Eagle;
- full-text search over titles, tags, Zotero annotation text/comments, and Obsidian note bodies;
- browsing by nested Astrolabe folder, tag, source library, or uncategorized state;
- document detail with source instances, availability, folders, tags, annotation previews, and Obsidian backlinks;
- deep links back to the source application and reveal-in-Finder actions;
- multiple Obsidian vaults and multiple known Eagle libraries;
- keyboard navigation and multi-select filing without moving source files; and
- retained “ghost” identities when every indexed copy of a document disappears.

Astrolabe is currently a development build, not a public product release. There is no signed/notarized installer, updater, account, checkout, payment flow, or published executable yet. The website keeps its download control inactive until a qualified GitHub Release exists.

## Run from source

Requirements: macOS, Node.js 24 with Corepack, and at least one supported source application or Obsidian vault.

```sh
corepack enable
pnpm install
pnpm dev
```

Astrolabe creates its default workspace at `~/Astrolabe/.astrolabe/`. Set `ASTROLABE_WORKSPACE` before launch to use a different workspace root.

See the [current documentation](https://ahmedkhan-gh.github.io/astrolabe/docs/) for connector behavior and known limitations.

## Validate the application

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Repository map

- `src/main/` — Electron composition, connectors, local index, and IPC
- `src/preload/` — typed renderer bridge
- `src/renderer/` — React three-pane interface
- `drizzle/` — local SQLite schema migrations
- `docs/` — vision, architecture, decisions, and implementation records
- `site/` — static GitHub Pages site and current user documentation
- `.github/workflows/` — application CI, Pages deployment, and release preparation

## Distribution status

The checked-in local packaging path uses a development signing identity and must not be distributed. The separate production release workflow fails closed unless versioning, distribution terms, Developer ID signing, notarization, artifact verification, and release metadata are all present. See [macOS distribution authorization](MACOS-DISTRIBUTION-AUTHORIZATION-SPEC.md) for the recorded production requirements.
