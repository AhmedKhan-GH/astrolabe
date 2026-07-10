import { defineConfig } from 'vitest/config'

/**
 * Two projects (ADR-0006 tiers):
 *  - unit: pure logic, no native modules — plain node.
 *  - integration: real better-sqlite3 + real migrations — run via
 *    `pnpm test:integration`, which executes vitest inside Electron-as-node
 *    (ELECTRON_RUN_AS_NODE) so the electron-ABI native binary loads.
 * jsdom/component project enters with the first component test (runway step 6).
 * passWithNoTests keeps gates honest without placeholder specs (iteration-2 scar).
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          pool: 'threads',
          include: ['src/**/*.itest.ts'],
        },
      },
    ],
  },
})
