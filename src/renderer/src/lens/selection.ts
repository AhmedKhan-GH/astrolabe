import type { LensSelection } from './types'

/**
 * Fold a single-dimension click into the current selection.
 *  - click-again toggles that dimension off,
 *  - a plain source and a collection/folder are mutually exclusive (a structural
 *    node already implies its source), and collection ⊥ folder by construction,
 *  - kind and tag compose freely with everything (AND).
 */
export function applySelection(current: LensSelection, partial: Partial<LensSelection>): LensSelection {
  const dim = Object.keys(partial)[0] as keyof LensSelection
  const value = partial[dim]
  const next: LensSelection = { ...current }

  if (current[dim] === value) {
    delete next[dim]
    return next
  }

  // @ts-expect-error single-dimension write; value matches its own key by construction
  next[dim] = value

  if (dim === 'sourceKey') {
    delete next.collectionId
    delete next.folderPrefix
  } else if (dim === 'collectionId') {
    delete next.sourceKey
    delete next.folderPrefix
  } else if (dim === 'folderPrefix') {
    delete next.sourceKey
    delete next.collectionId
  }
  return next
}
