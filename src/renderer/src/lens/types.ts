/**
 * Library Navigator (Lens v1) shared types — mirror the `index:nav` / `index:browse`
 * wire contracts (docs/2026-07-10-library-navigator-spec.md). Kept renderer-local so
 * component tests never reach for the preload seam.
 */

export type SourceKey = 'zotero' | 'eagle' | 'obsidian'
export type DocumentKind = 'pdf' | 'image' | 'note' | 'other'

/**
 * Renderer mirror of the `queries.ts` filterSetSchema wire contract — same field
 * names, all arrays optional (omitted entirely when empty, keeping the payload
 * minimal). Dimensions AND together; within a scope dimension values OR.
 */
export interface FilterSet {
  sourceKeys?: SourceKey[]
  collectionIds?: number[]
  folderPrefixes?: string[] // obsidian externalKey LIKE '<prefix>%'
  kinds?: DocumentKind[]
  tagsAll?: string[] // document has every one
  tagsAny?: string[] // at least one
  tagsNone?: string[] // none of them
}

/**
 * Multi-select facets + boolean tag search. Scope arrays (sources/collections/
 * folders) OR within and AND across dimensions; tags carry per-name mode, and
 * `tagMatch` decides whether required tags map to tagsAll vs tagsAny on the wire.
 */
export interface LensSelection {
  sourceKeys: SourceKey[]
  collectionIds: number[]
  folderPrefixes: string[]
  kinds: DocumentKind[]
  tags: { name: string; mode: 'require' | 'exclude' }[]
  tagMatch: 'all' | 'any'
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
