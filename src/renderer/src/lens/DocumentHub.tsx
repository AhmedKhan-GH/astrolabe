import { useEffect, useMemo } from 'react'
import clsx from 'clsx'
import type { DocumentDetail } from './types'

/** How many annotated pages the hub lists (top-by-count). */
const TOP_PAGES = 8

const SOURCE_BADGE: Record<string, string> = {
  zotero: 'bg-red-950 text-red-300 border-red-800',
  eagle: 'bg-sky-950 text-sky-300 border-sky-800',
  obsidian: 'bg-violet-950 text-violet-300 border-violet-800',
}

/** One-line presence statement (copy — the zotero↔eagle split made human-readable). */
const PRESENCE_STATEMENT: Record<DocumentDetail['presence'], string> = {
  both: 'In both Zotero and Eagle',
  'zotero-only': 'Zotero only',
  'eagle-only': 'Eagle only',
  none: 'From a single source',
}

/**
 * Document Hub — the third member of the fixed right-overlay panel family (Canvas/Note are its
 * siblings; same Escape/× close, same mutually-exclusive slot in Lens). It composes ONLY existing
 * index data (docs/2026-07-10-implementation-plan-notes-hub-ink §Step 2): header (title/kind/tags/
 * VCs), Sources (per-instance jump-out / open-file / reveal + a presence statement), Annotations
 * (total + top pages, "open canvas" for a pdf), Notes (backlinks), and an actions row. The detail
 * arrives as a PROP so the panel stays pure and fully testable; the host owns the fetch.
 */
export function DocumentHub({
  detail,
  loading = false,
  error,
  onOpenUri,
  onOpenFile,
  onReveal,
  onOpenCanvas,
  onOpenNote,
  onOpenBacklink,
  onClose,
}: {
  detail: DocumentDetail | null
  loading?: boolean
  error?: string
  onOpenUri: (uri: string) => void
  onOpenFile: (path: string) => void
  onReveal: (path: string) => void
  onOpenCanvas: () => void
  onOpenNote: () => void
  onOpenBacklink: (target: { documentId: number; instanceId: number; title: string }) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Top annotated pages by count (desc), capped — the per-page counts arrive pageIndex-ordered.
  const topPages = useMemo(
    () => [...(detail?.annotations.pages ?? [])].sort((a, b) => b.count - a.count).slice(0, TOP_PAGES),
    [detail],
  )

  // Canvas needs bytes: a pdf with a file on disk (astro://doc streams by instanceId).
  const canCanvas = detail?.kind === 'pdf' && detail.instances.some((i) => i.filePath !== null)
  // Note reads a file-backed obsidian instance by instanceId.
  const canNote = detail?.instances.some((i) => i.sourceKey === 'obsidian' && i.filePath !== null) ?? false

  return (
    <div
      role="dialog"
      aria-label="document details"
      className="fixed inset-y-0 right-0 z-20 flex w-[min(34rem,92vw)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
          {detail?.kind ?? ''}
        </span>
        <h2 className="min-w-0 truncate font-medium text-zinc-100">{detail?.title ?? 'Document'}</h2>
        <button
          aria-label="close document details"
          onClick={onClose}
          className="ml-auto shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <p className="text-sm text-red-400">could not load details: {error}</p>
        ) : loading && !detail ? (
          <p className="text-sm text-zinc-600">loading details…</p>
        ) : !detail ? (
          <p className="text-sm text-zinc-600">no details.</p>
        ) : (
          <>
            {/* Tags + virtual-collection chips. */}
            {(detail.tags.length > 0 || detail.virtualCollections.length > 0) && (
              <div className="mb-5 flex flex-wrap items-center gap-1.5">
                {detail.tags.slice(0, 6).map((t) => (
                  <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                    #{t}
                  </span>
                ))}
                {detail.virtualCollections.map((vc) => (
                  <span
                    key={vc.slug}
                    className="rounded-full border border-emerald-900 bg-emerald-950 px-2 py-0.5 text-[11px] text-emerald-300"
                  >
                    {vc.name}
                  </span>
                ))}
              </div>
            )}

            {/* Sources. */}
            <Section title="Sources">
              <p className="mb-2 text-xs text-zinc-500">{PRESENCE_STATEMENT[detail.presence]}</p>
              <ul className="flex flex-col gap-2">
                {detail.instances.map((inst) => (
                  <li key={inst.instanceId} className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => onOpenUri(inst.uri)}
                      title={inst.uri}
                      className={clsx(
                        'rounded border px-1.5 py-0.5 text-[11px] font-medium hover:brightness-125',
                        SOURCE_BADGE[inst.sourceKey] ?? 'border-zinc-700 bg-zinc-800 text-zinc-300',
                      )}
                    >
                      {inst.sourceKey} ↗
                    </button>
                    {inst.filePath && (
                      <>
                        <button
                          onClick={() => onOpenFile(inst.filePath!)}
                          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                        >
                          open file
                        </button>
                        <button
                          onClick={() => onReveal(inst.filePath!)}
                          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                        >
                          reveal
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Section>

            {/* Annotations. */}
            <Section title="Annotations">
              <p className="text-sm text-zinc-300">
                <span className="font-medium text-zinc-100">{detail.annotations.total}</span> total
              </p>
              {topPages.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {topPages.map((p) => (
                    <li
                      key={p.pageIndex}
                      className="rounded border border-amber-900 bg-amber-950/60 px-2 py-0.5 text-[11px] text-amber-300"
                    >
                      page {p.pageIndex + 1} · {p.count}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Notes (backlinks). */}
            <Section title="Notes">
              {detail.backlinks.length === 0 ? (
                <p className="text-xs text-zinc-600">No linked notes.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {detail.backlinks.map((b) => (
                    <li key={b.documentId}>
                      <button
                        onClick={() =>
                          onOpenBacklink({ documentId: b.documentId, instanceId: b.instanceId, title: b.title })
                        }
                        className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-zinc-900"
                      >
                        <span className="text-[10px] uppercase tracking-wider text-zinc-600">{b.kind}</span>
                        <span className="min-w-0 truncate text-sm text-zinc-300">{b.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Actions. */}
            {(canCanvas || canNote) && (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
                {canCanvas && (
                  <button
                    aria-label="open canvas"
                    onClick={onOpenCanvas}
                    className="rounded border border-amber-800 bg-amber-950 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900"
                  >
                    Canvas
                  </button>
                )}
                {canNote && (
                  <button
                    onClick={onOpenNote}
                    className="rounded border border-violet-800 bg-violet-950 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-900"
                  >
                    Note
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** A titled hub section (uppercase eyebrow + body), matching the NoteView backlinks style. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 border-t border-zinc-800 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
      {children}
    </section>
  )
}
