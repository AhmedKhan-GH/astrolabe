import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server, type IncomingMessage } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createZoteroWrite } from './zotero-write'

/**
 * Mock-server integration for the Zotero connector write path (spec §Testing → Integration): a real
 * local HTTP fixture asserting the EXACT requests — paths, headers (no version header), and that the
 * PDF is STREAMED as raw bytes, not JSON-encoded. The connector protocol is Zotero-internal, so the
 * live canary (zotero-write.live.itest.ts) pins it against a running Zotero; this pins our framing.
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
let dir: string
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-zwrite-'))
  server = createServer(async (req, res) => {
    captured.push({ method: req.method!, url: req.url!, headers: req.headers, body: await readBody(req) })
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`
})
afterAll(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  captured = []
})

describe('zotero-write against a mock connector server', () => {
  it('posts saveItems (JSON) then saveAttachment (raw PDF bytes) with the right framing', async () => {
    const filePath = join(dir, 'a.pdf')
    writeFileSync(filePath, PDF_BYTES)
    const w = createZoteroWrite({ baseUrl: base })

    const res = await w.promoteDocument({ title: 'A Paper', tags: ['ml', 'stats'], filePath })
    expect(res).toEqual({ ok: true })

    expect(captured).toHaveLength(2)
    const [items, attach] = captured

    // 1) saveItems: JSON translator-item.
    expect(items!.method).toBe('POST')
    expect(items!.url).toBe('/connector/saveItems')
    expect(items!.headers['content-type']).toBe('application/json')
    const itemsBody = JSON.parse(items!.body.toString('utf-8'))
    expect(itemsBody.items[0]).toMatchObject({
      id: 'itm1',
      itemType: 'document',
      title: 'A Paper',
      tags: [{ tag: 'ml' }, { tag: 'stats' }],
    })
    expect(typeof itemsBody.sessionID).toBe('string')

    // 2) saveAttachment: raw PDF bytes, X-Metadata, same session, NO version header.
    expect(attach!.url).toBe('/connector/saveAttachment')
    expect(attach!.headers['content-type']).toBe('application/pdf')
    expect(attach!.body.equals(PDF_BYTES)).toBe(true) // streamed bytes, not JSON
    const meta = JSON.parse(String(attach!.headers['x-metadata']))
    expect(meta).toMatchObject({ parentItemID: 'itm1', title: 'A Paper', sessionID: itemsBody.sessionID })
    expect(attach!.headers['x-zotero-connector-api-version']).toBeUndefined()
    expect(items!.headers['x-zotero-connector-api-version']).toBeUndefined()
  })
})
