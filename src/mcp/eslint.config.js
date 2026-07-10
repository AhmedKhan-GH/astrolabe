import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

/**
 * Nested flat config for the MCP server (runway step 7). ESLint v10 resolves the
 * nearest config to each file, so this covers `src/mcp/**` without touching the
 * repo-root eslint.config.js. This process is a standalone Node/Electron program
 * (not bundled by electron-vite), so it lints with Node globals + the shared TS
 * recommended set. `no-console` is hardened here on purpose: stdout is the MCP wire
 * protocol, so only stderr (console.error/warn) may be used.
 */
export default defineConfig([
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      // Two flat configs exist in the repo (root + this one); pin the root dir so
      // typescript-eslint doesn't fail on "multiple candidate TSConfigRootDirs".
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
])
