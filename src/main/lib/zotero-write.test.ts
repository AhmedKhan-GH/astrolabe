import { describe, it, expect, vi } from 'vitest'
import { buildSaveItemsBody, buildAttachmentMetadata, createZoteroWrite } from './zotero-write'

const doc = { title: 'A Paper', tags: ['ml', 'stats'], filePath: '/tmp/a.pdf' }

const okResponse = (): Response => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response
const errResponse = (status: number, body: string): Response =>
  ({ ok: false, status, text: async () => body }) as unknown as Response

describe('zotero-write payload builders', () => {
  it('saveItems body: itm1 / itemType document / tags mapped to [{tag}]', () => {
    expect(buildSaveItemsBody('sess-1', doc)).toEqual({
      sessionID: 'sess-1',
      items: [{ id: 'itm1', itemType: 'document', title: 'A Paper', tags: [{ tag: 'ml' }, { tag: 'stats' }] }],
    })
  })

  it('attachment X-Metadata ties the PDF to the parent item', () => {
    expect(buildAttachmentMetadata('sess-1', doc)).toEqual({
      sessionID: 'sess-1',
      parentItemID: 'itm1',
      title: 'A Paper',
    })
  })
})

describe('zotero-write promoteDocument error mapping', () => {
  it('a refused connection reads as "Zotero isn\'t running"', async () => {
    const fetch = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    const w = createZoteroWrite({ fetch: fetch as unknown as typeof globalThis.fetch, readFile: async () => Buffer.from('%PDF') })
    const res = await w.promoteDocument(doc)
    expect(res).toEqual({ ok: false, reason: "Zotero isn't running — open it and retry" })
  })

  it('a non-2xx surfaces the status + body snippet', async () => {
    const fetch = vi.fn().mockResolvedValue(errResponse(400, 'bad session'))
    const w = createZoteroWrite({ fetch: fetch as unknown as typeof globalThis.fetch, readFile: async () => Buffer.from('%PDF') })
    const res = await w.promoteDocument(doc)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toContain('400')
      expect(res.reason).toContain('bad session')
    }
  })

  it('an unreadable file fails before any network call (not "Zotero isn\'t running")', async () => {
    const fetch = vi.fn()
    const w = createZoteroWrite({
      fetch: fetch as unknown as typeof globalThis.fetch,
      readFile: async () => {
        throw new Error('ENOENT')
      },
    })
    const res = await w.promoteDocument(doc)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/could not read/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('happy path posts saveItems then saveAttachment and never sends the API-version header', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return okResponse()
    })
    const w = createZoteroWrite({ fetch: fetch as unknown as typeof globalThis.fetch, readFile: async () => Buffer.from('%PDF-1.7') })
    const res = await w.promoteDocument(doc)
    expect(res).toEqual({ ok: true })
    expect(calls.map((c) => c.url)).toEqual([
      'http://localhost:23119/connector/saveItems',
      'http://localhost:23119/connector/saveAttachment',
    ])
    const attach = calls[1]!.init.headers as Record<string, string>
    expect(attach['Content-Type']).toBe('application/pdf')
    expect(attach['X-Metadata']).toContain('itm1')
    // The version-warning gate must stay untriggered (research §Gotchas).
    for (const c of calls) {
      const h = c.init.headers as Record<string, string>
      expect(Object.keys(h)).not.toContain('X-Zotero-Connector-API-Version')
    }
  })
})
