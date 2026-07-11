import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEagleWrite } from './eagle-write'

/**
 * LIVE canary (spec §Testing → Live pin) — SKIPPED unless ASTROLABE_LIVE_EAGLE=1. Imports a throwaway
 * generated PDF into a RUNNING Eagle to catch API drift. It adds a real item — run deliberately, then
 * trash the imported "astrolabe-live-test" item.
 *
 *   ASTROLABE_LIVE_EAGLE=1 pnpm test:integration
 */
const LIVE = process.env.ASTROLABE_LIVE_EAGLE === '1'

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
)

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-elive-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!LIVE)('eagle-write LIVE canary (real Eagle API)', () => {
  it('imports a throwaway PDF into the running Eagle', async () => {
    const filePath = join(dir, 'astrolabe-live-test.pdf')
    writeFileSync(filePath, MINIMAL_PDF)
    const w = createEagleWrite()
    const res = await w.importDocument({
      title: `astrolabe-live-test ${new Date().toISOString()}`,
      tags: ['astrolabe-live-test'],
      filePath,
      externalKey: 'LIVEKEY',
    })
    expect(res).toEqual({ ok: true })
  })
})
