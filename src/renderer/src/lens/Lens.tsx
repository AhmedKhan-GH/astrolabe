import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SearchResult, type ResultData } from './SearchResult'

/**
 * Library Lens v0 (runway step 6): one search box over every connected source,
 * results with per-source jump-outs. Filters rail + Views land with the design
 * pass; this is the daily-driver skeleton.
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
  const debouncedQ = useDebounced(q, 200)
  const queryClient = useQueryClient()

  const search = useQuery<ResultData[]>({
    queryKey: ['search', debouncedQ],
    queryFn: () => window.astrolabe.index.search(debouncedQ),
    enabled: debouncedQ.trim().length > 0,
    placeholderData: (prev) => prev,
  })

  const sync = useMutation({
    mutationFn: () => window.astrolabe.index.sync(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['search'] }),
  })
  const rebuild = useMutation({
    mutationFn: () => window.astrolabe.index.rebuild(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['search'] }),
  })

  const reports = sync.data ?? rebuild.data

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col gap-3 p-4">
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

      {reports && (
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
          {reports.map((r) => (
            <span
              key={r.sourceKey}
              className={r.ok ? 'text-emerald-400/80' : 'text-amber-400/80'}
            >
              {r.sourceKey}:{' '}
              {r.ok ? `${r.documentsUpserted} docs, ${r.annotationsUpserted} annotations` : 'unavailable'}
            </span>
          ))}
        </div>
      )}

      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your library — titles, annotations, tags…"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
      />

      <main className="min-h-0 flex-1 overflow-y-auto">
        {search.isError && (
          <p className="text-sm text-red-400">search failed: {String(search.error)}</p>
        )}
        {debouncedQ && search.data?.length === 0 && !search.isFetching && (
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
    </div>
  )
}
