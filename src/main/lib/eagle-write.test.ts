import { describe, it, expect, vi } from 'vitest'
import { buildAddFromPathBody, createEagleWrite } from './eagle-write'

const doc = { title: 'A Paper', tags: ['ml'], filePath: '/tmp/a.pdf', externalKey: 'ITEMKEY9' }

const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response

describe('eagle-write payload builder', () => {
  it('addFromPath body carries path/name/tags and a zotero back-link website', () => {
    expect(buildAddFromPathBody(doc)).toEqual({
      path: '/tmp/a.pdf',
      name: 'A Paper',
      tags: ['ml'],
      website: 'zotero://select/library/items/ITEMKEY9',
    })
  })
})

describe('eagle-write importDocument error mapping', () => {
  it('a refused connection reads as "Eagle isn\'t running"', async () => {
    const fetch = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    const w = createEagleWrite({ fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await w.importDocument(doc)).toEqual({ ok: false, reason: "Eagle isn't running — open it and retry" })
  })

  it('a non-2xx surfaces the status', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(500, { status: 'error' }))
    const w = createEagleWrite({ fetch: fetch as unknown as typeof globalThis.fetch })
    const res = await w.importDocument(doc)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('500')
  })

  it('a 200 with status !== success is a failure', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'error', data: 'nope' }))
    const w = createEagleWrite({ fetch: fetch as unknown as typeof globalThis.fetch })
    expect((await w.importDocument(doc)).ok).toBe(false)
  })

  it('a 200 status success is ok', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'success', data: {} }))
    const w = createEagleWrite({ fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await w.importDocument(doc)).toEqual({ ok: true })
  })
})
