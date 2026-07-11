import { describe, it, expect } from 'vitest'
import { createZoteroClient } from './client'

/**
 * Unit tier: the keys-only enumeration used by removal reconciliation, driven through an
 * injected fetch (no network). Grounds the method in what curl verified live 2026-07-11:
 *  - `GET /items/top?format=keys` → text/plain, newline-delimited top-level item keys.
 *  - trashed items are EXCLUDED by default (no includeTrashed) — that is what makes a
 *    Zotero trash count as a deletion for the sweep.
 *  - pagination via the `Total-Results` header + `start`/`limit`, same as the JSON walk.
 */

/** A fetch stub serving newline-delimited keys with a Total-Results header, honoring `start`. */
function keysFetch(allKeys: string[], pageSize: number): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchFn = (async (url: string | URL) => {
    const u = new URL(String(url))
    calls.push(u.pathname + u.search)
    const start = Number(u.searchParams.get('start') ?? '0')
    const page = allKeys.slice(start, start + pageSize)
    return new Response(page.join('\n'), {
      status: 200,
      headers: { 'Total-Results': String(allKeys.length), 'Content-Type': 'text/plain' },
    })
  }) as unknown as typeof fetch
  return { fetch: fetchFn, calls }
}

describe('zotero client — fetchAllTopLevelKeys', () => {
  it('hits /items/top with format=keys and NO includeTrashed (trash excluded by default)', async () => {
    const { fetch, calls } = keysFetch(['AAAA', 'BBBB'], 100)
    const client = createZoteroClient({ fetchFn: fetch })

    const keys = await client.fetchAllTopLevelKeys()

    expect(keys).toEqual(['AAAA', 'BBBB'])
    expect(calls[0]).toContain('/items/top')
    expect(calls[0]).toContain('format=keys')
    expect(calls[0]).not.toContain('includeTrashed')
  })

  it('paginates via Total-Results + start until the full key set is collected', async () => {
    const all = Array.from({ length: 250 }, (_, i) => `K${i}`)
    const { fetch, calls } = keysFetch(all, 100)
    const client = createZoteroClient({ fetchFn: fetch })

    const keys = await client.fetchAllTopLevelKeys()

    expect(keys).toHaveLength(250)
    expect(keys).toEqual(all)
    // 3 pages: start=0, 100, 200.
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('start=0')
    expect(calls[1]).toContain('start=100')
    expect(calls[2]).toContain('start=200')
  })

  it('an empty source yields an empty array (a legitimate sweep-everything signal)', async () => {
    const { fetch } = keysFetch([], 100)
    const client = createZoteroClient({ fetchFn: fetch })
    expect(await client.fetchAllTopLevelKeys()).toEqual([])
  })
})
