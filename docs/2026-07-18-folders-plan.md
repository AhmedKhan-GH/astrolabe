# Folders Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the folder primitive from `docs/2026-07-18-folders-spec.md` — nested, multi-membership, files-as-truth folders with a SQLite mirror, query integration, IPC surface, and the one-time Eagle seed import. Substrate only; no UI (the frame is a later phase).

**Architecture:** One JSON file per folder in `<workspace>/.astrolabe/folders/` is truth (views/reading-state precedent: zod-validated, atomic tmp+rename, invalid→absent+warn). Two derived tables (`folders`, `folder_members`) are rebuilt wholesale from the files and joined by the query layer. IPC mutates via the store, then re-mirrors. Import reads the already-synced `collections` tables — no new connector surface.

**Tech Stack:** TypeScript (strict, bundler resolution), zod 4, drizzle-orm + better-sqlite3, vitest (unit + Electron-as-node integration tiers), pnpm.

## Global Constraints

- Package manager is **pnpm** (settled decision; never introduce npm artifacts).
- **No new dependencies** — everything uses zod/drizzle/node built-ins already present.
- Gates for every commit: `pnpm typecheck && pnpm lint` clean, `pnpm test` green (currently 54 unit + 63 integration).
- Integration tests run via `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration <file>`; unit via `pnpm vitest run --project unit <file>`.
- File-store conventions copied from `src/main/lib/reading-state.ts` verbatim: `schemaVersion: z.literal(1)`, atomic `tmp+rename`, corrupt file → treated absent with `log.warn`, lazy `mkdirSync`.
- Commit messages: conventional (`feat(folders): …`), body explains the *why*, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Spec is authority: `docs/2026-07-18-folders-spec.md` (decisions D-A1…D-A6). On any conflict between this plan and the spec, the spec wins — flag it, don't improvise.
- No folder operation may ever write to a connector app or delete a `documents` row (ADR-0001, spec §3).

## File Structure

| File | Responsibility |
|---|---|
| `src/main/lib/folders.ts` | The store: schemas, pure rules (cycle guard, ref equality/dedupe, delete-reparent), file CRUD |
| `src/main/lib/folders.test.ts` | Unit: pure rules |
| `src/main/lib/folders.itest.ts` | Integration: file round-trips in a tmp dir |
| `src/main/db/schema.ts` | +`folders`, +`folderMembers` mirror tables |
| `drizzle/0003_*.sql` | Generated migration |
| `src/main/index/folder-mirror.ts` | `syncFolders(db, store)` — wholesale rebuild, ref resolution |
| `src/main/index/folder-mirror.itest.ts` | Integration: resolution, idempotency, wipe survival |
| `src/main/index/folder-import.ts` | `importLibraryTree(db, store, {libraryId, rootName?})` (D-A6) |
| `src/main/index/folder-import.itest.ts` | Integration: seeded tree, re-run isolation, skip counting |
| `src/main/index/queries.ts` | filterSet +`folderSlugs`/`includeSubfolders`/`uncategorized`; `folderTree()` |
| `src/main/index/queries.itest.ts` | Extended coverage |
| `src/shared/db-ipc.ts` | `FOLDERS_*` channels + layer-free request schemas |
| `src/main/index.ts` | Wire channels; re-mirror after boot/sync/mutations |
| `src/preload/index.ts` | `window.astrolabe.folders.*` |

---

### Task 1: Mirror tables + migration

**Files:**
- Modify: `src/main/db/schema.ts` (append after the `links` table block)
- Create: `drizzle/0003_*.sql` (generated — do not hand-write)

**Interfaces:**
- Consumes: existing `documents` table.
- Produces: `s.folders` (id, slug UNIQUE, name, parentId nullable self-ref SET NULL), `s.folderMembers` (folderId CASCADE, documentId CASCADE, unique(folderId, documentId)). Later tasks import these as `s.folders` / `s.folderMembers`.

- [ ] **Step 1: Add the tables to schema.ts**

```ts
/**
 * Folder mirror (docs/2026-07-18-folders-spec §4) — the derived join surface
 * for the files-as-truth folders in `.astrolabe/folders/`. Rebuilt WHOLESALE
 * from the files by syncFolders; row ids are NOT stable across rebuilds — the
 * slug is the only durable address. The mirror never writes files.
 */
export const folders = sqliteTable(
  'folders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    parentId: integer('parent_id'),
  },
  (t) => [index('folders_parent_idx').on(t.parentId)],
)
export type FolderRow = typeof folders.$inferSelect

export const folderMembers = sqliteTable(
  'folder_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    folderId: integer('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('folder_members_uq').on(t.folderId, t.documentId),
    index('folder_members_document_idx').on(t.documentId),
  ],
)
```

