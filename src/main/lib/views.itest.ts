import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createViewsApi, type ViewsApi } from './views'

/**
 * Tier A integration for the saved-view file CRUD (docs/2026-07-10-lens-saved-views-spec
 * §Testing): the on-disk artifact is the contract, so this exercises real fs against a tmp
 * dir — save→list round-trip, upsert-by-slug, delete, and the fail-soft skip of a corrupt or
 * schema-violating file (a hand-edited view must never take down the rail).
 */
let dir: string
let views: ViewsApi

const fixtureFilter = {
  sourceKeys: ['zotero'] as const,
  collectionRefs: [{ sourceKey: 'zotero' as const, key: 'papers' }],
  tagsAll: ['ml'],
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-views-'))
  views = createViewsApi(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('createViewsApi', () => {
  it('save → list round-trips name, q, and filter, and derives the slug', () => {
    const saved = views.save({ name: 'ML Papers', q: 'transformer', filter: fixtureFilter })
    expect(saved.slug).toBe('ml-papers')
    expect(saved.schemaVersion).toBe(1)
    expect(saved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const listed = views.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      slug: 'ml-papers',
      name: 'ML Papers',
      q: 'transformer',
      filter: fixtureFilter,
    })
  })

  it('list returns [] before the dir exists (no save yet)', () => {
    const fresh = createViewsApi(join(dir, 'not-created-yet'))
    expect(fresh.list()).toEqual([])
  })

  it('sorts views by name', () => {
    views.save({ name: 'Zebra', filter: {} })
    views.save({ name: 'Alpha', filter: {} })
    expect(views.list().map((v) => v.name)).toEqual(['Alpha', 'Zebra'])
  })

  it('upserts by slug: re-saving the same name overwrites, not duplicates', () => {
    views.save({ name: 'My View', filter: { tagsAll: ['a'] } })
    views.save({ name: 'My View', filter: { tagsAll: ['b'] } })
    const listed = views.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.filter.tagsAll).toEqual(['b'])
  })

  it('delete removes the file and reports whether it existed', () => {
    views.save({ name: 'Temp', filter: {} })
    expect(existsSync(join(dir, 'temp.json'))).toBe(true)
    expect(views.remove({ slug: 'temp' })).toBe(true)
    expect(existsSync(join(dir, 'temp.json'))).toBe(false)
    expect(views.list()).toEqual([])
    expect(views.remove({ slug: 'temp' })).toBe(false)
  })

  it('skips a corrupt (non-JSON) file instead of throwing', () => {
    views.save({ name: 'Good', filter: {} })
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    const listed = views.list()
    expect(listed.map((v) => v.name)).toEqual(['Good'])
  })

  it('skips a schema-violating file instead of throwing', () => {
    views.save({ name: 'Good', filter: {} })
    // Missing required fields (schemaVersion/createdAt/filter) — a hand-edit gone wrong.
    writeFileSync(join(dir, 'bad-shape.json'), JSON.stringify({ name: 'Bad' }))
    const listed = views.list()
    expect(listed.map((v) => v.name)).toEqual(['Good'])
  })

  it('never persists a raw collections.id (rebuild-unsafe): storedFilter has no such field', () => {
    // The stable ref lives in collectionRefs; a raw collections.id is dropped at the boundary.
    const saved = views.save({
      name: 'x',
      filter: { collectionIds: [7], tagsAll: ['ml'] } as never,
    })
    expect(saved.filter).not.toHaveProperty('collectionIds')
    expect(saved.filter.tagsAll).toEqual(['ml'])
    expect(views.list()[0]?.filter).not.toHaveProperty('collectionIds')
  })
})
