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
  togglePresence,
  cycleTag,
  setTagMatch,
  removeTag,
  toFilterSet,
} from './selection'
import { toStoredFilter, resolveStoredFilter, selectionFromFilterSet } from './viewRefs'
import { CanvasView } from './CanvasView'
import { NoteView, type NoteNavTarget } from './NoteView'
import { ExcalidrawView } from './excalidraw/ExcalidrawView'
import { isExcalidrawNote, parseExcalidrawScene } from './excalidraw/parse'
import { DocumentHub } from './DocumentHub'
import { canvasCandidates, type CanvasHostHit } from './canvas'
import { usePdfDocument } from './pdf/usePdfDocument'
import { rewriteOpenPdfPage } from './pdf/heat'
import type {
  BrowseInstance,
  DocumentDetail,
  DocumentLinks,
  LensSelection,
  NavData,
  NavNode,
  PageAnnotations,
  SavedView,
  VCollectionSummary,
} from './types'

const EMPTY_LINKS: DocumentLinks = { outlinks: [], backlinks: [] }

/** A note the NoteHost opens; uri/tags are absent for notes reached by following a link. */
interface NoteRef extends NoteNavTarget {
  uri?: string
  tags?: string[]
}

/** The minimal hit shape openNote needs — satisfied by a BrowseHit and a search ResultData. */
interface NoteSource {
  documentId: number
  title: string
  tags: string[]
  instances: BrowseInstance[]
}

const EMPTY_NAV: NavData = { kinds: [], sources: [], tags: [], virtualCollections: [], presence: [] }

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

/**
 * Owns the pdf.js hook + heat query for one open document, so CanvasView stays a pure,
 * fully-testable component (the hook RESULT is a prop) and pdf.js loads only while a
 * canvas is actually open.
 */
function CanvasHost({
  hit,
  onOpenDetails,
  onClose,
}: {
  hit: CanvasHostHit
  onOpenDetails: () => void
  onClose: () => void
}) {
  // File-backed instances zotero-first (canvas.ts). If one fails to render, fall forward to
  // the next candidate — a broken/moved Zotero file shouldn't dead-end a document that Eagle
  // also has on disk.
  const candidates = canvasCandidates(hit.instances)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const instance = candidates[candidateIndex] ?? null
  const pdf = usePdfDocument(`astro://doc/${instance?.instanceId ?? 0}`)
  useEffect(() => {
    if (pdf.status === 'error' && candidateIndex < candidates.length - 1)
      setCandidateIndex((i) => i + 1)
  }, [pdf.status, candidateIndex, candidates.length])
  const heat = useQuery<PageAnnotations>({
    queryKey: ['pageAnnotations', hit.documentId],
    queryFn: () => window.astrolabe.index.pageAnnotations(hit.documentId),
  })
  // Page-targeted deep link: when main indexed an open-pdf base for this instance (built from
  // the zotero attachmentKey), rewrite its page to the clicked one — that lands on the page,
  // not just the document. Older/non-zotero instances have no base, so we open the plain uri
  // (which only page-targets if it already happens to be open-pdf shaped). Needs a Rebuild
  // index for the attachmentKey backfill before page-out works on an existing library.
  const openPage = (pageIndex: number): void => {
    if (!instance) return
    const uri = instance.openPdfUri
      ? rewriteOpenPdfPage(instance.openPdfUri, pageIndex + 1)
      : instance.uri.includes('open-pdf')
        ? rewriteOpenPdfPage(instance.uri, pageIndex + 1)
        : instance.uri
    void window.astrolabe.system.openUri(uri)
  }
  return (
    <CanvasView
      title={hit.title}
      pdf={pdf}
      heat={heat.data ?? null}
      onOpenPage={openPage}
      onOpenDetails={onOpenDetails}
      onClose={onClose}
    />
  )
}

/**
 * Owns the markdown fetch (`astro://doc/<instanceId>`) + links query for one open note, so
 * NoteView stays a pure, fully-testable component. Keyed by instanceId in Lens, so following
 * a wiki link / backlink remounts it with fresh queries for the navigated-to note.
 */
