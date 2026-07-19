import { useEffect, useRef, useState } from 'react'
import { useFolderTree, useFrameActions, useLibraries } from '../state'
import type { FolderTreeNode, SearchHit } from '../../../../main/index/queries'

/**
 * ⌘K — the frame's ONE overlay (spec §5). Type → matched sections in order:
 * Folders (flattened, parent-path labels), Documents (index:search, debounced
 * 150ms, only ≥2 chars), Libraries. ↑↓ move a single highlight across all
 * sections; Enter dispatches (folder/library → rail selection; document →
 * select + detail) then closes; Esc closes. Matching is plain case-insensitive
 * substring — fuzzysort stays dead.
 */

const DEBOUNCE_MS = 150
const DOC_MIN_CHARS = 2
const SEARCH_LIMIT = 8

interface FlatFolder {
  slug: string
  /** Full ancestor path incl. self, e.g. 'EEC 174 ABY / Papers'. */
  path: string
}

/** Depth-first flatten; each node carries its ' / '-joined ancestor path. */
function flattenFolders(nodes: FolderTreeNode[], prefix: string[] = []): FlatFolder[] {
  const out: FlatFolder[] = []
  for (const n of nodes) {
    const chain = [...prefix, n.name]
    out.push({ slug: n.slug, path: chain.join(' / ') })
    if (n.children.length) out.push(...flattenFolders(n.children, chain))
  }
  return out
}

type Item =
  | { kind: 'folder'; slug: string; label: string }
  | { kind: 'document'; id: number; label: string }
  | { kind: 'library'; id: number; label: string }

export function CommandK({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  // Mount the palette only while open: hooks (folder tree, libraries, search
  // state) reset per invocation and the input auto-focuses on mount.
  if (!open) return null
  return <Palette onClose={onClose} />
}

function Palette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const actions = useFrameActions()
  const folderTree = useFolderTree()
  const libraries = useLibraries()
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<SearchHit[]>([])
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Documents: debounced index:search, only for queries ≥2 chars. setDocs runs
  // inside the timeout callback (never synchronously in the effect body).
  useEffect(() => {
    const q = query.trim()
    if (q.length < DOC_MIN_CHARS) return
    let alive = true
    const timer = setTimeout(() => {
      window.astrolabe.search({ q, limit: SEARCH_LIMIT }).then(
        (hits) => {
          if (alive) setDocs(hits)
        },
        () => {
          /* a failed search just shows no documents */
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  const q = query.trim().toLowerCase()
  const showDocs = q.length >= DOC_MIN_CHARS
  const folders = flattenFolders(folderTree.data ?? []).filter((f) =>
    f.path.toLowerCase().includes(q),
  )
  const libs = (libraries.data?.libraries ?? []).filter((l) =>
    l.displayName.toLowerCase().includes(q),
  )
  const docItems = showDocs ? docs : []

  const items: Item[] = [
    ...folders.map((f): Item => ({ kind: 'folder', slug: f.slug, label: f.path })),
    ...docItems.map((d): Item => ({ kind: 'document', id: d.documentId, label: d.title })),
    ...libs.map((l): Item => ({ kind: 'library', id: l.id, label: l.displayName })),
  ]
  const active = items.length > 0 ? Math.min(highlight, items.length - 1) : 0

  const go = (item: Item): void => {
    if (item.kind === 'folder')
      actions.selectRail({ kind: 'folder', slug: item.slug, includeSubfolders: false })
    else if (item.kind === 'library') actions.selectRail({ kind: 'library', id: item.id })
    else actions.selectDocument(item.id)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (item) go(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Section offsets so a single highlight index spans all three sections.
  const docOffset = folders.length
  const libOffset = folders.length + docItems.length

  const row = (item: Item, index: number): React.JSX.Element => (
    <li
      key={`${item.kind}-${'slug' in item ? item.slug : item.id}`}
      role="option"
      aria-selected={index === active}
      onMouseEnter={() => setHighlight(index)}
      onClick={() => go(item)}
      className={`cursor-pointer px-3 py-1.5 text-sm ${
        index === active ? 'bg-violet-600/30 text-neutral-100' : 'text-neutral-300'
      }`}
    >
      {item.label}
    </li>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-[560px] max-w-[90vw] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          aria-label="Search Astrolabe"
          placeholder="Jump to a folder, document, or library…"
          className="w-full border-b border-neutral-800 bg-transparent px-3 py-2.5 text-sm text-neutral-100 outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {folders.length > 0 && (
            <>
              <li className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                Folders
              </li>
              {folders.map((f, i) =>
                row({ kind: 'folder', slug: f.slug, label: f.path }, i),
              )}
            </>
          )}
          {docItems.length > 0 && (
            <>
              <li className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                Documents
              </li>
              {docItems.map((d, i) =>
                row({ kind: 'document', id: d.documentId, label: d.title }, docOffset + i),
              )}
            </>
          )}
          {libs.length > 0 && (
            <>
              <li className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                Libraries
              </li>
              {libs.map((l, i) =>
                row({ kind: 'library', id: l.id, label: l.displayName }, libOffset + i),
              )}
            </>
          )}
          {items.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-600">No matches.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
