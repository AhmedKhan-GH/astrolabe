import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Launch smoke test (INFRASTRUCTURE-SPEC Pillar 1): the app boots, renders, and
 * holds its security posture. Assertions are behavioral consequences, not config
 * literals (ADR-0006 — asserting on webPreferences would be a change-detector;
 * asserting the renderer actually has no Node reach is the real contract).
 */

let app: ElectronApplication
let window: Page
const pageErrors: Error[] = []
const consoleErrors: string[] = []

test.beforeAll(async () => {
  // Launches the built app (out/main/index.js via package.json "main").
  // `pnpm test:e2e` runs electron-vite build first. A temp workspace keeps the
  // test from touching the real ~/Astrolabe (ASTROLABE_WORKSPACE override).
  const workspace = mkdtempSync(join(tmpdir(), 'astrolabe-e2e-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, ASTROLABE_WORKSPACE: workspace },
  })
  window = await app.firstWindow()
  window.on('pageerror', (err) => pageErrors.push(err))
  window.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('window opens and the lens renders', async () => {
  // An empty #root means the renderer bundle failed silently (the phantom-shell
  // failure class). The lens's search box is the app's primary affordance.
  const root = window.locator('#root')
  await expect(root).toBeVisible()
  expect(await root.locator(':scope > *').count()).toBeGreaterThan(0)
  await expect(window.getByPlaceholder(/search your library/i)).toBeVisible()
  // Scoped to the header: the river's empty state also says "Sync now" (navigator v1).
  await expect(window.getByRole('banner').getByRole('button', { name: 'Sync now' })).toBeVisible()
  await expect(window.getByRole('banner').getByRole('button', { name: 'Rebuild index' })).toBeVisible()
})

test('preload bridge exposes exactly its allowlist', async () => {
  const api = await window.evaluate(() => (window as never as Record<string, unknown>)['astrolabe'])
  // The bridge surface is a security contract: exactly these keys, nothing more.
  expect(api).toBeTruthy()
  expect(Object.keys(api as object).sort()).toEqual([
    'collections',
    'db',
    'index',
    'system',
    'versions',
    'views',
  ])
  const versions = (api as { versions: Record<string, unknown> }).versions
  expect(typeof versions.electron).toBe('string')
  expect(typeof versions.chrome).toBe('string')
  expect(typeof versions.node).toBe('string')
})

test('db round-trip over typed IPC (renderer → main → sqlite)', async () => {
  const result = await window.evaluate(async () => {
    type MetaClient = {
      create: (v: { key: string; value: string }) => Promise<{ id: number; key: string; value: string }>
      getById: (id: number) => Promise<{ value: string } | null>
      remove: (id: number) => Promise<number>
      getAll: () => Promise<unknown[]>
    }
    const meta = (window as never as { astrolabe: { db: { meta: MetaClient } } }).astrolabe.db.meta
    const created = await meta.create({ key: `smoke-${Date.now()}`, value: 'ok' })
    const fetched = await meta.getById(created.id)
    const removed = await meta.remove(created.id)
    return { createdId: created.id, fetchedValue: fetched?.value, removed }
  })
  expect(result.createdId).toBeGreaterThan(0)
  expect(result.fetchedValue).toBe('ok')
  expect(result.removed).toBe(1)
})

test('renderer has no Node reach (context isolation holds)', async () => {
  const leaks = await window.evaluate(() => ({
    require: typeof (window as never as Record<string, unknown>)['require'],
    process: typeof (window as never as Record<string, unknown>)['process'],
    Buffer: typeof (window as never as Record<string, unknown>)['Buffer'],
  }))
  expect(leaks).toEqual({ require: 'undefined', process: 'undefined', Buffer: 'undefined' })
})

test('boot is clean — no page errors, no console errors, preload loaded', async () => {
  // Give the renderer a beat to surface any late boot errors.
  await window.waitForTimeout(500)
  expect(pageErrors).toEqual([])
  // Console *errors* only — Electron's dev-mode CSP advisory is a warning and is
  // expected until the app is packaged (docs/07 as-built notes).
  expect(consoleErrors).toEqual([])
})

test('astro scheme is fetchable from the renderer (404 on unknown doc instance)', async () => {
  // Status 404 proves the whole chain: scheme privileges (supportFetchAPI — without
  // it fetch throws/returns 0 and pdf.js canvas loads fail), handler registration,
  // and the index allowlist rejecting an id it does not know.
  const status = await window.evaluate(() =>
    fetch('astro://doc/999999').then(
      (r) => r.status,
      (e) => `fetch rejected: ${String(e)}`,
    ),
  )
  expect(status).toBe(404)
})
