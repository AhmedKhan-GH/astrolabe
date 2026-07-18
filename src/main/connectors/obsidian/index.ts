import { existsSync, readFileSync, readdirSync, statSync, type Stats } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { moduleLogger } from '../../lib/logger'
import { ensureWorkspace } from '../../lib/workspace'
import type {
  Connector,
  ConnectorScan,
  ConnectorScanContext,
  LibraryDocumentInput,
  LibraryScanResult,
} from '../types'
import { parseNote } from './parser'

/**
 * The Obsidian connector v2 (spine spec v2 §1–2): each configured vault is its
 * own LIBRARY (stableKey = the vault's absolute path), and one scan returns one
 * LibraryScanResult per vault that currently exists on disk. Notes are
 * file-identity, not content-identity — the same words in two files, or the same
 * relpath in two vaults, are two documents — so contentSha256 is always null and
 * there is NO cross-source hash join (an intentional deviation from Zotero/Eagle,
 * anchored in spec §1: mutable notes' identity is (library, relpath)). Iron rules
 * hold: imports no other connector; a missing vault dims only itself.
 *
 * Presence (spec §2, enforced by index/sync.ts): a configured vault whose dir has
 * vanished is simply OMITTED from the scan — sync marks its library dormant and
 * deletes nothing. The connector reports available while ANY vault is reachable.
 *
 * The note BODY rides the existing annotation → FTS body pipeline (quarried from
 * v1): each note contributes ONE synthetic annotation ({externalKey: '<relpath>#body'})
 * so refreshFtsRow folds note content into search — the same mechanism the Zotero
 * connector uses for annotation text. A first-class extractedText column is later work.
 *
 * Incremental: a per-vault max-mtime watermark cursor; files with mtime ≤ cursor are
 * skipped. The full relpath set (allExternalKeys, the removal-sweep ground truth) is
 * collected on EVERY scan regardless of the watermark — a deletion never advances any
 * mtime, so the sweep is the only path that observes it.
 */

const log = moduleLogger('connector.obsidian')

/** Note body cap fed to FTS (a first-class extractedText column is later work). */
const BODY_LIMIT = 10_000
/** Coalesce a burst of vault writes into one onChange (Obsidian saves rapidly). */
const WATCH_DEBOUNCE_MS = 2000
const LAUNCH_HINT = 'set connectors.obsidian.vaultPath in ~/Astrolabe/.astrolabe/manifest.json'

export interface ObsidianConnectorOptions {
  /**
   * Override the vault paths (tests inject tmp vaults). When omitted the single
   * `connectors.obsidian.vaultPath` is read from the workspace manifest at call
   * time and wrapped into a one-element list, so a manifest edit takes effect
   * without reconstruction. (The manifest's plural `vaults` form is orchestrator
   * work; this connector already accepts a list here.)
   */
  vaultPaths?: string[]
}

