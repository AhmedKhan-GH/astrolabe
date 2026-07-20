import { useEffect, useState } from 'react'
import type { EagleLibrariesSnapshot } from '../../../../shared/db-ipc'
import { useFrame } from '../state'

/**
 * The Uncategorized badge total. `stats` has no uncategorized count and the
 * folder tree carries only per-folder counts, so we ask browse for the count
 * directly (limit:1 — we want `total`, not the rows) once per refresh version.
 * Null while it has never resolved (badge simply hides).
 */
export function useUncategorizedCount(): number | null {
  const { version } = useFrame()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    window.astrolabe.browse({ uncategorized: true, limit: 1 }).then(
      (page) => {
        if (alive) setCount(page.total)
      },
      () => {
        if (alive) setCount(null)
      },
    )
    return () => {
      alive = false
    }
  }, [version])
  return count
}

/**
 * Eagle's known libraries (from /library/history) + the currently-open one, for
 * the rail's switch affordances (spec §B). Distinct from `useLibraries` (the
 * INDEXED libraries): the difference — known but not yet indexed — is exactly
 * the set the rail offers a first-scan switch for. Null until it resolves;
 * defensive so a renderer without the eagle bridge simply shows nothing.
 */
export function useEagleLibraries(): EagleLibrariesSnapshot | null {
  const { version } = useFrame()
  const [snap, setSnap] = useState<EagleLibrariesSnapshot | null>(null)
  useEffect(() => {
    let alive = true
    Promise.resolve(window.astrolabe.eagle?.libraries()).then(
      (s) => {
        if (alive) setSnap(s ?? null)
      },
      () => {
        if (alive) setSnap(null)
      },
    )
    return () => {
      alive = false
    }
  }, [version])
  return snap
}
