import { existsSync, readFileSync, readdirSync, statSync, type Stats } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { moduleLogger } from '../../lib/logger'
import { ensureWorkspace } from '../../lib/workspace'
import type { DocumentInput } from '../../index/upsert'
import type { Connector, ResolveResult, ScanResult, SyncContext } from '../types'
import { parseNote } from './parser'

/**
 * The Obsidian connector (runway step 8): a vault of markdown notes → documents.
 * Notes are file-identity, not content-identity — the same words in two files are two
 * notes — so unlike Zotero/Eagle there is NO content hash and NO cross-source join
 * (an intentional deviation, documented in the spec). Iron rules hold: imports no other
 * connector, and an absent/misconfigured vault dims this source only.
 *
 * The note BODY is indexed for FTS by riding the existing annotation → body pipeline:
 * each note contributes ONE synthetic annotation ({externalKey: '<relpath>#body'}) whose
 * text is the note body, so `refreshFtsRow` folds note content into the search index
 * (a documented Phase-1 deviation — a first-class `extractedText` column is Phase 2).
 *
 * Incremental: a max-mtime watermark cursor; files with mtime ≤ cursor are skipped.
 * The `watch()` contract member is finally consumed here (chokidar, debounced) — the
 * app decides when to act on the callback (registry wiring is the lead's).
 */

const log = moduleLogger('connector.obsidian')

/** Note body cap fed to FTS (extractedText column is Phase 2 — spec deviation). */
const BODY_LIMIT = 10_000
/** Coalesce a burst of vault writes into one onChange (Obsidian saves rapidly). */
const WATCH_DEBOUNCE_MS = 2000
const LAUNCH_HINT = 'set connectors.obsidian.vaultPath in ~/Astrolabe/.astrolabe/manifest.json'

export interface ObsidianConnectorOptions {
  /**
   * Override the vault path (tests inject a tmp vault). When omitted the path is read
   * from the workspace manifest (`connectors.obsidian.vaultPath`) at call time, so a
   * user editing the manifest takes effect without reconstruction.
   */
  vaultPath?: string | null
}

/** Read the configured vault path from the workspace manifest; null if unreadable/unset. */
function manifestVaultPath(): string | null {
  try {
    return ensureWorkspace().manifest.connectors?.obsidian?.vaultPath ?? null
  } catch (err) {
    log.warn({ err }, 'could not read workspace manifest for obsidian vault path')
    return null
  }
}

/** Recursively collect **\/*.md, skipping hidden dirs (.obsidian, .trash, dotfiles). */
function walkVault(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
    }
  }
  walk(root)
  return out
}

/** One note file → a DocumentInput (pure given its inputs; the fs read happens in scan). */
function buildDocument(args: {
  raw: string
  relPath: string
  filePath: string
  vaultName: string
  mtime: number
}): DocumentInput {
  const { raw, relPath, filePath, vaultName, mtime } = args
  const parsed = parseNote(raw)

  // obsidian://open wants the vault name and the vault-relative path WITHOUT the .md
  // extension, URL-encoded (encodeURIComponent turns '/' into %2F, which Obsidian accepts).
  const relNoMd = relPath.replace(/\.md$/i, '')
  const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relNoMd)}`

  const title = parsed.title ?? basename(relPath).replace(/\.md$/i, '')
  const body = parsed.body.slice(0, BODY_LIMIT)

  return {
    sourceKey: 'obsidian',
    externalKey: relPath,
    uri,
    title,
    kind: 'note',
    filePath,
    metaJson: JSON.stringify({ wikiLinks: parsed.wikiLinks, frontmatterKeys: parsed.frontmatterKeys }),
    modifiedAt: mtime,
    tags: parsed.tags,
    // The note body rides the annotation → FTS body pipeline (spec deviation).
    annotations:
      body.length > 0 ? [{ externalKey: `${relPath}#body`, type: 'note', text: body, modifiedAt: mtime }] : undefined,
  }
}

export function createObsidianConnector(options: ObsidianConnectorOptions = {}): Connector {
  // `undefined` means "not overridden → read the manifest"; an explicit null/string wins.
  const resolveVault = (): string | null =>
    options.vaultPath !== undefined ? options.vaultPath : manifestVaultPath()

  async function checkAvailable(): Promise<{ available: boolean; launchHint?: string }> {
    const vaultPath = resolveVault()
    if (vaultPath && existsSync(vaultPath) && statSync(vaultPath).isDirectory()) {
      return { available: true }
    }
    return { available: false, launchHint: LAUNCH_HINT }
  }

  async function scan(ctx: SyncContext): Promise<ScanResult> {
    const vaultPath = resolveVault()
    if (!vaultPath || !existsSync(vaultPath)) {
      // Contract: a throwing scan is the degrade signal for one source.
      throw new Error(`obsidian vault path missing or not found: ${vaultPath ?? '<unset>'}`)
    }
    const vaultName = basename(vaultPath)
    const cursorNum =
      ctx.cursor != null && Number.isFinite(Number(ctx.cursor)) ? Number(ctx.cursor) : null

    let maxMtime = cursorNum ?? 0
    let documentsUpserted = 0
    let annotationsUpserted = 0

    const files = walkVault(vaultPath)
    for (const filePath of files) {
      const mtime = Math.floor(statSync(filePath).mtimeMs)
      if (mtime > maxMtime) maxMtime = mtime
      if (cursorNum != null && mtime <= cursorNum) continue // watermark: unchanged file

      const relPath = relative(vaultPath, filePath).split(sep).join('/')
      const raw = readFileSync(filePath, 'utf8')
      const doc = buildDocument({ raw, relPath, filePath, vaultName, mtime })
      ctx.upsert.upsertDocument(doc)
      documentsUpserted++
      annotationsUpserted += doc.annotations?.length ?? 0
    }

    const cursor = files.length > 0 ? String(maxMtime) : ctx.cursor
    log.info({ vaultPath, scanned: files.length, documentsUpserted, cursor }, 'obsidian scan complete')
    return { cursor, documentsUpserted, annotationsUpserted }
  }

  async function resolve(uri: string): Promise<ResolveResult> {
    // obsidian:// deep links are opened by the OS via Obsidian's URI handler.
    return { uri }
  }

  function watch(onChange: () => void): () => void {
    const vaultPath = resolveVault()
    if (!vaultPath || !existsSync(vaultPath)) {
      log.warn('obsidian watch requested but no vault path is configured; watch is a no-op')
      return () => {}
    }
    // chokidar v5 dropped glob support: watch the dir, filter with an `ignored` matcher.
    const watcher = chokidarWatch(vaultPath, {
      ignoreInitial: true,
      persistent: true,
      ignored: (p: string, stats?: Stats): boolean => {
        const rel = relative(vaultPath, p)
        if (rel === '') return false // never ignore the vault root itself
        if (rel.split(sep).some((seg) => seg.startsWith('.'))) return true // .obsidian/.trash/dotfiles
        return stats?.isFile() === true && !p.endsWith('.md') // non-md files
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

  /** The vault dir is the protected surface (iCloud-Drive vaults are TCC-blocked). */
  async function accessProbePath(): Promise<string | null> {
    return resolveVault()
  }

  return { key: 'obsidian', checkAvailable, scan, resolve, watch, accessProbePath }
}

/** Default instance the registry wires in (runway step 8). */
export const obsidianConnector = createObsidianConnector()
