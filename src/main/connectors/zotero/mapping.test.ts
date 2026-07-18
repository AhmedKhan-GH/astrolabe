import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapCollections, mapItemsToDocuments, zoteroOpenPdfUri, zoteroSelectUri } from './mapping'

/**
 * Tier A (pure transform, fixtures-first). Fixtures are real captures from this
 * machine's live Zotero local API, trimmed to shape. v2 additions: the SCOPE
 * argument — personal vs group determines every deep link — and the
 * ready-to-open `openPdfUri` stored in instance metaJson.
 */
const FIXTURES = join(__dirname, '__fixtures__')
const rawItems = JSON.parse(readFileSync(join(FIXTURES, 'items.json'), 'utf8')) as unknown[]
const rawCollections = JSON.parse(readFileSync(join(FIXTURES, 'collections.json'), 'utf8')) as unknown[]

const DATA_DIR = '/Users/ahmed/Zotero'
const PERSONAL = { kind: 'personal' } as const
const GROUP = { kind: 'group', groupId: 6356926 } as const

function mapFixture(scope: typeof PERSONAL | typeof GROUP = PERSONAL) {
  return mapItemsToDocuments(rawItems, { dataDir: DATA_DIR, scope })
}
function docByKey(key: string) {
  return mapFixture().documents.find((d) => d.externalKey === key)
}

describe('scope-aware URIs', () => {
  it('personal scope addresses /library/, group scope addresses /groups/<id>/', () => {
    expect(zoteroSelectUri(PERSONAL, 'K1')).toBe('zotero://select/library/items/K1')
    expect(zoteroSelectUri(GROUP, 'K1')).toBe('zotero://select/groups/6356926/items/K1')
    expect(zoteroOpenPdfUri(PERSONAL, 'A1', '12')).toBe('zotero://open-pdf/library/items/A1?page=12')
    expect(zoteroOpenPdfUri(GROUP, 'A1', null)).toBe('zotero://open-pdf/groups/6356926/items/A1')
  })

  it('group-mapped documents carry group deep links throughout', () => {
    const { documents } = mapFixture(GROUP)
    const doc = documents.find((d) => d.externalKey === 'ZL98NX6Y')
    expect(doc?.uri).toBe('zotero://select/groups/6356926/items/ZL98NX6Y')
    const meta = JSON.parse(doc?.metaJson ?? '{}') as { openPdfUri?: string }
    expect(meta.openPdfUri).toBe('zotero://open-pdf/groups/6356926/items/LLWXS3LB')
  })
})

