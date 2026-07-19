/* eslint-disable react-refresh/only-export-components --
 * The frozen frame contract deliberately co-locates the provider with its
 * hooks and types (spec §6); losing fast-refresh on this rarely-edited file
 * is an accepted trade. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { FolderTreeNode, DocumentDetail, SearchHit, BrowseHit, IndexStats } from '../../../main/index/queries'
import type { LibrariesSnapshot } from '../../../shared/db-ipc'

/**
 * The frame's state contract (frame spec §6) — FROZEN: rail/river/detail/⌘K
 * components code against exactly these shapes. Selection is real state; the
 * history stack records the (rail, selectedDocumentId, detailOpen) triple and
 * ⌘[/⌘] replay it. Data hooks are plain fetch-on-change (react-query is M4);
 * `refresh()` bumps a version every hook depends on.
 */

// ── Selection ────────────────────────────────────────────────────────────────

export type RailSelection =
  | { kind: 'all' }
  | { kind: 'uncategorized' }
  | { kind: 'folder'; slug: string; includeSubfolders: boolean }
  | { kind: 'tag'; name: string }
  | { kind: 'library'; id: number }

export interface FrameSnapshot {
  rail: RailSelection
  selectedDocumentId: number | null
  detailOpen: boolean
}

export interface FrameState extends FrameSnapshot {
  ghosts: boolean
  query: string
  /** Data-refresh generation — bumped by refresh(); every hook refetches. */
  version: number
  canGoBack: boolean
  canGoForward: boolean
}

export interface FrameActions {
  selectRail(rail: RailSelection): void
  /** Select a document (opens detail). null clears + closes detail. */
  selectDocument(id: number | null): void
  setQuery(q: string): void
  toggleGhosts(): void
  setDetailOpen(open: boolean): void
  goBack(): void
  goForward(): void
  /** Re-fetch everything (after filing, sync, import, folder edits). */
  refresh(): void
}

const HISTORY_LIMIT = 50

const StateCtx = createContext<FrameState | null>(null)
const ActionsCtx = createContext<FrameActions | null>(null)

export function FrameProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<FrameSnapshot>({
    rail: { kind: 'all' },
    selectedDocumentId: null,
    detailOpen: false,
  })
  const [ghosts, setGhosts] = useState(false)
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState(0)
  // History: past ← current → future. Navigation pushes; goBack/goForward move.
  // canGoBack/Forward mirror the ref stacks into state so render never reads refs.
  const past = useRef<FrameSnapshot[]>([])
  const future = useRef<FrameSnapshot[]>([])
  const [nav, setNav] = useState({ back: false, forward: false })
  const syncNav = (): void =>
    setNav({ back: past.current.length > 0, forward: future.current.length > 0 })

  const navigate = useCallback((next: FrameSnapshot): void => {
    setSnapshot((current) => {
      past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), current]
      future.current = []
      return next
    })
    syncNav()
  }, [])

  const actions = useMemo<FrameActions>(
    () => ({
      selectRail: (rail) =>
        navigate({ rail, selectedDocumentId: null, detailOpen: false }),
      selectDocument: (id) => {
        setSnapshot((s) => {
          const next: FrameSnapshot = { ...s, selectedDocumentId: id, detailOpen: id != null }
          past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), s]
          future.current = []
          return next
        })
        syncNav()
      },
      setQuery,
      toggleGhosts: () => setGhosts((g) => !g),
      setDetailOpen: (open) => setSnapshot((s) => ({ ...s, detailOpen: open })),
      goBack: () => {
        setSnapshot((current) => {
          const prev = past.current[past.current.length - 1]
          if (!prev) return current
          past.current = past.current.slice(0, -1)
          future.current = [current, ...future.current].slice(0, HISTORY_LIMIT)
          return prev
        })
        syncNav()
      },
      goForward: () => {
        setSnapshot((current) => {
          const next = future.current[0]
          if (!next) return current
          future.current = future.current.slice(1)
          past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), current]
          return next
        })
        syncNav()
      },
      refresh: () => setVersion((v) => v + 1),
    }),
    [navigate],
  )

  const state: FrameState = {
    ...snapshot,
    ghosts,
    query,
    version,
    canGoBack: nav.back,
    canGoForward: nav.forward,
  }

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  )
}

