import { useCallback, useState } from 'react'
import {
  FrameProvider,
  useFrame,
  useFrameActions,
  useStats,
} from './frame/state'
import Rail from './frame/rail/Rail'
import River from './frame/river/River'
import DetailPanel from './frame/detail/DetailPanel'
import { CommandK } from './frame/commandk/CommandK'
import { useGlobalKeys } from './frame/commandk/useGlobalKeys'

/**
 * The frame (Track A part 2, docs/2026-07-18-frame-spec §1): the three-pane
 * spine — rail | river | detail — over the frozen state contract. ⌘K is the
 * one overlay; history (⌘[/⌘]) replays selection state. The skeleton shell
 * this file used to be lives on in the row anatomy the river inherited.
 */

function Topbar({ onOpenPalette }: { onOpenPalette: () => void }): React.JSX.Element {
  const { query, ghosts, canGoBack, canGoForward } = useFrame()
  const actions = useFrameActions()
  const stats = useStats()
  const [syncing, setSyncing] = useState(false)

  const runSync = useCallback(() => {
    setSyncing(true)
    void window.astrolabe
      .sync()
      .finally(() => {
        setSyncing(false)
        actions.refresh()
      })
  }, [actions])

  return (
    <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
      <div className="flex items-center gap-1">
        <button
          onClick={actions.goBack}
          disabled={!canGoBack}
          title="Back (⌘[)"
          className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-600 disabled:opacity-30"
        >
          ‹
        </button>
        <button
          onClick={actions.goForward}
          disabled={!canGoForward}
          title="Forward (⌘])"
          className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-600 disabled:opacity-30"
        >
          ›
        </button>
      </div>
      <input
        id="frame-search"
        autoFocus
        value={query}
        onChange={(e) => actions.setQuery(e.target.value)}
        placeholder="Search title, annotations, tags…  (⌘F)"
        className="w-96 rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm outline-none focus:border-neutral-500"
      />
      <button
        onClick={onOpenPalette}
        title="Jump to folder, document, or library"
        className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-500 hover:border-neutral-600"
      >
        ⌘K
      </button>
      <div className="grow" />
      {stats.data && (
        <span className="text-xs text-neutral-500">
          {stats.data.documents} documents · {stats.data.annotations} annotations
        </span>
      )}
      <button
        onClick={actions.toggleGhosts}
        title="Documents whose every copy is gone are remembered, not shown. One switch reveals them."
        className={`rounded border px-2 py-1 text-xs ${
          ghosts
            ? 'border-violet-500 text-violet-300'
            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
        }`}
      >
        {ghosts ? 'Hide' : 'Show'} ghosts
        {stats.data && stats.data.ghosts > 0 ? ` (${stats.data.ghosts})` : ''}
      </button>
      <button
        onClick={runSync}
        disabled={syncing}
        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 disabled:opacity-50"
      >
        {syncing ? 'Syncing…' : 'Sync'}
      </button>
    </header>
  )
}

function Frame(): React.JSX.Element {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  useGlobalKeys({ onOpenPalette: openPalette })
  const { detailOpen } = useFrame()

  return (
    <div className="flex h-screen flex-col">
      <Topbar onOpenPalette={openPalette} />
      <div className="flex min-h-0 grow">
        <Rail />
        <main className="min-w-0 grow overflow-y-auto">
          <River />
        </main>
        {detailOpen && (
          <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-neutral-800">
            <DetailPanel />
          </aside>
        )}
      </div>
      <CommandK open={paletteOpen} onClose={closePalette} />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <FrameProvider>
      <Frame />
    </FrameProvider>
  )
}
