import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveObsidianVaultPaths } from '../../lib/workspace'

/**
 * Obsidian's desktop registry is a small JSON object keyed by opaque vault IDs.
 * Only `path` is our contract: tolerate future/unknown registry fields and skip
 * malformed individual entries rather than losing every otherwise-valid vault.
 */
const registrySchema = z
  .object({ vaults: z.record(z.string(), z.unknown()).default({}) })
  .loose()
const vaultEntrySchema = z.object({ path: z.string().min(1) }).loose()

export interface ObsidianRegistryLocationOptions {
  platform?: NodeJS.Platform
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

/** The platform-native registry written by the Obsidian desktop app. */
export function defaultObsidianRegistryPath(
  options: ObsidianRegistryLocationOptions = {},
): string {
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? homedir()
  const env = options.env ?? process.env

  if (platform === 'darwin')
    return join(homeDir, 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  if (platform === 'win32') {
    const appData = env['APPDATA'] ?? join(homeDir, 'AppData', 'Roaming')
    return join(appData, 'obsidian', 'obsidian.json')
  }
  const configHome = env['XDG_CONFIG_HOME'] ?? join(homeDir, '.config')
  return join(configHome, 'obsidian', 'obsidian.json')
}

/**
 * Read Obsidian's registered vault paths. A missing registry means Obsidian is
 * not installed/configured and is not an error. Malformed JSON or a malformed
 * top-level shape throws so the connector can log the anomaly and fall back to
 * explicit manifest paths without degrading the whole source.
 */
export function discoverObsidianVaultPaths(
  registryPath = defaultObsidianRegistryPath(),
): string[] {
  if (!existsSync(registryPath)) return []

  const registry = registrySchema.parse(JSON.parse(readFileSync(registryPath, 'utf8')))
  const paths: string[] = []
  for (const raw of Object.values(registry.vaults)) {
    const entry = vaultEntrySchema.safeParse(raw)
    if (entry.success) paths.push(entry.data.path)
  }
  return resolveObsidianVaultPaths({ vaultPaths: paths })
}
