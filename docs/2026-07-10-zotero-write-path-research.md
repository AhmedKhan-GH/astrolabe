# Zotero Write Path — Research Note (reconciler write gestures)

**Date:** 2026-07-10 · **Status:** decision recorded; implementation pending (write half of the
Eagle↔Zotero reconciler)

## Decision

**Write into local Zotero via the connector server** (`http://localhost:23119/connector/*`) —
the surface the browser Connector uses. Local, keyless, no cloud dependency; items + attached
PDFs land directly in the local library with Zotero storing its own file copy (Zotero stays
system of record). The alternatives are disqualified or deferred:

- **Local API `/api/…` (port 23119):** officially **read-only** ("Only GET is accepted; an
  upcoming version will support write requests"). Re-check on Zotero upgrades — if writes ship,
  it becomes the cleanest option.
- **Web API (`api.zotero.org`):** works (it's what zotero-mcp's `add_from_file` uses via
  pyzotero) but requires API key + library id, uploads bytes to Zotero cloud storage (300 MB
  free quota), and reaches the desktop only via sync. Acceptable fallback for cloud-sync users;
  not the default.
- **Direct `zotero.sqlite`:** disqualified — corrupts while Zotero runs.

## The connector-server flow (verified against Zotero's `server_connector.js`)

1. `POST /connector/getSelectedCollection` `{}` → editable targets `[{id:"C<id>", name, level}]` + tags.
2. `POST /connector/saveItems` `{sessionID:<uuid>, uri, items:[{id:"itm1", itemType, title,
   creators, date, DOI, tags:[{tag}]}]}` → 201. Item JSON = standard Zotero translator-item
   shape (confirm field names empirically at implementation).
3. `POST /connector/updateSession` `{sessionID, target:"C<id>", tags:[…], note}` — collection
   placement; without it, saves go to the collection selected in the Zotero UI.
4. `POST /connector/saveAttachment` — header `X-Metadata: {sessionID, parentItemID:"itm1",
   title, url}`, `Content-Type: application/pdf`, **body = raw PDF bytes** (attaching an
   existing local file = stream its bytes). `saveStandaloneAttachment` for parent-less.

Gotchas: do NOT send `X-Zotero-Connector-API-Version` (avoids the version-warning gate);
target library must be editable; connector protocol is Zotero-internal (not a versioned public
REST contract) — pin with an integration test against the live app and re-verify on upgrades;
confirm the Origin/CSRF handling accepts an Origin-less Electron main-process fetch on the
installed Zotero version.

## Eagle reverse gesture (import into Eagle)

`POST http://localhost:41595/api/item/addFromPath` `{path, name, website, annotation,
tags:[…], folderId}` (batch: `addFromPaths`); folders via `POST /api/folder/create
{folderName, parent}`. Tokenless while Eagle runs — same API the read connector already uses.
Set `website` to the `zotero://select/items/<key>` URI so the Eagle item links back.

## Context notes

- The app's Zotero connector today is read-only against the local API (`/api/users/0/…`,
  keyless); `/deleted` is 404 locally, so removals only reconcile on full rebuild.
- zotero-mcp as currently configured (`ZOTERO_LOCAL=true`, no API key) would refuse
  `add_from_file` — its write path is cloud-only. Do not model Astrolabe's write path on it.
