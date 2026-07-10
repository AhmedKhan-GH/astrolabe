import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { BrowseHit, BrowsePage, FilterSet, VCollectionSummary } from './types'
import { shouldFetchNextPage } from './pagination'

const PAGE = 100

const SOURCE_BADGE: Record<string, string> = {
  zotero: 'bg-red-950 text-red-300 border-red-800',
  eagle: 'bg-sky-950 text-sky-300 border-sky-800',
  obsidian: 'bg-violet-950 text-violet-300 border-violet-800',
}

/** Recency river: browse the whole (filtered) index, newest-modified first. */
export function DocumentRiver({
  filters,
  collections,
  onOpenUri = (uri) => void window.astrolabe.system.openUri(uri),
  onOpenFile = (p) => void window.astrolabe.system.openPath(p),
  onReveal = (p) => void window.astrolabe.system.reveal(p),
  onToggleMembership,
  onCreateAndAdd,
  onOpenCanvas,
  onOpenNote,
  onSync,
}: {
  filters: FilterSet
  collections?: VCollectionSummary[]
  onOpenUri?: (uri: string) => void
  onOpenFile?: (path: string) => void
  onReveal?: (path: string) => void
  onToggleMembership?: (documentId: number, slug: string, nextChecked: boolean) => void
  onCreateAndAdd?: (documentId: number, name: string) => void
  onOpenCanvas?: (hit: BrowseHit) => void
  onOpenNote?: (hit: BrowseHit) => void
  onSync?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const query = useInfiniteQuery({
    queryKey: ['browse', filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      window.astrolabe.index.browse({ ...filters, offset: pageParam, limit: PAGE }),
    getNextPageParam: (lastPage: BrowsePage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.hits.length, 0)
      return lastPage.hits.length > 0 && loaded < lastPage.total ? loaded : undefined
    },
  })

  const total = query.data?.pages[0]?.total ?? 0
  const hits: BrowseHit[] = query.data?.pages.flatMap((p) => p.hits) ?? []

  const virtualizer = useVirtualizer({
    // The filtered total keeps the scrollbar representative before every page is loaded.
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 8,
  })

  const items = virtualizer.getVirtualItems()
  const lastVisibleIndex = items[items.length - 1]?.index ?? -1
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query

  useEffect(() => {
    if (
      shouldFetchNextPage({
        lastVisibleIndex,
        loadedCount: hits.length,
        hasNextPage,
        isFetchingNextPage,
      })
    ) {
      void fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage, hits.length, isFetchingNextPage, lastVisibleIndex])

  if (query.isError) {
    return <p className="text-sm text-red-400">browse failed: {String(query.error)}</p>
  }

  if (query.isPending) {
    return <p className="text-sm text-zinc-600">loading documents…</p>
  }

  if (!query.isFetching && total === 0) {
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm text-zinc-600">
        <span>index is empty — Sync now</span>
        {onSync && (
          <button
            onClick={onSync}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Sync now
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="text-[11px] text-zinc-500">{total.toLocaleString()} documents</p>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {items.map((vi) => {
            const h = hits[vi.index]
            if (!h) {
              return (
                <div
                  key={vi.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                  }}
                  className="px-3 py-2 text-xs text-zinc-600"
                >
                  loading…
                </div>
              )
            }
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                <DocumentRow
                  hit={h}
                  collections={collections}
                  onOpenUri={onOpenUri}
                  onOpenFile={onOpenFile}
                  onReveal={onReveal}
                  onToggleMembership={onToggleMembership}
                  onCreateAndAdd={onCreateAndAdd}
                  onOpenCanvas={onOpenCanvas}
                  onOpenNote={onOpenNote}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** One row in the river (exported so it is component-testable without the virtualizer). */
export function DocumentRow({
  hit,
  collections,
  onOpenUri,
  onOpenFile,
  onReveal,
  onToggleMembership,
  onCreateAndAdd,
  onOpenCanvas,
  onOpenNote,
}: {
  hit: BrowseHit
  collections?: VCollectionSummary[]
  onOpenUri: (uri: string) => void
  onOpenFile: (path: string) => void
  onReveal: (path: string) => void
  onToggleMembership?: (documentId: number, slug: string, nextChecked: boolean) => void
  onCreateAndAdd?: (documentId: number, name: string) => void
  onOpenCanvas?: (hit: BrowseHit) => void
  onOpenNote?: (hit: BrowseHit) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  // The membership affordance appears only when the feature is wired in.
  const canManage = Boolean(onToggleMembership || onCreateAndAdd)
  const filePath = hit.instances.find((i) => i.filePath)?.filePath ?? null
  // Canvas needs bytes to render: pdf kind + a served file (astro://doc streams by instanceId).
  const canCanvas = Boolean(onOpenCanvas) && hit.kind === 'pdf' && filePath !== null
  // NoteView reads a file-backed obsidian note (astro://doc streams the markdown by instanceId).
  const canNote =
    Boolean(onOpenNote) &&
    hit.kind === 'note' &&
    hit.instances.some((i) => i.sourceKey === 'obsidian' && i.filePath !== null)
  return (
    <div className="group relative mb-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">{hit.kind}</span>
        {canCanvas ? (
          <button
            aria-label={`open canvas: ${hit.title}`}
            title="Open canvas — all pages at a glance"
            onClick={() => onOpenCanvas?.(hit)}
            className="min-w-0 flex-1 truncate text-left font-medium text-zinc-100 hover:text-white hover:underline"
          >
            {hit.title}
          </button>
        ) : canNote ? (
          <button
            aria-label={`open note: ${hit.title}`}
            title="Open note view"
            onClick={() => onOpenNote?.(hit)}
            className="min-w-0 flex-1 truncate text-left font-medium text-zinc-100 hover:text-white hover:underline"
          >
            {hit.title}
          </button>
        ) : (
          <h3 className="min-w-0 flex-1 truncate font-medium text-zinc-100">{hit.title}</h3>
        )}
        {canManage && (
          <button
            aria-label="add to collection"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className={clsx(
              'shrink-0 rounded border border-zinc-700 px-1.5 text-[11px] leading-5 text-zinc-400 hover:bg-zinc-800',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            ＋
          </button>
        )}
        <span className="shrink-0 text-[11px] text-zinc-500" title={new Date(hit.modifiedAt).toLocaleString()}>
          {relativeTime(hit.modifiedAt)}
        </span>
      </div>
      {canManage && menuOpen && (
        <MembershipPopover
          hit={hit}
          collections={collections ?? []}
          onToggleMembership={onToggleMembership}
          onCreateAndAdd={onCreateAndAdd}
          onClose={() => setMenuOpen(false)}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {hit.instances.map((inst) => (
          <button
            key={inst.uri}
            onClick={() => onOpenUri(inst.uri)}
            title={inst.uri}
            className={clsx(
              'rounded border px-1.5 py-0.5 text-[11px] font-medium hover:brightness-125',
              SOURCE_BADGE[inst.sourceKey] ?? 'border-zinc-700 bg-zinc-800 text-zinc-300',
            )}
          >
            {inst.sourceKey} ↗
          </button>
        ))}
        {filePath && (
          <>
            <button
              onClick={() => onOpenFile(filePath)}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              open file
            </button>
            <button
              onClick={() => onReveal(filePath)}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              reveal
            </button>
          </>
        )}
        {hit.tags.slice(0, 6).map((t) => (
          <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
            #{t}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Virtual-collection membership popover — absolutely positioned within the row (no
 * portal library). A checkbox per collection (checked = the row already belongs);
 * toggling fires add/remove for this document. A footer input creates a new
 * collection and adds the document in one shot. Closes on outside click / Escape.
 */
function MembershipPopover({
  hit,
  collections,
  onToggleMembership,
  onCreateAndAdd,
  onClose,
}: {
  hit: BrowseHit
  collections: VCollectionSummary[]
  onToggleMembership?: (documentId: number, slug: string, nextChecked: boolean) => void
  onCreateAndAdd?: (documentId: number, name: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="collections"
      className="absolute right-2 top-9 z-10 w-52 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl"
    >
      <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
        {collections.map((c) => {
          const checked = hit.virtualCollections.includes(c.slug)
          return (
            <label
              key={c.slug}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggleMembership?.(hit.documentId, c.slug, e.target.checked)}
                className="accent-emerald-600"
              />
              <span className="truncate">{c.name}</span>
            </label>
          )
        })}
        {collections.length === 0 && (
          <p className="px-1 py-0.5 text-[11px] text-zinc-600">No collections yet.</p>
        )}
      </div>
      {onCreateAndAdd && (
        <PopoverCreate onCreate={(name) => onCreateAndAdd(hit.documentId, name)} />
      )}
    </div>
  )
}

/** Footer "New collection" input — Enter creates-and-adds; a blank name is a no-op. */
function PopoverCreate({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  const commit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
    setName('')
  }
  return (
    <input
      aria-label="new collection name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      placeholder="New collection…"
      className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
    />
  )
}

/** Coarse relative-modified label (change-detector copy — deliberately untested). */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < hour) return `${Math.max(1, Math.round(diff / min))}m ago`
  if (diff < day) return `${Math.round(diff / hour)}h ago`
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`
  return new Date(ms).toLocaleDateString()
}
