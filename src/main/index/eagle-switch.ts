import { moduleLogger } from '../lib/logger'
import { normalizeLibraryPath, type EagleClient } from '../connectors/eagle/client'
import type { SyncOutcome } from './sync'
import type { EagleLibrariesSnapshot } from '../../shared/db-ipc'

/**
 * The Eagle switch orchestrator (multi-library spec §B). Eagle exposes exactly
 * ONE open library at a time, so reaching another library's contents means
 * COMMANDING Eagle to switch, waiting for the swap to land, then running the
 * ordinary sync. Both gestures are EXPLICIT and user-driven — switching visibly
 * changes Eagle's own window, so it is never automatic and never scheduled
 * (disruption is spent deliberately). One switch runs at a time (an in-flight
 * guard); a concurrent request fails fast.
 *
 * This module owns the CHOREOGRAPHY only; it routes the actual index write
 * through an injected `runEagleSync` closure (the same syncConnector wiring the
 * composition root uses for a normal sync), so there is one code path for
 * landing an Eagle scan.
 */
const log = moduleLogger('index.eagle-switch')

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_SETTLE_MS = 500

/** The slice of the Eagle client the switcher needs (spec §B). */
export type EagleSwitchClient = Pick<
  EagleClient,
  'libraryInfo' | 'itemList' | 'switchLibrary' | 'knownLibraries'
>

/** Injectable timing so tests drive the poll loop with a no-op sleep. */
export interface SwitchTiming {
  pollIntervalMs?: number
  timeoutMs?: number
  settleMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface EagleSwitcherDeps {
  client: EagleSwitchClient
  /** Lands an Eagle scan through the normal sync wiring; returns its outcome. */
  runEagleSync: () => Promise<SyncOutcome>
  timing?: SwitchTiming
}

/** One library's result within a sync-all sweep. */
export interface LibrarySyncResult {
  library: string
  ok: boolean
  error?: string
  synced?: SyncOutcome
}

/** The sync-all summary (spec §B): per-library outcomes + whether the original
 *  library was restored at the end (try/finally, even after failures). */
export interface SyncAllSummary {
  outcomes: LibrarySyncResult[]
  restored: boolean
}

export interface EagleSwitcher {
  /** Current open library + the known set (`eagle:libraries`). */
  listLibraries(): Promise<EagleLibrariesSnapshot>
  /** Switch Eagle to `target`, wait until it is open, then sync it. */
  switchAndSync(target: string): Promise<SyncOutcome>
  /** Sweep every known library (current first) then restore the original. */
  syncAllLibraries(): Promise<SyncAllSummary>
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createEagleSwitcher(deps: EagleSwitcherDeps): EagleSwitcher {
  const { client, runEagleSync } = deps
  const pollIntervalMs = deps.timing?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = deps.timing?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const settleMs = deps.timing?.settleMs ?? DEFAULT_SETTLE_MS
  const sleep = deps.timing?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // One switch at a time: switching yanks Eagle's whole UI, so overlapping
  // switches would fight over the open library. A concurrent request fails fast.
  let inFlight = false
  async function withGuard<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight) throw new Error('an Eagle library switch is already in progress')
    inFlight = true
    try {
      return await fn()
    } finally {
      inFlight = false
    }
  }

  /** Poll /library/info until it (normalized) equals `target`, then a single
   *  item-list probe confirms the library is actually readable. Throws on the
   *  30s cap — the caller then leaves Eagle as-is and skips the sync. */
  async function waitReady(target: string): Promise<void> {
    let waited = 0
    for (;;) {
      let openPath: string | null
      try {
        openPath = normalizeLibraryPath((await client.libraryInfo()).path)
      } catch {
        openPath = null // Eagle can error mid-switch; treat as not-ready-yet
      }
      if (openPath === target) break
      if (waited >= timeoutMs) {
        throw new Error(`Eagle did not open ${target} within ${timeoutMs}ms`)
      }
      await sleep(pollIntervalMs)
      waited += pollIntervalMs
    }
    // A successful item list confirms the open library is queryable, not just named.
    await client.itemList({ limit: 1, page: 0 })
  }

  /** Switch + wait + settle + sync (no guard — the internal primitive). */
  async function doSwitchAndSync(target: string): Promise<SyncOutcome> {
    log.info({ target }, 'switching Eagle library')
    await client.switchLibrary(target)
    await waitReady(target)
    await sleep(settleMs) // let Eagle finish opening before the metadata walk
    return runEagleSync()
  }

  /** Restore Eagle to `target` (switch + wait, no sync). Never throws — a failed
   *  restore is reported as `restored: false`, not an exception. */
  async function restoreTo(target: string): Promise<boolean> {
    try {
      await client.switchLibrary(target)
      await waitReady(target)
      return true
    } catch (err) {
      log.warn({ target, err }, 'failed to restore original Eagle library')
      return false
    }
  }

  async function syncAll(): Promise<SyncAllSummary> {
    const original = normalizeLibraryPath((await client.libraryInfo()).path)
    const known = await client.knownLibraries() // already normalized + deduped
    // Current first (cheapest — already open, no switch), then the rest.
    const ordered = [original, ...known.filter((l) => l !== original)]

    const outcomes: LibrarySyncResult[] = []
    let restored: boolean
    try {
      for (let i = 0; i < ordered.length; i++) {
        const library = ordered[i]!
        try {
          const synced = i === 0 ? await runEagleSync() : await doSwitchAndSync(library)
          outcomes.push({ library, ok: true, synced })
        } catch (err) {
          // One library's failure never aborts the sweep (spec §B).
          log.warn({ library, err }, 'sync-all: library failed; continuing')
          outcomes.push({ library, ok: false, error: errMsg(err) })
        }
      }
    } finally {
      // ALWAYS return Eagle to where the user left it, even after failures.
      restored = await restoreTo(original)
    }
    return { outcomes, restored }
  }

  return {
    async listLibraries() {
      let current: string | null
      try {
        current = normalizeLibraryPath((await client.libraryInfo()).path)
      } catch {
        current = null // Eagle not running — the rail still lists the known set
      }
      const known = await client.knownLibraries()
      return { current, known }
    },
    switchAndSync: (target) => withGuard(() => doSwitchAndSync(normalizeLibraryPath(target))),
    syncAllLibraries: () => withGuard(() => syncAll()),
  }
}
