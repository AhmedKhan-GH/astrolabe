import { useCallback, useMemo, useState } from 'react'
import {
  friendlyFolderError,
  useFolderTree,
  useFrame,
  useFrameActions,
  useRiver,
} from '../state'
import type { BrowseHit, FolderTreeNode, SearchHit } from '../../../../main/index/queries'

/**
 * The RIVER (frame spec §3): the scrolling result list between rail and detail.
 * Renders the useRiver hits with the App-row visual language (title · kind ·
 * connector:library badges · tags · ghost dimming), and owns the filing
 * gestures — a local multi-select Set plus the action bar and FolderPicker.
 *
 * Selection model (spec §3): plain click selects one doc and opens detail;
 * ⌘/⌃-click toggles into a multi-select without touching detail; ⇧-click
 * range-selects from the last anchor. Esc clears. Filing only ever touches
 * folder membership — never the documents (spec §3, §9). No drag-and-drop (v1).
 */

type Hit = BrowseHit | SearchHit

function open(hit: Hit): void {
  const inst = hit.instances[0]
  const value = inst?.openPdfUri ?? inst?.uri
  if (value) void window.astrolabe.open({ kind: 'uri', value })
}

export default function River(): React.JSX.Element {
  const { rail } = useFrame()
  const actions = useFrameActions()
  const { data, loading } = useRiver()

  const hits = useMemo<Hit[]>(() => data?.hits ?? [], [data])
  const mode = data?.mode ?? 'browse'

  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = useMemo(() => {
    const m = new Map<number, Hit>()
    for (const h of hits) m.set(h.documentId, h)
    return m
  }, [hits])

  const clearSelection = useCallback(() => {
    setSelection(new Set())
    setPickerOpen(false)
    setError(null)
  }, [])

  const onRowClick = useCallback(
    (e: React.MouseEvent, hit: Hit, index: number): void => {
      setError(null)
      if (e.shiftKey && anchor != null) {
        const a = hits.findIndex((h) => h.documentId === anchor)
        if (a >= 0) {
          const [lo, hi] = [Math.min(a, index), Math.max(a, index)]
          setSelection((prev) => {
            const next = new Set(prev)
            for (let i = lo; i <= hi; i++) next.add(hits[i].documentId)
            return next
          })
          return
        }
      }
      if (e.metaKey || e.ctrlKey) {
        // ⌘-click: toggle into the multi-select, never touch the detail panel.
        setSelection((prev) => {
          const next = new Set(prev)
          if (next.has(hit.documentId)) next.delete(hit.documentId)
          else next.add(hit.documentId)
          return next
        })
        setAnchor(hit.documentId)
        return
      }
      // Plain click: select this one doc and open detail.
      setSelection(new Set([hit.documentId]))
      setAnchor(hit.documentId)
      actions.selectDocument(hit.documentId)
    },
    [anchor, hits, actions],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        clearSelection()
      } else if (e.key === 'Enter' || e.key === 'o') {
        const hit = anchor != null ? byId.get(anchor) : undefined
        if (hit) open(hit)
      } else if (e.key === 'f') {
        if (selection.size >= 1) {
          e.preventDefault()
          setPickerOpen(true)
        }
      }
    },
    [anchor, byId, selection, clearSelection],
  )

  const fileToFolder = useCallback(
    async (slug: string): Promise<void> => {
      try {
        await window.astrolabe.folders.addMembers({ slug, documentIds: [...selection] })
        clearSelection()
        actions.refresh()
      } catch (err) {
        setError(friendlyFolderError(err))
      }
    },
    [selection, clearSelection, actions],
  )

  const removeFromFolder = useCallback(async (): Promise<void> => {
    if (rail.kind !== 'folder') return
    try {
      await window.astrolabe.folders.removeMembers({
        slug: rail.slug,
        documentIds: [...selection],
      })
      clearSelection()
      actions.refresh()
    } catch (err) {
      setError(friendlyFolderError(err))
    }
  }, [rail, selection, clearSelection, actions])

  const openSelected = useCallback((): void => {
    for (const id of selection) {
      const hit = byId.get(id)
      if (hit) open(hit)
    }
  }, [selection, byId])

  const empty = !loading && hits.length === 0

  return (
    <div className="flex h-full flex-col" role="listbox" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="grow overflow-y-auto">
        <ul className="divide-y divide-neutral-900">
          {hits.map((hit, index) => {
            const ghost = hit.instances.length === 0
            const selected = selection.has(hit.documentId)
            const snippet = mode === 'search' ? (hit as SearchHit).snippet : undefined
            return (
              <li
                key={hit.documentId}
                role="option"
                aria-selected={selected}
                data-testid={`river-row-${hit.documentId}`}
                onClick={(e) => onRowClick(e, hit, index)}
                onDoubleClick={() => open(hit)}
                className={`cursor-pointer px-4 py-2 ${
                  selected ? 'bg-neutral-800' : 'hover:bg-neutral-900'
                } ${ghost ? 'opacity-50' : ''}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm text-neutral-100">{hit.title}</span>
                  <span className="text-xs text-neutral-500">{hit.kind}</span>
                  {ghost && (
                    <span className="rounded bg-violet-950 px-1.5 text-[10px] text-violet-300">
                      ghost
                    </span>
                  )}
                  {hit.instances.map((i) => (
                    <span
                      key={i.instanceId}
                      className="text-xs text-neutral-600"
                      title={i.libraryAvailability}
                    >
                      {i.connectorKey}:{i.libraryName}
                    </span>
                  ))}
                </div>
                {snippet && <div className="mt-0.5 text-xs text-neutral-400">{snippet}</div>}
                {hit.tags.length > 0 && (
                  <div className="mt-0.5 flex gap-1">
                    {hit.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-neutral-900 px-1.5 text-[10px] text-neutral-500"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {empty && (
          <div className="p-8 text-center text-sm text-neutral-600">
            {mode === 'search'
              ? 'No matches.'
              : rail.kind === 'folder'
                ? 'This folder is empty.'
                : 'No documents yet — Sync to index your libraries.'}
          </div>
        )}
      </div>

      {selection.size >= 1 && (
        <div className="relative flex items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-4 py-2 text-xs">
          <span className="text-neutral-300">{selection.size} selected</span>
          <span className="text-neutral-700">·</span>
          <button
            onClick={() => setPickerOpen((p) => !p)}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-neutral-500"
          >
            File to folder…
          </button>
          {rail.kind === 'folder' && (
            <button
              onClick={removeFromFolder}
              className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-neutral-500"
            >
              Remove from this folder
            </button>
          )}
          <button
            onClick={openSelected}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-neutral-500"
          >
            Open
          </button>
          <button
            onClick={clearSelection}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-400 hover:border-neutral-500"
          >
            Clear
          </button>
          {error && <span className="text-amber-400">{error}</span>}
          {pickerOpen && (
            <FolderPicker onPick={fileToFolder} onClose={() => setPickerOpen(false)} />
          )}
        </div>
      )}
    </div>
  )
}

/** The filing target picker: a mini folder tree over useFolderTree. Choosing a
 *  folder files the current multi-selection into it (membership only). */
function FolderPicker({
  onPick,
  onClose,
}: {
  onPick: (slug: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { data, loading } = useFolderTree()
  const tree = data ?? []

  const rows = (nodes: FolderTreeNode[], depth: number): React.JSX.Element[] =>
    nodes.flatMap((n) => [
      <button
        key={n.slug}
        onClick={() => onPick(n.slug)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="block w-full truncate py-1 pr-2 text-left text-neutral-300 hover:bg-neutral-800"
      >
        {n.name}
      </button>,
      ...rows(n.children, depth + 1),
    ])

  return (
    <div
      role="dialog"
      aria-label="File to folder"
      className="absolute bottom-full left-0 mb-1 max-h-64 w-64 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
    >
      <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500">
        <span>File to folder</span>
        <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
          ✕
        </button>
      </div>
      {loading && <div className="px-2 py-1 text-neutral-600">Loading…</div>}
      {!loading && tree.length === 0 && (
        <div className="px-2 py-1 text-neutral-600">No folders yet.</div>
      )}
      {rows(tree, 0)}
    </div>
  )
}
