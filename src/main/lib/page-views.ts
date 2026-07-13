import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from './logger'
import { slugify as slugifyBase } from './slug'

/**
 * Page-range Views (docs/2026-07-13-r3-structure-views-spec §3) — the reading-state twin. A named
 * page selection over one document (iteration-1's crown jewel), persisted as one JSON file per
 * document at `<workspace>/.astrolabe/page-views/<contentSha256>.json` (views precedent: zod-
 * validated, schemaVersion literal, atomic tmp+rename write, invalid file → treated absent + warn).
 * Keyed by CONTENT HASH, not documentId, so the same PDF held in Eagle+Zotero accrues ONE set of
 * Views and a rebuild (which renumbers ids) never loses them.
 */
const log = moduleLogger('page-views')

/** Page-views' slug is the shared `slugify` bound to a `view` empty-guard fallback (views precedent
 *  — an all-punctuation/non-ascii name still yields a real basename, never a dotfile-ish `.json`). */
export const slugify = (name: string): string => slugifyBase(name, 'view')

/** One saved page-range View (spec §3). `pages` are 0-based pageIndexes, deduped + sorted server-
 *  side (1..5000 after dedup); `tocPaths` is the TOC-cover provenance it was created from. */
export const docPageViewSchema = z.object({
  slug: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  pages: z.array(z.number().int().min(0)).min(1).max(5000),
  tocPaths: z.array(z.string()).max(500).optional(),
  createdAt: z.iso.datetime(),
})
export type DocPageView = z.infer<typeof docPageViewSchema>

/** The on-disk payload = the wire `DocPageView[]` plus a `schemaVersion` literal and the hash it is
 *  keyed by. `views` are stored createdAt-ascending (the list order the wire returns). */
export const pageViewsFileSchema = z.object({
  schemaVersion: z.literal(1),
  contentSha256: z.string(),
  views: z.array(docPageViewSchema),
  updatedAt: z.iso.datetime(),
})
export type PageViewsFile = z.infer<typeof pageViewsFileSchema>

// ── Frozen wire request schemas (spec §3) — kept WITH the module (views/reading precedent), so the
// shared db-ipc file stays layer-free and carries only the channel names. ─────────────────────────

const documentId = z.number().int().positive()

/** page-views:list / the id half of every request — documentId is a positive int. */
export const pageViewsListRequestSchema = z.object({ documentId })
export type PageViewsListRequest = z.infer<typeof pageViewsListRequestSchema>

/** page-views:save — upsert a named page selection. `pages` may carry duplicates (max 5000 pre-
 *  dedup, min 1); the store dedups + sorts. `tocPaths` is optional provenance (max 500). The slug is
 *  derived server-side from `name`, so it is not part of the input. */
export const savePageViewRequestSchema = z.object({
  documentId,
  name: z.string().min(1).max(120),
  pages: z.array(z.number().int().min(0)).min(1).max(5000),
  tocPaths: z.array(z.string()).max(500).optional(),
})
export type SavePageViewRequest = z.infer<typeof savePageViewRequestSchema>

/** page-views:delete — a View is addressed by its slug (derived from its name). */
export const deletePageViewRequestSchema = z.object({
  documentId,
  slug: z.string().min(1).max(200),
})
export type DeletePageViewRequest = z.infer<typeof deletePageViewRequestSchema>

/** The dedup+sort rule (spec §3, TDD'd) — PURE. Pages are 0-based, ascending, unique. */
export function dedupeSortPages(pages: number[]): number[] {
  return [...new Set(pages)].sort((a, b) => a - b)
}

/**
 * The upsert accumulator (spec §3, TDD'd) — PURE. Derives the slug from `name`, dedups + sorts the
 * pages, then UPSERTS BY SLUG: a same-slug (same name) save replaces `pages`/`tocPaths` but KEEPS
 * the original `createdAt`; a new slug appends with `createdAt = now`. The result is sorted
 * createdAt-ascending (the wire list order). Returns a new array — the input is not mutated.
 */
