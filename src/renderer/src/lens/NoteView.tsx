import { useEffect, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stripFrontmatter, wikiLinksToMd } from './md/wiki'
import type { DocumentLinks } from './types'

/** The minimal reference NoteView hands back when a link is followed in-app. */
export interface NoteNavTarget {
  documentId: number
  instanceId: number
  title: string
}

const WIKI_SCHEME = 'astro-wiki://'

/**
 * Read-only note panel — the NoteView twin of CanvasView (same fixed right-overlay family,
 * Escape/× to close). Obsidian stays the editor and fidelity renderer; this is a fast,
 * in-app read with LIVE wiki links: `[[target]]` references resolve against the `outlinks`
 * prop and either navigate in-app (resolved) or grey out as "not in vault". Content and the
 * link graph arrive as PROPS so the whole panel is a pure, fully-testable component.
 */
export function NoteView({
  title,
  content,
  tags,
  uri,
  links,
  loading = false,
  error,
  onNavigate,
  onOpenUri,
  onOpenDetails,
  onClose,
}: {
  title: string
  content: string
  tags?: string[]
  /** Obsidian deep-link — absent for navigated-to notes; the header button hides when unset. */
  uri?: string
  links: DocumentLinks
  loading?: boolean
  error?: string
  onNavigate: (target: NoteNavTarget) => void
  onOpenUri: (uri: string) => void
  /** Cross-link to the Document Hub for this note (panel swap); hidden when unwired. */
  onOpenDetails?: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Resolve a wiki target (the decoded note name) to its indexed document, if any.
  const outlinkByName = useMemo(() => {
    const m = new Map<string, DocumentLinks['outlinks'][number]>()
    for (const o of links.outlinks) m.set(o.targetName, o)
    return m
  }, [links.outlinks])

  const rendered = useMemo(() => wikiLinksToMd(stripFrontmatter(content)), [content])

  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => <h1 className="mb-2 mt-4 text-xl font-semibold text-zinc-100">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold text-zinc-100">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold text-zinc-200">{children}</h3>,
      p: ({ children }) => <p className="my-2 leading-relaxed text-zinc-300">{children}</p>,
      ul: ({ children }) => <ul className="my-2 list-disc pl-5 text-zinc-300">{children}</ul>,
      ol: ({ children }) => <ol className="my-2 list-decimal pl-5 text-zinc-300">{children}</ol>,
      li: ({ children }) => <li className="my-0.5">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-2 border-l-2 border-zinc-700 pl-3 text-zinc-400">{children}</blockquote>
      ),
      hr: () => <hr className="my-4 border-zinc-800" />,
      strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      code: ({ children }) => (
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-[0.85em] text-zinc-200">{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-200">
          {children}
        </pre>
      ),
      table: ({ children }) => (
        <table className="my-2 w-full border-collapse text-sm text-zinc-300">{children}</table>
      ),
      th: ({ children }) => <th className="border border-zinc-800 px-2 py-1 text-left font-medium">{children}</th>,
      td: ({ children }) => <td className="border border-zinc-800 px-2 py-1">{children}</td>,
      a: ({ href, children }) => {
        if (href?.startsWith(WIKI_SCHEME)) {
          const targetName = decodeURIComponent(href.slice(WIKI_SCHEME.length))
          const hit = outlinkByName.get(targetName)
          if (hit && hit.documentId !== null && hit.instanceId !== null) {
            return (
              <button
                onClick={() =>
                  onNavigate({
                    documentId: hit.documentId as number,
                    instanceId: hit.instanceId as number,
                    title: hit.title ?? targetName,
                  })
                }
                className="text-violet-300 underline decoration-dotted underline-offset-2 hover:text-violet-200"
              >
                {children}
              </button>
            )
          }
          return (
            <span title="not in vault" className="text-zinc-500 underline decoration-dotted underline-offset-2">
              {children}
            </span>
          )
        }
        return (
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
        )
      },
    }),
    [outlinkByName, onNavigate, onOpenUri],
  )

  return (
    <div
      role="dialog"
      aria-label="note view"
      className="fixed inset-y-0 right-0 z-20 flex w-[min(48rem,92vw)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <h2 className="min-w-0 truncate font-medium text-zinc-100">{title}</h2>
        {(tags?.length ?? 0) > 0 && (
          <div className="flex min-w-0 shrink flex-wrap items-center gap-1">
            {tags!.slice(0, 6).map((t) => (
              <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {uri && (
            <button
              onClick={() => onOpenUri(uri)}
              className="rounded border border-violet-800 bg-violet-950 px-2 py-1 text-xs text-violet-300 hover:bg-violet-900"
            >
              open in Obsidian ↗
            </button>
          )}
          {onOpenDetails && (
            <button
              aria-label="document details"
              title="Document details"
              onClick={onOpenDetails}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              ⓘ
            </button>
          )}
          <button
            aria-label="close note view"
            onClick={onClose}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            ×
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <p className="text-sm text-red-400">could not load note: {error}</p>
        ) : loading && content.length === 0 ? (
          <p className="text-sm text-zinc-600">loading note…</p>
        ) : (
          <article className="max-w-none text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url) => url} components={components}>
              {rendered}
            </ReactMarkdown>
          </article>
        )}

        {links.backlinks.length > 0 && (
          <section className="mt-8 border-t border-zinc-800 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Backlinks · {links.backlinks.length}
            </h3>
            <ul className="flex flex-col gap-1">
              {links.backlinks.map((b) => (
                <li key={b.documentId}>
                  <button
                    onClick={() =>
                      onNavigate({ documentId: b.documentId, instanceId: b.instanceId, title: b.title })
                    }
                    className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-zinc-900"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-zinc-600">{b.kind}</span>
                    <span className="min-w-0 truncate text-sm text-zinc-300">{b.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
