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
  virtualCollections?: string[] // slugs — a fourth scope sub-predicate (OR with the others)
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
  virtualCollections: string[] // slugs — source-independent M:N groupings
  kinds: DocumentKind[]
  tags: { name: string; mode: 'require' | 'exclude' }[]
  tagMatch: 'all' | 'any'
}

/** id = collections.id (zotero/eagle) | folder path string (obsidian). */
export interface NavNode {
  id: number | string
  name: string
  count: number
  /**
   * Stable cross-rebuild identifier for zotero/eagle collection nodes
   * (`collections.externalKey`). Raw `id` regenerates on rebuild, so saved views
   * persist this instead. Absent on obsidian folder nodes (their id is already a
   * stable path).
   */
  externalKey?: string
  children: NavNode[]
}

/**
 * A saved-view's persisted filter: the wire FilterSet with `collectionIds` (index-
 * internal, regenerated on rebuild) swapped for `collectionRefs` — stable
 * (sourceKey, externalKey) pairs that survive index rebuilds.
 */
export interface StoredFilter {
  sourceKeys?: SourceKey[]
  collectionRefs?: { sourceKey: SourceKey; key: string }[]
  folderPrefixes?: string[]
  // Slugs are rebuild-stable, so virtual collections persist verbatim (no ref mapping).
  virtualCollections?: string[]
  kinds?: DocumentKind[]
  tagsAll?: string[]
  tagsAny?: string[]
  tagsNone?: string[]
}

/** A named lens over the library — file payload (`views/<slug>.json`) plus its slug. */
export interface SavedView {
  slug: string
  name: string
  createdAt: string
  q?: string
  filter: StoredFilter
}

export interface NavData {
  kinds: { kind: string; count: number }[]
  sources: { key: string; status: string; documentCount: number; tree: NavNode[] }[]
  tags: { name: string; count: number }[]
  /**
   * Virtual (source-independent) collections. The wire payload carries slug/name/
   * count; the renderer mirror may carry `unresolvedCount` (refs in the file that
   * don't currently resolve to an indexed document) — surfaced when non-zero.
   */
  virtualCollections: { slug: string; name: string; count: number; unresolvedCount?: number }[]
}

/**
 * A virtual collection as returned by `astrolabe.collections.list()` — the dedicated
 * query that drives the rail section, the river membership popover, and chip labels.
 */
export interface VCollectionSummary {
  slug: string
  name: string
  count: number
  unresolvedCount: number
}

/** SearchHit minus snippet, plus modifiedAt. */
export interface BrowseHit {
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  /** Slugs of the virtual collections this document belongs to — drives the popover's checked state. */
  virtualCollections: string[]
  instances: { sourceKey: string; uri: string; filePath: string | null }[]
}

export interface BrowsePage {
  total: number
  hits: BrowseHit[]
}
