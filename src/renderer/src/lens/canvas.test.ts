import { describe, it, expect } from 'vitest'
import { canvasCandidates } from './canvas'
import type { BrowseInstance } from './types'

const inst = (over: Partial<BrowseInstance>): BrowseInstance => ({
  instanceId: 1,
  sourceKey: 'zotero',
  uri: 'zotero://x',
  filePath: '/tmp/x.pdf',
  openPdfUri: null,
  ...over,
})

describe('canvasCandidates', () => {
  it('drops instances with no file on disk', () => {
    const c = canvasCandidates([
      inst({ instanceId: 1, filePath: null }),
      inst({ instanceId: 2, filePath: '/tmp/a.pdf' }),
    ])
    expect(c.map((i) => i.instanceId)).toEqual([2])
  })

  it('orders zotero first, then any other file-backed source (fallback order)', () => {
    const c = canvasCandidates([
      inst({ instanceId: 1, sourceKey: 'eagle', filePath: '/tmp/e.pdf' }),
      inst({ instanceId: 2, sourceKey: 'zotero', filePath: '/tmp/z.pdf' }),
      inst({ instanceId: 3, sourceKey: 'obsidian', filePath: '/tmp/o.pdf' }),
    ])
    expect(c.map((i) => i.instanceId)).toEqual([2, 1, 3])
  })

  it('is empty when nothing is file-backed', () => {
    expect(canvasCandidates([inst({ filePath: null })])).toEqual([])
  })
})
