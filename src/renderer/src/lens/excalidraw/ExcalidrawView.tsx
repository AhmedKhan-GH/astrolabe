import { useEffect, useState, type ComponentType } from 'react'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawScene } from './parse'

/**
 * Read-only Excalidraw panel — the drawing twin of NoteView/CanvasView (same fixed
 * right-overlay family, Escape/× to close). Obsidian stays the drawing EDITOR (founding
 * no-drawing-engine rule, docs/02 D2); this is a fast, in-app read: pan/zoom only, editing
 * disabled (`viewModeEnabled`). The scene arrives already parsed (a prop) so this component
 * is pure over its inputs; the heavy Excalidraw library is dynamically imported so it never
 * loads in jsdom/tests and code-splits out of the main chunk (usePdfDocument pattern).
 */

// Minimal shape of the props we pass — the real type lives in the (dynamically imported) lib.
type ExcalidrawProps = {
  initialData: { elements: unknown[]; appState: Record<string, unknown>; files?: Record<string, unknown> }
  viewModeEnabled: boolean
  UIOptions?: unknown
}

/**
 * Dynamically load the (heavy) Excalidraw component so it code-splits out of the main chunk and
 * never loads in jsdom/tests (which vi.mock the module) — the usePdfDocument dynamic-import
 * pattern, adapted for a component result rather than a data hook. Before importing, point the
 * library at the LOCAL font pack (electron.vite.config.ts copies dist/prod/fonts →
 * out/renderer/excalidraw/fonts): without EXCALIDRAW_ASSET_PATH the library fetches its fonts
 * from a CDN (unpkg) at runtime, which a desktop app must never do. Resolved against
 * document.baseURI so the same relative layout works on the dev server and the packaged
 * astro://app host. Returns null while the chunk loads (the caller shows a loading hint).
 */
function useExcalidraw(): ComponentType<ExcalidrawProps> | null {
  const [Comp, setComp] = useState<ComponentType<ExcalidrawProps> | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL(
      'excalidraw/',
      document.baseURI,
    ).toString()
    void import('@excalidraw/excalidraw').then((m) => {
      if (!cancelled) setComp(() => m.Excalidraw as unknown as ComponentType<ExcalidrawProps>)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return Comp
}

export function ExcalidrawView({
  title,
  scene,
  uri,
  onOpenUri,
  onOpenDetails,
  onClose,
}: {
  title: string
  scene: ExcalidrawScene
  /** Obsidian deep-link — absent for navigated-to notes; the header button hides when unset. */
  uri?: string
  onOpenUri: (uri: string) => void
  /** Cross-link to the Document Hub for this document (panel swap); hidden when unwired. */
  onOpenDetails?: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The dynamically-loaded Excalidraw component (or null while its chunk loads).
  const Excalidraw = useExcalidraw()

  return (
    <div
      role="dialog"
      aria-label="drawing view"
      className="fixed inset-y-0 right-0 z-20 flex w-[min(60rem,92vw)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="min-w-0 truncate font-medium text-zinc-100">{title}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {uri && (
            <button
              onClick={() => onOpenUri(uri)}
              className="rounded border border-violet-800 bg-violet-950 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900"
            >
              open in Obsidian ↗
            </button>
          )}
          {onOpenDetails && (
            <button
              aria-label="document details"
              title="Document details"
              onClick={onOpenDetails}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              ⓘ
            </button>
          )}
          <button
            aria-label="close drawing view"
            onClick={onClose}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            ×
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {Excalidraw ? (
          // The rule guards against components DEFINED inline during render (which remount every
          // pass); this reference is loaded once into state and stays stable, so it is safe.
          // eslint-disable-next-line react-hooks/static-components
          <Excalidraw
            initialData={{
              elements: scene.elements,
              // Honour the note's canvas colour; force dark theme to match the app shell.
              appState: {
                viewBackgroundColor:
                  (scene.appState?.['viewBackgroundColor'] as string | undefined) ?? '#ffffff',
                theme: 'dark',
              },
              files: scene.files,
            }}
            viewModeEnabled
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: false,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
                toggleTheme: false,
              },
              tools: { image: false },
            }}
          />
        ) : (
          <p className="px-5 py-4 text-sm text-zinc-600">loading drawing…</p>
        )}
      </div>
    </div>
  )
}