function NoteHost({
  note,
  onNavigate,
  onOpenDetails,
  onClose,
}: {
  note: NoteRef
  onNavigate: (target: NoteNavTarget) => void
  onOpenDetails: () => void
  onClose: () => void
}) {
  const md = useQuery({
    queryKey: ['noteMd', note.instanceId],
    queryFn: async () => {
      const r = await fetch(`astro://doc/${note.instanceId}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    },
  })
  const links = useQuery<DocumentLinks>({
    queryKey: ['links', note.documentId],
    queryFn: () => window.astrolabe.index.links(note.documentId),
  })

  // An Obsidian-Excalidraw note (`*.excalidraw.md`) IS a note (reached by the same title
  // click), but its body is an embedded drawing, not prose. When the fetched markdown is one,
  // render it as a read-only drawing instead of the raw NoteView. Parsing can throw on a
  // corrupt/unsupported payload — in that case we fall back to the source NoteView with a
  // visible notice, so a broken drawing never blanks the panel (docs/02 D2 keeps editing in
  // Obsidian; this is a read-only surface).
  const md_data = md.data ?? ''
  const drawing = useMemo(() => {
    if (!md.data || !isExcalidrawNote(md.data)) return null
    try {
      return { scene: parseExcalidrawScene(md.data), error: null as string | null }
    } catch (e) {
      return { scene: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [md.data])

  if (drawing?.scene) {
    return (
      <ExcalidrawView
        title={note.title}
        scene={drawing.scene}
        uri={note.uri}
        onOpenUri={(uri) => void window.astrolabe.system.openUri(uri)}
        onOpenDetails={onOpenDetails}
        onClose={onClose}
      />
    )
  }

  return (
    <NoteView
      title={note.title}
      content={md_data}
      tags={note.tags}
      uri={note.uri}
      links={links.data ?? EMPTY_LINKS}
      loading={md.isPending}
      error={md.isError ? String(md.error) : undefined}
      notice={drawing?.error ? 'drawing could not be parsed — showing source' : undefined}
      onNavigate={onNavigate}
      onOpenUri={(uri) => void window.astrolabe.system.openUri(uri)}
      onOpenDetails={onOpenDetails}
      onClose={onClose}
    />
  )
}

/**
 * Owns the `index:document` fetch for one open document, so DocumentHub stays a pure, fully-
 * testable component (the detail is a prop). Adapts the hub's parameterless action callbacks to
 * the shared openCanvas/openNote helpers using the fetched detail; backlink rows navigate to the
 * source note via openNoteRef. Keyed by documentId in Lens so opening a new hub refetches.
 */
function DocumentHost({
  documentId,
  onOpenCanvas,
  onOpenNote,
  onOpenBacklink,
  onClose,
}: {
  documentId: number
  onOpenCanvas: (hit: CanvasHostHit) => void
  onOpenNote: (hit: NoteSource) => void
  onOpenBacklink: (target: NoteNavTarget) => void
  onClose: () => void
}) {
  const detail = useQuery<DocumentDetail | null>({
    queryKey: ['document', documentId],
    queryFn: () => window.astrolabe.index.document(documentId),
  })
  const d = detail.data ?? null
  return (
    <DocumentHub
      detail={d}
      loading={detail.isPending}
      error={
        detail.isError
          ? String(detail.error)
          : !detail.isPending && detail.data === null
            ? 'document not found'
            : undefined
      }
      onOpenUri={(uri) => void window.astrolabe.system.openUri(uri)}
      onOpenFile={(p) => void window.astrolabe.system.openPath(p)}
      onReveal={(p) => void window.astrolabe.system.reveal(p)}
      onOpenCanvas={() =>
        d && onOpenCanvas({ documentId: d.documentId, title: d.title, instances: d.instances })
      }
      onOpenNote={() =>
        d && onOpenNote({ documentId: d.documentId, title: d.title, tags: d.tags, instances: d.instances })
      }
      onOpenBacklink={onOpenBacklink}
      onClose={onClose}
    />
  )
}

export function Lens() {
  const [q, setQ] = useState('')
  const [selection, setSelection] = useState<LensSelection>(emptySelection())
  const [canvasFor, setCanvasFor] = useState<CanvasHostHit | null>(null)
  // Canvas, Note, and Hub share ONE mutually-exclusive panel slot: opening any one nulls the
  // other two (docs/2026-07-10-implementation-plan-notes-hub-ink §Step 2 — one panel slot).
  const [noteFor, setNoteFor] = useState<NoteRef | null>(null)
  const [hubFor, setHubFor] = useState<number | null>(null)
  const openCanvas = (hit: CanvasHostHit): void => {
    setNoteFor(null)
    setHubFor(null)
    setCanvasFor(hit)
  }
  const openNote = (hit: NoteSource): void => {
    const inst = hit.instances.find((i) => i.sourceKey === 'obsidian' && i.filePath !== null)
    if (!inst) return
    openNoteRef({
      documentId: hit.documentId,
      instanceId: inst.instanceId,
      title: hit.title,
      uri: inst.uri,
      tags: hit.tags,
    })
  }
  // Navigate straight to a note by reference (a followed wiki-link / backlink, or a hub note).
  const openNoteRef = (note: NoteRef): void => {
    setCanvasFor(null)
    setHubFor(null)
    setNoteFor(note)
  }
  const openHub = (documentId: number): void => {
    setCanvasFor(null)
    setNoteFor(null)
    setHubFor(documentId)
  }
  // The slug of the currently-applied saved view, cleared on any manual edit so the
  // rail highlight never lies about whether the live lens still matches the view.
  const [appliedViewSlug, setAppliedViewSlug] = useState<string | null>(null)
  const debouncedQ = useDebounced(q, 200)
  const queryClient = useQueryClient()

  // The serialized FilterSet is the wire payload and the query-key fragment: when it
  // changes, browse/search refetch. TanStack hashes object keys deterministically.
  const filterSet = useMemo(() => toFilterSet(selection), [selection])

  // Manual edits detach from any applied view; a wrapper keeps that invariant in one place.
  const editSelection = (fn: (s: LensSelection) => LensSelection) => {
    setSelection(fn)
    setAppliedViewSlug(null)
  }
  const editQ = (value: string) => {
    setQ(value)
    setAppliedViewSlug(null)
  }

  const onToggleScope: Parameters<typeof NavRail>[0]['onToggleScope'] = (dim, value) =>
    editSelection((s) => toggleScope(s, dim, value))
  const onToggleKind: Parameters<typeof NavRail>[0]['onToggleKind'] = (kind) =>
    editSelection((s) => toggleKind(s, kind))
  const onTogglePresence: Parameters<typeof NavRail>[0]['onTogglePresence'] = (value) =>
    editSelection((s) => togglePresence(s, value))
  const onCycleTag = (name: string) => editSelection((s) => cycleTag(s, name))
  const onSetTagMatch = (mode: 'all' | 'any') => editSelection((s) => setTagMatch(s, mode))
  const onRemoveTag = (name: string) => editSelection((s) => removeTag(s, name))
  const onClearAll = () => editSelection(() => emptySelection())

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

  // Saved views — named lenses persisted as one JSON file each (user artifact).
  const views = useQuery<SavedView[]>({
    queryKey: ['views'],
    queryFn: () => window.astrolabe.views.list(),
  })
  const saveView = useMutation({
    mutationFn: (name: string) =>
      window.astrolabe.views.save({
        name,
        q: q.trim() || undefined,
        filter: toStoredFilter(filterSet, nav.data ?? EMPTY_NAV),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['views'] }),
  })
  const deleteView = useMutation({
    mutationFn: (slug: string) => window.astrolabe.views.remove(slug),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['views'] }),
  })

  // Virtual collections — source-independent M:N groupings (first-party user data).
  // The dedicated list carries counts + unresolvedCount, driving the rail section, the
  // river membership popover, and FilterBar chip labels.
  const vcollections = useQuery<VCollectionSummary[]>({
    queryKey: ['vcollections'],
    queryFn: () => window.astrolabe.collections.list(),
  })
  // Membership changes both the counts (nav + vcollections) and the row chips (browse).
  const invalidateVCollections = () => {
    void queryClient.invalidateQueries({ queryKey: ['vcollections'] })
    void queryClient.invalidateQueries({ queryKey: ['nav'] })
    void queryClient.invalidateQueries({ queryKey: ['browse'] })
  }
  const createCollection = useMutation({
    mutationFn: (name: string) => window.astrolabe.collections.create(name),
    onSuccess: invalidateVCollections,
  })
  const deleteCollection = useMutation({
    mutationFn: (slug: string) => window.astrolabe.collections.remove(slug),
    onSuccess: invalidateVCollections,
  })
  const addMembers = useMutation({
    mutationFn: ({ slug, documentIds }: { slug: string; documentIds: number[] }) =>
      window.astrolabe.collections.addMembers(slug, documentIds),
    onSuccess: invalidateVCollections,
  })
  const removeMembers = useMutation({
    mutationFn: ({ slug, documentIds }: { slug: string; documentIds: number[] }) =>
      window.astrolabe.collections.removeMembers(slug, documentIds),
    onSuccess: invalidateVCollections,
  })
  // Create-then-add is a two-call composite (the river popover's footer input).
  const createAndAdd = useMutation({
    mutationFn: async ({ documentId, name }: { documentId: number; name: string }) => {
      const created = await window.astrolabe.collections.create(name)
      await window.astrolabe.collections.addMembers(created.slug, [documentId])
      return created
    },
    onSuccess: invalidateVCollections,
  })

  const onToggleMembership = (documentId: number, slug: string, nextChecked: boolean): void => {
    if (nextChecked) addMembers.mutate({ slug, documentIds: [documentId] })
    else removeMembers.mutate({ slug, documentIds: [documentId] })
  }

  // slug → display name for FilterBar chips (the vcollections list is the name source).
  const vcollectionNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of vcollections.data ?? []) map.set(c.slug, c.name)
    return map
  }, [vcollections.data])

  // Applying a view replaces q + selection wholesale; unresolvable collection refs
  // are dropped so the FilterBar shows exactly what took effect (honest stale-ref surface).
  const applyView = (view: SavedView) => {
    setSelection(selectionFromFilterSet(resolveStoredFilter(view.filter, nav.data ?? EMPTY_NAV)))
    setQ(view.q ?? '')
    setAppliedViewSlug(view.slug)
  }

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
              views={views.data ?? []}
              appliedViewSlug={appliedViewSlug}
              collections={vcollections.data ?? []}
              onToggleKind={onToggleKind}
              onToggleScope={onToggleScope}
              onTogglePresence={onTogglePresence}
              onCycleTag={onCycleTag}
              onSetTagMatch={onSetTagMatch}
              onApplyView={applyView}
              onDeleteView={(slug) => deleteView.mutate(slug)}
              onCreateCollection={(name) => createCollection.mutate(name)}
              onDeleteCollection={(slug) => deleteCollection.mutate(slug)}
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
            vcollectionNames={vcollectionNames}
            canSave={q.trim().length > 0}
            onToggleScope={onToggleScope}
            onToggleKind={onToggleKind}
            onTogglePresence={onTogglePresence}
            onRemoveTag={onRemoveTag}
            onClearAll={onClearAll}
            onSaveView={(name) => saveView.mutate(name)}
          />
          <input
            autoFocus
            value={q}
            onChange={(e) => editQ(e.target.value)}
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
                    onOpenCanvas={openCanvas}
                    onOpenNote={openNote}
                    onOpenHub={(hit) => openHub(hit.documentId)}
                  />
                ))}
              </ul>
            </main>
          ) : (
            <DocumentRiver
              filters={filterSet}
              collections={vcollections.data ?? []}
              onToggleMembership={onToggleMembership}
              onCreateAndAdd={(documentId, name) => createAndAdd.mutate({ documentId, name })}
              onOpenCanvas={openCanvas}
              onOpenNote={openNote}
              onOpenHub={(hit) => openHub(hit.documentId)}
              onSync={() => sync.mutate()}
            />
          )}
        </div>
      </div>

      {canvasFor && (
        <CanvasHost
          key={canvasFor.documentId}
          hit={canvasFor}
          onOpenDetails={() => openHub(canvasFor.documentId)}
          onClose={() => setCanvasFor(null)}
        />
      )}
      {noteFor && (
        <NoteHost
          key={noteFor.instanceId}
          note={noteFor}
          onNavigate={openNoteRef}
          onOpenDetails={() => openHub(noteFor.documentId)}
          onClose={() => setNoteFor(null)}
        />
      )}
      {hubFor !== null && (
        <DocumentHost
          key={hubFor}
          documentId={hubFor}
          onOpenCanvas={openCanvas}
          onOpenNote={openNote}
          onOpenBacklink={openNoteRef}
          onClose={() => setHubFor(null)}
        />
      )}
    </div>
  )
}
