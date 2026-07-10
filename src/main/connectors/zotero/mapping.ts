import { join } from 'node:path'
import type { AnnotationInput, CollectionInput, DocumentInput } from '../../index/upsert'
import {
  zoteroCollectionSchema,
  zoteroItemSchema,
  type ZoteroCollection,
  type ZoteroItemData,
} from './client'

/**
 * PURE transforms: raw Zotero JSON → DocumentInput/CollectionInput (runway step 4).
 * No fs, no network — the scanner (index.ts) resolves file paths against disk and
 * hashes. Zotero delivers one flat item stream (regular items, attachments,
 * annotations, notes intermixed); this module reassembles the document tree.
 *
 * Document identity rule:
 *  - regular bibliographic item (journalArticle, book, …) → a document; its child
 *    PDF attachment supplies the file path + hosts the annotations.
 *  - a top-level attachment (attachment with no parentItem — an imported PDF with no
 *    bibliographic parent) → its OWN document.
 *  - child attachments, annotations, and notes are never documents on their own.
 * Annotations chain up: annotation.parentItem → attachment → (attachment.parentItem
 * → regular item, or the attachment itself when top-level).
 */

const SOURCE_KEY = 'zotero'
/** itemTypes that are structural, never standalone documents (notes land in step 8). */
const NON_DOCUMENT_TYPES = new Set(['annotation', 'note'])

export function zoteroSelectUri(itemKey: string): string {
  return `zotero://select/library/items/${itemKey}`
}

/** Page-anchored deep link into the reader (spec: provenance for annotation hits). */
export function zoteroOpenPdfUri(attachmentKey: string, pageLabel: string | null): string {
  const page = pageLabel ? `?page=${encodeURIComponent(pageLabel)}` : ''
  return `zotero://open-pdf/library/items/${attachmentKey}${page}`
}

function parseModifiedAt(dateModified: string | undefined): number {
  if (!dateModified) return 0
  const ms = Date.parse(dateModified)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Absolute path to an attachment's file, or null if unresolvable.
 *  - imported_file / imported_url (stored): <dataDir>/storage/<KEY>/<filename>
 *    (verified: every local attachment is imported_file living here).
 *  - linked_file: the absolute `path` field (not present in this library — handled
 *    from web-API parity, unverified locally).
 */
function resolveAttachmentPath(att: ZoteroItemData, dataDir: string): string | null {
  if (att.linkMode === 'linked_file' && att.path) return att.path
  if (att.filename) return join(dataDir, 'storage', att.key, att.filename)
  return null
}

function isPdf(att: ZoteroItemData): boolean {
  return att.contentType === 'application/pdf'
}

function mapAnnotation(ann: ZoteroItemData, attachmentKey: string): AnnotationInput {
  let position: unknown = null
  if (ann.annotationPosition) {
    try {
      position = JSON.parse(ann.annotationPosition)
    } catch {
      position = null
    }
  }
  return {
    externalKey: ann.key,
    type: ann.annotationType ?? 'highlight',
    text: ann.annotationText || null,
    comment: ann.annotationComment || null,
    pageLabel: ann.annotationPageLabel || null,
    color: ann.annotationColor || null,
    // Position json preserves the reader anchor plus the deep link needed to reopen
    // the PDF at this annotation — the document's own instance key is the top-level
    // item, so the attachment key would otherwise be lost.
    positionJson: JSON.stringify({
      attachmentKey,
      openPdfUri: zoteroOpenPdfUri(attachmentKey, ann.annotationPageLabel ?? null),
      position,
    }),
    modifiedAt: parseModifiedAt(ann.dateModified),
  }
}

export interface MapResult {
  documents: DocumentInput[]
  /** Rows that failed schema validation (malformed) and were skipped. */
  skipped: number
}

export function mapItemsToDocuments(rawItems: unknown[], opts: { dataDir: string }): MapResult {
  const items: ZoteroItemData[] = []
  let skipped = 0
  for (const raw of rawItems) {
    const parsed = zoteroItemSchema.safeParse(raw)
    if (parsed.success) items.push(parsed.data.data)
    else skipped++
  }

  const annotationsByAttachment = new Map<string, ZoteroItemData[]>()
  const childAttachmentsByParent = new Map<string, ZoteroItemData[]>()
  for (const d of items) {
    if (d.itemType === 'annotation' && d.parentItem) {
      const list = annotationsByAttachment.get(d.parentItem) ?? []
      list.push(d)
      annotationsByAttachment.set(d.parentItem, list)
    } else if (d.itemType === 'attachment' && d.parentItem) {
      const list = childAttachmentsByParent.get(d.parentItem) ?? []
      list.push(d)
      childAttachmentsByParent.set(d.parentItem, list)
    }
  }

  const documents: DocumentInput[] = []
  for (const d of items) {
    if (NON_DOCUMENT_TYPES.has(d.itemType)) continue
    if (d.itemType === 'attachment' && d.parentItem) continue // belongs to its parent

    const isTopLevelAttachment = d.itemType === 'attachment'
    const attachments = isTopLevelAttachment ? [d] : (childAttachmentsByParent.get(d.key) ?? [])

    const pdfAttachment = attachments.find(isPdf) ?? attachments[0]
    const annotations: AnnotationInput[] = []
    for (const att of attachments) {
      for (const ann of annotationsByAttachment.get(att.key) ?? []) {
        annotations.push(mapAnnotation(ann, att.key))
      }
    }

    documents.push({
      sourceKey: SOURCE_KEY,
      externalKey: d.key,
      uri: zoteroSelectUri(d.key),
      title: d.title || '(untitled)',
      kind: pdfAttachment && isPdf(pdfAttachment) ? 'pdf' : 'other',
      filePath: pdfAttachment ? resolveAttachmentPath(pdfAttachment, opts.dataDir) : null,
      modifiedAt: parseModifiedAt(d.dateModified),
      tags: d.tags.map((t) => t.tag),
      collectionKeys: d.collections,
      annotations: annotations.length > 0 ? annotations : undefined,
      metaJson: JSON.stringify({ itemType: d.itemType }),
    })
  }

  return { documents, skipped }
}

export function mapCollections(rawCollections: unknown[]): CollectionInput[] {
  const out: CollectionInput[] = []
  for (const raw of rawCollections) {
    const parsed = zoteroCollectionSchema.safeParse(raw)
    if (!parsed.success) continue
    out.push(toCollectionInput(parsed.data))
  }
  return out
}

function toCollectionInput(c: ZoteroCollection): CollectionInput {
  const parent = c.data.parentCollection
  return {
    externalKey: c.data.key,
    name: c.data.name,
    parentExternalKey: typeof parent === 'string' ? parent : null,
  }
}
