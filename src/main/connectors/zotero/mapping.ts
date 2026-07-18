import { join } from 'node:path'
import type { CollectionInput } from '../../index/upsert'
import type { AnnotationInput } from '../../index/upsert'
import type { LibraryDocumentInput } from '../types'
import {
  zoteroCollectionSchema,
  zoteroItemSchema,
  type ZoteroCollection,
  type ZoteroItemData,
} from './client'

/**
 * PURE transforms: raw Zotero JSON → LibraryDocumentInput/CollectionInput. No
 * fs, no network — the scanner (index.ts) resolves file paths against disk and
 * hashes. Zotero delivers one flat item stream (regular items, attachments,
 * annotations, notes intermixed); this module reassembles the document tree.
 *
 * v2: every URI is LIBRARY-SCOPE-AWARE. Zotero deep links address the personal
 * library as `zotero://…/library/…` and a group as `zotero://…/groups/<id>/…`;
 * the scope rides in as an argument and the ready-to-open `openPdfUri` base is
 * stored in metaJson (queries.ts reads it verbatim — the read path never
 * builds zotero URIs).
 *
 * Document identity rule (unchanged from v1):
 *  - regular bibliographic item → a document; its child PDF attachment
 *    supplies the file path + hosts the annotations.
 *  - a top-level attachment → its OWN document.
 *  - child attachments, annotations, and notes are never documents on their own.
 */

/** Which corpus the items came from — determines the deep-link path segment. */
export type ZoteroScope = { kind: 'personal' } | { kind: 'group'; groupId: number }

/** itemTypes that are structural, never standalone documents (notes: M2 era). */
const NON_DOCUMENT_TYPES = new Set(['annotation', 'note'])

/** 'library' for the personal library, 'groups/<id>' for a group. */
function scopeSegment(scope: ZoteroScope): string {
  return scope.kind === 'personal' ? 'library' : `groups/${scope.groupId}`
}

export function zoteroSelectUri(scope: ZoteroScope, itemKey: string): string {
  return `zotero://select/${scopeSegment(scope)}/items/${itemKey}`
}

/** Page-targetable open-pdf base; the renderer appends `?page=` when deep-linking. */
export function zoteroOpenPdfUri(scope: ZoteroScope, attachmentKey: string, pageLabel: string | null): string {
  const page = pageLabel ? `?page=${encodeURIComponent(pageLabel)}` : ''
  return `zotero://open-pdf/${scopeSegment(scope)}/items/${attachmentKey}${page}`
}

function parseModifiedAt(dateModified: string | undefined): number {
  if (!dateModified) return 0
  const ms = Date.parse(dateModified)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Absolute path to an attachment's file, or null if unresolvable.
 *  - imported_file / imported_url (stored): <dataDir>/storage/<KEY>/<filename>
 *    (group attachments live in the same per-profile storage pool).
 *  - linked_file: the absolute `path` field.
 */
function resolveAttachmentPath(att: ZoteroItemData, dataDir: string): string | null {
  if (att.linkMode === 'linked_file' && att.path) return att.path
  if (att.filename) return join(dataDir, 'storage', att.key, att.filename)
  return null
}

function isPdf(att: ZoteroItemData): boolean {
  return att.contentType === 'application/pdf'
}

function mapAnnotation(ann: ZoteroItemData, attachmentKey: string, scope: ZoteroScope): AnnotationInput {
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
    // Position json preserves the reader anchor plus the deep link needed to
    // reopen the PDF at this annotation — the document's own instance key is
    // the top-level item, so the attachment key would otherwise be lost.
    positionJson: JSON.stringify({
      attachmentKey,
      openPdfUri: zoteroOpenPdfUri(scope, attachmentKey, ann.annotationPageLabel ?? null),
      position,
    }),
    modifiedAt: parseModifiedAt(ann.dateModified),
  }
}

export interface MapResult {
  documents: LibraryDocumentInput[]
  /** Rows that failed schema validation (malformed) and were skipped. */
  skipped: number
}

export function mapItemsToDocuments(
  rawItems: unknown[],
  opts: { dataDir: string; scope: ZoteroScope },
): MapResult {
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

  const documents: LibraryDocumentInput[] = []
  for (const d of items) {
    if (NON_DOCUMENT_TYPES.has(d.itemType)) continue
    if (d.itemType === 'attachment' && d.parentItem) continue // belongs to its parent

    const isTopLevelAttachment = d.itemType === 'attachment'
    const attachments = isTopLevelAttachment ? [d] : (childAttachmentsByParent.get(d.key) ?? [])

    const pdfAttachment = attachments.find(isPdf) ?? attachments[0]
    const annotations: AnnotationInput[] = []
    for (const att of attachments) {
      for (const ann of annotationsByAttachment.get(att.key) ?? []) {
        annotations.push(mapAnnotation(ann, att.key, opts.scope))
      }
    }

    const hasPdf = pdfAttachment != null && isPdf(pdfAttachment)
    documents.push({
      externalKey: d.key,
      uri: zoteroSelectUri(opts.scope, d.key),
      title: d.title || '(untitled)',
      kind: hasPdf ? 'pdf' : 'other',
      filePath: pdfAttachment ? resolveAttachmentPath(pdfAttachment, opts.dataDir) : null,
      modifiedAt: parseModifiedAt(d.dateModified),
      tags: d.tags.map((t) => t.tag),
      collectionKeys: d.collections,
      annotations: annotations.length > 0 ? annotations : undefined,
      // The instance metaJson carries the ready-to-open pdf link (scope-aware,
      // built HERE — the read path never constructs zotero URIs) plus the raw
      // attachmentKey for the write-back era (M6).
      metaJson: JSON.stringify({
        itemType: d.itemType,
        ...(hasPdf
          ? {
              attachmentKey: pdfAttachment.key,
              openPdfUri: zoteroOpenPdfUri(opts.scope, pdfAttachment.key, null),
            }
          : {}),
      }),
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
