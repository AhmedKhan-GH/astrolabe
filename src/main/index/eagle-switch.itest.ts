import { describe, it, expect, vi } from 'vitest'
import { createEagleSwitcher, type EagleSwitchClient } from './eagle-switch'
import type { SyncOutcome } from './sync'
import type { EagleLibraryInfo } from '../connectors/eagle/client'

/**
 * Tier B integration for the Eagle switch orchestrator (spec §B). No live Eagle,
 * no DB — a SCRIPTED fake client + a fake syncRunner drive every branch:
 *   - wait-ready polling until /library/info reports the target, then one
 *     item-list probe, settle, sync;
 *   - a timeout leaves Eagle as-is and never syncs;
 *   - sync-all visits current-first then the rest, records a mid-loop failure,
 *     and ALWAYS restores the original library (try/finally);
 *   - the in-flight guard rejects a concurrent switch.
 * Timing is injected (no-op sleep) so the poll loop runs with zero real delay.
 */

const A = '/libs/A.library'
const B = '/libs/B.library'
const C = '/libs/C.library'

/** A fast SyncOutcome factory keyed by the library path (for assertion). */
function outcome(path: string): SyncOutcome {
  return { connector: 'eagle', status: 'ok', libraries: [{ stableKey: path, displayName: path, documentsUpserted: 0, removed: 0, unchanged: true }] }
}

const info = (path: string): EagleLibraryInfo => ({ path, folders: [] })

/** Timing that removes all real delay; a tight timeout keeps the timeout test fast. */
const fastTiming = { pollIntervalMs: 500, timeoutMs: 3000, settleMs: 500, sleep: async () => {} }

describe('eagle switch — switchAndSync wait-ready', () => {
  it('polls /library/info until the target is open, probes item-list, then syncs', async () => {
    let current = A
    let pending: string | null = null
    let pollsLeft = 0
    let infoCalls = 0
    let itemListCalls = 0
    const client: EagleSwitchClient = {
      libraryInfo: async () => {
        infoCalls++
        if (pending && --pollsLeft <= 0) {
          current = pending
          pending = null
        }
        return info(current)
      },
      itemList: async () => {
        itemListCalls++
        return []
      },
      switchLibrary: async (p) => {
        pending = p
        pollsLeft = 3 // becomes ready on the 3rd poll
      },
      knownLibraries: async () => [A, B],
    }
    const runEagleSync = vi.fn(async () => outcome(current))
    const sw = createEagleSwitcher({ client, runEagleSync, timing: fastTiming })

    const result = await sw.switchAndSync(B)

    expect(result).toEqual(outcome(B))
    expect(infoCalls).toBeGreaterThanOrEqual(3) // it actually polled
    expect(itemListCalls).toBe(1) // exactly one readiness probe
    expect(runEagleSync).toHaveBeenCalledOnce()
  })

  it('times out (Eagle never reaches the target) → clear error, no sync', async () => {
    const client: EagleSwitchClient = {
      libraryInfo: async () => info(A), // never becomes B
      itemList: async () => [],
      switchLibrary: async () => {},
      knownLibraries: async () => [A, B],
    }
    const runEagleSync = vi.fn(async () => outcome(A))
    const sw = createEagleSwitcher({ client, runEagleSync, timing: fastTiming })

    await expect(sw.switchAndSync(B)).rejects.toThrow(/did not (open|switch)|timed? ?out/i)
    expect(runEagleSync).not.toHaveBeenCalled() // Eagle left as-is, nothing synced
  })
})

describe('eagle switch — syncAllLibraries', () => {
  it('visits current-first then the rest, records a mid-loop failure, and restores the original', async () => {
    let current = A
    const client: EagleSwitchClient = {
      libraryInfo: async () => info(current),
      itemList: async () => [],
      switchLibrary: async (p) => {
        current = p.replace(/\/+$/, '')
      },
      knownLibraries: async () => [A, B, C],
    }
    // B's scan fails; A and C succeed.
    const runEagleSync = vi.fn(async () => {
      if (current === B) throw new Error('scan blew up for B')
      return outcome(current)
    })
    const sw = createEagleSwitcher({ client, runEagleSync, timing: fastTiming })

    const summary = await sw.syncAllLibraries()

    expect(summary.outcomes.map((o) => o.library)).toEqual([A, B, C]) // current (A) first
    expect(summary.outcomes.map((o) => o.ok)).toEqual([true, false, true])
    expect(summary.outcomes[1]?.error).toMatch(/blew up/)
    expect(summary.restored).toBe(true)
    expect(current).toBe(A) // the original library is open again
  })
})

describe('eagle switch — in-flight guard', () => {
  it('rejects a concurrent switch while one is running', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const client: EagleSwitchClient = {
      libraryInfo: async () => info(B),
      itemList: async () => [],
      switchLibrary: async () => {},
      knownLibraries: async () => [A, B],
    }
    const runEagleSync = vi.fn(async () => {
      await gate // block the first op mid-flight
      return outcome(B)
    })
    const sw = createEagleSwitcher({ client, runEagleSync, timing: fastTiming })

    const first = sw.switchAndSync(B) // enters the guard, blocks on the gate
    await expect(sw.switchAndSync(B)).rejects.toThrow(/in progress|already/i)

    release()
    await expect(first).resolves.toEqual(outcome(B))
  })
})

describe('eagle switch — listLibraries', () => {
  it('reports the current open library and the known set', async () => {
    const client: EagleSwitchClient = {
      libraryInfo: async () => info(A),
      itemList: async () => [],
      switchLibrary: async () => {},
      knownLibraries: async () => [A, B, C],
    }
    const sw = createEagleSwitcher({ client, runEagleSync: async () => outcome(A), timing: fastTiming })

    expect(await sw.listLibraries()).toEqual({ current: A, known: [A, B, C] })
  })
})
