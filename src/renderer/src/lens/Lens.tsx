import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SearchResult, type ResultData } from './SearchResult'
import { SourceBadge } from './SourceBadge'
import { NavRail } from './NavRail'
import { FilterBar } from './FilterBar'
import { DocumentRiver } from './DocumentRiver'
import {
  emptySelection,
  toggleScope,
  toggleKind,
  cycleTag,
  setTagMatch,
  removeTag,
  toFilterSet,
} from './selection'
import type { LensSelection, NavData, NavNode } from './types'

/**
 * Library Navigator (Lens v1): a left nav rail (structure + tags + kinds) over a
 * center pane that is either the recency river (q empty) or FTS hits (q typed).
 * Navigation and search compose — both respect the active LensSelection.
 */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function Lens() {
  const [q, setQ] = useState('')
  const [selection, setSelection] = useState<LensSelection>(emptySelection())
  const debouncedQ = useDebounced(q, 200)
  const queryClient = useQueryClient()

  // The serialized FilterSet is the wire payload and the query-key fragment: when it
  // changes, browse/search refetch. TanStack hashes object keys deterministically.
  const filterSet = useMemo(() => toFilterSet(selection), [selection])

  const onToggleScope: Parameters<typeof NavRail>[0]['onToggleScope'] = (dim, value) =>
    setSelection((s) => toggleScope(s, dim, value))
  const onToggleKind: Parameters<typeof NavRail>[0]['onToggleKind'] = (kind) =>
    setSelection((s) => toggleKind(s, kind))
  const onCycleTag = (name: string) => setSelection((s) => cycleTag(s, name))
  const onSetTagMatch = (mode: 'all' | 'any') => setSelection((s) => setTagMatch(s, mode))
  const onRemoveTag = (name: string) => setSelection((s) => removeTag(s, name))
  const onClearAll = () => setSelection(emptySelection())

  const search = useQuery<ResultData[]>({
    queryKey: ['search', debouncedQ, filterSet],
    queryFn: () => window.astrolabe.index.search(debouncedQ, undefined, filterSet),
    enabled: debouncedQ.trim().length > 0,
    placeholderData: (prev) => prev,
  })

  const nav = useQuery<NavData>({
    queryKey: ['nav'],
    queryFn: () => window.astrolabe.index.nav(),
  })

  // Collection id → display name, harvested from the nav trees (the renderer's only
  // source of collection names) so FilterBar chips can label numeric collection ids.
  const collectionNames = useMemo(() => {
    const map = new Map<number, string>()
    const walk = (nodes: NavNode[]): void => {
      for (const n of nodes) {
        if (typeof n.id === 'number') map.set(n.id, n.name)
        walk(n.children)
      }
    }
    nav.data?.sources.forEach((s) => walk(s.tree))
    return map
  }, [nav.data])

  const sync = useMutation({
    mutationFn: () => window.astrolabe.index.sync(),
    onSuccess: invalidateIndexViews,
  })
  const rebuild = useMutation({
    mutationFn: () => window.astrolabe.index.rebuild(),
    onSuccess: invalidateIndexViews,
  })

  // Always-on totals (index-wide) — a no-change incremental sync must never read
  // as an empty index (the "0 docs" confusion this replaces).
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => window.astrolabe.index.stats(),
  })
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => window.astrolabe.index.sources(),
  })
  // Grant-access probe: an fs read from the app's main process summons the
  // native macOS consent dialog (the call holds until the user answers). On a
  // grant, sync immediately so the source lights up without another click.
  const grant = useMutation({
    mutationFn: (sourceKey: string) =>
      window.astrolabe.system.requestAccess(sourceKey as Parameters<typeof window.astrolabe.system.requestAccess>[0]),
    onSuccess: (result) => {
      if (result.granted) sync.mutate()
    },
  })

  const lastRun = sync.data ?? rebuild.data
  const upsertedBy = (key: string) =>
    lastRun?.find((r) => r.sourceKey === key)?.documentsUpserted ?? null

  function invalidateIndexViews() {
    void queryClient.invalidateQueries({ queryKey: ['search'] })
    void queryClient.invalidateQueries({ queryKey: ['sources'] })
    void queryClient.invalidateQueries({ queryKey: ['stats'] })
    void queryClient.invalidateQueries({ queryKey: ['browse'] })
    void queryClient.invalidateQueries({ queryKey: ['nav'] })
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-6xl flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-100">Astrolabe</h1>
        <span className="text-xs text-zinc-500">library lens</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending || rebuild.isPending}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {sync.isPending ? 'syncing…' : 'Sync now'}
          </button>
          <button
            onClick={() => rebuild.mutate()}
            disabled={sync.isPending || rebuild.isPending}
            title="Wipe the derived index and rescan every source (ADR-0005)"
            className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-900 disabled:opacity-50"
          >
            {rebuild.isPending ? 'rebuilding…' : 'Rebuild index'}
          </button>
        </div>
      </header>

      {/* Always-on stats strip: index-wide totals + per-source breakdown. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span className="font-medium text-zinc-300">
          {stats.data
            ? `${stats.data.documents.toLocaleString()} documents · ${stats.data.annotations.toLocaleString()} annotations`
            : stats.isError
              ? 'index unavailable'
              : 'counting…'}
        </span>
        {(sources.data ?? []).map((src) => (
          <SourceBadge
            key={src.key}
            src={src}
            fresh={upsertedBy(src.key)}
            granting={grant.isPending}
            onGrant={(sourceKey) => grant.mutate(sourceKey)}
          />
        ))}
      </div>

      {/* FDA fallback: macOS provides no API to prompt for Full Disk Access, so a
          hard denial deep-links the Settings pane and we tell the user what to do. */}
      {grant.data?.settingsOpened && (
        <p className="text-[11px] text-amber-400/80">
          macOS blocked the request — System Settings was opened: add Astrolabe under Privacy &
          Security → Full Disk Access, then hit “Sync now”.
        </p>
      )}
      {grant.data?.granted && (
        <p className="text-[11px] text-emerald-400/80">
          access granted — syncing. Tip: run “Rebuild index” to hash existing files and light up
          cross-source joins.
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <div
          className={`w-60 shrink-0 ${nav.isFetching || nav.isError ? 'opacity-60' : ''}`}
        >
          {nav.data ? (
            <NavRail
              nav={nav.data}
              selection={selection}
              onToggleKind={onToggleKind}
              onToggleScope={onToggleScope}
              onCycleTag={onCycleTag}
              onSetTagMatch={onSetTagMatch}
            />
          ) : (
            <aside className="h-full border-r border-zinc-800 pr-3 text-xs text-zinc-600">
              {nav.isError ? 'navigation unavailable' : 'loading navigation…'}
            </aside>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {nav.isError && (
            <p className="text-sm text-red-400">navigation failed: {String(nav.error)}</p>
          )}
          <FilterBar
            selection={selection}
            collectionNames={collectionNames}
            onToggleScope={onToggleScope}
            onToggleKind={onToggleKind}
            onRemoveTag={onRemoveTag}
            onClearAll={onClearAll}
          />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your library — titles, annotations, tags…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
          />

          {debouncedQ.trim().length > 0 ? (
            <main className="min-h-0 flex-1 overflow-y-auto">
              {search.isError && (
                <p className="text-sm text-red-400">search failed: {String(search.error)}</p>
              )}
              {search.data?.length === 0 && !search.isFetching && (
                <p className="text-sm text-zinc-600">no matches — try “Sync now” first</p>
              )}
              <ul className="flex flex-col gap-2">
                {(search.data ?? []).map((hit) => (
                  <SearchResult
                    key={hit.documentId}
                    hit={hit}
                    onOpenUri={(uri) => void window.astrolabe.system.openUri(uri)}
                    onOpenFile={(p) => void window.astrolabe.system.openPath(p)}
                    onReveal={(p) => void window.astrolabe.system.reveal(p)}
                  />
                ))}
              </ul>
            </main>
          ) : (
            <DocumentRiver filters={filterSet} onSync={() => sync.mutate()} />
          )}
        </div>
      </div>
    </div>
  )
}
