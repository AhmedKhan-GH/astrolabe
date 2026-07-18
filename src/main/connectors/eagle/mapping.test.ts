import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extToKind, flattenFolders, mapItem, mapItems, resolveFilePath } from './mapping'

/**
 * Tier A unit: the Eagle raw-JSON → index-input mapping is PURE (no fs, no net),
 * so it is driven entirely from sanitized live-API fixtures (docs/03). The money
 * logic (the hash join) is covered in eagle.itest.ts; here we prove every shape
 * transform: folder-tree flattening, multi-membership, ext→kind, tags, file-path
 * layout, and malformed/deleted row rejection. v2: mapping emits LibraryDocumentInput
 * (no sourceKey, no libraryId — sync supplies the library).
 */
const FIXTURES = join(__dirname, '__fixtures__')
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T
}

const LIBRARY = '/Users/ahmed/Library/Mobile Documents/com~apple~CloudDocs/Eagle/Books.library'
const libInfo = fixture<{ library: { path: string }; folders: unknown[] }>('library-info.json')
const rawItems = fixture<unknown[]>('items.json')

describe('flattenFolders', () => {
  it('flattens a nested tree into parent-keyed CollectionInputs', () => {
    const flat = flattenFolders(libInfo.folders)
    const byKey = new Map(flat.map((c) => [c.externalKey, c]))
    // every node present
    expect(byKey.size).toBe(4)
    // roots have no parent
    expect(byKey.get('MACHGP7E724GJ')?.parentExternalKey).toBeNull()
    expect(byKey.get('MD7UT6LA5IP8U')?.parentExternalKey).toBeNull()
    // children carry their parent's externalKey
    expect(byKey.get('MPC7EA9367GXO')?.parentExternalKey).toBe('MACHGP7E724GJ')
    expect(byKey.get('MI2XSLJMEUKJJ')?.parentExternalKey).toBe('MACHGP7E724GJ')
    // names preserved
    expect(byKey.get('MPC7EA9367GXO')?.name).toBe('Griffiths Introduction Quantum Mechanics')
  })

  it('skips malformed folder rows without throwing', () => {
    const flat = flattenFolders([{ id: 'OK', name: 'Fine', children: [] }, { name: 'no id' }, 42, null])
    expect(flat.map((c) => c.externalKey)).toEqual(['OK'])
  })
})

describe('extToKind', () => {
  it('maps pdf → pdf (Eagle PDFs are first-class documents)', () => {
    expect(extToKind('pdf')).toBe('pdf')
    expect(extToKind('PDF')).toBe('pdf')
  })
  it('maps raster/vector image exts → image', () => {
    for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic']) expect(extToKind(e)).toBe('image')
  })
  it('everything else (incl. missing ext) → other', () => {
    expect(extToKind('zip')).toBe('other')
    expect(extToKind('')).toBe('other')
    expect(extToKind(undefined)).toBe('other')
  })
})

describe('resolveFilePath', () => {
  it('builds <library>/images/<id>.info/<name>.<ext>', () => {
    expect(resolveFilePath({ id: 'MPC79WQDBP4BY', name: 'griffiths', ext: 'pdf' }, LIBRARY)).toBe(
      `${LIBRARY}/images/MPC79WQDBP4BY.info/griffiths.pdf`,
    )
  })
  it('returns null when the item has no ext (link/bookmark, not file-backed)', () => {
    expect(resolveFilePath({ id: 'MABC0LINK002', name: 'ref' }, LIBRARY)).toBeNull()
  })
})

describe('mapItem', () => {
  const griffiths = rawItems[0] as { id: string }
  const doc = mapItem(griffiths, LIBRARY)

  it('sets externalKey, deep-link uri and title from name (no sourceKey — v2)', () => {
    expect(doc.externalKey).toBe('MPC79WQDBP4BY')
    expect(doc.uri).toBe('eagle://item/MPC79WQDBP4BY')
    expect(doc.title).toBe('docsity-david-griffiths-qunatum-mechanics-solution-manual-3th')
    expect(doc.kind).toBe('pdf')
    expect(doc.modifiedAt).toBe(1779168982261)
    expect('sourceKey' in doc).toBe(false)
  })

  it('carries tags and folder memberships (collectionKeys)', () => {
    expect(doc.tags).toEqual(['Griffiths', 'mathematics', 'science', 'quantum mechanics'])
    expect(doc.collectionKeys).toEqual(['MPC7EA9367GXO'])
  })

  it('resolves the on-disk file path from the library layout (no hash yet — scan hashes)', () => {
    expect(doc.filePath).toBe(
      `${LIBRARY}/images/MPC79WQDBP4BY.info/docsity-david-griffiths-qunatum-mechanics-solution-manual-3th.pdf`,
    )
    expect(doc.contentSha256).toBeUndefined()
  })

  it('preserves multiple folder membership 1:1', () => {
    const multi = mapItem(rawItems[1] as { id: string }, LIBRARY)
    expect(multi.collectionKeys).toEqual(['MPC7EA9367GXO', 'MD7UT6LA5IP8U'])
  })
})

describe('mapItems', () => {
  it('maps valid rows, skips deleted and malformed rows', () => {
    const withGarbage = [...rawItems, { name: 'no id' }, null, { id: 'X' /* no name */ }, 7]
    const docs = mapItems(withGarbage, LIBRARY)
    const keys = docs.map((d) => d.externalKey)
    // 5 valid, non-deleted rows from the fixture; the trash row + garbage excluded
    expect(keys).toEqual(['MPC79WQDBP4BY', 'MPC6SM76S55H8', 'MQIYEW70BY9J1', 'MABC0IMAGE001', 'MABC0LINK002'])
    expect(keys).not.toContain('MABC0TRASH03')
  })

  it('maps an image ext to kind image and a bookmark (no ext) to other with null filePath', () => {
    const docs = mapItems(rawItems, LIBRARY)
    const image = docs.find((d) => d.externalKey === 'MABC0IMAGE001')
    const link = docs.find((d) => d.externalKey === 'MABC0LINK002')
    expect(image?.kind).toBe('image')
    expect(link?.kind).toBe('other')
    expect(link?.filePath).toBeNull()
  })
})
