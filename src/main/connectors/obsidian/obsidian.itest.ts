import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../../db'
import * as s from '../../db/schema'
import { createUpsertApi, type UpsertApi } from '../../index/upsert'
import { createIndexQueries, type IndexQueries } from '../../index/queries'
import { syncConnector } from '../../index/sync'
import { createObsidianConnector } from './index'

/**
 * Tier A integration: the Obsidian connector v2 driven end-to-end through the real
 * sync runner (syncConnector) against real SQLite + migrations + tmp vaults on disk.
 * We prove the spine-spec-v2 identity/presence rules for a MULTI-VAULT connector:
 *  - each vault is its own library (stableKey = vault path); the SAME relpath in two
 *    vaults is two documents (mutable notes: identity is (library, relpath), no hash join);
 *  - deleting a note file sweeps its instance within THAT vault only (library-scoped);
 *  - a vault dir that disappears is marked dormant with NOTHING deleted;
 * plus the core note behaviours quarried from v1 (hidden-dir exclusion, obsidian://
 * provenance, tag + body FTS, wiki-link rows, the mtime watermark).
 */

const FIXTURE_VAULT = fileURLToPath(new URL('./__fixtures__/vault', import.meta.url))

let dir: string
let handle: DbHandle
let upsert: UpsertApi
let queries: IndexQueries

/** Write a note at `rel` under `vaultPath`, creating parent dirs. */
function note(vaultPath: string, rel: string, body: string): void {
  const full = join(vaultPath, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, body)
}

/** A vault dir under the temp root, populated with the given notes. */
function makeVault(name: string, notes: Record<string, string>): string {
  const vaultPath = join(dir, name)
  mkdirSync(vaultPath, { recursive: true })
  for (const [rel, body] of Object.entries(notes)) note(vaultPath, rel, body)
  return vaultPath
}

/** All instance externalKeys for a given library stableKey (the vault path). */
function keysInLibrary(stableKey: string): string[] {
  const lib = handle.db.select().from(s.libraries).where(eq(s.libraries.stableKey, stableKey)).get()
  if (!lib) return []
  return handle.db
    .select({ k: s.documentInstances.externalKey })
    .from(s.documentInstances)
    .where(eq(s.documentInstances.libraryId, lib.id))
    .all()
    .map((r) => r.k)
    .sort()
}

