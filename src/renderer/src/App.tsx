import { useCallback, useEffect, useState } from 'react'
import type { LibrariesSnapshot } from '../../shared/db-ipc'
import type { BrowseHit, IndexStats, SearchHit } from '../../main/index/queries'

/**
 * The skeleton shell: search box + document list + libraries strip + the ONE
 * ghost toggle (D3). Deliberately plain — Track A (navigation/experience) is a
 * design session, not this commit. Data flows: no query → browse (recency
 * river); query → FTS search. Every row deep-links out via system:open.
 */

type Row = {
  documentId: number
  title: string
  kind: string
  tags: string[]
  snippet?: string
  instances: BrowseHit['instances']
}

export default function App(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [showGhosts, setShowGhosts] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [libraries, setLibraries] = useState<LibrariesSnapshot | null>(null)
  const [syncing, setSyncing] = useState(false)

  const refreshMeta = useCallback(() => {
    void window.astrolabe.stats().then(setStats)
    void window.astrolabe.libraries().then(setLibraries)
  }, [])

  const refreshRows = useCallback(() => {
    const q = query.trim()
    if (q.length > 0) {
      void window.astrolabe.search({ q, includeGhosts: showGhosts }).then((hits: SearchHit[]) => {
        setRows(hits)
        setTotal(hits.length)
      })
    } else {
      void window.astrolabe.browse({ includeGhosts: showGhosts, limit: 200 }).then((page) => {
        setRows(page.hits)
        setTotal(page.total)
      })
    }
  }, [query, showGhosts])

  useEffect(refreshRows, [refreshRows])
  useEffect(refreshMeta, [refreshMeta])

  const runSync = useCallback(() => {
    setSyncing(true)
    void window.astrolabe
      .sync()
      .finally(() => {
        setSyncing(false)
        refreshRows()
        refreshMeta()
      })
  }, [refreshMeta, refreshRows])

  const openRow = (row: Row): void => {
    const uri = row.instances[0]?.openPdfUri ?? row.instances[0]?.uri
    if (uri) void window.astrolabe.open({ kind: 'uri', value: uri })
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-300">Astrolabe</h1>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, annotations, tags…"
          className="w-96 rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm outline-none focus:border-neutral-500"
        />
        <span className="text-xs text-neutral-500">
          {total} shown{stats ? ` · ${stats.documents} documents · ${stats.annotations} annotations` : ''}
        </span>
        <div className="grow" />
        <button
          onClick={() => setShowGhosts((g) => !g)}
          title="Documents whose every copy is gone are remembered, not shown. One switch reveals them."
          className={`rounded border px-2 py-1 text-xs ${
            showGhosts
              ? 'border-violet-500 text-violet-300'
              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
          }`}
        >
          {showGhosts ? 'Hide' : 'Show'} ghosts{stats && stats.ghosts > 0 ? ` (${stats.ghosts})` : ''}
        </button>
        <button
          onClick={runSync}
          disabled={syncing}
          className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </header>

      {libraries && (
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-1.5 text-xs text-neutral-400">
          {libraries.connectors.map((c) => (
            <span key={c.key} className={c.status === 'ok' ? 'text-neutral-300' : 'text-amber-400'}>
              {c.key}: {c.status}
            </span>
          ))}
          <span className="text-neutral-700">·</span>
          {libraries.libraries.map((l) => (
            <span
              key={l.id}
              className={`rounded bg-neutral-900 px-2 py-0.5 ${
                l.availability === 'live' ? 'text-neutral-300' : 'text-neutral-500'
              }`}
              title={`${l.stableKey} — ${l.availability}`}
            >
              {l.displayName} ({l.documentCount})
            </span>
          ))}
        </div>
      )}

      <main className="grow overflow-y-auto">
        <ul className="divide-y divide-neutral-900">
          {rows.map((row) => (
            <li
              key={row.documentId}
              onClick={() => openRow(row)}
              className={`cursor-pointer px-4 py-2 hover:bg-neutral-900 ${
                row.instances.length === 0 ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-neutral-100">{row.title}</span>
                <span className="text-xs text-neutral-500">{row.kind}</span>
                {row.instances.length === 0 && (
                  <span className="text-xs text-violet-400">ghost</span>
                )}
                {row.instances.map((i) => (
                  <span key={i.instanceId} className="text-xs text-neutral-600" title={i.libraryAvailability}>
                    {i.connectorKey}:{i.libraryName}
                  </span>
                ))}
              </div>
              {row.snippet && (
                <div className="mt-0.5 text-xs text-neutral-400">{row.snippet}</div>
              )}
              {row.tags.length > 0 && (
                <div className="mt-0.5 flex gap-1">
                  {row.tags.map((t) => (
                    <span key={t} className="rounded bg-neutral-900 px-1.5 text-[10px] text-neutral-500">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-neutral-600">
            {query ? 'No matches.' : 'No documents yet — Sync to index your libraries.'}
          </div>
        )}
      </main>
    </div>
  )
}
