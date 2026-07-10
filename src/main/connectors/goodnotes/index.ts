import { existsSync, readdirSync, statSync, type Stats } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { sha256File } from '../../lib/hash'
import { moduleLogger } from '../../lib/logger'
import { ensureWorkspace } from '../../lib/workspace'
import type { DocumentInput } from '../../index/upsert'
import type { Connector, ResolveResult, ScanResult, SyncContext } from '../types'

/**
 * The GoodNotes connector (docs/2026-07-10-implementation-plan-notes-hub-ink §Step 3):
 * a folder of GoodNotes auto-backup PDFs → `pdf` documents. GoodNotes is a walled
 * garden with no external file API, but its auto-backup continuously exports every
 * notebook as a PDF to a cloud folder — that folder is the ingestion surface, and
 * GoodNotes stays the sole editor of the ink (no OCR in v1; that ships with the AI
 * layer). Every PDF is SHA-256'd, so a handwritten notebook already held elsewhere
 * (a scan filed into Eagle/Zotero) merges into ONE document (upsert.ts hash join) —
 * ink joins the library instead of forming a fourth island.
 *
 * Reference-in-place: filePath points at the backup PDF; nothing is copied into
 * `.astrolabe/` (the auto-backup IS the stable managed export — revisit a copy step
 * only if GoodNotes' rewrite churn proves disruptive). Iron rules hold: imports no
 * other connector; a missing/misconfigured backup folder dims THIS source only.
 *
 * Incremental: an mtime watermark cursor (files with mtime ≤ cursor are skipped),
 * mirroring the Obsidian connector.
 */

const log = moduleLogger('connector.goodnotes')

/** Coalesce a burst of backup writes into one onChange (GoodNotes rewrites in bursts). */
const WATCH_DEBOUNCE_MS = 2000
const LAUNCH_HINT = 'set connectors.goodnotes.backupPath in ~/Astrolabe/.astrolabe/manifest.json'

export interface GoodnotesConnectorOptions {
  /**
   * Override the backup folder (tests inject a tmp dir). When omitted the path is
   * read from the workspace manifest (`connectors.goodnotes.backupPath`) at call
   * time, so a user editing the manifest takes effect without reconstruction.
   */
  backupPath?: string | null
}

/** Read the configured backup path from the workspace manifest; null if unreadable/unset. */
function manifestBackupPath(): string | null {
  try {
    return ensureWorkspace().manifest.connectors?.goodnotes?.backupPath ?? null
  } catch (err) {
    log.warn({ err }, 'could not read workspace manifest for goodnotes backup path')
    return null
  }
}

/** Recursively collect **\/*.pdf, skipping hidden dirs (dotfiles, .Trash, etc.). */
function walkPdfs(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) out.push(full)
    }
  }
  walk(root)
  return out
}

/** One backup PDF → a DocumentInput (pure given its inputs; the fs read happens in scan). */
function buildDocument(args: { relPath: string; filePath: string; mtime: number }): DocumentInput {
  const { relPath, filePath, mtime } = args
  return {
    sourceKey: 'goodnotes',
    externalKey: relPath,
    // A provenance marker only: GoodNotes has no documented open-URI scheme, so the
    // document is opened via open-file / reveal (filePath), never by dispatching this uri.
    uri: `goodnotes://${relPath}`,
    title: basename(relPath).replace(/\.pdf$/i, ''),
    kind: 'pdf',
    // Reference in place — the auto-backup file is the stable managed export.
    filePath,
    modifiedAt: mtime,
  }
}

export function createGoodnotesConnector(options: GoodnotesConnectorOptions = {}): Connector {
  // `undefined` means "not overridden → read the manifest"; an explicit null/string wins.
  const resolveBackup = (): string | null =>
    options.backupPath !== undefined ? options.backupPath : manifestBackupPath()

  async function checkAvailable(): Promise<{ available: boolean; launchHint?: string }> {
    const backupPath = resolveBackup()
    if (backupPath && existsSync(backupPath) && statSync(backupPath).isDirectory()) {
      return { available: true }
    }
    return { available: false, launchHint: LAUNCH_HINT }
  }

  async function scan(ctx: SyncContext): Promise<ScanResult> {
    const backupPath = resolveBackup()
    if (!backupPath || !existsSync(backupPath)) {
      // Contract: a throwing scan is the degrade signal for one source.
      throw new Error(`goodnotes backup path missing or not found: ${backupPath ?? '<unset>'}`)
    }
    const cursorNum =
      ctx.cursor != null && Number.isFinite(Number(ctx.cursor)) ? Number(ctx.cursor) : null

    let maxMtime = cursorNum ?? 0
    let documentsUpserted = 0

    const files = walkPdfs(backupPath)
    for (const filePath of files) {
      const mtime = Math.floor(statSync(filePath).mtimeMs)
      if (mtime > maxMtime) maxMtime = mtime
      if (cursorNum != null && mtime <= cursorNum) continue // watermark: unchanged file

      const relPath = relative(backupPath, filePath).split(sep).join('/')
      const doc = buildDocument({ relPath, filePath, mtime })
      // The hash join: content SHA-256 merges a notebook already held in Eagle/Zotero
      // into one document. A missing/unreadable file degrades to no-join, never a crash.
      const contentSha256 = await sha256File(filePath).catch(() => null)
      ctx.upsert.upsertDocument(contentSha256 ? { ...doc, contentSha256 } : doc)
      documentsUpserted++
    }

    const cursor = files.length > 0 ? String(maxMtime) : ctx.cursor
    log.info({ backupPath, scanned: files.length, documentsUpserted, cursor }, 'goodnotes scan complete')
    return { cursor, documentsUpserted, annotationsUpserted: 0 }
  }

  async function resolve(uri: string): Promise<ResolveResult> {
    return { uri }
  }

  function watch(onChange: () => void): () => void {
    const backupPath = resolveBackup()
    if (!backupPath || !existsSync(backupPath)) {
      log.warn('goodnotes watch requested but no backup path is configured; watch is a no-op')
      return () => {}
    }
    // chokidar v5 dropped glob support: watch the dir, filter with an `ignored` matcher.
    const watcher = chokidarWatch(backupPath, {
      ignoreInitial: true,
      persistent: true,
      ignored: (p: string, stats?: Stats): boolean => {
        const rel = relative(backupPath, p)
        if (rel === '') return false // never ignore the backup root itself
        if (rel.split(sep).some((seg) => seg.startsWith('.'))) return true // dotfiles/.Trash
        return stats?.isFile() === true && !p.toLowerCase().endsWith('.pdf') // non-pdf files
      },
    })

    let timer: ReturnType<typeof setTimeout> | null = null
    const trigger = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, WATCH_DEBOUNCE_MS)
    }
    watcher.on('add', trigger).on('change', trigger).on('unlink', trigger)

    return () => {
      if (timer) clearTimeout(timer)
      void watcher.close()
    }
  }

  /** The backup dir is the protected surface (iCloud/Drive backup folders are TCC-blocked). */
  async function accessProbePath(): Promise<string | null> {
    return resolveBackup()
  }

  return { key: 'goodnotes', checkAvailable, scan, resolve, watch, accessProbePath }
}

/** Default instance the registry wires in. */
export const goodnotesConnector = createGoodnotesConnector()
