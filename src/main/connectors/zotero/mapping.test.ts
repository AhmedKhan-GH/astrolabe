import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapCollections, mapItemsToDocuments } from './mapping'

/**
 * Tier A (pure transform, fixtures-first). Fixtures are real captures from this
 * machine's live Zotero local API (see __fixtures__/), trimmed to shape. The
 * mapping is the branching logic that turns Zotero's flat item stream into
 * DocumentInput trees — tested hard: parent chaining, tags, collections,
 * missing-attachment fallback, and malformed-row rejection.
 */
const FIXTURES = join(__dirname, '__fixtures__')
const rawItems = JSON.parse(readFileSync(join(FIXTURES, 'items.json'), 'utf8')) as unknown[]
const rawCollections = JSON.parse(readFileSync(join(FIXTURES, 'collections.json'), 'utf8')) as unknown[]

const DATA_DIR = '/Users/ahmed/Zotero'

function mapFixture() {
  return mapItemsToDocuments(rawItems, { dataDir: DATA_DIR })
}
function docByKey(key: string) {
  return mapFixture().documents.find((d) => d.externalKey === key)
}

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
    // child attachment LLWXS3LB → <dataDir>/storage/<attachmentKey>/<filename>
    expect(doc?.filePath).toBe(
      join(
        DATA_DIR,
        'storage',
        'LLWXS3LB',
        'Joshi et al. - 2025 - Linking Electrocardiogram and Echocardiogram Comparing Classical Machine Learning and Deep Learning.pdf',
      ),
    )
  })

  it('captures the pdf attachment key in the instance metaJson (keeps itemType)', () => {
    // child pdf attachment (LLWXS3LB) for the journalArticle; the top-level attachment
    // (VSVGJBTT) is its own key; the book's child pdf is T9SSDYGS.
    const meta = (key: string) => JSON.parse(docByKey(key)?.metaJson ?? '{}') as Record<string, unknown>
    expect(meta('ZL98NX6Y')).toEqual({ itemType: 'journalArticle', attachmentKey: 'LLWXS3LB' })
    expect(meta('VSVGJBTT')).toEqual({ itemType: 'attachment', attachmentKey: 'VSVGJBTT' })
    expect(meta('8QYTD4NN')).toEqual({ itemType: 'book', attachmentKey: 'T9SSDYGS' })
  })

  it('omits attachmentKey (keeps itemType) when the item has no pdf attachment', () => {
    const bare = {
      key: 'BARE0001',
      data: { key: 'BARE0001', itemType: 'journalArticle', title: 'No PDF here' },
    }
    const { documents } = mapItemsToDocuments([bare], { dataDir: DATA_DIR })
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
    // Re-parent a real annotation onto LLWXS3LB (a child attachment of ZL98NX6Y).
    // The live library only has annotations on top-level attachments, so this
    // exercises the parent-of-parent walk the spec requires.
    const annotation = (rawItems as { data: { itemType: string } }[]).find(
      (i) => i.data.itemType === 'annotation',
    )
    const reParented = structuredClone(annotation) as unknown as { data: { key: string; parentItem: string } }
    reParented.data.key = 'REPARENT1'
    reParented.data.parentItem = 'LLWXS3LB'
    const { documents } = mapItemsToDocuments([...rawItems, reParented], { dataDir: DATA_DIR })
    const parent = documents.find((d) => d.externalKey === 'ZL98NX6Y')
    expect(parent?.annotations?.map((a) => a.externalKey)).toEqual(['REPARENT1'])
  })

  it('falls back to kind "other" with no file path when a top-level item has no attachment', () => {
    const bare = {
      key: 'BARE0001',
      data: { key: 'BARE0001', itemType: 'journalArticle', title: 'No PDF here', dateModified: '2026-01-01T00:00:00Z' },
    }
    const { documents } = mapItemsToDocuments([bare], { dataDir: DATA_DIR })
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
      { dataDir: DATA_DIR },
    )
    expect(skipped).toBe(2)
    expect(documents.map((d) => d.externalKey)).toEqual(['BARE0001'])
  })

  it('resolves a linked_file attachment via its absolute path field', () => {
    const parent = { key: 'LNK', data: { key: 'LNK', itemType: 'journalArticle', title: 'Linked' } }
    const att = {
      key: 'LNKATT',
      data: {
        key: 'LNKATT',
        itemType: 'attachment',
        parentItem: 'LNK',
        linkMode: 'linked_file',
        contentType: 'application/pdf',
        path: '/abs/path/to/linked.pdf',
      },
    }
    const { documents } = mapItemsToDocuments([parent, att], { dataDir: DATA_DIR })
    expect(documents[0]?.filePath).toBe('/abs/path/to/linked.pdf')
  })
})

describe('mapCollections', () => {
  it('maps collections and resolves parentExternalKey (false → null)', () => {
    const cols = mapCollections(rawCollections)
    const root = cols.find((c) => c.externalKey === 'ZV7DG2X6')
    const child = cols.find((c) => c.externalKey === 'SWPTENWV')
    expect(root?.parentExternalKey).toBeNull()
    expect(root?.name).toBe('eec_174aby')
    expect(child?.parentExternalKey).toBe('ZV7DG2X6')
  })

  it('skips malformed collection rows', () => {
    const cols = mapCollections([{ junk: 1 }, ...rawCollections])
    expect(cols).toHaveLength(rawCollections.length)
  })
})