export function useFrame(): FrameState {
  const s = useContext(StateCtx)
  if (!s) throw new Error('useFrame outside FrameProvider')
  return s
}
export function useFrameActions(): FrameActions {
  const a = useContext(ActionsCtx)
  if (!a) throw new Error('useFrameActions outside FrameProvider')
  return a
}

// ── Data hooks (plain fetch-on-change; react-query is M4) ────────────────────

export interface Loadable<T> {
  data: T | null
  loading: boolean
  error: string | null
}

function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[]): Loadable<T> {
  // Stale-while-refetch: previous data stays visible during a refetch (no
  // flicker); `loading` means "never resolved yet". No sync setState in the
  // effect body (react-hooks/set-state-in-effect).
  const [out, setOut] = useState<Loadable<T>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    fetcher().then(
      (data) => alive && setOut({ data, loading: false, error: null }),
      (err: unknown) =>
        alive && setOut((o) => ({ data: o.data, loading: false, error: String(err) })),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return out
}

/** The rail's folder tree. */
export function useFolderTree(): Loadable<FolderTreeNode[]> {
  const { version } = useFrame()
  return useFetch(() => window.astrolabe.folders.list(), [version])
}

/** The river: rail selection + query + ghosts → search or browse. */
export interface RiverData {
  total: number
  hits: (BrowseHit | SearchHit)[]
  mode: 'browse' | 'search'
}
export function useRiver(): Loadable<RiverData> {
  const { rail, query, ghosts, version } = useFrame()
  return useFetch(async () => {
    const scope: Record<string, unknown> = { includeGhosts: ghosts }
    if (rail.kind === 'uncategorized') scope['uncategorized'] = true
    if (rail.kind === 'folder') {
      scope['folderSlugs'] = [rail.slug]
      scope['includeSubfolders'] = rail.includeSubfolders
    }
    if (rail.kind === 'tag') scope['tagsAny'] = [rail.name]
    if (rail.kind === 'library') scope['libraryIds'] = [rail.id]
    const q = query.trim()
    if (q.length > 0) {
      const hits = await window.astrolabe.search({ q, ...scope })
      return { total: hits.length, hits, mode: 'search' as const }
    }
    const page = await window.astrolabe.browse({ ...scope, limit: 200 })
    return { total: page.total, hits: page.hits, mode: 'browse' as const }
  }, [JSON.stringify(rail), query, ghosts, version])
}

/** The detail panel's document. */
export function useDocumentDetail(id: number | null): Loadable<DocumentDetail | null> {
  const { version } = useFrame()
  return useFetch(
    () => (id == null ? Promise.resolve(null) : window.astrolabe.document(id)),
    [id, version],
  )
}

export function useTags(): Loadable<{ name: string; count: number }[]> {
  const { version } = useFrame()
  return useFetch(() => window.astrolabe.tags(), [version])
}

export function useLibraries(): Loadable<LibrariesSnapshot> {
  const { version } = useFrame()
  return useFetch(() => window.astrolabe.libraries(), [version])
}

export function useStats(): Loadable<IndexStats> {
  const { version } = useFrame()
  return useFetch(() => window.astrolabe.stats(), [version])
}

// ── Folder-error humanizer (closes the part-1 deferred item) ─────────────────

/** Map a folders IPC rejection to a human sentence. FolderError codes travel
 *  in the serialized message ("… CYCLE"-ish text isn't guaranteed, so match
 *  known code words defensively). */
export function friendlyFolderError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (msg.includes('CYCLE') || msg.includes('cycle'))
    return 'That would put a folder inside itself.'
  if (msg.includes('DUPLICATE') || msg.includes('exists'))
    return 'A folder with that name already exists.'
  if (msg.includes('BAD_PARENT') || msg.includes('parent'))
    return 'The destination folder no longer exists.'
  if (msg.includes('NOT_FOUND') || msg.includes('no such'))
    return 'That folder no longer exists — it may have been deleted elsewhere.'
  if (msg.includes('INVALID') || msg.includes('invalid'))
    return 'That name cannot be used (too long or empty).'
  return 'The folder operation failed. Check the logs.'
}
