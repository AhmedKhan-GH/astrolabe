import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/**
 * The `.astrolabe/` workspace (docs/03; runway spec step 2 — provisionally resolves
 * D-INF-1). Default root is ~/Astrolabe; ASTROLABE_WORKSPACE overrides it (used by
 * e2e tests, and later by the workspace-chooser setting). Everything inside
 * `.astrolabe/` except the manifest is derived and rebuildable (ADR-0005).
 */
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.uuid(),
  createdAt: z.iso.datetime(),
  /** Per-connector user config (no secrets — docs/03). Absent = connector defaults. */
  connectors: z
    .object({
      obsidian: z.object({ vaultPath: z.string() }).partial().optional(),
    })
    .partial()
    .optional(),
})
export type WorkspaceManifest = z.infer<typeof manifestSchema>

export interface Workspace {
  root: string
  astroDir: string
  dbPath: string
  manifest: WorkspaceManifest
}

export function workspaceRoot(): string {
  return process.env['ASTROLABE_WORKSPACE'] ?? join(homedir(), 'Astrolabe')
}

/**
 * Create-or-open the workspace. Fail closed (throws) on an unreadable or invalid
 * manifest — a half-configured workspace must stop boot, not limp (doc 10 §4).
 */
export function ensureWorkspace(): Workspace {
  const root = workspaceRoot()
  const astroDir = join(root, '.astrolabe')
  mkdirSync(astroDir, { recursive: true })

  const manifestPath = join(astroDir, 'manifest.json')
  let manifest: WorkspaceManifest
  if (existsSync(manifestPath)) {
    manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  } else {
    manifest = {
      schemaVersion: 1,
      workspaceId: randomUUID(),
      createdAt: new Date().toISOString(),
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  }

  return { root, astroDir, dbPath: join(astroDir, 'index.db'), manifest }
}
