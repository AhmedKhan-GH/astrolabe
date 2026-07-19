import type { DocumentDetail, HitInstance } from '../../../../main/index/queries'
import { useDocumentDetail, useFrame, useFrameActions } from '../state'

/**
 * The detail panel — the document hub (frame spec §3). One document at a time:
 * header (title · kind · modified · close), a ghost banner when every copy is
 * gone (D3 language), then Instances / Folders / Tags / Annotations / Backlinks.
 * Reads selection from the frame; renders nothing when the detail is closed.
 * The detail hook is stale-while-refetch, so prior content stays put across a
 * refresh; only an error surfaces a line.
 */
export default function DetailPanel(): React.JSX.Element | null {
  const { selectedDocumentId, detailOpen } = useFrame()
  const { data, error } = useDocumentDetail(selectedDocumentId)

  if (!detailOpen || selectedDocumentId == null) return null

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-950 text-neutral-200">
      {error && (
        <div className="border-b border-amber-900/50 bg-amber-950/30 px-4 py-1.5 text-xs text-amber-400">
          Couldn’t load this document. {error}
        </div>
      )}
      {data ? <DetailBody detail={data} /> : !error ? <EmptyState /> : null}
    </aside>
  )
}

function EmptyState(): React.JSX.Element {
  return <div className="p-8 text-center text-sm text-neutral-600">Loading…</div>
}

function DetailBody({ detail }: { detail: DocumentDetail }): React.JSX.Element {
  const actions = useFrameActions()
  const modified = formatModified(detail.modifiedAt)

  return (
    <>
      <header className="flex items-start gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="min-w-0 grow">
          <h2 className="text-sm font-semibold leading-snug text-neutral-100">{detail.title}</h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-400">{detail.kind}</span>
            {modified && <span>{modified}</span>}
          </div>
        </div>
        <button
          onClick={() => actions.setDetailOpen(false)}
          aria-label="Close detail"
          title="Close"
          className="shrink-0 rounded border border-neutral-800 px-1.5 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
        >
          ✕
        </button>
      </header>

      {detail.instances.length === 0 && (
        <div className="border-b border-violet-900/40 bg-violet-950/30 px-4 py-2 text-xs text-violet-300">
          No live copies — this document is remembered.
        </div>
      )}

      <InstancesSection instances={detail.instances} />
      <FoldersSection folders={detail.folders} />
      <TagsSection tags={detail.tags} />
      <AnnotationsSection annotations={detail.annotations} />
      <BacklinksSection backlinks={detail.backlinks} />
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="border-b border-neutral-900 px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  )
}

function InstancesSection({ instances }: { instances: HitInstance[] }): React.JSX.Element {
  const open = (value: string): void => void window.astrolabe.open({ kind: 'uri', value })
  const reveal = (value: string): void => void window.astrolabe.open({ kind: 'reveal', value })

  return (
    <Section title="Instances">
      {instances.length === 0 ? (
        <p className="text-xs text-neutral-600">No copies to open.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {instances.map((i) => {
            const live = i.libraryAvailability === 'live'
            const openTarget = i.openPdfUri ?? i.uri
            return (
              <li key={i.instanceId} className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-block size-1.5 shrink-0 rounded-full ${
                    live ? 'bg-emerald-500' : 'bg-neutral-600'
                  }`}
                  title={i.libraryAvailability}
                  aria-label={live ? 'live' : 'dormant'}
                />
                <span
                  className={`min-w-0 grow truncate ${live ? 'text-neutral-300' : 'text-neutral-500'}`}
                  title={`${i.connectorKey}:${i.libraryName}`}
                >
                  {i.connectorKey}:{i.libraryName}
                </span>
                {openTarget && (
                  <button
                    onClick={() => open(openTarget)}
                    className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 hover:border-neutral-500"
                  >
                    Open
                  </button>
                )}
                {i.filePath && (
                  <button
                    onClick={() => reveal(i.filePath as string)}
                    className="shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 text-neutral-400 hover:border-neutral-600"
                  >
                    Reveal
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function FoldersSection({ folders }: { folders: { slug: string; name: string }[] }): React.JSX.Element | null {
  const actions = useFrameActions()
  if (folders.length === 0) return null
  return (
    <Section title="Folders">
      <div className="flex flex-wrap gap-1.5">
        {folders.map((f) => (
          <button
            key={f.slug}
            onClick={() => actions.selectRail({ kind: 'folder', slug: f.slug, includeSubfolders: false })}
            className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {f.name}
          </button>
        ))}
      </div>
    </Section>
  )
}

function TagsSection({ tags }: { tags: string[] }): React.JSX.Element | null {
  const actions = useFrameActions()
  if (tags.length === 0) return null
  return (
    <Section title="Tags">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <button
            key={t}
            onClick={() => actions.selectRail({ kind: 'tag', name: t })}
            className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            {t}
          </button>
        ))}
      </div>
    </Section>
  )
}

function AnnotationsSection({
  annotations,
}: {
  annotations: DocumentDetail['annotations']
}): React.JSX.Element | null {
  if (annotations.total === 0) return null
  return (
    <Section title={`${annotations.total} annotation${annotations.total === 1 ? '' : 's'}`}>
      <ul className="flex flex-col gap-2">
        {annotations.preview.map((a, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs">
            <div className="min-w-0 grow">
              {a.text && <p className="italic text-neutral-300">{a.text}</p>}
              {a.comment && <p className="mt-0.5 text-neutral-400">{a.comment}</p>}
            </div>
            {a.pageLabel && <span className="shrink-0 text-right text-neutral-600">{a.pageLabel}</span>}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function BacklinksSection({
  backlinks,
}: {
  backlinks: DocumentDetail['backlinks']
}): React.JSX.Element | null {
  const actions = useFrameActions()
  if (backlinks.length === 0) return null
  return (
    <Section title="Linked from">
      <ul className="flex flex-col gap-1">
        {backlinks.map((b) => (
          <li key={`${b.documentId}:${b.instanceId}`}>
            <button
              onClick={() => actions.selectDocument(b.documentId)}
              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-900"
            >
              <span className="min-w-0 grow truncate text-neutral-300">{b.title}</span>
              <span className="shrink-0 text-neutral-600">{b.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function formatModified(modifiedAt: number): string | null {
  if (!Number.isFinite(modifiedAt) || modifiedAt <= 0) return null
  const d = new Date(modifiedAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
