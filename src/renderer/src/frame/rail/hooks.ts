import { useEffect, useState } from 'react'
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
