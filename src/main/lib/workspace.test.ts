import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureWorkspace, resolveObsidianVaultPaths } from './workspace'

/**
 * Tier A unit (spec §A): the Obsidian vault-path resolution/normalization rules
 * branch (plural-wins → singular-wrapped → []) and transform (strip trailing
 * slashes + dedupe), so they get a failing-first test. Plus a manifest-parse
 * check that the schema accepts singular-only / plural-only / both — driven
 * through ensureWorkspace against a tmp workspace (ASTROLABE_WORKSPACE), which
 * uses only node fs (no native modules), so it lives in the unit tier.
 */

describe('resolveObsidianVaultPaths — resolution rules', () => {
  it('returns [] when the obsidian config is absent', () => {
    expect(resolveObsidianVaultPaths(undefined)).toEqual([])
    expect(resolveObsidianVaultPaths({})).toEqual([])
  })

  it('wraps the singular vaultPath into a one-element list', () => {
    expect(resolveObsidianVaultPaths({ vaultPath: '/vaults/Research' })).toEqual(['/vaults/Research'])
  })

  it('uses the plural vaultPaths when present', () => {
    expect(resolveObsidianVaultPaths({ vaultPaths: ['/a', '/b'] })).toEqual(['/a', '/b'])
  })

  it('plural wins when both singular and plural are present', () => {
    expect(
      resolveObsidianVaultPaths({ vaultPath: '/singular', vaultPaths: ['/a', '/b'] }),
    ).toEqual(['/a', '/b'])
  })

  it('an explicitly-present (even empty) plural still wins over the singular', () => {
    expect(resolveObsidianVaultPaths({ vaultPath: '/singular', vaultPaths: [] })).toEqual([])
  })
})

describe('resolveObsidianVaultPaths — normalization', () => {
  it('strips trailing slashes', () => {
    expect(resolveObsidianVaultPaths({ vaultPath: '/vaults/Research/' })).toEqual(['/vaults/Research'])
    expect(resolveObsidianVaultPaths({ vaultPaths: ['/a///'] })).toEqual(['/a'])
  })

  it('dedupes x vs x/ (post-normalization), order-preserving', () => {
    expect(resolveObsidianVaultPaths({ vaultPaths: ['/a', '/a/', '/b', '/a'] })).toEqual(['/a', '/b'])
  })

  it('also normalizes + dedupes the singular-wrapped path', () => {
    expect(resolveObsidianVaultPaths({ vaultPath: '/a/' })).toEqual(['/a'])
  })
})

describe('ensureWorkspace — manifest schema accepts singular / plural / both', () => {
  let root: string
  let savedEnv: string | undefined

  const writeManifest = (obsidian: unknown): void => {
    const astroDir = join(root, '.astrolabe')
    mkdirSync(astroDir, { recursive: true })
    writeFileSync(
      join(astroDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: randomUUID(),
        createdAt: new Date().toISOString(),
        connectors: { obsidian },
      }),
    )
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'astrolabe-workspace-'))
    savedEnv = process.env['ASTROLABE_WORKSPACE']
    process.env['ASTROLABE_WORKSPACE'] = root
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env['ASTROLABE_WORKSPACE']
    else process.env['ASTROLABE_WORKSPACE'] = savedEnv
    rmSync(root, { recursive: true, force: true })
  })

  it('accepts singular-only and resolves it', () => {
    writeManifest({ vaultPath: '/vaults/One' })
    const m = ensureWorkspace().manifest
    expect(resolveObsidianVaultPaths(m.connectors?.obsidian)).toEqual(['/vaults/One'])
  })

  it('accepts plural-only and resolves it', () => {
    writeManifest({ vaultPaths: ['/vaults/One', '/vaults/Two'] })
    const m = ensureWorkspace().manifest
    expect(resolveObsidianVaultPaths(m.connectors?.obsidian)).toEqual(['/vaults/One', '/vaults/Two'])
  })

  it('accepts both and resolves plural-wins', () => {
    writeManifest({ vaultPath: '/vaults/Singular', vaultPaths: ['/vaults/One', '/vaults/Two'] })
    const m = ensureWorkspace().manifest
    expect(resolveObsidianVaultPaths(m.connectors?.obsidian)).toEqual(['/vaults/One', '/vaults/Two'])
  })
})
