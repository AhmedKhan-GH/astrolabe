import type { LensSelection, FilterSet, SourceKey, DocumentKind } from './types'

/**
 * Pure selection algebra for the boolean-filtering lens. Dimensions compose with
 * AND; within a scope dimension values are a union. Tags carry per-name mode and
 * fold into tagsAll/tagsAny/tagsNone at the wire boundary (`toFilterSet`).
 */

type ScopeDim = 'sourceKeys' | 'collectionIds' | 'folderPrefixes'
type ScopeValue = SourceKey | number | string

export function emptySelection(): LensSelection {
  return { sourceKeys: [], collectionIds: [], folderPrefixes: [], kinds: [], tags: [], tagMatch: 'all' }
}

/** Toggle set membership in one scope dimension; other dimensions are untouched. */
export function toggleScope(sel: LensSelection, dim: ScopeDim, value: ScopeValue): LensSelection {
  const current = sel[dim] as ScopeValue[]
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return { ...sel, [dim]: next } as LensSelection
}

export function toggleKind(sel: LensSelection, kind: DocumentKind): LensSelection {
  const next = sel.kinds.includes(kind) ? sel.kinds.filter((k) => k !== kind) : [...sel.kinds, kind]
  return { ...sel, kinds: next }
}

/** neutral → require → exclude → neutral. */
export function cycleTag(sel: LensSelection, name: string): LensSelection {
  const existing = sel.tags.find((t) => t.name === name)
  if (!existing) return { ...sel, tags: [...sel.tags, { name, mode: 'require' }] }
  if (existing.mode === 'require')
    return { ...sel, tags: sel.tags.map((t) => (t.name === name ? { name, mode: 'exclude' } : t)) }
  return { ...sel, tags: sel.tags.filter((t) => t.name !== name) }
}

export function setTagMatch(sel: LensSelection, tagMatch: 'all' | 'any'): LensSelection {
  return { ...sel, tagMatch }
}

/** Drop a tag regardless of its mode — the FilterBar chip's one-click removal. */
export function removeTag(sel: LensSelection, name: string): LensSelection {
  return { ...sel, tags: sel.tags.filter((t) => t.name !== name) }
}

export function clearAll(): LensSelection {
  return emptySelection()
}

export function isEmpty(sel: LensSelection): boolean {
  return (
    sel.sourceKeys.length === 0 &&
    sel.collectionIds.length === 0 &&
    sel.folderPrefixes.length === 0 &&
    sel.kinds.length === 0 &&
    sel.tags.length === 0
  )
}

/** Serialize to the wire FilterSet; empty arrays are omitted so the payload stays minimal. */
export function toFilterSet(sel: LensSelection): FilterSet {
  const required = sel.tags.filter((t) => t.mode === 'require').map((t) => t.name)
  const excluded = sel.tags.filter((t) => t.mode === 'exclude').map((t) => t.name)
  const fs: FilterSet = {}
  if (sel.sourceKeys.length) fs.sourceKeys = sel.sourceKeys
  if (sel.collectionIds.length) fs.collectionIds = sel.collectionIds
  if (sel.folderPrefixes.length) fs.folderPrefixes = sel.folderPrefixes
  if (sel.kinds.length) fs.kinds = sel.kinds
  if (required.length) {
    if (sel.tagMatch === 'all') fs.tagsAll = required
    else fs.tagsAny = required
  }
  if (excluded.length) fs.tagsNone = excluded
  return fs
}
