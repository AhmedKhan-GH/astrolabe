import clsx from 'clsx'
import { renderSnippet } from './snippet'
import type { BrowseInstance } from './types'

/** Mirrors SearchHit from src/main/index/queries (structural copy; type flows via preload).
 *  `instances` share BrowseInstance with the river so the Canvas opens from either pane. */
export interface ResultData {
  documentId: number
  title: string
  kind: string
  snippet: string
  tags: string[]
  instances: BrowseInstance[]
}

const SOURCE_BADGE: Record<string, string> = {
  zotero: 'bg-red-950 text-red-300 border-red-800',
  eagle: 'bg-sky-950 text-sky-300 border-sky-800',
  obsidian: 'bg-violet-950 text-violet-300 border-violet-800',
}

export function SearchResult({
  hit,
  onOpenUri,
  onOpenFile,
  onReveal,
  onOpenCanvas,
}: {
  hit: ResultData
  onOpenUri: (uri: string) => void
  onOpenFile: (path: string) => void
  onReveal: (path: string) => void
  onOpenCanvas?: (hit: ResultData) => void
}) {
  const filePath = hit.instances.find((i) => i.filePath)?.filePath ?? null
  // Same rule as the river (DocumentRiver `canCanvas`): the Canvas streams bytes, so it needs
  // a pdf kind + a file on disk, and the affordance appears only when the handler is wired.
  const canCanvas = Boolean(onOpenCanvas) && hit.kind === 'pdf' && filePath !== null
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
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
        ) : (
          <h3 className="truncate font-medium text-zinc-100">{hit.title}</h3>
        )}
      </div>
      {hit.snippet && (
        <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{renderSnippet(hit.snippet)}</p>
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
    </li>
  )
}
