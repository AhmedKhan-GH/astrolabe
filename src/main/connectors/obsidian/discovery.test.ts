import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultObsidianRegistryPath,
  discoverObsidianVaultPaths,
} from './discovery'

/**
 * Tier A unit: Obsidian's registered-vault file is the discovery boundary,
 * equivalent to Eagle's /library/history boundary. Drive it with a tmp registry
 * so path resolution, schema tolerance, normalization, and failure behavior are
 * all deterministic and never depend on the developer's real Obsidian install.
 */

const dirs: string[] = []

function tempRegistry(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'astrolabe-obsidian-registry-'))
  dirs.push(dir)
  const registryPath = join(dir, 'obsidian.json')
  writeFileSync(registryPath, JSON.stringify(value))
  return registryPath
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('defaultObsidianRegistryPath', () => {
  it('resolves the platform-native Obsidian registry location', () => {
    expect(
      defaultObsidianRegistryPath({
        platform: 'darwin',
        homeDir: '/Users/ahmed',
        env: {},
      }),
    ).toBe('/Users/ahmed/Library/Application Support/obsidian/obsidian.json')

    expect(
      defaultObsidianRegistryPath({
        platform: 'linux',
        homeDir: '/home/ahmed',
        env: { XDG_CONFIG_HOME: '/config' },
      }),
    ).toBe('/config/obsidian/obsidian.json')

    expect(
      defaultObsidianRegistryPath({
        platform: 'win32',
        homeDir: 'C:\\Users\\ahmed',
        env: { APPDATA: 'C:\\Users\\ahmed\\AppData\\Roaming' },
      }),
    ).toBe(join('C:\\Users\\ahmed\\AppData\\Roaming', 'obsidian', 'obsidian.json'))
  })
})

describe('discoverObsidianVaultPaths', () => {
  it('reads registered paths, normalizes trailing slashes, and dedupes in registry order', () => {
    const registryPath = tempRegistry({
      vaults: {
        alpha: { path: '/vaults/Alpha/', ts: 3, open: true },
        alphaDuplicate: { path: '/vaults/Alpha', ts: 2 },
        beta: { path: '/vaults/Beta', ts: 1, open: false },
      },
    })

    expect(discoverObsidianVaultPaths(registryPath)).toEqual(['/vaults/Alpha', '/vaults/Beta'])
  })

  it('ignores malformed entries without losing valid registered vaults', () => {
    const registryPath = tempRegistry({
      vaults: {
        valid: { path: '/vaults/Valid' },
        missingPath: { open: true },
        wrongPathType: { path: 42 },
        notAnObject: 'bad',
      },
    })

    expect(discoverObsidianVaultPaths(registryPath)).toEqual(['/vaults/Valid'])
  })

  it('returns an empty list when Obsidian has not created a registry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrolabe-no-obsidian-registry-'))
    dirs.push(dir)
    const registryPath = join(dir, 'nested', 'obsidian.json')
    mkdirSync(dirname(registryPath), { recursive: true })

    expect(discoverObsidianVaultPaths(registryPath)).toEqual([])
  })

  it('surfaces malformed JSON so the connector can log it and fall back explicitly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrolabe-bad-obsidian-registry-'))
    dirs.push(dir)
    const registryPath = join(dir, 'obsidian.json')
    writeFileSync(registryPath, '{')

    expect(() => discoverObsidianVaultPaths(registryPath)).toThrow()
  })
})
