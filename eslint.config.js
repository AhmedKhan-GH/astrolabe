import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importX from 'eslint-plugin-import-x'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'out']),
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Electron main & preload, tests, and build/test configs run in Node, not the browser.
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'e2e/**/*.ts',
      'scripts/**/*.ts',
      'electron.vite.config.ts',
      'playwright.config.ts',
      'vitest.config.ts',
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Iron-rule boundaries (doc 10 §5), mechanical: lib is foundation and imports no
    // feature layer; shared imports nothing app-side; connectors never import each
    // other (per-connector zones join as connectors land, runway steps 4/5/8).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: './src/main/lib', from: './src/main/connectors' },
            { target: './src/main/connectors/zotero', from: './src/main/connectors/eagle' },
            { target: './src/main/connectors/eagle', from: './src/main/connectors/zotero' },
            { target: './src/main/connectors/obsidian', from: './src/main/connectors/zotero' },
            { target: './src/main/connectors/obsidian', from: './src/main/connectors/eagle' },
            { target: './src/main/connectors/zotero', from: './src/main/connectors/obsidian' },
            { target: './src/main/connectors/eagle', from: './src/main/connectors/obsidian' },
            { target: './src/main/lib', from: './src/main/db' },
            { target: './src/main/lib', from: './src/main/index' },
            { target: './src/shared', from: './src/main' },
            { target: './src/shared', from: './src/preload' },
            { target: './src/shared', from: './src/renderer' },
          ],
        },
      ],
    },
  },
])
