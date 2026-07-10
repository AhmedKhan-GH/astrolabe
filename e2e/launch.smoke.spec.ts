import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

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
  // `pnpm test:e2e` runs electron-vite build first.
  app = await electron.launch({ args: ['.'] })
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

test('window opens and React renders real DOM', async () => {
  // The template renders into #root; an empty #root means the renderer bundle
  // failed silently (the class of failure a phantom shell produces).
  const root = window.locator('#root')
  await expect(root).toBeVisible()
  expect(await root.locator(':scope > *').count()).toBeGreaterThan(0)
})

test('preload bridge exposes exactly its allowlist', async () => {
  const api = await window.evaluate(() => (window as never as Record<string, unknown>)['astrolabe'])
  // The bridge surface is a security contract: exactly these keys, nothing more.
  expect(api).toBeTruthy()
  expect(Object.keys(api as object)).toEqual(['versions'])
  const versions = (api as { versions: Record<string, unknown> }).versions
  expect(typeof versions.electron).toBe('string')
  expect(typeof versions.chrome).toBe('string')
  expect(typeof versions.node).toBe('string')
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
