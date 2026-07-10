import { defineConfig } from '@playwright/test'

// E2E harness: drives the built Electron app via Playwright's _electron launcher.
// Run `pnpm test:e2e` (builds first — the tests exercise out/, not source).
export default defineConfig({
  testDir: './e2e',
  // One Electron app instance at a time; parallel launches fight over the dock/GPU.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,
})