(Note: `parentId` is a plain nullable integer, not a foreign key — the mirror is rebuilt wholesale so referential integrity is the mirror-writer's job, and a self-referential FK complicates bulk insert order for nothing.)

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: `drizzle/0003_<name>.sql` created containing only `CREATE TABLE folders`, `CREATE TABLE folder_members`, and their three indexes. Read the file to confirm nothing else was diffed.

- [ ] **Step 3: Verify migrations still bring up a clean db**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/db/db.itest.ts`
Expected: `4 passed` (the itest runs all migrations including 0003).

- [ ] **Step 4: Gates + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git add src/main/db/schema.ts drizzle/
git commit -m "feat(db): folder mirror tables + migration 0003

Derived join surface for files-as-truth folders (folders spec §4). Slug is
the durable address; row ids are rebuild-local.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Folder store — pure rules (TDD)

**Files:**
- Create: `src/main/lib/folders.ts`
- Create: `src/main/lib/folders.test.ts`

**Interfaces:**
- Consumes: `slugify` from `src/main/lib/slug.ts` (signature: `slugify(name: string, fallback: string): string`), `moduleLogger` from `./logger`, zod.
- Produces (used by every later task):

```ts
export type FolderMemberRef = { sha256: string } | { library: string; key: string }
export interface FolderFile {
  schemaVersion: 1
  name: string
  parent: string | null // parent slug
  members: FolderMemberRef[]
}
export interface FolderRecord { slug: string; file: FolderFile }
export class FolderError extends Error {
  readonly code: 'NOT_FOUND' | 'CYCLE' | 'DUPLICATE' | 'BAD_PARENT'
}
// Pure helpers (exported for tests and reuse):
export function refsEqual(a: FolderMemberRef, b: FolderMemberRef): boolean
export function dedupeRefs(refs: FolderMemberRef[]): FolderMemberRef[]
export function wouldCycle(folders: Map<string, string | null>, slug: string, newParent: string | null): boolean
export function createFoldersStore(foldersDir: string): FoldersStore
export interface FoldersStore {
  list(): FolderRecord[]
  create(req: { name: string; parent?: string | null }): FolderRecord
  rename(slug: string, name: string): { record: FolderRecord; previousSlug: string }
  setParent(slug: string, parent: string | null): FolderRecord
  remove(slug: string): void // children re-parented to the removed folder's parent
  addMembers(slug: string, refs: FolderMemberRef[]): FolderRecord
  removeMembers(slug: string, refs: FolderMemberRef[]): FolderRecord
}
```

- [ ] **Step 1: Write the failing unit tests**

```ts
// src/main/lib/folders.test.ts
import { describe, it, expect } from 'vitest'
import { refsEqual, dedupeRefs, wouldCycle, type FolderMemberRef } from './folders'

/** Tier A unit: the pure rules of the folder primitive (spec §3) — ref
 *  equality across the two shapes, dedupe, and the nesting cycle guard. */
describe('refsEqual', () => {
  const h = (s: string): FolderMemberRef => ({ sha256: s })
  const p = (l: string, k: string): FolderMemberRef => ({ library: l, key: k })

  it('hash refs equal by sha256; path refs by (library, key); shapes never cross-equal', () => {
    expect(refsEqual(h('a'), h('a'))).toBe(true)
    expect(refsEqual(h('a'), h('b'))).toBe(false)
    expect(refsEqual(p('v', 'n.md'), p('v', 'n.md'))).toBe(true)
    expect(refsEqual(p('v', 'n.md'), p('v', 'other.md'))).toBe(false)
    expect(refsEqual(p('v', 'n.md'), p('w', 'n.md'))).toBe(false)
    expect(refsEqual(h('a'), p('v', 'a'))).toBe(false)
  })

  it('dedupeRefs keeps first occurrence, preserves order', () => {
    const refs = [h('a'), p('v', 'n.md'), h('a'), p('v', 'n.md'), h('b')]
    expect(dedupeRefs(refs)).toEqual([h('a'), p('v', 'n.md'), h('b')])
  })
})

describe('wouldCycle', () => {
  // tree: root → mid → leaf   (map: slug → parent slug)
  const tree = new Map<string, string | null>([
    ['root', null],
    ['mid', 'root'],
    ['leaf', 'mid'],
    ['other', null],
  ])

  it('self-parent is a cycle', () => {
    expect(wouldCycle(tree, 'root', 'root')).toBe(true)
  })
  it('parenting under own descendant is a cycle (deep)', () => {
    expect(wouldCycle(tree, 'root', 'leaf')).toBe(true)
  })
  it('parenting under an unrelated folder or null is fine', () => {
    expect(wouldCycle(tree, 'mid', 'other')).toBe(false)
    expect(wouldCycle(tree, 'leaf', null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit src/main/lib/folders.test.ts`
Expected: FAIL — `Cannot find module './folders'`.

- [ ] **Step 3: Implement the store (pure rules + file CRUD in one module)**

```ts
// src/main/lib/folders.ts
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { moduleLogger } from './logger'
import { slugify as slugifyBase } from './slug'

/**
 * Folders — the organization primitive (docs/2026-07-18-folders-spec). One
 * JSON file per folder under `<workspace>/.astrolabe/folders/`; files are
 * truth, the SQLite mirror (index/folder-mirror.ts) is derived. Store rules
 * (spec §3): nesting with a hard cycle guard, multi-membership with ref
 * dedupe, delete re-parents children, no operation ever touches documents.
 */
const log = moduleLogger('folders')

export const slugify = (name: string): string => slugifyBase(name, 'folder')

const hashRefSchema = z.object({ sha256: z.string().min(1) })
const pathRefSchema = z.object({ library: z.string().min(1), key: z.string().min(1) })
export const memberRefSchema = z.union([hashRefSchema, pathRefSchema])
export type FolderMemberRef = z.infer<typeof memberRefSchema>

export const folderFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  parent: z.string().min(1).max(200).nullable(),
  members: z.array(memberRefSchema),
})
export type FolderFile = z.infer<typeof folderFileSchema>
export interface FolderRecord { slug: string; file: FolderFile }

export class FolderError extends Error {
  readonly code: 'NOT_FOUND' | 'CYCLE' | 'DUPLICATE' | 'BAD_PARENT'
  constructor(message: string, code: FolderError['code']) {
    super(message)
    this.code = code
  }
}

/** Hash refs equal by sha256; path refs by (library, key); shapes never cross-equal. */
export function refsEqual(a: FolderMemberRef, b: FolderMemberRef): boolean {
  if ('sha256' in a && 'sha256' in b) return a.sha256 === b.sha256
  if ('library' in a && 'library' in b) return a.library === b.library && a.key === b.key
  return false
}

/** First occurrence wins; order preserved (spec §2 members are ordered-as-filed). */
export function dedupeRefs(refs: FolderMemberRef[]): FolderMemberRef[] {
  const out: FolderMemberRef[] = []
  for (const ref of refs) if (!out.some((r) => refsEqual(r, ref))) out.push(ref)
  return out
}

/** Would setting `slug`.parent = `newParent` create a cycle? Walk ancestors of
 *  newParent; hitting `slug` (or newParent === slug) is a cycle. `folders` maps
 *  slug → parent slug. */
export function wouldCycle(
  folders: Map<string, string | null>,
  slug: string,
  newParent: string | null,
): boolean {
  let cursor = newParent
  const seen = new Set<string>()
  while (cursor != null) {
    if (cursor === slug) return true
    if (seen.has(cursor)) return true // pre-existing corruption reads as cycle: refuse
    seen.add(cursor)
    cursor = folders.get(cursor) ?? null
  }
  return false
}

export interface FoldersStore {
  list(): FolderRecord[]
  create(req: { name: string; parent?: string | null }): FolderRecord
  rename(slug: string, name: string): { record: FolderRecord; previousSlug: string }
  setParent(slug: string, parent: string | null): FolderRecord
  remove(slug: string): void
  addMembers(slug: string, refs: FolderMemberRef[]): FolderRecord
  removeMembers(slug: string, refs: FolderMemberRef[]): FolderRecord
}

/** `foldersDir` injected (the workspace's `.astrolabe/folders/`) so tests run
 *  against tmp dirs — reading-state precedent throughout. */
export function createFoldersStore(foldersDir: string): FoldersStore {
  const fileFor = (slug: string): string => join(foldersDir, `${slug}.json`)

  function readOne(slug: string): FolderFile | null {
    const path = fileFor(slug)
    if (!existsSync(path)) return null
    try {
      return folderFileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
    } catch (err) {
      log.warn({ err, slug }, 'ignoring unreadable or invalid folder file')
      return null
    }
  }

  function writeOne(slug: string, file: FolderFile): void {
    mkdirSync(foldersDir, { recursive: true })
    const dest = fileFor(slug)
    const tmp = `${dest}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
    renameSync(tmp, dest)
  }

  function list(): FolderRecord[] {
    if (!existsSync(foldersDir)) return []
    const out: FolderRecord[] = []
    for (const entry of readdirSync(foldersDir)) {
      if (!entry.endsWith('.json')) continue
      const slug = entry.slice(0, -'.json'.length)
      const file = readOne(slug)
      if (file) out.push({ slug, file })
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug))
  }

  const parentMap = (records: FolderRecord[]): Map<string, string | null> =>
    new Map(records.map((r) => [r.slug, r.file.parent]))

  function mustRead(slug: string): FolderFile {
    const file = readOne(slug)
    if (!file) throw new FolderError(`no such folder: ${slug}`, 'NOT_FOUND')
    return file
  }

  function assertParentOk(records: FolderRecord[], slug: string, parent: string | null): void {
    if (parent == null) return
    if (!records.some((r) => r.slug === parent))
      throw new FolderError(`parent does not exist: ${parent}`, 'BAD_PARENT')
    if (wouldCycle(parentMap(records), slug, parent))
      throw new FolderError(`cycle: ${slug} → ${parent}`, 'CYCLE')
  }

  function create(req: { name: string; parent?: string | null }): FolderRecord {
    const slug = slugify(req.name)
    if (readOne(slug)) throw new FolderError(`folder exists: ${slug}`, 'DUPLICATE')
    const records = list()
    const parent = req.parent ?? null
    assertParentOk(records, slug, parent)
    const file: FolderFile = { schemaVersion: 1, name: req.name, parent, members: [] }
    writeOne(slug, file)
    return { slug, file }
  }

  function rename(slug: string, name: string): { record: FolderRecord; previousSlug: string } {
    const file = mustRead(slug)
    const nextSlug = slugify(name)
    if (nextSlug !== slug && readOne(nextSlug))
      throw new FolderError(`folder exists: ${nextSlug}`, 'DUPLICATE')
    const next: FolderFile = { ...file, name }
    writeOne(nextSlug, next)
    if (nextSlug !== slug) {
      // Children keep pointing at the folder: rewrite their parent refs, then
      // drop the old file (slug is the address, spec §5 rename semantics).
      for (const r of list()) {
        if (r.slug !== slug && r.file.parent === slug)
          writeOne(r.slug, { ...r.file, parent: nextSlug })
      }
      rmSync(fileFor(slug), { force: true })
    }
    return { record: { slug: nextSlug, file: next }, previousSlug: slug }
  }

  function setParent(slug: string, parent: string | null): FolderRecord {
    const file = mustRead(slug)
    assertParentOk(list(), slug, parent)
    const next: FolderFile = { ...file, parent }
    writeOne(slug, next)
    return { slug, file: next }
  }

  function remove(slug: string): void {
    const file = mustRead(slug)
    // Children re-parent to the removed folder's parent (spec §3: never
    // orphaned, never cascaded).
    for (const r of list()) {
      if (r.slug !== slug && r.file.parent === slug)
        writeOne(r.slug, { ...r.file, parent: file.parent })
    }
    rmSync(fileFor(slug), { force: true })
  }

  function addMembers(slug: string, refs: FolderMemberRef[]): FolderRecord {
    const file = mustRead(slug)
    const next: FolderFile = { ...file, members: dedupeRefs([...file.members, ...refs]) }
    writeOne(slug, next)
    return { slug, file: next }
  }

  function removeMembers(slug: string, refs: FolderMemberRef[]): FolderRecord {
    const file = mustRead(slug)
    const next: FolderFile = {
      ...file,
      members: file.members.filter((m) => !refs.some((r) => refsEqual(r, m))),
    }
    writeOne(slug, next)
    return { slug, file: next }
  }

  return { list, create, rename, setParent, remove, addMembers, removeMembers }
}
```

- [ ] **Step 4: Run unit tests, expect pass**

Run: `pnpm vitest run --project unit src/main/lib/folders.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: Mutation check the cycle guard (spec §7 demands it bites)**

Temporarily change `if (cursor === slug) return true` to `return false`, run the unit test — expect the two cycle tests FAIL. Restore the line, re-run, expect `6 passed`. Do not commit the mutation.

- [ ] **Step 6: Gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit`
Expected: clean; unit count grows by 6.

```bash
git add src/main/lib/folders.ts src/main/lib/folders.test.ts
git commit -m "feat(folders): the store — pure rules + file CRUD (spec §2–3)

Cycle guard (mutation-checked), ref equality across both shapes, dedupe,
delete-reparents-children, rename rewrites child parent refs. Files-as-truth
with the reading-state file conventions.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Folder store — file round-trip itest

**Files:**
- Create: `src/main/lib/folders.itest.ts`

**Interfaces:**
- Consumes: `createFoldersStore`, `FolderError` from `./folders` (Task 2 signatures).
- Produces: nothing new — proof the store honors spec §2–3 against a real filesystem.

- [ ] **Step 1: Write the failing itest**

```ts
// src/main/lib/folders.itest.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFoldersStore, FolderError, type FoldersStore } from './folders'

/** Tier A integration: the folder store against a real tmp dir (spec §2–3). */
let dir: string
let store: FoldersStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-folders-'))
  store = createFoldersStore(dir)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('folder store round-trips', () => {
  it('create → nest → file on disk matches schema; duplicate name rejected', () => {
    const root = store.create({ name: 'EEC 174 ABY' })
    store.create({ name: 'Lectures', parent: root.slug })
    const onDisk = JSON.parse(readFileSync(join(dir, 'lectures.json'), 'utf-8'))
    expect(onDisk.parent).toBe('eec-174-aby')
    expect(() => store.create({ name: 'Lectures' })).toThrow(FolderError)
  })

  it('cycle rejected at write time; BAD_PARENT for missing parent', () => {
    const a = store.create({ name: 'A' })
    const b = store.create({ name: 'B', parent: a.slug })
    expect(() => store.setParent(a.slug, b.slug)).toThrow(/cycle/i)
    expect(() => store.create({ name: 'C', parent: 'nope' })).toThrow(/parent/i)
  })

  it('addMembers dedupes; removeMembers touches only named refs', () => {
    const f = store.create({ name: 'F' })
    store.addMembers(f.slug, [{ sha256: 'aa' }, { library: 'obsidian:/v', key: 'n.md' }])
    const after = store.addMembers(f.slug, [{ sha256: 'aa' }])
    expect(after.file.members).toHaveLength(2)
    const removed = store.removeMembers(f.slug, [{ sha256: 'aa' }])
    expect(removed.file.members).toEqual([{ library: 'obsidian:/v', key: 'n.md' }])
  })

  it('remove re-parents children to the removed folder parent', () => {
    const root = store.create({ name: 'Root' })
    const mid = store.create({ name: 'Mid', parent: root.slug })
    store.create({ name: 'Leaf', parent: mid.slug })
    store.remove(mid.slug)
    const leaf = store.list().find((r) => r.slug === 'leaf')
    expect(leaf?.file.parent).toBe('root')
  })

  it('rename regenerates slug, rewrites child parents, drops old file', () => {
    const root = store.create({ name: 'Old Name' })
    store.create({ name: 'Child', parent: root.slug })
    const { record } = store.rename(root.slug, 'New Name')
    expect(record.slug).toBe('new-name')
    expect(readdirSync(dir)).not.toContain('old-name.json')
    expect(store.list().find((r) => r.slug === 'child')?.file.parent).toBe('new-name')
  })

  it('a corrupt file is ignored with the rest intact (hand-edit tolerance)', () => {
    store.create({ name: 'Good' })
    writeFileSync(join(dir, 'bad.json'), '{nope')
    expect(store.list().map((r) => r.slug)).toEqual(['good'])
  })
})
```

- [ ] **Step 2: Run to verify current state**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/lib/folders.itest.ts`
Expected: all 6 PASS immediately (the store exists from Task 2). This task's tests are the *fixed acceptance suite* for the store — if any fail, the store (not the test) is wrong; fix the store.

- [ ] **Step 3: Gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean; integration count grows by 6.

```bash
git add src/main/lib/folders.itest.ts
git commit -m "test(folders): store round-trip acceptance suite (spec §2–3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The mirror — syncFolders

**Files:**
- Create: `src/main/index/folder-mirror.ts`
- Create: `src/main/index/folder-mirror.itest.ts`

**Interfaces:**
- Consumes: `FoldersStore`, `FolderRecord`, `FolderMemberRef` (Task 2); `s.folders`/`s.folderMembers` (Task 1); `Db` from `../db`.
- Produces: `syncFolders(db: Db, store: FoldersStore): void` — later tasks call it after boot, after connector sync, and after every folders IPC mutation.

- [ ] **Step 1: Write the failing itest**

```ts
// src/main/index/folder-mirror.itest.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createFoldersStore, type FoldersStore } from '../lib/folders'
import { syncFolders } from './folder-mirror'
import * as s from '../db/schema'

/** Tier A integration: files → mirror (spec §4). Wholesale rebuild, ref
 *  resolution (hash / path / unresolved), idempotency, wipe survival. */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let store: FoldersStore

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-fmirror-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  upsert.wipeDerived()
  rmSync(join(dir, 'folders'), { recursive: true, force: true })
  store = createFoldersStore(join(dir, 'folders'))
})

const seedDocs = (): { pdfId: number; noteId: number; vaultKey: string } => {
  const z = upsert.ensureLibrary('zotero', '1', 'My Library')
  const v = upsert.ensureLibrary('obsidian', '/vault', 'Vault')
  const pdf = upsert.upsertDocument({
    libraryId: z.id, externalKey: 'K1', uri: 'zotero://x', title: 'Paper',
    kind: 'pdf', contentSha256: 'hash-p', modifiedAt: 1,
  })
  const note = upsert.upsertDocument({
    libraryId: v.id, externalKey: 'n.md', uri: 'obsidian://x', title: 'n',
    kind: 'note', contentSha256: null, modifiedAt: 1,
  })
  return { pdfId: pdf.documentId, noteId: note.documentId, vaultKey: 'obsidian:/vault' }
}

const memberDocIds = (slug: string): number[] => {
  const row = handle.db.select().from(s.folders).where(eq(s.folders.slug, slug)).get()
  if (!row) return []
  return handle.db
    .select({ d: s.folderMembers.documentId })
    .from(s.folderMembers)
    .where(eq(s.folderMembers.folderId, row.id))
    .all()
    .map((r) => r.d)
}

describe('syncFolders', () => {
  it('resolves hash refs and path refs; unresolved refs contribute nothing yet', () => {
    const { pdfId, noteId, vaultKey } = seedDocs()
    const f = store.create({ name: 'Course' })
    store.addMembers(f.slug, [
      { sha256: 'hash-p' },
      { library: vaultKey, key: 'n.md' },
      { sha256: 'hash-not-yet-synced' },
    ])
    syncFolders(handle.db, store)
    expect(memberDocIds('course').sort()).toEqual([pdfId, noteId].sort())
    // the unresolved ref stays in the FILE untouched (spec §3: never pruned)
    expect(store.list()[0]?.file.members).toHaveLength(3)
  })

  it('unresolved ref resolves after the document arrives + re-mirror', () => {
    seedDocs()
    const f = store.create({ name: 'Course' })
    store.addMembers(f.slug, [{ sha256: 'hash-late' }])
    syncFolders(handle.db, store)
    expect(memberDocIds('course')).toHaveLength(0)
    const z = upsert.ensureLibrary('zotero', '1', 'My Library')
    upsert.upsertDocument({
      libraryId: z.id, externalKey: 'K9', uri: 'zotero://y', title: 'Late',
      kind: 'pdf', contentSha256: 'hash-late', modifiedAt: 2,
    })
    syncFolders(handle.db, store)
    expect(memberDocIds('course')).toHaveLength(1)
  })

  it('is a wholesale rebuild: deleted folders/members vanish; idempotent; parent linked', () => {
    seedDocs()
    const root = store.create({ name: 'Root' })
    const child = store.create({ name: 'Child', parent: root.slug })
    store.addMembers(child.slug, [{ sha256: 'hash-p' }])
    syncFolders(handle.db, store)
    syncFolders(handle.db, store) // idempotent
    const rows = handle.db.select().from(s.folders).all()
    expect(rows).toHaveLength(2)
    const childRow = rows.find((r) => r.slug === 'child')
    const rootRow = rows.find((r) => r.slug === 'root')
    expect(childRow?.parentId).toBe(rootRow?.id)
    store.remove(child.slug)
    syncFolders(handle.db, store)
    expect(handle.db.select().from(s.folders).all()).toHaveLength(1)
    expect(handle.db.select().from(s.folderMembers).all()).toHaveLength(0)
  })

  it('membership survives wipeDerived + rescan + re-mirror (ids renumbered)', () => {
    const { vaultKey } = seedDocs()
    void vaultKey
    const f = store.create({ name: 'Keep' })
    store.addMembers(f.slug, [{ sha256: 'hash-p' }])
    syncFolders(handle.db, store)
    upsert.wipeDerived()
    seedDocs() // rescan re-creates the documents with NEW ids
    syncFolders(handle.db, store)
    expect(memberDocIds('keep')).toHaveLength(1)
  })

  it('ghost members stay mirrored (membership is not presence, spec §3)', () => {
    seedDocs()
    const f = store.create({ name: 'G' })
    store.addMembers(f.slug, [{ sha256: 'hash-p' }])
    // kill the only instance → ghost
    const z = upsert.ensureLibrary('zotero', '1', 'My Library')
    const { reconcileRemovals } = await_import_removals()
    reconcileRemovals(handle.db, z.id, [])
    syncFolders(handle.db, store)
    expect(memberDocIds('g')).toHaveLength(1)
  })
})

// Top-level import (kept here so the snippet above stays readable):
import { reconcileRemovals as _rr } from './removals'
function await_import_removals(): { reconcileRemovals: typeof _rr } {
  return { reconcileRemovals: _rr }
}
```

(Implementer note: fold `_rr` in as a normal top-of-file import named `reconcileRemovals` and delete the helper — shown this way only to keep the test body self-explanatory.)

- [ ] **Step 2: Run to verify failure**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/index/folder-mirror.itest.ts`
Expected: FAIL — `Cannot find module './folder-mirror'`.

- [ ] **Step 3: Implement the mirror**

```ts
// src/main/index/folder-mirror.ts
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from '../lib/logger'
import type { FolderMemberRef, FoldersStore } from '../lib/folders'

/**
 * Files → mirror (folders spec §4). WHOLESALE rebuild: delete both tables,
 * reinsert from the store. Runs at boot, after every connector sync (new
 * documents can resolve pending refs), and after every folders mutation.
 * The mirror never writes files; row ids are rebuild-local (slug = address).
 */
const log = moduleLogger('folder-mirror')

function resolveRef(db: Db, ref: FolderMemberRef): number | null {
  if ('sha256' in ref) {
    return (
      db.select({ id: s.documents.id }).from(s.documents)
        .where(eq(s.documents.contentSha256, ref.sha256)).get()?.id ?? null
    )
  }
  // path ref: `library` is `${connectorKey}:${stableKey}` (spec §2)
  const sep = ref.library.indexOf(':')
  if (sep < 0) return null
  const connectorKey = ref.library.slice(0, sep)
  const stableKey = ref.library.slice(sep + 1)
  const row = db
    .select({ documentId: s.documentInstances.documentId })
    .from(s.documentInstances)
    .innerJoin(s.libraries, eq(s.documentInstances.libraryId, s.libraries.id))
    .innerJoin(s.connectors, eq(s.libraries.connectorId, s.connectors.id))
    .where(
      and(
        eq(s.connectors.key, connectorKey),
        eq(s.libraries.stableKey, stableKey),
        eq(s.documentInstances.externalKey, ref.key),
      ),
    )
    .get()
  return row?.documentId ?? null
}

export function syncFolders(db: Db, store: FoldersStore): void {
  const records = store.list()
  db.transaction(() => {
    db.delete(s.folderMembers).run()
    db.delete(s.folders).run()
    const idBySlug = new Map<string, number>()
    for (const r of records) {
      const row = db.insert(s.folders)
        .values({ slug: r.slug, name: r.file.name, parentId: null })
        .returning().get()
      idBySlug.set(r.slug, row.id)
    }
    for (const r of records) {
      if (r.file.parent == null) continue
      const parentId = idBySlug.get(r.file.parent)
      if (parentId == null) {
        log.warn({ slug: r.slug, parent: r.file.parent }, 'parent missing; rendering at root')
        continue
      }
      db.update(s.folders).set({ parentId })
        .where(eq(s.folders.id, idBySlug.get(r.slug)!)).run()
    }
    for (const r of records) {
      const folderId = idBySlug.get(r.slug)!
      const docIds = new Set<number>()
      for (const ref of r.file.members) {
        const id = resolveRef(db, ref)
        if (id != null) docIds.add(id)
      }
      for (const documentId of docIds) {
        db.insert(s.folderMembers).values({ folderId, documentId }).run()
      }
    }
  })
}

/** Slug set → mirror folder ids, optionally expanded to all descendants
 *  (spec §6 includeSubfolders). Exported for the query layer. */
export function folderIdsForSlugs(db: Db, slugs: string[], includeSubfolders: boolean): number[] {
  const all = db.select().from(s.folders).all()
  const bySlug = new Map(all.map((f) => [f.slug, f]))
  const childrenOf = new Map<number, number[]>()
  for (const f of all) {
    if (f.parentId != null) {
      const list = childrenOf.get(f.parentId) ?? []
      list.push(f.id)
      childrenOf.set(f.parentId, list)
    }
  }
  const out = new Set<number>()
  const queue: number[] = slugs.flatMap((slug) => {
    const f = bySlug.get(slug)
    return f ? [f.id] : []
  })
  for (const id of queue) out.add(id)
  if (includeSubfolders) {
    while (queue.length > 0) {
      const id = queue.pop()!
      for (const child of childrenOf.get(id) ?? []) {
        if (!out.has(child)) {
          out.add(child)
          queue.push(child)
        }
      }
    }
  }
  return [...out]
}
void inArray // (used by Task 5's query integration; keeps the import stable)
```

(Implementer note: drop the trailing `void inArray` + import if lint flags it — it exists only if Task 5 ends up importing `inArray` from here; otherwise remove.)

- [ ] **Step 4: Run itest, expect pass**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/index/folder-mirror.itest.ts`
Expected: `5 passed`.

- [ ] **Step 5: Gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

```bash
git add src/main/index/folder-mirror.ts src/main/index/folder-mirror.itest.ts
git commit -m "feat(folders): the mirror — wholesale files→SQLite rebuild (spec §4)

Hash + path ref resolution, unresolved refs contribute nothing (and are
never pruned from files), idempotent, membership survives wipeDerived with
renumbered ids, ghosts stay mirrored.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Query integration — folder scope, Uncategorized, folderTree

**Files:**
- Modify: `src/main/index/queries.ts` (filterSetSchema, filterConditions, new `folderTree`)
- Modify: `src/main/index/queries.itest.ts` (append a describe block)

**Interfaces:**
- Consumes: `folderIdsForSlugs` (Task 4), mirror tables (Task 1).
- Produces:
  - `filterSetSchema` gains `folderSlugs: z.array(z.string().max(200)).max(50).optional()`, `includeSubfolders: z.boolean().default(false)`, `uncategorized: z.boolean().default(false)`.
  - `folderTree(): FolderTreeNode[]` where `interface FolderTreeNode { slug: string; name: string; ownCount: number; subtreeCount: number; children: FolderTreeNode[] }` — plus `uncategorizedCount(): number`.
  - `createIndexQueries(db)` return object gains `folderTree` and `uncategorizedCount`.

- [ ] **Step 1: Write the failing itests (append to `src/main/index/queries.itest.ts`)**

```ts
describe('folder scope + Uncategorized (folders spec §6)', () => {
  // Local helpers: a folder store + mirror inside this suite's tmp dir.
  const makeFolders = (): FoldersStore => {
    const fdir = join(dir, `folders-${Math.random().toString(36).slice(2)}`)
    return createFoldersStore(fdir)
  }

  it('folderSlugs scopes browse; includeSubfolders pulls descendants', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a', title: 'In Root' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', title: 'In Child' })
    put(z.id, { externalKey: 'C', contentSha256: 'h-c', title: 'Unfiled' })
    const store = makeFolders()
    const root = store.create({ name: 'Root' })
    const child = store.create({ name: 'Child', parent: root.slug })
    store.addMembers(root.slug, [{ sha256: 'h-a' }])
    store.addMembers(child.slug, [{ sha256: 'h-b' }])
    syncFolders(handle.db, store)

    expect(queries.browse({ folderSlugs: ['root'] }).total).toBe(1)
    expect(queries.browse({ folderSlugs: ['root'], includeSubfolders: true }).total).toBe(2)
    expect(queries.search({ q: 'child', folderSlugs: ['root'] })).toHaveLength(0)
    expect(queries.search({ q: 'child', folderSlugs: ['root'], includeSubfolders: true })).toHaveLength(1)
  })

  it('uncategorized = member of no folder; counts feed the rail', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a', title: 'Filed' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b', title: 'Inbox item' })
    const store = makeFolders()
    const f = store.create({ name: 'F' })
    store.addMembers(f.slug, [{ sha256: 'h-a' }])
    syncFolders(handle.db, store)

    const inbox = queries.browse({ uncategorized: true })
    expect(inbox.total).toBe(1)
    expect(inbox.hits[0]?.title).toBe('Inbox item')
    expect(queries.uncategorizedCount()).toBe(1)
  })

  it('folderTree carries own + subtree counts (multi-membership not double-counted in subtree)', () => {
    const z = lib('zotero', '1')
    put(z.id, { externalKey: 'A', contentSha256: 'h-a' })
    put(z.id, { externalKey: 'B', contentSha256: 'h-b' })
    const store = makeFolders()
    const root = store.create({ name: 'Root' })
    const child = store.create({ name: 'Child', parent: root.slug })
    store.addMembers(root.slug, [{ sha256: 'h-a' }])
    store.addMembers(child.slug, [{ sha256: 'h-a' }, { sha256: 'h-b' }]) // h-a in both
    syncFolders(handle.db, store)

    const tree = queries.folderTree()
    expect(tree).toHaveLength(1)
    expect(tree[0]?.ownCount).toBe(1)
    expect(tree[0]?.subtreeCount).toBe(2) // distinct docs across root ∪ child
    expect(tree[0]?.children[0]?.ownCount).toBe(2)
  })
})
```

Also add these imports at the top of the itest file: `import { createFoldersStore, type FoldersStore } from '../lib/folders'` and `import { syncFolders } from './folder-mirror'`.

- [ ] **Step 2: Run to verify failure**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/index/queries.itest.ts`
Expected: FAIL — unknown filter keys are stripped by zod so `folderSlugs` is ignored → first test fails on `.total` being 3, and `folderTree`/`uncategorizedCount` don't exist.

- [ ] **Step 3: Implement in queries.ts**

filterSetSchema additions (inside the existing `z.object`):

```ts
  /** Folder scope (folders spec §6): union dimension over the mirror. */
  folderSlugs: z.array(z.string().max(200)).max(50).optional(),
  includeSubfolders: z.boolean().default(false),
  /** The filing inbox: documents in NO folder. */
  uncategorized: z.boolean().default(false),
```

In `filterConditions`, after the ghost predicate:

```ts
    if (f.folderSlugs?.length) {
      const ids = folderIdsForSlugs(db, f.folderSlugs, f.includeSubfolders)
      // An empty id set must match NOTHING (a filter for a deleted folder is
      // not "no filter").
      conds.push(
        ids.length
          ? sql`EXISTS (SELECT 1 FROM folder_members fm
                        WHERE fm.document_id = d.id AND fm.folder_id IN (${inList(ids)}))`
          : sql`0`,
      )
    }
    if (f.uncategorized)
      conds.push(sql`NOT EXISTS (SELECT 1 FROM folder_members fm WHERE fm.document_id = d.id)`)
```

New reads (inside `createIndexQueries`, exported on the return object):

```ts
  export interface FolderTreeNode {
    slug: string
    name: string
    ownCount: number
    subtreeCount: number
    children: FolderTreeNode[]
  }
  // (interface at module top level, beside the other exported shapes)

  /** The rail payload (spec §6): the folder tree with own + distinct-subtree
   *  counts. Small data (10² folders); computed in JS from two full reads. */
  function folderTree(): FolderTreeNode[] {
    const rows = db.select().from(s.folders).all()
    const members = db.select().from(s.folderMembers).all()
    const docsByFolder = new Map<number, Set<number>>()
    for (const m of members) {
      const set = docsByFolder.get(m.folderId) ?? new Set<number>()
      set.add(m.documentId)
      docsByFolder.set(m.folderId, set)
    }
    const childrenOf = new Map<number | null, typeof rows>()
    for (const r of rows) {
      const list = childrenOf.get(r.parentId) ?? []
      list.push(r)
      childrenOf.set(r.parentId, list)
    }
    const build = (row: (typeof rows)[number]): { node: FolderTreeNode; docs: Set<number> } => {
      const own = docsByFolder.get(row.id) ?? new Set<number>()
      const kids = (childrenOf.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)).map(build)
      const subtree = new Set(own)
      for (const k of kids) for (const d of k.docs) subtree.add(d)
      return {
        node: {
          slug: row.slug, name: row.name, ownCount: own.size,
          subtreeCount: subtree.size, children: kids.map((k) => k.node),
        },
        docs: subtree,
      }
    }
    return (childrenOf.get(null) ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((r) => build(r).node)
  }

  /** The inbox badge (spec §6): anchored documents in no folder. */
  function uncategorizedCount(): number {
    return (
      db.get<{ c: number }>(
        sql`SELECT count(*) AS c FROM documents d
            WHERE ${anchored} AND NOT EXISTS
              (SELECT 1 FROM folder_members fm WHERE fm.document_id = d.id)`,
      )?.c ?? 0
    )
  }
```

Add `import { folderIdsForSlugs } from './folder-mirror'` at the top, and `folderTree, uncategorizedCount` to the return object.

- [ ] **Step 4: Run itests, expect pass**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/index/queries.itest.ts`
Expected: previous 9 + new 3 = `12 passed`.

- [ ] **Step 5: Mutation check the empty-id-set rule**

Temporarily replace `: sql\`0\`` with `: sql\`1\``, run the first new test — expect FAIL (a deleted-folder filter would show everything). Restore, re-run, expect `12 passed`.

- [ ] **Step 6: Gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

```bash
git add src/main/index/queries.ts src/main/index/queries.itest.ts
git commit -m "feat(index): folder scope, Uncategorized inbox, folderTree (spec §6)

folderSlugs union dimension with includeSubfolders expansion (empty
resolution matches nothing — mutation-checked), uncategorized predicate +
count, folder tree with own/distinct-subtree counts for the rail.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire contract + composition + preload

**Files:**
- Modify: `src/shared/db-ipc.ts` (channels + request schemas)
- Modify: `src/main/index.ts` (folders store instance, handlers, re-mirror hooks)
- Modify: `src/preload/index.ts` (expose `folders` API)
- Create: `src/main/index/folder-ipc.itest.ts` (id→ref resolution logic)

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces:
  - Channels: `FOLDERS_LIST_CHANNEL='folders:list'`, `FOLDERS_CREATE_CHANNEL='folders:create'`, `FOLDERS_RENAME_CHANNEL='folders:rename'`, `FOLDERS_SET_PARENT_CHANNEL='folders:set-parent'`, `FOLDERS_DELETE_CHANNEL='folders:delete'`, `FOLDERS_ADD_MEMBERS_CHANNEL='folders:add-members'`, `FOLDERS_REMOVE_MEMBERS_CHANNEL='folders:remove-members'`, `FOLDERS_IMPORT_CHANNEL='folders:import'`.
  - `refsForDocumentIds(db: Db, documentIds: number[]): FolderMemberRef[]` exported from `folder-mirror.ts` — hash ref when the document has `contentSha256`, else path ref from its FIRST instance (`connectorKey:stableKey` + externalKey); documents with neither hash nor instance are skipped (nothing to reference durably).
  - `window.astrolabe.folders`: `{ list, create, rename, setParent, remove, addMembers, removeMembers, import }` — every mutate returns `queries.folderTree()` so the renderer holds one snapshot.

- [ ] **Step 1: Write the failing itest for id→ref resolution**

```ts
// src/main/index/folder-ipc.itest.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { refsForDocumentIds } from './folder-mirror'

/** Tier A: the main-side id→ref policy (spec §5): hash-first, path ref for
 *  unhashed notes, skip the unreferenceable. The renderer never builds refs. */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-fipc-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => upsert.wipeDerived())

describe('refsForDocumentIds', () => {
  it('hash ref for hashed docs; path ref for notes; skips id without either', () => {
    const z = upsert.ensureLibrary('zotero', '1', 'My Library')
    const v = upsert.ensureLibrary('obsidian', '/vault', 'Vault')
    const pdf = upsert.upsertDocument({
      libraryId: z.id, externalKey: 'K1', uri: 'z://', title: 'P', kind: 'pdf',
      contentSha256: 'h-p', modifiedAt: 1,
    })
    const note = upsert.upsertDocument({
      libraryId: v.id, externalKey: 'n.md', uri: 'o://', title: 'n', kind: 'note',
      contentSha256: null, modifiedAt: 1,
    })
    const refs = refsForDocumentIds(handle.db, [pdf.documentId, note.documentId, 999_999])
    expect(refs).toEqual([
      { sha256: 'h-p' },
      { library: 'obsidian:/vault', key: 'n.md' },
    ])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/index/folder-ipc.itest.ts`
Expected: FAIL — `refsForDocumentIds` is not exported.

- [ ] **Step 3: Implement `refsForDocumentIds` (append to folder-mirror.ts)**

```ts
/** documentIds → durable member refs (spec §5): hash-first; unhashed docs get
 *  a path ref from their first instance; ids with neither are skipped. The
 *  renderer never constructs refs — this is the only place ids become refs. */
export function refsForDocumentIds(db: Db, documentIds: number[]): FolderMemberRef[] {
  const out: FolderMemberRef[] = []
  for (const id of documentIds) {
    const doc = db.select().from(s.documents).where(eq(s.documents.id, id)).get()
    if (!doc) continue
    if (doc.contentSha256) {
      out.push({ sha256: doc.contentSha256 })
      continue
    }
    const inst = db
      .select({
        externalKey: s.documentInstances.externalKey,
        stableKey: s.libraries.stableKey,
        connectorKey: s.connectors.key,
      })
      .from(s.documentInstances)
      .innerJoin(s.libraries, eq(s.documentInstances.libraryId, s.libraries.id))
      .innerJoin(s.connectors, eq(s.libraries.connectorId, s.connectors.id))
      .where(eq(s.documentInstances.documentId, id))
      .get()
    if (inst) out.push({ library: `${inst.connectorKey}:${inst.stableKey}`, key: inst.externalKey })
  }
  return out
}
```

- [ ] **Step 4: Run itest, expect pass; then add the wire contract**

Run (same command as Step 2). Expected: `1 passed`.

db-ipc.ts additions (below the libraries section — request schemas are layer-free):

```ts
// ── Folders (docs/2026-07-18-folders-spec §5) — the organization primitive ───
export const FOLDERS_LIST_CHANNEL = 'folders:list'
export const FOLDERS_CREATE_CHANNEL = 'folders:create'
export const FOLDERS_RENAME_CHANNEL = 'folders:rename'
export const FOLDERS_SET_PARENT_CHANNEL = 'folders:set-parent'
export const FOLDERS_DELETE_CHANNEL = 'folders:delete'
export const FOLDERS_ADD_MEMBERS_CHANNEL = 'folders:add-members'
export const FOLDERS_REMOVE_MEMBERS_CHANNEL = 'folders:remove-members'
export const FOLDERS_IMPORT_CHANNEL = 'folders:import'

const folderSlug = z.string().min(1).max(200)
export const createFolderRequestSchema = z.object({
  name: z.string().min(1).max(120),
  parent: folderSlug.nullable().optional(),
})
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>
export const renameFolderRequestSchema = z.object({ slug: folderSlug, name: z.string().min(1).max(120) })
export type RenameFolderRequest = z.infer<typeof renameFolderRequestSchema>
export const setFolderParentRequestSchema = z.object({ slug: folderSlug, parent: folderSlug.nullable() })
export type SetFolderParentRequest = z.infer<typeof setFolderParentRequestSchema>
export const deleteFolderRequestSchema = z.object({ slug: folderSlug })
export type DeleteFolderRequest = z.infer<typeof deleteFolderRequestSchema>
export const folderMembersRequestSchema = z.object({
  slug: folderSlug,
  documentIds: z.array(z.number().int().positive()).min(1).max(10_000),
})
export type FolderMembersRequest = z.infer<typeof folderMembersRequestSchema>
export const importFoldersRequestSchema = z.object({
  libraryId: z.number().int().positive(),
  rootName: z.string().min(1).max(120).optional(),
})
export type ImportFoldersRequest = z.infer<typeof importFoldersRequestSchema>
/** Import outcome — user-renderable numbers (spec §6b). */
export interface ImportFoldersResult { created: number; members: number; skipped: number }
```

main/index.ts wiring (inside the existing boot/wireIpc structure):

```ts
// imports:
import { createFoldersStore, FolderError, type FoldersStore } from './lib/folders'
import { refsForDocumentIds, syncFolders } from './index/folder-mirror'
import { importLibraryTree } from './index/folder-import'
import {
  FOLDERS_ADD_MEMBERS_CHANNEL, FOLDERS_CREATE_CHANNEL, FOLDERS_DELETE_CHANNEL,
  FOLDERS_IMPORT_CHANNEL, FOLDERS_LIST_CHANNEL, FOLDERS_REMOVE_MEMBERS_CHANNEL,
  FOLDERS_RENAME_CHANNEL, FOLDERS_SET_PARENT_CHANNEL,
  createFolderRequestSchema, deleteFolderRequestSchema, folderMembersRequestSchema,
  importFoldersRequestSchema, renameFolderRequestSchema, setFolderParentRequestSchema,
} from '../shared/db-ipc'

// module state beside the other singletons:
let foldersStore: FoldersStore

// in boot, after openDb + before first sync (workspace already ensured):
foldersStore = createFoldersStore(join(workspace.astroDir, 'folders'))

// at the end of runSync(), after resolveLinks:
syncFolders(handle.db, foldersStore) // new documents may resolve pending refs

// in wireIpc(): every mutate re-mirrors then returns the fresh tree, so the
// renderer always holds one consistent snapshot.
const mirrorAndTree = (): unknown => {
  syncFolders(handle.db, foldersStore)
  return queries.folderTree()
}
ipcMain.handle(FOLDERS_LIST_CHANNEL, () => queries.folderTree())
ipcMain.handle(FOLDERS_CREATE_CHANNEL, (_e, raw: unknown) => {
  const req = createFolderRequestSchema.parse(raw)
  foldersStore.create({ name: req.name, parent: req.parent ?? null })
  return mirrorAndTree()
})
ipcMain.handle(FOLDERS_RENAME_CHANNEL, (_e, raw: unknown) => {
  const req = renameFolderRequestSchema.parse(raw)
  foldersStore.rename(req.slug, req.name)
  return mirrorAndTree()
})
ipcMain.handle(FOLDERS_SET_PARENT_CHANNEL, (_e, raw: unknown) => {
  const req = setFolderParentRequestSchema.parse(raw)
  foldersStore.setParent(req.slug, req.parent)
  return mirrorAndTree()
})
ipcMain.handle(FOLDERS_DELETE_CHANNEL, (_e, raw: unknown) => {
  const req = deleteFolderRequestSchema.parse(raw)
  foldersStore.remove(req.slug)
  return mirrorAndTree()
})
ipcMain.handle(FOLDERS_ADD_MEMBERS_CHANNEL, (_e, raw: unknown) => {
  const req = folderMembersRequestSchema.parse(raw)
  foldersStore.addMembers(req.slug, refsForDocumentIds(handle.db, req.documentIds))
  return mirrorAndTree()
})
ipcMain.handle(FOLDERS_REMOVE_MEMBERS_CHANNEL, (_e, raw: unknown) => {
  const req = folderMembersRequestSchema.parse(raw)
  foldersStore.removeMembers(req.slug, refsForDocumentIds(handle.db, req.documentIds))
  return mirrorAndTree()
})
ipcMain.handle(FOLDERS_IMPORT_CHANNEL, (_e, raw: unknown) => {
  const req = importFoldersRequestSchema.parse(raw)
  const result = importLibraryTree(handle.db, foldersStore, req)
  syncFolders(handle.db, foldersStore)
  return result
})
```

(Task 7 creates `importLibraryTree`; until then, stub the import handler with `throw new Error('folders:import lands in the next commit')` and leave the channel unregistered — register it in Task 7. Do NOT ship a dead handler.)

preload/index.ts — add to the exposed API object (type-only imports for the shapes):

```ts
folders: {
  list: () => ipcRenderer.invoke(FOLDERS_LIST_CHANNEL) as Promise<FolderTreeNode[]>,
  create: (req: CreateFolderRequest) => ipcRenderer.invoke(FOLDERS_CREATE_CHANNEL, req) as Promise<FolderTreeNode[]>,
  rename: (req: RenameFolderRequest) => ipcRenderer.invoke(FOLDERS_RENAME_CHANNEL, req) as Promise<FolderTreeNode[]>,
  setParent: (req: SetFolderParentRequest) => ipcRenderer.invoke(FOLDERS_SET_PARENT_CHANNEL, req) as Promise<FolderTreeNode[]>,
  remove: (req: DeleteFolderRequest) => ipcRenderer.invoke(FOLDERS_DELETE_CHANNEL, req) as Promise<FolderTreeNode[]>,
  addMembers: (req: FolderMembersRequest) => ipcRenderer.invoke(FOLDERS_ADD_MEMBERS_CHANNEL, req) as Promise<FolderTreeNode[]>,
  removeMembers: (req: FolderMembersRequest) => ipcRenderer.invoke(FOLDERS_REMOVE_MEMBERS_CHANNEL, req) as Promise<FolderTreeNode[]>,
  import: (req: ImportFoldersRequest) => ipcRenderer.invoke(FOLDERS_IMPORT_CHANNEL, req) as Promise<ImportFoldersResult>,
},
```

- [ ] **Step 5: Gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean (import handler stubbed out per the note — no dead channel registered).

```bash
git add src/shared/db-ipc.ts src/main/index.ts src/preload/index.ts src/main/index/folder-mirror.ts src/main/index/folder-ipc.itest.ts
git commit -m "feat(folders): wire contract + composition + preload (spec §5)

folders:* channels; main-side id→ref policy (hash-first, path for notes,
skip unreferenceable — itested); every mutate re-mirrors and returns the
fresh tree; runSync re-mirrors so new documents resolve pending refs.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Seed import — lifting a source tree (D-A6)

**Files:**
- Create: `src/main/index/folder-import.ts`
- Create: `src/main/index/folder-import.itest.ts`
- Modify: `src/main/index.ts` (register the `folders:import` handler stubbed in Task 6)

**Interfaces:**
- Consumes: `FoldersStore` (Task 2), mirror tables + `collections`/`documentCollections` (already synced by connectors), `ImportFoldersResult` (Task 6).
- Produces: `importLibraryTree(db: Db, store: FoldersStore, req: { libraryId: number; rootName?: string }): ImportFoldersResult`.

- [ ] **Step 1: Write the failing itest**

```ts
// src/main/index/folder-import.itest.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DbHandle } from '../db'
import { createUpsertApi, type UpsertApi } from './upsert'
import { createFoldersStore, type FoldersStore } from '../lib/folders'
import { importLibraryTree } from './folder-import'

/** Tier A: D-A6 — lift an already-synced source tree into Astrolabe folders
 *  under a fresh root; a copy, never a sync; re-run isolation. */
let dir: string
let handle: DbHandle
let upsert: UpsertApi
let store: FoldersStore
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-fimport-'))
  handle = openDb(join(dir, 'index.db'))
  upsert = createUpsertApi(handle.db)
})
afterAll(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  upsert.wipeDerived()
  rmSync(join(dir, 'folders'), { recursive: true, force: true })
  store = createFoldersStore(join(dir, 'folders'))
})

/** Seed an eagle-like library: folders root→sub, one hashed member in each,
 *  plus one unhashed+instanceless member (unreferenceable → skipped). */
function seedEagle(): { libraryId: number } {
  const e = upsert.ensureLibrary('eagle', '/Books.library', 'Books')
  upsert.upsertCollections(e.id, [
    { externalKey: 'root-f', name: 'Reading' },
    { externalKey: 'sub-f', name: 'Finished', parentExternalKey: 'root-f' },
  ])
  upsert.upsertDocument({
    libraryId: e.id, externalKey: 'I1', uri: 'eagle://item/I1', title: 'Book One',
    kind: 'pdf', contentSha256: 'h-one', modifiedAt: 1, collectionKeys: ['root-f'],
  })
  upsert.upsertDocument({
    libraryId: e.id, externalKey: 'I2', uri: 'eagle://item/I2', title: 'Book Two',
    kind: 'pdf', contentSha256: 'h-two', modifiedAt: 1, collectionKeys: ['sub-f'],
  })
  return { libraryId: e.id }
}

describe('importLibraryTree', () => {
  it('lifts the tree under a fresh root: names, nesting, hash-first members', () => {
    const { libraryId } = seedEagle()
    const result = importLibraryTree(handle.db, store, { libraryId })
    expect(result).toEqual({ created: 3, members: 2, skipped: 0 }) // root + 2 folders
    const records = store.list()
    const root = records.find((r) => r.file.parent === null)
    expect(root?.file.name).toBe('Books (imported)')
    const reading = records.find((r) => r.file.name === 'Reading')
    const finished = records.find((r) => r.file.name === 'Finished')
    expect(reading?.file.parent).toBe(root?.slug)
    expect(finished?.file.parent).toBe(reading?.slug)
    expect(reading?.file.members).toEqual([{ sha256: 'h-one' }])
    expect(finished?.file.members).toEqual([{ sha256: 'h-two' }])
  })

  it('re-run lands in a second fresh root — never merges into curated folders', () => {
    const { libraryId } = seedEagle()
    importLibraryTree(handle.db, store, { libraryId })
    const second = importLibraryTree(handle.db, store, { libraryId })
    expect(second.created).toBe(3)
    const roots = store.list().filter((r) => r.file.parent === null)
    expect(roots).toHaveLength(2) // "Books (imported)" + "Books (imported) 2"
  })

  it('unhashed member with an instance becomes a path ref; instanceless is skipped+counted', () => {
    const e = upsert.ensureLibrary('eagle', '/Books.library', 'Books')
    upsert.upsertCollections(e.id, [{ externalKey: 'f', name: 'Notes-ish' }])
    upsert.upsertDocument({
      libraryId: e.id, externalKey: 'I3', uri: 'eagle://item/I3', title: 'No hash yet',
      kind: 'other', contentSha256: null, modifiedAt: 1, collectionKeys: ['f'],
    })
    const result = importLibraryTree(handle.db, store, { libraryId: e.id, rootName: 'Seed' })
    expect(result.members).toBe(1)
    const f = store.list().find((r) => r.file.name === 'Notes-ish')
    expect(f?.file.members).toEqual([{ library: 'eagle:/Books.library', key: 'I3' }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --project integration src/main/index/folder-import.itest.ts`
Expected: FAIL — `Cannot find module './folder-import'`.

- [ ] **Step 3: Implement the import**

```ts
// src/main/index/folder-import.ts
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import { moduleLogger } from '../lib/logger'
import type { FoldersStore } from '../lib/folders'
import { refsForDocumentIds } from './folder-mirror'
import type { ImportFoldersResult } from '../../shared/db-ipc'

/**
 * D-A6 (folders spec §6b): lift an already-synced library's collection tree
 * into Astrolabe folders under a FRESH root. A copy, not a subscription —
 * after import the trees are unlinked. Re-runnable: each run creates a new
 * root ("<name> (imported)", "<name> (imported) 2", …), never merging into
 * folders curated since. Members become durable refs via the same hash-first
 * policy as filing (refsForDocumentIds); items that yield no ref are skipped
 * and counted.
 */
const log = moduleLogger('folder-import')

export function importLibraryTree(
  db: Db,
  store: FoldersStore,
  req: { libraryId: number; rootName?: string },
): ImportFoldersResult {
  const library = db.select().from(s.libraries).where(eq(s.libraries.id, req.libraryId)).get()
  if (!library) throw new Error(`no such library: ${req.libraryId}`)

  // Fresh root: first free of "<base>", "<base> 2", "<base> 3", …
  const base = req.rootName ?? `${library.displayName} (imported)`
  const taken = new Set(store.list().map((r) => r.file.name))
  let rootName = base
  for (let n = 2; taken.has(rootName); n++) rootName = `${base} ${n}`
  const root = store.create({ name: rootName })
  let created = 1
  let members = 0
  let skipped = 0

  const collections = db
    .select()
    .from(s.collections)
    .where(eq(s.collections.libraryId, req.libraryId))
    .all()
  // Two passes (upsertCollections precedent): create all, then parent them —
  // source order is arbitrary. Names collide across the source tree? The
  // store's DUPLICATE guard would fire — suffix like the root.
  const slugByCollectionId = new Map<number, string>()
  for (const c of collections) {
    let name = c.name
    for (let n = 2; store.list().some((r) => r.file.name === name); n++) name = `${c.name} ${n}`
    const rec = store.create({ name, parent: root.slug })
    slugByCollectionId.set(c.id, rec.slug)
    created++
  }
  for (const c of collections) {
    if (c.parentId == null) continue
    const child = slugByCollectionId.get(c.id)
    const parent = slugByCollectionId.get(c.parentId)
    if (child && parent) store.setParent(child, parent)
  }

  for (const c of collections) {
    const slug = slugByCollectionId.get(c.id)
    if (!slug) continue
    const docIds = db
      .select({ documentId: s.documentCollections.documentId })
      .from(s.documentCollections)
      .where(eq(s.documentCollections.collectionId, c.id))
      .all()
      .map((r) => r.documentId)
    if (docIds.length === 0) continue
    const refs = refsForDocumentIds(db, docIds)
    skipped += docIds.length - refs.length
    members += refs.length
    if (refs.length > 0) store.addMembers(slug, refs)
  }

  log.info({ library: library.displayName, created, members, skipped }, 'source tree lifted into folders')
  return { created, members, skipped }
}
```

- [ ] **Step 4: Run itest, expect pass**

Run (same command as Step 2). Expected: `3 passed`.

- [ ] **Step 5: Register the import handler in main/index.ts**

Replace the Task 6 stub note with the real handler (code already shown in Task 6 Step 4's wiring block — the `FOLDERS_IMPORT_CHANNEL` handler calling `importLibraryTree` then `syncFolders`).

- [ ] **Step 6: Full gates + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean — final counts: unit +6, integration +15 over the pre-plan baseline.

```bash
git add src/main/index/folder-import.ts src/main/index/folder-import.itest.ts src/main/index.ts
git commit -m "feat(folders): seed import — lift a source tree into folders (D-A6)

Fresh-root copy of an already-synced library tree (Eagle first): names +
nesting preserved, members become durable refs (hash-first, path fallback,
unreferenceable skipped + counted), re-runs isolate into numbered roots.
Trees are unlinked from the moment the import returns.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification + ledger

**Files:**
- Modify: `~/.claude/.../memory/astrolabe-rebuild-plan.md` (session ledger — not committed to the repo)

- [ ] **Step 1: Full suite, thrice (native-teardown flake fence)**

Run: `pnpm test` three times.
Expected: identical green counts each run, zero SIGSEGV.

- [ ] **Step 2: Live smoke (dev app)**

Run: `pnpm dev`, then in the running app's devtools console:
`await window.astrolabe.folders.create({ name: 'Test Folder' })` → returns a tree containing `test-folder`;
`await window.astrolabe.folders.import({ libraryId: <Books library id from the strip tooltip> })` → returns `{created, members, skipped}` with created ≥ 1.
Verify `~/Astrolabe/.astrolabe/folders/` contains the JSON files; delete `test-folder.json` by hand, re-run sync, confirm the mirror drops it (files are truth).

- [ ] **Step 3: Update the session memory ledger**

Record: folders substrate complete (commits list), suite counts, "frame (rail/river/hub/⌘K) is the next design session" — so the next session resumes correctly.

---

## Self-Review (completed at write time)

- **Spec coverage:** §2 primitive → T2/T3; §3 semantics → T2/T3/T4 (ghost membership, unresolved refs, delete-reparent, cycle guard); §4 mirror → T4; §5 wire → T6; §6 queries/Uncategorized → T5; §6b import → T7; §7 testing incl. mutation checks → T2·S5, T5·S5; §8 build order → task order. Rail *UI* is explicitly out of scope (spec §8 step 2 — the frame's own session).
- **Placeholder scan:** none — every step carries code or an exact command. Two implementer notes (Task 4 import hint, Task 6 stub) are instructions, not gaps.
- **Type consistency:** `FolderMemberRef`/`FoldersStore`/`FolderRecord` (T2) used verbatim in T4–T7; `folderIdsForSlugs`/`refsForDocumentIds` live in folder-mirror.ts and are imported accordingly; `FolderTreeNode` defined in queries.ts (T5) and referenced by preload (T6); `ImportFoldersResult` defined in db-ipc (T6) and consumed by T7.
