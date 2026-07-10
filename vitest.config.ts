import { defineConfig } from 'vitest/config'

// Unit tier (ADR-0006 Tier A/B): pure logic — connector parsers, index operations,
// the context assembler. No unit tests exist yet, deliberately: the first
// Tier-A logic (the DB table-client dispatch, then Zotero connector parsing)
// brings the first real specs. passWithNoTests keeps the gate honest until then —
// no placeholder example specs (the iteration-2 test-theater scar, docs/01).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    passWithNoTests: true,
  },
})