function libraryRow(stableKey: string): s.Library | undefined {
  return handle.db.select().from(s.libraries).where(eq(s.libraries.stableKey, stableKey)).get()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-obsidian-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
  queries = createIndexQueries(handle.db)
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('obsidian v2 — multi-vault as multiple libraries', () => {
  it('scans two vaults as two libraries; the same relpath in each is two documents', async () => {
    const vaultA = makeVault('Alpha', {
      'note.md': 'Alpha-only note about #photosynthesis.\n',
      'shared.md': 'Shared relpath, but the Alpha copy.\n',
    })
    const vaultB = makeVault('Beta', {
      'shared.md': 'Shared relpath, but the Beta copy.\n',
    })

    const conn = createObsidianConnector({ vaultPaths: [vaultA, vaultB] })
    const outcome = await syncConnector(handle.db, upsert, conn)

    expect(outcome.status).toBe('ok')
    expect(outcome.libraries.map((l) => l.stableKey).sort()).toEqual([vaultA, vaultB].sort())

    // Two library rows, keyed by vault path, named by basename, both live.
    const libs = handle.db.select().from(s.libraries).all()
    expect(libs).toHaveLength(2)
    expect(libraryRow(vaultA)?.displayName).toBe('Alpha')
    expect(libraryRow(vaultB)?.displayName).toBe('Beta')
    expect(libs.every((l) => l.availability === 'live')).toBe(true)

    // 3 instances → 3 documents (no content hash means no cross-library merge).
    expect(handle.db.select().from(s.documentInstances).all()).toHaveLength(3)
    expect(handle.db.select().from(s.documents).all()).toHaveLength(3)

    // 'shared.md' exists once per vault: two instances, two DISTINCT documents.
    const sharedInstances = handle.db
      .select()
      .from(s.documentInstances)
      .where(eq(s.documentInstances.externalKey, 'shared.md'))
      .all()
    expect(sharedInstances).toHaveLength(2)
    expect(new Set(sharedInstances.map((i) => i.libraryId)).size).toBe(2)
    expect(new Set(sharedInstances.map((i) => i.documentId)).size).toBe(2)
  })
})

describe('obsidian v2 — library-scoped removal sweep', () => {
  it('deleting a note sweeps its instance in that vault only; other vaults untouched', async () => {
    const vaultA = makeVault('Alpha', {
      'keep.md': 'Alpha keeper.\n',
      'drop.md': 'Alpha note that will be deleted about #renormalization.\n',
    })
    const vaultB = makeVault('Beta', {
      'keep.md': 'Beta keeper (same relpath as Alpha, different library).\n',
    })

    const conn = createObsidianConnector({ vaultPaths: [vaultA, vaultB] })
    await syncConnector(handle.db, upsert, conn)
    expect(keysInLibrary(vaultA)).toEqual(['drop.md', 'keep.md'])
    expect(keysInLibrary(vaultB)).toEqual(['keep.md'])
    const documentsBefore = handle.db.select().from(s.documents).all().length // 3

    // Delete one note from Alpha, then re-sync (cursors read back from the db).
    rmSync(join(vaultA, 'drop.md'))
    const outcome = await syncConnector(handle.db, upsert, conn)

    // Alpha's instance is swept; Beta's identically-named library is untouched.
    expect(keysInLibrary(vaultA)).toEqual(['keep.md'])
    expect(keysInLibrary(vaultB)).toEqual(['keep.md'])
    const alpha = outcome.libraries.find((l) => l.stableKey === vaultA)
    expect(alpha?.removed).toBe(1)

    // Documents are permanent (spec §2): drop.md's document survives as a ghost.
    expect(handle.db.select().from(s.documents).all()).toHaveLength(documentsBefore)
    expect(queries.indexStats().ghosts).toBe(1)
  })
})

describe('obsidian v2 — a vanished vault goes dormant, deletes nothing', () => {
  it('marks the missing vault dormant while the surviving vault stays live', async () => {
    const vaultA = makeVault('Alpha', { 'a.md': 'Alpha content.\n' })
    const vaultB = makeVault('Beta', { 'b.md': 'Beta content about #chloroplasts.\n' })

    const conn = createObsidianConnector({ vaultPaths: [vaultA, vaultB] })
    await syncConnector(handle.db, upsert, conn)
    expect(libraryRow(vaultA)?.availability).toBe('live')
    expect(libraryRow(vaultB)?.availability).toBe('live')

    // Beta's dir disappears entirely (unmounted vault); re-sync.
    rmSync(vaultB, { recursive: true, force: true })
    const outcome = await syncConnector(handle.db, upsert, conn)

    // Connector still available (Alpha reachable) → not degraded; only Beta dormant.
    expect(outcome.status).toBe('ok')
    expect(libraryRow(vaultA)?.availability).toBe('live')
    expect(libraryRow(vaultB)?.availability).toBe('dormant')

    // Nothing under Beta was deleted — its instance and document are intact.
    expect(keysInLibrary(vaultB)).toEqual(['b.md'])
    const snap = queries.librariesSnapshot()
    expect(snap.libraries.find((l) => l.stableKey === vaultB)?.documentCount).toBe(1)
  })
})

describe('obsidian v2 — core note behaviours (single vault, quarried from v1)', () => {
  let vaultPath: string
  beforeEach(() => {
    vaultPath = join(dir, 'FixtureVault')
    cpSync(FIXTURE_VAULT, vaultPath, { recursive: true })
  })

  it('indexes every .md as a note document, skipping hidden dirs (.obsidian/.trash)', async () => {
    await syncConnector(handle.db, upsert, createObsidianConnector({ vaultPaths: [vaultPath] }))

    // 5 notes; .obsidian/app.json and .trash/old.md are NOT indexed.
    const docs = handle.db.select().from(s.documents).all()
    expect(docs).toHaveLength(5)
    expect(docs.every((d) => d.kind === 'note')).toBe(true)
    expect(docs.every((d) => d.contentSha256 === null)).toBe(true)
    // The trashed note (#gone / "deleted note") is absent from the index.
    expect(queries.search({ q: 'deleted' })).toHaveLength(0)
  })

  it('exposes obsidian://open?path= provenance (encoded absolute path), incl. nested', async () => {
    await syncConnector(handle.db, upsert, createObsidianConnector({ vaultPaths: [vaultPath] }))

    const hits = queries.search({ q: 'Reading List' }) // wikilinks.md frontmatter title
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('note')
    expect(hits[0]?.instances[0]?.uri).toBe(
      `obsidian://open?path=${encodeURIComponent(join(vaultPath, 'wikilinks.md'))}`,
    )

    const nested = queries.search({ q: 'recursive vault walking' })
    expect(nested[0]?.instances[0]?.uri).toBe(
      `obsidian://open?path=${encodeURIComponent(join(vaultPath, 'projects/nested-note.md'))}`,
    )
  })

  it('folds tags onto the document and makes note BODY searchable via FTS', async () => {
    await syncConnector(handle.db, upsert, createObsidianConnector({ vaultPaths: [vaultPath] }))

    const byTag = queries.search({ q: 'physics' }) // frontmatter tag → FTS tags column
    expect(byTag).toHaveLength(1)
    expect(byTag[0]?.tags).toEqual(
      expect.arrayContaining(['physics', 'quantum', 'field-theory', 'renormalization']),
    )

    // "coupling constants" appears only in the BODY of frontmatter-tags.md.
    const byBody = queries.search({ q: 'coupling constants' })
    expect(byBody).toHaveLength(1)
    expect(byBody[0]?.title).toBe('Quantum Field Theory Notes')
  })

  it('emits a link row per wiki-link target, deduped, alias/heading stripped', async () => {
    await syncConnector(handle.db, upsert, createObsidianConnector({ vaultPaths: [vaultPath] }))

    const lib = libraryRow(vaultPath)!
    const instance = handle.db
      .select()
      .from(s.documentInstances)
      .where(
        and(eq(s.documentInstances.libraryId, lib.id), eq(s.documentInstances.externalKey, 'wikilinks.md')),
      )
      .get()!
    const rows = handle.db
      .select({ targetName: s.links.targetName, targetDocumentId: s.links.targetDocumentId })
      .from(s.links)
      .where(eq(s.links.sourceInstanceId, instance.id))
      .orderBy(s.links.id)
      .all()
    expect(rows).toEqual([
      { targetName: 'Deep Learning', targetDocumentId: null },
      { targetName: 'Attention Is All You Need', targetDocumentId: null },
      { targetName: 'Neural Networks', targetDocumentId: null },
      { targetName: 'architecture-diagram.png', targetDocumentId: null },
    ])
  })

  it('the mtime watermark skips unchanged files on re-sync', async () => {
    const conn = createObsidianConnector({ vaultPaths: [vaultPath] })
    await syncConnector(handle.db, upsert, conn)
    const second = await syncConnector(handle.db, upsert, conn)

    const lib = second.libraries.find((l) => l.stableKey === vaultPath)
    expect(lib?.unchanged).toBe(true)
    expect(lib?.documentsUpserted).toBe(0)
    expect(lib?.removed).toBe(0) // no deletions → nothing swept
  })
})

describe('obsidian v2 — rename hint (identity hardening 1, spec §1)', () => {
  it('emits sha256-of-content renameHint on every note and persists it in instance metaJson', async () => {
    const body = 'A note whose content fingerprints it.\n'
    const vaultPath = makeVault('Hinted', { 'note.md': body })
    const expected = createHash('sha256').update(body).digest('hex')

    const conn = createObsidianConnector({ vaultPaths: [vaultPath] })

    // The scan payload carries the content hint on the document itself.
    const scan = await conn.scan({ cursors: new Map() })
    const doc = scan.libraries[0]?.documents.find((d) => d.externalKey === 'note.md')
    expect(doc?.renameHint).toBe(expected)

    // …and after sync it is persisted in the instance's metaJson (sync reads OLD
    // hints from here), merged with the connector's other metaJson keys.
    await syncConnector(handle.db, upsert, conn)
    const lib = libraryRow(vaultPath)!
    const inst = handle.db
      .select()
      .from(s.documentInstances)
      .where(
        and(eq(s.documentInstances.libraryId, lib.id), eq(s.documentInstances.externalKey, 'note.md')),
      )
      .get()!
    const meta = JSON.parse(inst.metaJson!) as { renameHint?: string; wikiLinks?: unknown }
    expect(meta.renameHint).toBe(expected)
    expect(meta).toHaveProperty('wikiLinks') // merged, not clobbered
  })
})

describe('obsidian v2 — manifest-driven plural resolution (spec §A)', () => {
  it('reads connectors.obsidian.vaultPaths from the manifest → two libraries', async () => {
    // Two real vaults on disk; the manifest points a plural vaultPaths at both.
    const vaultA = makeVault('Research', { 'r.md': 'Research note about #optics.\n' })
    const vaultB = makeVault('Personal', { 'p.md': 'Personal note about #travel.\n' })

    // A tmp workspace whose manifest carries the plural form; ASTROLABE_WORKSPACE
    // points ensureWorkspace() at it (no injected vaultPaths → manifest is read).
    const wsRoot = join(dir, 'ws')
    const astroDir = join(wsRoot, '.astrolabe')
    mkdirSync(astroDir, { recursive: true })
    writeFileSync(
      join(astroDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: randomUUID(),
        createdAt: new Date().toISOString(),
        // A trailing slash on one path proves normalize+dedupe on the manifest path too.
        connectors: { obsidian: { vaultPaths: [`${vaultA}/`, vaultB] } },
      }),
    )

    const savedEnv = process.env['ASTROLABE_WORKSPACE']
    process.env['ASTROLABE_WORKSPACE'] = wsRoot
    try {
      // No options → the connector resolves vaults from the manifest at scan time.
      const outcome = await syncConnector(handle.db, upsert, createObsidianConnector())
      expect(outcome.status).toBe('ok')
      expect(outcome.libraries.map((l) => l.stableKey).sort()).toEqual([vaultA, vaultB].sort())
      expect(libraryRow(vaultA)?.displayName).toBe('Research')
      expect(libraryRow(vaultB)?.displayName).toBe('Personal')
      expect(handle.db.select().from(s.libraries).all()).toHaveLength(2)
    } finally {
      if (savedEnv === undefined) delete process.env['ASTROLABE_WORKSPACE']
      else process.env['ASTROLABE_WORKSPACE'] = savedEnv
    }
  })
})

describe('obsidian v2 — availability & probe', () => {
  it('available while any vault exists; false when none do', async () => {
    const vaultA = makeVault('Alpha', { 'a.md': 'x\n' })
    expect(await createObsidianConnector({ vaultPaths: [vaultA, join(dir, 'nope')] }).checkAvailable()).toEqual({
      available: true,
    })

    const none = await createObsidianConnector({ vaultPaths: [join(dir, 'nope')] }).checkAvailable()
    expect(none.available).toBe(false)
    expect(none.launchHint).toContain('vaultPath')

    const empty = await createObsidianConnector({ vaultPaths: [] }).checkAvailable()
    expect(empty.available).toBe(false)
  })

  it('accessProbePath returns the first configured vault path (existing or not), else null', async () => {
    const first = join(dir, 'First')
    expect(await createObsidianConnector({ vaultPaths: [first, join(dir, 'Second')] }).accessProbePath!()).toBe(
      first,
    )
    expect(await createObsidianConnector({ vaultPaths: [] }).accessProbePath!()).toBeNull()
  })
})
