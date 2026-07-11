import type { TransferDirection } from './types'

/**
 * The Eagle↔Zotero affordance rule (2026-07-11-eagle-zotero-sync-spec §Renderer), computed from a
 * hit/detail's own instances so the river, search rows, and the hub all decide identically:
 *
 *  - pdf + eagle-only + the eagle copy is file-backed → `to-zotero`
 *  - pdf + zotero-only + the zotero copy is file-backed → `to-eagle`
 *  - presence `both` / `none`, a non-pdf, or a source with no file on disk → null (no affordance)
 *
 * "eagle-only / zotero-only" is derived from the instances' source keys (the same Z/E rule the
 * presence facet uses): exactly one of the two library systems holds the document.
 */
export function transferDirection(
  kind: string,
  instances: { sourceKey: string; filePath: string | null }[],
): TransferDirection | null {
  if (kind !== 'pdf') return null
  const zotero = instances.find((i) => i.sourceKey === 'zotero')
  const eagle = instances.find((i) => i.sourceKey === 'eagle')
  const hasZ = zotero !== undefined
  const hasE = eagle !== undefined
  if (hasE && !hasZ && eagle.filePath) return 'to-zotero'
  if (hasZ && !hasE && zotero.filePath) return 'to-eagle'
  return null
}

/** The button label for a transfer direction (the target system, arrow-prefixed). */
export function transferLabel(direction: TransferDirection): string {
  return direction === 'to-zotero' ? '→ Zotero' : '→ Eagle'
}
