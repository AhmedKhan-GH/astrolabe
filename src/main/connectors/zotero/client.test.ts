import { describe, it, expect } from 'vitest'
import { createZoteroClient } from './client'

/**
 * Unit tier: the library-scoped surface driven through an injected fetch (no
 * network). Grounds v2 in what curl verified live 2026-07-17: groups enumerate
 * at /users/0/groups, and every endpoint works identically under a
 * /groups/<id> prefix.
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

function jsonFetch(body: unknown): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchFn = (async (url: string | URL) => {
    const u = new URL(String(url))
    calls.push(u.pathname + u.search)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetch: fetchFn, calls }
}

describe('zotero client — library(prefix).fetchAllTopLevelKeys', () => {
  it('hits <prefix>/items/top with format=keys and NO includeTrashed (trash excluded by default)', async () => {
    const { fetch, calls } = keysFetch(['AAAA', 'BBBB'], 100)
    const client = createZoteroClient({ fetchFn: fetch })

    const keys = await client.library('/users/0').fetchAllTopLevelKeys()

    expect(keys).toEqual(['AAAA', 'BBBB'])
    expect(calls[0]).toContain('/api/users/0/items/top')
    expect(calls[0]).toContain('format=keys')
    expect(calls[0]).not.toContain('includeTrashed')
  })

  it('the SAME surface bound to a group prefix hits /groups/<id>/…', async () => {
    const { fetch, calls } = keysFetch(['GGGG'], 100)
    const client = createZoteroClient({ fetchFn: fetch })

    const keys = await client.library('/groups/6356926').fetchAllTopLevelKeys()

    expect(keys).toEqual(['GGGG'])
    expect(calls[0]).toContain('/api/groups/6356926/items/top')
  })

  it('paginates via Total-Results + start until the full key set is collected', async () => {
    const all = Array.from({ length: 250 }, (_, i) => `K${i}`)
    const { fetch, calls } = keysFetch(all, 100)
    const client = createZoteroClient({ fetchFn: fetch })

    const keys = await client.library('/users/0').fetchAllTopLevelKeys()

    expect(keys).toHaveLength(250)
    expect(keys).toEqual(all)
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('start=0')
    expect(calls[1]).toContain('start=100')
    expect(calls[2]).toContain('start=200')
  })

  it('an empty library yields an empty array (a legitimate sweep-everything signal)', async () => {
    const { fetch } = keysFetch([], 100)
    const client = createZoteroClient({ fetchFn: fetch })
    expect(await client.library('/users/0').fetchAllTopLevelKeys()).toEqual([])
  })
})

describe('zotero client — fetchGroups', () => {
  it('enumerates the local client’s groups from /users/0/groups (id + name)', async () => {
    const { fetch, calls } = jsonFetch([
      { id: 6356926, version: 6, data: { id: 6356926, name: 'eec_174aby' } },
    ])
    const client = createZoteroClient({ fetchFn: fetch })

    const groups = await client.fetchGroups()

    expect(groups).toEqual([{ id: 6356926, name: 'eec_174aby' }])
    expect(calls[0]).toContain('/api/users/0/groups')
  })

  it('no groups → empty array (personal-only users)', async () => {
    const { fetch } = jsonFetch([])
    const client = createZoteroClient({ fetchFn: fetch })
    expect(await client.fetchGroups()).toEqual([])
  })
})
