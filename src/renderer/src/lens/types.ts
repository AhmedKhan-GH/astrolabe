/**
 * Library Navigator (Lens v1) shared types — mirror the `index:nav` / `index:browse`
 * wire contracts (docs/2026-07-10-library-navigator-spec.md). Kept renderer-local so
 * component tests never reach for the preload seam.
 */

export type SourceKey = 'zotero' | 'eagle' | 'obsidian' | 'goodnotes'
export type DocumentKind = 'pdf' | 'image' | 'note' | 'other'

/** The zotero↔eagle split as a facet (docs/2026-07-10-lens-presence-facet). Values are stable, so
 *  they persist and round-trip verbatim (no ref mapping like collections need). */
export type PresenceValue = 'both' | 'zotero-only' | 'eagle-only'

/** Human labels for the presence chips (rail + FilterBar). */
export const PRESENCE_LABELS: Record<PresenceValue, string> = {
  both: 'In both',
  'zotero-only': 'Zotero only',
  'eagle-only': 'Eagle only',
}

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
  presence?: PresenceValue[] // own AND-dimension over zotero/eagle instance existence
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
  presence: PresenceValue[] // AND-dimension; composes with scope/kinds/tags, never OR-ed into scope
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
  // Presence values are stable, so a saved view persists them verbatim (like virtualCollections).
  presence?: PresenceValue[]
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
  /** The three presence buckets (both / zotero-only / eagle-only) with document counts. */
  presence: { value: PresenceValue; count: number }[]
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
  instances: BrowseInstance[]
}

/**
 * One source instance of a document. `instanceId` (document_instances.id) is what the
 * `astro://doc/<id>` PDF protocol resolves — REQUIRED from the backend hydrate()
 * for the Canvas view to stream bytes (see report: integration point).
 */
export interface BrowseInstance {
  instanceId: number
  sourceKey: string
  uri: string
  filePath: string | null
  /**
   * Page-targetable `zotero://open-pdf/library/items/<key>` base (main builds it from the
   * instance's attachmentKey), or null. The Canvas appends the clicked page for a deep link
   * that lands on the page, not just the document.
   */
  openPdfUri: string | null
}

/**
 * Per-page annotation counts for one document (`index:page-annotations` wire contract).
 * pageIndex is 0-based (from `json_extract(position_json, '$.position.pageIndex')`); pages
 * with no annotations are simply absent. Drives the Canvas heat layer.
 */
export interface PageAnnotations {
  pages: { pageIndex: number; count: number }[]
}

export interface BrowsePage {
  total: number
  hits: BrowseHit[]
}

/**
 * The wiki-link graph for one document (`index:links` wire contract). Outlinks are the
 * `[[target]]` references this note makes — each resolved to an indexed document when the
 * target exists in the vault (documentId/instanceId/title/kind non-null), else left null
 * (a "not in vault" link). Backlinks are the notes that link TO this document (always
 * resolved — they exist because they were indexed). Drives NoteView's live links + backlinks.
 */
export interface DocumentLinks {
  outlinks: {
    targetName: string
    documentId: number | null
    title: string | null
    kind: string | null
    instanceId: number | null
  }[]
  backlinks: {
    documentId: number
    title: string
    kind: string
    instanceId: number
  }[]
}

/**
 * The Document Hub payload (`index:document` wire contract) — everything one document shows in
 * one round-trip: core, per-source instances, tags, virtual-collection memberships (slug+name),
 * the annotation summary (total + per-page counts), the zotero↔eagle presence, and backlinking
 * notes. Drives the DocumentHub panel; arrives as a prop so the panel stays pure/testable.
 */
export interface DocumentDetail {
  documentId: number
  title: string
  kind: string
  modifiedAt: number
  tags: string[]
  instances: BrowseInstance[]
  virtualCollections: { slug: string; name: string }[]
  annotations: { total: number; pages: { pageIndex: number; count: number }[] }
  /** 'none' = neither a zotero nor an eagle instance exists (e.g. an obsidian-only note). */
  presence: PresenceValue | 'none'
  backlinks: {
    documentId: number
    title: string
    kind: string
    instanceId: number
  }[]
}