describe('mapItemsToDocuments', () => {
  it('emits one document per top-level item / top-level attachment, never per annotation or child', () => {
    const { documents } = mapFixture()
    const keys = documents.map((d) => d.externalKey).sort()
    // ZL98NX6Y journalArticle, VSVGJBTT top-level attachment, 8QYTD4NN book.
    // Excluded: LLWXS3LB/T9SSDYGS (child attachments), JVWMW33V/M93KRWQT
    // (annotations), GR3TFQTM (standalone note).
    expect(keys).toEqual(['8QYTD4NN', 'VSVGJBTT', 'ZL98NX6Y'])
  })

  it('maps a regular item with a child PDF attachment: kind pdf, resolved file path, provenance URI', () => {
    const doc = docByKey('ZL98NX6Y')
    expect(doc).toBeDefined()
    expect(doc?.kind).toBe('pdf')
    expect(doc?.uri).toBe('zotero://select/library/items/ZL98NX6Y')
    expect(doc?.filePath).toBe(
      join(
        DATA_DIR,
        'storage',
        'LLWXS3LB',
        'Joshi et al. - 2025 - Linking Electrocardiogram and Echocardiogram Comparing Classical Machine Learning and Deep Learning.pdf',
      ),
    )
  })

  it('metaJson carries itemType + attachmentKey + the ready openPdfUri (v2)', () => {
    const meta = (key: string) => JSON.parse(docByKey(key)?.metaJson ?? '{}') as Record<string, unknown>
    expect(meta('ZL98NX6Y')).toEqual({
      itemType: 'journalArticle',
      attachmentKey: 'LLWXS3LB',
      openPdfUri: 'zotero://open-pdf/library/items/LLWXS3LB',
    })
    expect(meta('VSVGJBTT')).toEqual({
      itemType: 'attachment',
      attachmentKey: 'VSVGJBTT',
      openPdfUri: 'zotero://open-pdf/library/items/VSVGJBTT',
    })
    expect(meta('8QYTD4NN')).toEqual({
      itemType: 'book',
      attachmentKey: 'T9SSDYGS',
      openPdfUri: 'zotero://open-pdf/library/items/T9SSDYGS',
    })
  })

  it('omits attachmentKey/openPdfUri (keeps itemType) when the item has no pdf attachment', () => {
    const bare = {
      key: 'BARE0001',
      data: { key: 'BARE0001', itemType: 'journalArticle', title: 'No PDF here' },
    }
    const { documents } = mapItemsToDocuments([bare], { dataDir: DATA_DIR, scope: PERSONAL })
    expect(JSON.parse(documents[0]?.metaJson ?? '{}')).toEqual({ itemType: 'journalArticle' })
  })

  it('extracts tags and collection keys from item data', () => {
    const doc = docByKey('ZL98NX6Y')
    expect(doc?.tags?.sort()).toEqual(['model', 'printed'])
    expect(doc?.collectionKeys?.sort()).toEqual(['SWPTENWV', 'U33CVINM', 'ZV7DG2X6'])
  })

  it('does not set contentSha256 — hashing is the scanner’s job (mapping stays pure, no fs)', () => {
    expect(docByKey('ZL98NX6Y')?.contentSha256).toBeUndefined()
  })

  it('chains annotations to a top-level attachment document (annotation → attachment == document)', () => {
    const doc = docByKey('VSVGJBTT')
    expect(doc?.kind).toBe('pdf')
    const anns = doc?.annotations ?? []
    expect(anns.map((a) => a.externalKey).sort()).toEqual(['JVWMW33V', 'M93KRWQT'])
    const precision = anns.find((a) => a.externalKey === 'JVWMW33V')
    expect(precision?.type).toBe('highlight')
    expect(precision?.text).toContain('precision')
    expect(precision?.pageLabel).toBe('148')
    expect(precision?.color).toBe('#5fb236')
  })

  it('page-anchored provenance: annotation position json carries the attachment key + open-pdf deep link', () => {
    const doc = docByKey('VSVGJBTT')
    const ann = doc?.annotations?.find((a) => a.externalKey === 'JVWMW33V')
    const pos = JSON.parse(ann?.positionJson ?? '{}') as { attachmentKey: string; openPdfUri: string }
    expect(pos.attachmentKey).toBe('VSVGJBTT')
    expect(pos.openPdfUri).toBe('zotero://open-pdf/library/items/VSVGJBTT?page=148')
  })

  it('chains annotations up the full 3-level path: annotation → child attachment → regular item', () => {
    const annotation = (rawItems as { data: { itemType: string } }[]).find(
      (i) => i.data.itemType === 'annotation',
    )
    const reParented = structuredClone(annotation) as unknown as { data: { key: string; parentItem: string } }
    reParented.data.key = 'REPARENT1'
    reParented.data.parentItem = 'LLWXS3LB'
    const { documents } = mapItemsToDocuments([...rawItems, reParented], {
      dataDir: DATA_DIR,
      scope: PERSONAL,
    })
    const parent = documents.find((d) => d.externalKey === 'ZL98NX6Y')
    expect(parent?.annotations?.map((a) => a.externalKey)).toEqual(['REPARENT1'])
  })

  it('falls back to kind "other" with no file path when a top-level item has no attachment', () => {
    const bare = {
      key: 'BARE0001',
      data: {
        key: 'BARE0001',
        itemType: 'journalArticle',
        title: 'No PDF here',
        dateModified: '2026-01-01T00:00:00Z',
      },
    }
    const { documents } = mapItemsToDocuments([bare], { dataDir: DATA_DIR, scope: PERSONAL })
    expect(documents).toHaveLength(1)
    expect(documents[0]?.kind).toBe('other')
    expect(documents[0]?.filePath).toBeNull()
    expect(documents[0]?.annotations).toBeUndefined()
  })

  it('skips malformed rows and counts them, without throwing', () => {
    const { documents, skipped } = mapItemsToDocuments(
      [
        { nonsense: true },
        { key: 'X', data: { title: 'missing itemType' } },
        { key: 'BARE0001', data: { key: 'BARE0001', itemType: 'journalArticle', title: 'Valid' } },
      ],
      { dataDir: DATA_DIR, scope: PERSONAL },
    )
    expect(skipped).toBe(2)
    expect(documents.map((d) => d.externalKey)).toEqual(['BARE0001'])
  })
})

describe('mapCollections', () => {
  it('maps keys, names, and parent chains; malformed rows dropped', () => {
    const collections = mapCollections([...rawCollections, { junk: 1 }])
    expect(collections.length).toBeGreaterThan(0)
    const byKey = new Map(collections.map((c) => [c.externalKey, c]))
    for (const c of collections) {
      expect(c.name.length).toBeGreaterThan(0)
      if (c.parentExternalKey) expect(byKey.has(c.parentExternalKey)).toBe(true)
    }
  })
})
