/**
 * Library Navigator (Lens v1) shared types — mirror the `index:nav` / `index:browse`
 * wire contracts (docs/2026-07-10-library-navigator-spec.md). Kept renderer-local so
 * component tests never reach for the preload seam.
 */

/** One active value per dimension; all compose with AND. */
export interface LensSelection {
  sourceKey?: 'zotero' | 'eagle' | 'obsidian'
  collectionId?: number // zotero/eagle tree node; implies its source
  folderPrefix?: string // obsidian folder path ('Projects/'); implies obsidian
  tag?: string
  kind?: 'pdf' | 'image' | 'note' | 'other'
}

/** id = collections.id (zotero/eagle) | folder path string (obsidian). */
export interface NavNode {
  id: number | string
  name: string
  count: number
  children: NavNode[]
}

export interface NavData {
  kinds: { kind: string; count: number }[]
  sources: { key: string; status: string; documentCount: number; tree: NavNode[] }[]
  tags: { name: string; count: number }[]
}

/** SearchHit minus snippet, plus modifiedAt. */
export interface BrowseHit {
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  instances: { sourceKey: string; uri: string; filePath: string | null }[]
}

export interface BrowsePage {
  total: number
  hits: BrowseHit[]
}
