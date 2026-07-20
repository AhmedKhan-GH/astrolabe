import { describe, it, expect, vi } from 'vitest'
import { createEagleClient } from './client'

/**
 * Tier A unit: the two library-control methods added for the Eagle switch (spec
 * §B). Both are driven through an INJECTED fake fetch (no live Eagle) so we can
 * assert the wire shape exactly:
 *  - knownLibraries reads /library/history and normalizes + dedupes the
 *    trailing-slash duplicates the live probe returned (`X.library/` AND
 *    `X.library` → one entry);
 *  - switchLibrary POSTs a JSON `{ libraryPath }` body and throws on a
 *    non-success envelope.
 */

/** A minimal fake Response the client's `res.ok`/`res.json()` path accepts. */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

describe('eagle client — knownLibraries', () => {
  it('reads /library/history and normalizes + dedupes trailing-slash duplicates', async () => {
    const fetchFn = vi.fn(async (url: URL | string) => {
      expect(String(url)).toContain('/library/history')
      return jsonResponse({
        status: 'success',
        data: [
          '/Users/a/Stanford Summer.library/',
          '/Users/a/Stanford Summer.library',
          '/Users/a/Research.library',
          '/Users/a/Research.library/',
        ],
      })
    })
    const client = createEagleClient({ fetchFn: fetchFn as unknown as typeof fetch })

    const libs = await client.knownLibraries()

    expect(libs).toEqual(['/Users/a/Stanford Summer.library', '/Users/a/Research.library'])
  })

  it('throws when the history envelope is not success', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ status: 'error', data: [] }))
    const client = createEagleClient({ fetchFn: fetchFn as unknown as typeof fetch })
    await expect(client.knownLibraries()).rejects.toThrow()
  })
})

describe('eagle client — switchLibrary', () => {
  it('POSTs a JSON { libraryPath } body to /library/switch', async () => {
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    const fetchFn = vi.fn(async (url: URL | string, init?: RequestInit) => {
      seenUrl = String(url)
      seenInit = init
      return jsonResponse({ status: 'success' })
    })
    const client = createEagleClient({ fetchFn: fetchFn as unknown as typeof fetch })

    await client.switchLibrary('/Users/a/Research.library')

    expect(seenUrl).toContain('/library/switch')
    expect(seenInit?.method).toBe('POST')
    expect(seenInit?.body).toBe(JSON.stringify({ libraryPath: '/Users/a/Research.library' }))
    expect((seenInit?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('normalizes a trailing slash off the switched path', async () => {
    let body = ''
    const fetchFn = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      body = String(init?.body)
      return jsonResponse({ status: 'success' })
    })
    const client = createEagleClient({ fetchFn: fetchFn as unknown as typeof fetch })
    await client.switchLibrary('/Users/a/Research.library/')
    expect(body).toBe(JSON.stringify({ libraryPath: '/Users/a/Research.library' }))
  })

  it('throws on a non-success switch envelope (leaves the caller to abort)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ status: 'error' }))
    const client = createEagleClient({ fetchFn: fetchFn as unknown as typeof fetch })
    await expect(client.switchLibrary('/Users/a/Nope.library')).rejects.toThrow()
  })
})
