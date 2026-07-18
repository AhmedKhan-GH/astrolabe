import { z } from 'zod'
import type { CollectionInput } from '../../index/upsert'
import type { LibraryDocumentInput } from '../types'

/**
 * Pure Eagle raw-JSON → index-input mapping (docs/03 Layer 2). Zero fs / zero network:
 * `resolveFilePath` only *computes* the on-disk path from the library layout — `scan()`
 * is what stats + hashes it. Keeping this pure is what lets the whole mapping (incl. the
 * folder tree and multi-membership) be fixture-driven.
 *
 * v2 (spine spec v2 §1): the connector no longer writes the index, so this emits
 * `LibraryDocumentInput` — no `sourceKey` (the connector key is fixed at 'eagle') and no
 * `libraryId` (sync resolves it from the library path). Every other field is v1-identical.
 *
 * VERIFIED against live Eagle 4.0.0 on 2026-07-09:
 *  - item file layout: <library>/images/<id>.info/<name>.<ext>
 *    (confirmed via GET /api/item/source → the source is exactly this join; the
 *    on-disk <name> is the item's `name` field verbatim, not slugified).
 *  - /item/list rows: { id, name, ext?, tags[], folders[] (folder ids), isDeleted,
 *    url, annotation, modificationTime, size, ... }. `ext` is absent for link/bookmark
 *    items → those are not file-backed (filePath null, kind 'other').
 *  - /folder/list & /library/info.folders nest via `children` (recursive).
 */

/** Image extensions Eagle stores as visual assets (kind 'image'); PDFs are documents. */
const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'heic', 'heif',
  'avif', 'ico', 'jfif', 'apng',
])

export function extToKind(ext: string | null | undefined): LibraryDocumentInput['kind'] {
  if (!ext) return 'other'
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'pdf'
  if (IMAGE_EXTS.has(e)) return 'image'
  return 'other'
}

/** A single Eagle item row. Lenient: unknown extra fields are ignored, not rejected. */
export const eagleItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  ext: z.string().optional(),
  tags: z.array(z.string()).default([]),
  folders: z.array(z.string()).default([]),
  isDeleted: z.boolean().optional().default(false),
  url: z.string().optional(),
  annotation: z.string().optional(),
  size: z.number().optional(),
  modificationTime: z.number(),
})
export type EagleItem = z.infer<typeof eagleItemSchema>

/** A folder node; children recurse. `z.lazy` so the type references itself. */
export interface EagleFolder {
  id: string
  name: string
  children?: EagleFolder[]
}
export const eagleFolderSchema: z.ZodType<EagleFolder> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    name: z.string(),
    children: z.array(eagleFolderSchema).optional(),
  }),
)

/** <library>/images/<id>.info/<name>.<ext>; null when the item is not file-backed. */
export function resolveFilePath(
  item: { id: string; name: string; ext?: string | null },
  libraryPath: string,
): string | null {
  if (!item.ext) return null
  return `${libraryPath}/images/${item.id}.info/${item.name}.${item.ext}`
}

/**
 * Flatten Eagle's nested folder tree into the flat CollectionInput list the upsert API
 * expects (it resolves parents in a second pass, so order is irrelevant). Malformed
 * nodes are dropped rather than throwing — a broken folder must not abort a scan.
 */
export function flattenFolders(rawFolders: unknown): CollectionInput[] {
  const out: CollectionInput[] = []
  const walk = (nodes: unknown, parentKey: string | null): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      const parsed = eagleFolderSchema.safeParse(node)
      if (!parsed.success) continue
      const f = parsed.data
      out.push({ externalKey: f.id, name: f.name, parentExternalKey: parentKey })
      if (f.children?.length) walk(f.children, f.id)
    }
  }
  walk(rawFolders, null)
  return out
}

/**
 * One validated Eagle item → a LibraryDocumentInput. `contentSha256` is intentionally
 * absent: hashing needs the filesystem and belongs to `scan()`. `modifiedAt` is the
 * item's `modificationTime` (the incremental watermark).
 */
export function mapItem(rawItem: unknown, libraryPath: string): LibraryDocumentInput {
  const item = eagleItemSchema.parse(rawItem)
  return buildDocument(item, libraryPath)
}

function buildDocument(item: EagleItem, libraryPath: string): LibraryDocumentInput {
  const meta = {
    ext: item.ext ?? null,
    size: item.size ?? null,
    url: item.url ?? '',
    annotation: item.annotation ?? '',
  }
  return {
    externalKey: item.id,
    uri: `eagle://item/${item.id}`,
    title: item.name,
    kind: extToKind(item.ext),
    filePath: resolveFilePath(item, libraryPath),
    metaJson: JSON.stringify(meta),
    modifiedAt: item.modificationTime,
    tags: item.tags,
    collectionKeys: item.folders,
  }
}

/**
 * Map a page (or the whole list) of raw item rows, skipping trashed items and any row
 * that fails validation. Returns only file-mappable LibraryDocumentInputs; `scan()` then
 * adds the content hash for those whose file exists on disk.
 */
export function mapItems(rawItems: unknown, libraryPath: string): LibraryDocumentInput[] {
  if (!Array.isArray(rawItems)) return []
  const out: LibraryDocumentInput[] = []
  for (const raw of rawItems) {
    const parsed = eagleItemSchema.safeParse(raw)
    if (!parsed.success) continue
    if (parsed.data.isDeleted) continue
    out.push(buildDocument(parsed.data, libraryPath))
  }
  return out
}
