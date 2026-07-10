import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAccessApi } from './access'
import type { Connector } from '../connectors/types'

/**
 * The grant-access probe (in-app permission flow): reading the source's on-disk
 * root FROM THE APP PROCESS is what summons the native macOS consent dialog —
 * terminal-spawned children get silently denied. The probe itself is plain fs:
 * readable → granted; permission error → open the Full Disk Access pane
 * (deep-link fallback, injected); anything else is not a permission problem.
 */
const fakeConnector = (over: Partial<Connector>): Connector => ({
  key: 'obsidian',
  checkAvailable: async () => ({ available: true }),
  scan: async () => ({ cursor: null, documentsUpserted: 0, annotationsUpserted: 0 }),
  resolve: async (uri) => ({ uri }),
  ...over,
})

let dir: string
let opened: string[]
const deps = { openSettings: async () => void opened.push('settings') }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrolabe-access-'))
  opened = []
})
afterEach(() => {
  chmodSync(dir, 0o700)
  rmSync(dir, { recursive: true, force: true })
})

describe('requestAccess', () => {
  it('grants when the probe path is readable', async () => {
    const c = fakeConnector({ accessProbePath: async () => dir })
    const api = createAccessApi([c], deps)
    const result = await api.requestAccess('obsidian')
    expect(result).toEqual({ sourceKey: 'obsidian', granted: true, settingsOpened: false })
    expect(opened).toEqual([])
  })

  it('opens the Full Disk Access pane when the probe is permission-denied', async () => {
    const blocked = join(dir, 'blocked')
    mkdirSync(blocked)
    chmodSync(blocked, 0o000)
    const c = fakeConnector({ accessProbePath: async () => blocked })
    const api = createAccessApi([c], deps)
    const result = await api.requestAccess('obsidian')
    chmodSync(blocked, 0o700)
    expect(result).toEqual({ sourceKey: 'obsidian', granted: false, settingsOpened: true, reason: 'denied' })
    expect(opened).toEqual(['settings'])
  })

  it('reports missing (no settings) when the probe path does not exist', async () => {
    const c = fakeConnector({ accessProbePath: async () => join(dir, 'nope') })
    const api = createAccessApi([c], deps)
    const result = await api.requestAccess('obsidian')
    expect(result).toEqual({ sourceKey: 'obsidian', granted: false, settingsOpened: false, reason: 'missing' })
    expect(opened).toEqual([])
  })

  it('reports no-path when the connector exposes no probe path', async () => {
    const c = fakeConnector({}) // no accessProbePath
    const api = createAccessApi([c], deps)
    const result = await api.requestAccess('obsidian')
    expect(result).toEqual({ sourceKey: 'obsidian', granted: false, settingsOpened: false, reason: 'no-path' })
  })

  it('reports no-path for a source key not in the registry', async () => {
    const api = createAccessApi([], deps)
    const result = await api.requestAccess('eagle')
    expect(result).toEqual({ sourceKey: 'eagle', granted: false, settingsOpened: false, reason: 'no-path' })
  })
})
