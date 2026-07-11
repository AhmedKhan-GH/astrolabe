import { useState } from 'react'
import type { ToolCallEntry } from './transcript'
import type { AcpToolKind, ToolContentItem } from './types'

/**
 * ToolCard — one tool call as an expandable card (spec §Track B/2). The header shows a kind icon,
 * the title, and a live status glyph (spinner while pending/in_progress, ✓ completed, ✗ failed);
 * clicking it discloses the body: the command in mono, diffs as red/green line blocks, and
 * text/terminal output. A harvested documentId surfaces a chip that jumps to the Document Hub.
 * Pure/props-only so it renders identically live and in history.
 */

/** Glyph per ToolKind — a compact, legible stand-in for a real icon set. Unknown kinds fall back. */
const KIND_ICON: Record<string, string> = {
  read: '📖',
  edit: '✎',
  delete: '🗑',
  move: '↪',
  search: '🔍',
  execute: '⌘',
  think: '💭',
  fetch: '🌐',
  other: '•',
}

function iconFor(kind: AcpToolKind): string {
  return KIND_ICON[kind as string] ?? KIND_ICON.other
}

function StatusGlyph({ status }: { status: ToolCallEntry['status'] }) {
  if (status === 'completed')
    return (
      <span title="completed" aria-label="completed" className="text-emerald-400">
        ✓
      </span>
    )
  if (status === 'failed')
    return (
      <span title="failed" aria-label="failed" className="text-red-400">
        ✗
      </span>
    )
  return (
    <span
      title={status}
      aria-label={status}
      role="status"
      className="inline-block h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-transparent"
    />
  )
}

/** One diff block: old lines in red, new lines in green — the classic +/- gutter. */
function DiffBlock({ path, oldText, newText }: { path: string; oldText: string | null; newText: string }) {
  const del = oldText ? oldText.replace(/\n$/, '').split('\n') : []
  const add = newText.length ? newText.replace(/\n$/, '').split('\n') : []
  return (
    <div className="my-1 overflow-hidden rounded border border-zinc-800 font-mono text-[11px]">
      <div className="border-b border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-400">{path}</div>
      {del.map((line, i) => (
        <div key={`d${i}`} data-diff="del" className="whitespace-pre-wrap bg-red-950/40 px-2 text-red-300">
          <span aria-hidden>- </span>
          {line}
        </div>
      ))}
      {add.map((line, i) => (
        <div key={`a${i}`} data-diff="add" className="whitespace-pre-wrap bg-emerald-950/40 px-2 text-emerald-300">
          <span aria-hidden>+ </span>
          {line}
        </div>
      ))}
    </div>
  )
}

function ContentItem({ item }: { item: ToolContentItem }) {
  if (item.type === 'diff') return <DiffBlock path={item.path} oldText={item.oldText} newText={item.newText} />
  if (item.type === 'terminal')
    return (
      <pre className="my-1 overflow-x-auto rounded border border-zinc-800 bg-black px-2 py-1 font-mono text-[11px] text-zinc-300">
        {item.text}
      </pre>
    )
  return <p className="my-1 whitespace-pre-wrap text-[12px] text-zinc-300">{item.text}</p>
}

export function ToolCard({
  entry,
  onOpenHub,
}: {
  entry: ToolCallEntry
  onOpenHub: (documentId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const hasBody = !!entry.command || (entry.content?.length ?? 0) > 0

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span aria-hidden className="text-sm leading-none">
          {iconFor(entry.toolKind)}
        </span>
        <button
          type="button"
          disabled={!hasBody}
          aria-expanded={hasBody ? open : undefined}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        >
          <span className="min-w-0 truncate font-medium text-zinc-200">{entry.title}</span>
          {hasBody && <span className="text-zinc-600">{open ? '▾' : '▸'}</span>}
        </button>
        {entry.documentId != null && (
          <button
            type="button"
            title="open in Document Hub"
            onClick={() => onOpenHub(entry.documentId as number)}
            className="shrink-0 rounded-full border border-violet-800 bg-violet-950/60 px-1.5 py-0.5 text-[10px] text-violet-300 hover:bg-violet-900"
          >
            hub ⓘ
          </button>
        )}
        <StatusGlyph status={entry.status} />
      </div>

      {hasBody && open && (
        <div className="border-t border-zinc-800 px-2.5 py-2">
          {entry.command && (
            <pre className="my-1 overflow-x-auto rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200">
              {entry.command}
            </pre>
          )}
          {entry.content?.map((item, i) => (
            <ContentItem key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
