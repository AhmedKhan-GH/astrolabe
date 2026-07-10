import type { BrowseInstance } from './types'

/**
 * The minimal shape CanvasHost needs to open a document — satisfied by both a BrowseHit
 * (river) and a search ResultData, so the Canvas opens from either pane without forking
 * the model (docs/2026-07-10-canvas-view-spec).
 */
export interface CanvasHostHit {
  documentId: number
  title: string
  instances: BrowseInstance[]
}

/**
 * File-backed instances the Canvas can try to stream, zotero first (the annotation
 * workspace), then any other source with a file on disk. Pure so the ordering — and the
 * fallback CanvasHost walks when one instance fails to render — is unit-testable.
 */
export function canvasCandidates(instances: BrowseInstance[]): BrowseInstance[] {
  const withFile = instances.filter((i) => i.filePath)
  return [
    ...withFile.filter((i) => i.sourceKey === 'zotero'),
    ...withFile.filter((i) => i.sourceKey !== 'zotero'),
  ]
}
