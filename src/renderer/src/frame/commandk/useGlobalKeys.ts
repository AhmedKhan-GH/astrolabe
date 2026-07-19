import { useEffect } from 'react'
import { useFrameActions } from '../state'

/**
 * The frame's global key layer (spec §5). Four chords that ALWAYS fire — even
 * while typing in a field — because they are navigation, not text:
 *   ⌘K / ctrl+K → open the palette
 *   ⌘[         → history back
 *   ⌘]         → history forward
 *   ⌘F         → focus the river search (id 'frame-search'), select its text
 * Every other key is left alone (selection/open/close chords live with the
 * river and detail panes), so plain typing anywhere is a no-op here.
 */
export function useGlobalKeys({ onOpenPalette }: { onOpenPalette: () => void }): void {
  const actions = useFrameActions()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()

      if (key === 'k') {
        e.preventDefault()
        onOpenPalette()
      } else if (e.key === '[') {
        e.preventDefault()
        actions.goBack()
      } else if (e.key === ']') {
        e.preventDefault()
        actions.goForward()
      } else if (key === 'f') {
        e.preventDefault()
        const el = document.getElementById('frame-search')
        if (el instanceof HTMLInputElement) {
          el.focus()
          el.select()
        } else if (el instanceof HTMLElement) {
          el.focus()
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpenPalette, actions])
}
