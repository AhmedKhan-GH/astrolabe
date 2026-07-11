import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server, type IncomingMessage } from 'node:http'
import { createEagleWrite } from './eagle-write'

/**
 * Mock-server integration for the Eagle write path (spec §Testing → Integration): a real local HTTP
 * fixture asserting the exact addFromPath request — path, JSON body, and the zotero back-link URI.
 */
interface Captured {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: Buffer
}

let server: Server
let base: string
let captured: Captured[]

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })

beforeAll(async () => {
  server = createServer(async (req, res) => {
    captured.push({ method: req.method!, url: req.url!, headers: req.headers, body: await readBody(req) })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'success', data: { id: 'NEW' } }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}/api`
})
afterAll(() => server.close())
beforeEach(() => {
  captured = []
})

describe('eagle-write against a mock Eagle API', () => {
  it('posts addFromPath with path/name/tags and a zotero back-link website', async () => {
    const w = createEagleWrite({ baseUrl: base })
    const res = await w.importDocument({
      title: 'A Paper',
      tags: ['ml'],
      filePath: '/lib/a.pdf',
      externalKey: 'ITEMKEY9',
    })
    expect(res).toEqual({ ok: true })

    expect(captured).toHaveLength(1)
    const call = captured[0]!
    expect(call.method).toBe('POST')
    expect(call.url).toBe('/api/item/addFromPath')
    expect(call.headers['content-type']).toBe('application/json')
    expect(JSON.parse(call.body.toString('utf-8'))).toEqual({
      path: '/lib/a.pdf',
      name: 'A Paper',
      tags: ['ml'],
      website: 'zotero://select/library/items/ITEMKEY9',
    })
  })
})
