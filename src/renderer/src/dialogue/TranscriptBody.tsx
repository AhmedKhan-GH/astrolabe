import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { TranscriptEntry } from './transcript'

/**
 * The transcript body — the message/tool-chip/divider rendering shared by the live pane AND the
 * read-only history view (spec §1: "reuse the existing message/chip rendering"). Agent prose is
 * markdown (NoteView's zinc prose); every href routes through `onOpenUri` (provenance schemes),
 * and a tool chip carrying a documentId links into the Document Hub via `onOpenHub`.
 */
export function TranscriptBody({
  entries,
  onOpenUri,
  onOpenHub,
}: {
  entries: TranscriptEntry[]
  onOpenUri: (uri: string) => void
  onOpenHub: (documentId: number) => void
}) {
  const md = useMemo<Components>(
    () => ({
      h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold text-zinc-100">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold text-zinc-100">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-zinc-200">{children}</h3>,
      p: ({ children }) => <p className="my-1.5 leading-relaxed text-zinc-300">{children}</p>,
      ul: ({ children }) => <ul className="my-1.5 list-disc pl-5 text-zinc-300">{children}</ul>,
      ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5 text-zinc-300">{children}</ol>,
      li: ({ children }) => <li className="my-0.5">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-1.5 border-l-2 border-zinc-700 pl-3 text-zinc-400">{children}</blockquote>
      ),
      strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      code: ({ children }) => (
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-[0.85em] text-zinc-200">{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="my-1.5 overflow-x-auto rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-200">
          {children}
        </pre>
      ),
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault()
            if (href) onOpenUri(href)
          }}
          className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
        >
          {children}
        </a>
      ),
    }),
    [onOpenUri],
  )

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((e, i) => {
        if (e.kind === 'divider') {
          return (
            <li key={i} className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-600">
              <span className="h-px flex-1 bg-zinc-800" />
              session restarted
              <span className="h-px flex-1 bg-zinc-800" />
            </li>
          )
        }
        if (e.kind === 'message' && e.role === 'user') {
          return (
            <li key={i} className="whitespace-pre-wrap rounded-lg bg-zinc-800/60 px-3 py-2 text-zinc-200">
              {e.text}
            </li>
          )
        }
        if (e.kind === 'message') {
          return (
            <li key={i} className="max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url) => url} components={md}>
                {e.text}
              </ReactMarkdown>
            </li>
          )
        }
        if (e.kind === 'tool') {
          const label = `${e.toolName} · ${e.status}`
          return (
            <li key={i}>
              {e.documentId != null ? (
                <button
                  onClick={() => onOpenHub(e.documentId as number)}
                  title="open in Document Hub"
                  className="inline-flex items-center gap-1 rounded-full border border-violet-800 bg-violet-950/60 px-2 py-0.5 text-[11px] text-violet-300 hover:bg-violet-900"
                >
                  <span className="font-mono">{label}</span>
                  <span aria-hidden>ⓘ</span>
                </button>
              ) : (
                <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-mono text-zinc-400">
                  {label}
                </span>
              )}
            </li>
          )
        }
        return (
          <li key={i} className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {e.reason}
          </li>
        )
      })}
    </ul>
  )
}