export function upsertView(
  views: DocPageView[],
  req: { name: string; pages: number[]; tocPaths?: string[] },
  now: number,
): DocPageView[] {
  const slug = slugify(req.name)
  const existing = views.find((v) => v.slug === slug)
  const view: DocPageView = {
    slug,
    name: req.name,
    pages: dedupeSortPages(req.pages),
    ...(req.tocPaths !== undefined ? { tocPaths: req.tocPaths } : {}),
    createdAt: existing ? existing.createdAt : new Date(now).toISOString(),
  }
  return [...views.filter((v) => v.slug !== slug), view].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )
}

export interface PageViewsApi {
  list: (raw: unknown) => DocPageView[] | null
  save: (raw: unknown) => DocPageView[] | null
  remove: (raw: unknown) => DocPageView[] | null
}

/**
 * `pageViewsDir` is injected (the workspace's `.astrolabe/page-views/`) so tests run against a tmp
 * dir; the `db` handle resolves documentId → contentSha256 (mirrors reading-state). The dir is
 * created lazily on first write.
 */
export function createPageViewsApi(pageViewsDir: string, db: Db): PageViewsApi {
  const fileFor = (sha: string): string => join(pageViewsDir, `${sha}.json`)

  /** documentId → contentSha256, or null when the document is unknown OR carries no hash (an
   *  un-hashed instance, e.g. a note). Both cases are no-ops upstream — never a throw. */
  function hashFor(id: number): string | null {
    const doc = db
      .select({ contentSha256: s.documents.contentSha256 })
      .from(s.documents)
      .where(eq(s.documents.id, id))
      .get()
    return doc?.contentSha256 ?? null
  }

  /** The stored file, or null when absent. A present-but-corrupt/invalid file is treated as absent
   *  with a warn (a hand-edit gone wrong must not take down the reader — views precedent). */
  function readFile(sha: string): PageViewsFile | null {
    const path = fileFor(sha)
    if (!existsSync(path)) return null
    try {
      return pageViewsFileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
    } catch (err) {
      log.warn({ err, sha }, 'ignoring unreadable or invalid page-views file')
      return null
    }
  }

  /** Atomic tmp + rename so a concurrent read never observes a half-written file (views precedent). */
  function writeFileAtomic(file: PageViewsFile): void {
    mkdirSync(pageViewsDir, { recursive: true })
    const dest = fileFor(file.contentSha256)
    const tmp = `${dest}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
    renameSync(tmp, dest)
  }

  const emptyFile = (sha: string, now: number): PageViewsFile => ({
    schemaVersion: 1,
    contentSha256: sha,
    views: [],
    updatedAt: new Date(now).toISOString(),
  })

  function list(raw: unknown): DocPageView[] | null {
    const { documentId: id } = pageViewsListRequestSchema.parse(raw)
    const sha = hashFor(id)
    if (!sha) return null
    return readFile(sha)?.views ?? []
  }

  function save(raw: unknown): DocPageView[] | null {
    const req = savePageViewRequestSchema.parse(raw)
    const sha = hashFor(req.documentId)
    if (!sha) return null
    const now = Date.now()
    const current = readFile(sha) ?? emptyFile(sha, now)
    const next: PageViewsFile = pageViewsFileSchema.parse({
      ...current,
      views: upsertView(current.views, req, now),
      updatedAt: new Date(now).toISOString(),
    })
    writeFileAtomic(next)
    return next.views
  }

  function remove(raw: unknown): DocPageView[] | null {
    const req = deletePageViewRequestSchema.parse(raw)
    const sha = hashFor(req.documentId)
    if (!sha) return null
    const now = Date.now()
    const current = readFile(sha) ?? emptyFile(sha, now)
    const next: PageViewsFile = {
      ...current,
      views: current.views.filter((v) => v.slug !== req.slug),
      updatedAt: new Date(now).toISOString(),
    }
    writeFileAtomic(next)
    return next.views
  }

  return { list, save, remove }
}