/** The configured vault path from the manifest, wrapped into a list; [] if unset/unreadable. */
function manifestVaultPaths(): string[] {
  try {
    const vaultPath = ensureWorkspace().manifest.connectors?.obsidian?.vaultPath
    return vaultPath ? [vaultPath] : []
  } catch (err) {
    log.warn({ err }, 'could not read workspace manifest for obsidian vault paths')
    return []
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

/** One note file → a LibraryDocumentInput (pure given its inputs; the fs read happens in scan). */
function buildDocument(args: {
  raw: string
  relPath: string
  filePath: string
  mtime: number
}): LibraryDocumentInput {
  const { raw, relPath, filePath, mtime } = args
  const parsed = parseNote(raw)

  // obsidian://open with `path=<absolute file path>`: the absolute-path form overrides
  // vault+file per Obsidian's URI docs and is verified working against the live vault (the
  // earlier `vault=`+`file=`+`%2F` form did not open nested notes reliably).
  const uri = `obsidian://open?path=${encodeURIComponent(filePath)}`

  const title = parsed.title ?? basename(relPath).replace(/\.md$/i, '')
  const body = parsed.body.slice(0, BODY_LIMIT)

  return {
    externalKey: relPath,
    uri,
    title,
    kind: 'note',
    filePath,
    // Mutable notes have no hash identity (spec §1): identity is (library, relpath).
    contentSha256: null,
    metaJson: JSON.stringify({ wikiLinks: parsed.wikiLinks, frontmatterKeys: parsed.frontmatterKeys }),
    modifiedAt: mtime,
    tags: parsed.tags,
    // Wiki-link targets, raw (alias/heading already stripped by the parser). Always
    // present (possibly empty) so upsert replaces this instance's link rows wholesale;
    // resolveLinks joins the targets to documents in a post-sync re-pass.
    links: parsed.wikiLinks,
    // The note body rides the annotation → FTS body pipeline (see module doc).
    annotations:
      body.length > 0 ? [{ externalKey: `${relPath}#body`, type: 'note', text: body, modifiedAt: mtime }] : undefined,
  }
}

/** Scan one existing vault into its LibraryScanResult (watermark + full key set). */
function scanVault(vaultPath: string, previousCursor: string | null): LibraryScanResult {
  const cursorNum =
    previousCursor != null && Number.isFinite(Number(previousCursor)) ? Number(previousCursor) : null

  let maxMtime = cursorNum ?? 0
  const files = walkVault(vaultPath)
  // The walk enumerates every .md, so the complete relpath set (the sweep ground truth)
  // is free — collected for EVERY file, not just the watermark-changed ones.
  const allExternalKeys: string[] = []
  const documents: LibraryDocumentInput[] = []

  for (const filePath of files) {
    const relPath = relative(vaultPath, filePath).split(sep).join('/')
    allExternalKeys.push(relPath)

    const mtime = Math.floor(statSync(filePath).mtimeMs)
    if (mtime > maxMtime) maxMtime = mtime
    if (cursorNum != null && mtime <= cursorNum) continue // watermark: unchanged file

    documents.push(buildDocument({ raw: readFileSync(filePath, 'utf8'), relPath, filePath, mtime }))
  }

  // Nothing changed past the watermark → unchanged:true (sync skips upserts but still
  // runs the sweep against allExternalKeys, so a deletion is still observed).
  const cursor = files.length > 0 ? String(maxMtime) : previousCursor
  log.info(
    { vaultPath, files: files.length, changed: documents.length, cursor },
    'obsidian vault scan complete',
  )
  return {
    stableKey: vaultPath,
    displayName: basename(vaultPath),
    cursor,
    unchanged: documents.length === 0,
    documents,
    collections: [],
    allExternalKeys,
  }
}

export function createObsidianConnector(options: ObsidianConnectorOptions = {}): Connector {
  // `undefined` means "not overridden → read the manifest"; an explicit list wins.
  const resolveVaults = (): string[] =>
    options.vaultPaths !== undefined ? options.vaultPaths : manifestVaultPaths()

  const existingVaults = (): string[] =>
    resolveVaults().filter((p) => existsSync(p) && statSync(p).isDirectory())

  async function checkAvailable(): Promise<{ available: boolean; launchHint?: string }> {
    // Available while ANY configured vault is reachable; individual missing vaults
    // are handled per-library by scan (omitted → sync marks that one dormant).
    return existingVaults().length > 0 ? { available: true } : { available: false, launchHint: LAUNCH_HINT }
  }

  async function scan(ctx: ConnectorScanContext): Promise<ConnectorScan> {
    // A configured-but-missing vault dir is simply omitted — sync marks its library
    // dormant and deletes nothing (spec §2). Only existing vaults are scanned.
    const libraries = existingVaults().map((vaultPath) =>
      scanVault(vaultPath, ctx.cursors.get(vaultPath) ?? null),
    )
    return { libraries }
  }

  function watch(onChange: () => void): () => void {
    const vaults = existingVaults()
    if (vaults.length === 0) {
      log.warn('obsidian watch requested but no vault is reachable; watch is a no-op')
      return () => {}
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    const trigger = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, WATCH_DEBOUNCE_MS)
    }

    // One watcher per vault; all share the single debounce so a burst across vaults
    // still coalesces into one onChange. chokidar v5 has no glob support — watch the
    // dir and filter with an `ignored` matcher (relative to THAT vault's root).
    const watchers = vaults.map((vaultPath) => {
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
      watcher.on('add', trigger).on('change', trigger).on('unlink', trigger)
      return watcher
    })

    return () => {
      if (timer) clearTimeout(timer)
      for (const w of watchers) void w.close()
    }
  }

  /** The permission probe surface: the first configured vault path (existing or not),
   *  or null when none is configured. iCloud-Drive vaults are TCC-blocked. */
  async function accessProbePath(): Promise<string | null> {
    return resolveVaults()[0] ?? null
  }

  return { key: 'obsidian', checkAvailable, scan, watch, accessProbePath }
}

/** Default instance the registry wires in. */
export const obsidianConnector = createObsidianConnector()
