# Connectors

A sync probes each connector separately. If one source cannot be reached, Astrolabe marks that connector unavailable and keeps its previously indexed libraries dormant; the other connectors continue to work.

## Zotero

Start Zotero before syncing. Astrolabe connects to Zotero's local API at `localhost:23119`, discovers *My Library* and the group libraries in the local client, and indexes bibliographic items, top-level attachments, tags, collections, and PDF annotations.

- Stored attachment paths currently assume Zotero's default `~/Zotero` data directory.
- Linked attachments retain their absolute path when Zotero supplies one.
- Open actions use Zotero deep links, including a PDF attachment link when available.

## Obsidian

Astrolabe discovers vaults registered with the Obsidian desktop app by default. It recursively indexes readable `.md` files while skipping hidden directories and dotfiles. Titles, frontmatter and inline tags, note bodies, wiki-links, and contiguous Markdown blockquotes are parsed into the current index.

To add explicit vaults or use only a curated set, keep the generated fields in `~/Astrolabe/.astrolabe/manifest.json` and add this `connectors` field alongside them:

```json
"connectors": {
  "obsidian": {
    "vaultPaths": ["/absolute/path/to/Vault"],
    "discoverVaults": true
  }
}
```

Set `discoverVaults` to `false` to scan only the listed paths. Run **Sync** after changing the manifest. A missing vault is marked dormant rather than erased from the index.

## Eagle

Eagle exposes one open library at a time. Start Eagle with a library open before syncing. Astrolabe reads Eagle's local API at `localhost:41595` and indexes non-trashed items, file types, tags, and the source folder tree for the open library.

- The Libraries rail lists indexed libraries and libraries known from Eagle's history.
- A switch action opens another library in Eagle and then syncs it.
- **Sync all Eagle libraries** visits the known libraries and attempts to restore the one that was originally open.
- **Import from Eagle** copies a synced source folder tree into new Astrolabe folders once; the two trees are not kept in sync afterward.

Eagle file hashing and reveal actions require filesystem access to the library directory. macOS may require a privacy permission for libraries in protected locations such as iCloud Drive.

Matching Zotero and Eagle files may be combined by SHA-256. See [Data model](../reference/data-model.md) for storage and record behavior, or continue to [Search and navigation](search-and-navigation.md).
