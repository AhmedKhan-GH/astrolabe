import { readdir } from 'node:fs/promises'
import type { Connector, SourceKey } from '../connectors/types'
import { classifyScanError } from '../index/sync-status'

/**
 * In-app permission request (macOS TCC). The first read of an iCloud-Drive
 * folder BY THE APP PROCESS summons the native "Astrolabe would like to
 * access…" dialog — the probe is that read. Full Disk Access can never be
 * prompted for programmatically (no API, by design), so a denied probe falls
 * back to deep-linking the FDA Settings pane. No electron imports here:
 * openSettings is injected so this stays plain-node testable.
 */
export const FULL_DISK_ACCESS_SETTINGS_URI =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFilesAccess'

export interface AccessProbeResult {
  sourceKey: SourceKey
  granted: boolean
  settingsOpened: boolean
  reason?: 'no-path' | 'denied' | 'missing'
}

export function createAccessApi(registry: Connector[], deps: { openSettings: () => Promise<void> }) {
  async function requestAccess(sourceKey: SourceKey): Promise<AccessProbeResult> {
    const path = await registry.find((c) => c.key === sourceKey)?.accessProbePath?.()
    if (!path) return { sourceKey, granted: false, settingsOpened: false, reason: 'no-path' }
    try {
      // The probe: an fs read on the async threadpool (never block the main
      // process — the TCC dialog holds the call open until the user answers).
      await readdir(path)
      return { sourceKey, granted: true, settingsOpened: false }
    } catch (err) {
      if (classifyScanError(err) === 'denied') {
        await deps.openSettings()
        return { sourceKey, granted: false, settingsOpened: true, reason: 'denied' }
      }
      return { sourceKey, granted: false, settingsOpened: false, reason: 'missing' }
    }
  }
  return { requestAccess }
}

export type AccessApi = ReturnType<typeof createAccessApi>
