import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from './logger'

/**
 * Reading-state (docs/2026-07-13-r2-reader-reading-state-spec §1) — per-document reading exposure
 * as a first-party artifact, one JSON file per document at `<workspace>/.astrolabe/reading/
 * <contentSha256>.json` (views precedent: zod-validated, schemaVersion literal, atomic tmp+rename
 * write, invalid file → treated absent + warn). Keyed by CONTENT HASH, not documentId, so the same
 * PDF held in Eagle+Zotero accrues ONE state and a rebuild (which renumbers ids) never loses it.
 *
 * Honest framing (spec §upstream note): this measures ENGAGEMENT (dwell + visits + timestamps),
 * never comprehension. The shape is chosen to feed a forgetting curve (Track L).
 */
const log = moduleLogger('reading-state')

/** Per-page exposure. Timestamps are ISO strings on disk (the wire carries epoch-ms `at`). */
export const pageExposureSchema = z.object({
  dwellMs: z.number().int().min(0),
  visits: z.number().int().min(0),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
})
export type PageExposure = z.infer<typeof pageExposureSchema>

/** The on-disk payload = the wire `ReadingState` (spec §1) plus a `schemaVersion` literal. */
export const readingStateFileSchema = z.object({
  schemaVersion: z.literal(1),
  contentSha256: z.string(),
  pages: z.record(z.string(), pageExposureSchema), // key = String(pageIndex)
  finished: z.boolean(),
  finishedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
})
export type ReadingStateFile = z.infer<typeof readingStateFileSchema>

/** The wire shape the renderer mirrors (spec §1/§2): the file payload minus `schemaVersion`. */
export type ReadingState = Omit<ReadingStateFile, 'schemaVersion'>

// ── Frozen wire request schemas (spec §2) — kept WITH the module (views precedent), so the shared
// db-ipc file stays layer-free and carries only the channel names. ───────────────────────────────

const documentId = z.number().int().positive()

/** reading:get / the id half of every request — documentId is a positive int. */
export const readingGetRequestSchema = z.object({ documentId })
export type ReadingGetRequest = z.infer<typeof readingGetRequestSchema>

/** One dwell event off the renderer's tracker: a page, the accumulated in-view ms, and the wall
 *  clock (`at`, epoch ms). Bounds are the frozen contract — dwell 1..600_000 (a single page's
 *  un-flushed dwell is capped at 10 min renderer-side). */
export const readingEventSchema = z.object({
  pageIndex: z.number().int().min(0),
  dwellMs: z.number().int().min(1).max(600_000),
  at: z.number().int(),
})
export type ReadingEvent = z.infer<typeof readingEventSchema>

/** reading:record — a batch of 1..500 dwell events for one document. */
export const readingRecordRequestSchema = z.object({
  documentId,
  events: z.array(readingEventSchema).min(1).max(500),
})
export type ReadingRecordRequest = z.infer<typeof readingRecordRequestSchema>

/** reading:finish — set/clear the finished marker for one document. */
export const readingFinishRequestSchema = z.object({
  documentId,
  finished: z.boolean(),
})
export type ReadingFinishRequest = z.infer<typeof readingFinishRequestSchema>

/**
 * The merge accumulator (spec §1, TDD'd) — PURE. Dwell accumulates, visits increment once per
 * event, firstSeenAt keeps the earliest observation and lastSeenAt the latest (monotonic, order-
 * independent), updatedAt = `now`. `finished`/`finishedAt` are NEVER touched here — they change
 * only via the finish operation. `now` and each event's `at` are epoch ms; the stored timestamps
 * are ISO. Returns a new file — the input is not mutated.
 */
export function applyEvents(
  file: ReadingStateFile,
  events: ReadingEvent[],
  now: number,
): ReadingStateFile {
  const pages: Record<string, PageExposure> = { ...file.pages }
  for (const ev of events) {
    const key = String(ev.pageIndex)
    const atISO = new Date(ev.at).toISOString()
    const existing = pages[key]
    if (!existing) {
      pages[key] = { dwellMs: ev.dwellMs, visits: 1, firstSeenAt: atISO, lastSeenAt: atISO }
    } else {
      pages[key] = {
        dwellMs: existing.dwellMs + ev.dwellMs,
        visits: existing.visits + 1,
        firstSeenAt: ev.at < Date.parse(existing.firstSeenAt) ? atISO : existing.firstSeenAt,
        lastSeenAt: ev.at > Date.parse(existing.lastSeenAt) ? atISO : existing.lastSeenAt,
      }
    }
  }
  return { ...file, pages, updatedAt: new Date(now).toISOString() }
}

export interface ReadingStateApi {
  get: (raw: unknown) => ReadingState | null
  record: (raw: unknown) => ReadingState | null
  finish: (raw: unknown) => ReadingState | null
}

/**
 * `readingDir` is injected (the workspace's `.astrolabe/reading/`) so tests run against a tmp dir;
 * the `db` handle resolves documentId → contentSha256 (mirrors how vcollections/queries take the
 * drizzle db). The dir is created lazily on first write.
 */
export function createReadingStateApi(readingDir: string, db: Db): ReadingStateApi {
  const fileFor = (sha: string): string => join(readingDir, `${sha}.json`)

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
  function readState(sha: string): ReadingStateFile | null {
    const path = fileFor(sha)
    if (!existsSync(path)) return null
    try {
      return readingStateFileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
    } catch (err) {
      log.warn({ err, sha }, 'ignoring unreadable or invalid reading-state file')
      return null
    }
  }

  /** Atomic tmp + rename so a concurrent read never observes a half-written file (views precedent). */
  function writeState(file: ReadingStateFile): void {
    mkdirSync(readingDir, { recursive: true })
    const dest = fileFor(file.contentSha256)
    const tmp = `${dest}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
    renameSync(tmp, dest)
  }

  const emptyFile = (sha: string, now: number): ReadingStateFile => ({
    schemaVersion: 1,
    contentSha256: sha,
    pages: {},
    finished: false,
    finishedAt: null,
    updatedAt: new Date(now).toISOString(),
  })

  /** Strip the on-disk-only `schemaVersion` to the wire `ReadingState`. */
  const toWire = (file: ReadingStateFile): ReadingState => ({
    contentSha256: file.contentSha256,
    pages: file.pages,
    finished: file.finished,
    finishedAt: file.finishedAt,
    updatedAt: file.updatedAt,
  })

  function get(raw: unknown): ReadingState | null {
    const { documentId: id } = readingGetRequestSchema.parse(raw)
    const sha = hashFor(id)
    if (!sha) return null
    const file = readState(sha)
    return file ? toWire(file) : null
  }

  function record(raw: unknown): ReadingState | null {
    const req = readingRecordRequestSchema.parse(raw)
    const sha = hashFor(req.documentId)
    if (!sha) return null
    const now = Date.now()
    const next = applyEvents(readState(sha) ?? emptyFile(sha, now), req.events, now)
    writeState(next)
    return toWire(next)
  }

  function finish(raw: unknown): ReadingState | null {
    const req = readingFinishRequestSchema.parse(raw)
    const sha = hashFor(req.documentId)
    if (!sha) return null
    const now = Date.now()
    const nowISO = new Date(now).toISOString()
    const current = readState(sha) ?? emptyFile(sha, now)
    const next: ReadingStateFile = {
      ...current,
      finished: req.finished,
      finishedAt: req.finished ? nowISO : null,
      updatedAt: nowISO,
    }
    writeState(next)
    return toWire(next)
  }

  return { get, record, finish }
}
