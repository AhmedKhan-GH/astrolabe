import { join } from 'node:path'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { filterSetSchema } from '../index/queries'
import { deleteViewRequestSchema } from '../../shared/db-ipc'
import { moduleLogger } from './logger'
import { slugify as slugifyBase } from './slug'

/**
 * Saved views (docs/2026-07-10-lens-saved-views-spec) — the first first-party artifact: a named
 * lens over the library. One JSON file per view at `<workspace>/.astrolabe/views/<slug>.json`, so
 * views ride the user's file-sync, survive index rebuilds by construction, and stay hand-editable.
 * A user artifact, not index data — hence a file, not a table.
 */
const log = moduleLogger('views')

/**
 * The persisted FilterSet: the live `filterSetSchema` MINUS `collectionIds` (raw `collections.id`
 * is index-internal and regenerates on rebuild — it must never enter a durable file), PLUS
 * `collectionRefs`, the rebuild-stable `{sourceKey, key}` pairs (`key` is `collections.externalKey`,
 * unique per source). Tag boolean state (all/any/none) round-trips losslessly through the FilterSet
 * itself, so no renderer-model fields are persisted. `.omit`/`.extend` keep this a single source of
 * truth over the filter shape — no field is re-typed here.
 */
export const storedFilterSchema = filterSetSchema.omit({ collectionIds: true }).extend({
  collectionRefs: z
    .array(
      z.object({
        sourceKey: z.enum(['zotero', 'eagle', 'obsidian', 'goodnotes']),
        key: z.string().max(200),
      }),
    )
    .max(100)
    .optional(),
})
export type StoredFilter = z.infer<typeof storedFilterSchema>

/** The on-disk view payload (spec §Storage). `createdAt` is ISO; `q` composes as the live lens. */
export const savedViewFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
  q: z.string().max(500).optional(),
  filter: storedFilterSchema,
})
export type SavedViewFile = z.infer<typeof savedViewFileSchema>

/** A SavedView is the file payload plus its `slug` (the file identity + upsert key). */
export interface SavedView extends SavedViewFile {
  slug: string
}

/** The save request (spec §Wire): the slug is derived server-side, so it is not part of the input.
 *  `schemaVersion`/`createdAt` are set by `save`, so the request is the file schema minus those. */
export const saveViewRequestSchema = savedViewFileSchema.omit({ schemaVersion: true, createdAt: true })
export type SaveViewRequest = z.infer<typeof saveViewRequestSchema>

/** Views' slug is the shared `slugify` bound to a `view` empty-guard fallback. Re-exported so
 *  this module's surface stays stable after the extraction to `./slug` (spec §Architecture). */
export const slugify = (name: string): string => slugifyBase(name, 'view')

export interface ViewsApi {
  list: () => SavedView[]
  save: (raw: unknown) => SavedView
  remove: (raw: unknown) => boolean
}

/**
 * `viewsDir` is injected (the workspace's `.astrolabe/views/`) so tests run against a tmp dir.
 * The dir is created lazily on first save — a library with no views has no directory to read.
 */
export function createViewsApi(viewsDir: string): ViewsApi {
  const fileFor = (slug: string): string => join(viewsDir, `${slug}.json`)

  /** Every valid view, name-sorted. A corrupt or schema-violating file is skipped with a warn,
   *  never fatal — a hand-edit gone wrong must not take down the rail (spec §Wire contract). */
  function list(): SavedView[] {
    let names: string[]
    try {
      names = readdirSync(viewsDir)
    } catch {
      return [] // dir absent (no view saved yet) — an empty rail, not an error
    }
    const views: SavedView[] = []
    for (const file of names) {
      if (!file.endsWith('.json')) continue
      const path = join(viewsDir, file)
      try {
        const parsed = savedViewFileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
        views.push({ ...parsed, slug: file.slice(0, -'.json'.length) })
      } catch (err) {
        log.warn({ err, file }, 'skipping unreadable or invalid view file')
      }
    }
    return views.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Upsert by slug: writing to `<slug>.json` overwrites any same-slug view. Atomic (tmp + rename)
   *  so a concurrent list never observes a half-written file. Zod validates at the boundary — a raw
   *  `collections.id` in the filter is dropped here, never persisted. */
  function save(raw: unknown): SavedView {
    const req = saveViewRequestSchema.parse(raw)
    const slug = slugify(req.name)
    const file: SavedViewFile = savedViewFileSchema.parse({
      schemaVersion: 1,
      name: req.name,
      createdAt: new Date().toISOString(),
      ...(req.q !== undefined ? { q: req.q } : {}),
      filter: req.filter,
    })
    mkdirSync(viewsDir, { recursive: true })
    const dest = fileFor(slug)
    const tmp = `${dest}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
    renameSync(tmp, dest)
    return { ...file, slug }
  }

  /** Delete by slug; reports whether a file existed (drives the renderer's optimistic removal). */
  function remove(raw: unknown): boolean {
    const { slug } = deleteViewRequestSchema.parse(raw)
    try {
      rmSync(fileFor(slug))
      return true
    } catch {
      return false // already gone — deletion is idempotent from the caller's view
    }
  }

  return { list, save, remove }
}
