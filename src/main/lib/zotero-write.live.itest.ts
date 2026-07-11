import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createZoteroWrite } from './zotero-write'

/**
 * LIVE canary (spec §Testing → Live pin) — SKIPPED unless ASTROLABE_LIVE_ZOTERO=1. The connector
 * protocol is Zotero-internal (not a versioned public REST contract), so this promotes a throwaway
 * generated PDF against a RUNNING Zotero to catch protocol drift on Zotero upgrades. It writes a real
 * item into your library — run it deliberately, then delete the "Astrolabe live-test" item.
 *
 *   ASTROLABE_LIVE_ZOTERO=1 pnpm test:integration
 */
const LIVE = process.env.ASTROLABE_LIVE_ZOTERO === '1'

// A minimal but valid single-page PDF.
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF',
)

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-zlive-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(!LIVE)('zotero-write LIVE canary (real connector server)', () => {
  it('promotes a throwaway PDF into the running Zotero', async () => {
    const filePath = join(dir, 'astrolabe-live-test.pdf')
    writeFileSync(filePath, MINIMAL_PDF)
    const w = createZoteroWrite()
    const res = await w.promoteDocument({
      title: `Astrolabe live-test ${new Date().toISOString()}`,
      tags: ['astrolabe-live-test'],
      filePath,
    })
    expect(res).toEqual({ ok: true })
  })
})
