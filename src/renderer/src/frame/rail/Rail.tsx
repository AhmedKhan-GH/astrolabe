import { useState } from 'react'
import type { FolderTreeNode } from '../../../../main/index/queries'
import type { ImportFoldersResult } from '../../../../shared/db-ipc'
import {
  friendlyFolderError,
  useFolderTree,
  useFrame,
  useFrameActions,
  useLibraries,
  useStats,
  useTags,
} from '../state'
import { ConfirmDialog, ImportDialog, MoveDialog, NameDialog } from './dialogs'
import { FolderTree } from './FolderTree'
import { useUncategorizedCount } from './hooks'
import { collectSubtreeSlugs, findNode, flatten } from './tree'
import { availabilityDot, rowClass } from './ui'

/**
 * The rail (frame spec §2): All · Uncategorized · Folders tree · Smart Folders
 * (soon) · Tags · Libraries. Selection scopes the river via the frozen state
 * contract (selectRail); folder mutations go through window.astrolabe.folders.*
 * then refresh(). Everything is fetched via the shared hooks — no props.
 */

const TAG_PREVIEW = 12

type Dialog =
  | { kind: 'newRoot' }
  | { kind: 'newChild'; parent: string; parentName: string }
  | { kind: 'rename'; slug: string; current: string }
  | { kind: 'move'; slug: string; name: string }
  | { kind: 'delete'; slug: string; name: string }
  | { kind: 'import' }
  | null

export default function Rail(): React.JSX.Element {
  const { rail } = useFrame()
  const actions = useFrameActions()

  const tree = useFolderTree()
  const tags = useTags()
  const libraries = useLibraries()
  const stats = useStats()
  const uncategorized = useUncategorizedCount()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAllTags, setShowAllTags] = useState(false)
  const [menu, setMenu] = useState<{ node: FolderTreeNode; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResult, setImportResult] = useState<ImportFoldersResult | null>(null)

  const closeDialog = (): void => {
    setDialog(null)
    setError(null)
    setImportResult(null)
  }

  /** Run a folder mutation, refresh on success, humanize failures inline. */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      actions.refresh()
      closeDialog()
    } catch (err) {
      setError(friendlyFolderError(err))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (libraryId: number): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.astrolabe.folders.import({ libraryId })
      setImportResult(res)
      actions.refresh()
    } catch (err) {
      setError(friendlyFolderError(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleExpand = (slug: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })

  const openContextMenu = (e: React.MouseEvent, node: FolderTreeNode): void => {
    e.preventDefault()
    setMenu({ node, x: e.clientX, y: e.clientY })
  }

  const treeNodes = tree.data ?? []
  const allTags = tags.data ?? []
  const shownTags = showAllTags ? allTags : allTags.slice(0, TAG_PREVIEW)
  const snapshot = libraries.data

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 text-neutral-300">
      <div className="grow overflow-y-auto px-1.5 py-2">
        {/* All · Uncategorized */}
        <button className={rowClass(rail.kind === 'all')} onClick={() => actions.selectRail({ kind: 'all' })}>
          <span className="flex-1">All</span>
          {stats.data && <span className="text-xs text-neutral-500">{stats.data.documents}</span>}
        </button>
        <button
          className={rowClass(rail.kind === 'uncategorized')}
          onClick={() => actions.selectRail({ kind: 'uncategorized' })}
        >
          <span className="flex-1">Uncategorized</span>
          {uncategorized != null && <span className="text-xs text-neutral-500">{uncategorized}</span>}
        </button>

        {/* Folders */}
        <SectionHeader
          action={
            <button
              type="button"
              onClick={() => setDialog({ kind: 'newRoot' })}
              className="text-neutral-500 hover:text-neutral-300"
              title="New top-level folder"
            >
              + New Folder
            </button>
          }
        >
          Folders
        </SectionHeader>
        {treeNodes.length === 0 ? (
          <p className="px-2 py-1 text-xs text-neutral-600">
            {tree.loading ? 'Loading…' : 'No folders yet.'}
          </p>
        ) : (
          <FolderTree
            nodes={treeNodes}
            depth={0}
            rail={rail}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onSelect={(slug) => actions.selectRail({ kind: 'folder', slug, includeSubfolders: false })}
            onToggleSubfolders={(slug) =>
              actions.selectRail({
                kind: 'folder',
                slug,
                includeSubfolders: !(rail.kind === 'folder' && rail.includeSubfolders),
              })
            }
            onContextMenu={openContextMenu}
          />
        )}

        {/* Smart Folders — reserved */}
        <SectionHeader>
          Smart Folders <span className="font-normal normal-case text-neutral-600">(soon)</span>
        </SectionHeader>

        {/* Tags */}
        <SectionHeader
          action={
            allTags.length > TAG_PREVIEW ? (
              <button
                type="button"
                onClick={() => setShowAllTags((s) => !s)}
                className="text-neutral-500 hover:text-neutral-300"
              >
                {showAllTags ? 'show less' : 'show all'}
              </button>
            ) : undefined
          }
        >
          Tags
        </SectionHeader>
        {shownTags.map((t) => (
          <button
            key={t.name}
            className={rowClass(rail.kind === 'tag' && rail.name === t.name)}
            onClick={() => actions.selectRail({ kind: 'tag', name: t.name })}
          >
            <span className="flex-1 truncate">#{t.name}</span>
            <span className="text-xs text-neutral-500">{t.count}</span>
          </button>
        ))}

        {/* Libraries */}
        <SectionHeader>Libraries</SectionHeader>
        {snapshot && (
          <div className="mb-1 flex flex-wrap gap-x-2 gap-y-0.5 px-2 text-[11px]">
            {snapshot.connectors.map((c) => (
              <span key={c.key} className={c.status === 'ok' ? 'text-neutral-500' : 'text-amber-400'}>
                {c.key}: {c.status}
              </span>
            ))}
          </div>
        )}
        {snapshot?.libraries.map((l) => (
          <button
            key={l.id}
            className={rowClass(rail.kind === 'library' && rail.id === l.id)}
            onClick={() => actions.selectRail({ kind: 'library', id: l.id })}
            title={`${l.stableKey} — ${l.availability}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${availabilityDot(l.availability)}`} />
            <span className="flex-1 truncate">{l.displayName}</span>
            <span className="text-xs text-neutral-500">{l.documentCount}</span>
          </button>
        ))}
      </div>

      {/* Footer: Import gesture + the active dialog strip */}
      <div className="border-t border-neutral-800 p-2">
        {error && <div className="mb-2 px-1 text-xs text-amber-400">{error}</div>}
        {dialog ? (
          <DialogStrip
            dialog={dialog}
            tree={treeNodes}
            snapshot={snapshot}
            busy={busy}
            importResult={importResult}
            onCancel={closeDialog}
            onCreateRoot={(name) => run(() => window.astrolabe.folders.create({ name, parent: null }))}
            onCreateChild={(parent, name) =>
              run(() => window.astrolabe.folders.create({ name, parent }))
            }
            onRename={(slug, name) => run(() => window.astrolabe.folders.rename({ slug, name }))}
            onMove={(slug, parent) => run(() => window.astrolabe.folders.setParent({ slug, parent }))}
            onDelete={(slug) => run(() => window.astrolabe.folders.remove({ slug }))}
            onImport={doImport}
          />
        ) : (
          <button
            type="button"
            onClick={() => setDialog({ kind: 'import' })}
            className="w-full rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
          >
            Import from Eagle…
          </button>
        )}
      </div>

      {/* Right-click context menu (a light popover pinned to the cursor) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div
            role="menu"
            className="fixed z-50 w-44 rounded border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-lg"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem
              onClick={() => {
                setDialog({ kind: 'newChild', parent: menu.node.slug, parentName: menu.node.name })
                setExpanded((prev) => new Set(prev).add(menu.node.slug))
                setMenu(null)
              }}
            >
              New subfolder
            </MenuItem>
            <MenuItem
              onClick={() => {
                setDialog({ kind: 'rename', slug: menu.node.slug, current: menu.node.name })
                setMenu(null)
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              onClick={() => {
                setDialog({ kind: 'move', slug: menu.node.slug, name: menu.node.name })
                setMenu(null)
              }}
            >
              Move to…
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                setDialog({ kind: 'delete', slug: menu.node.slug, name: menu.node.name })
                setMenu(null)
              }}
            >
              Delete
            </MenuItem>
          </div>
        </>
      )}
    </nav>
  )
}

function SectionHeader({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-3 mb-1 flex items-center px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
      <span className="flex-1">{children}</span>
      {action}
    </div>
  )
}

function MenuItem({
  children,
  danger,
  onClick,
}: {
  children: React.ReactNode
  danger?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-3 py-1 text-left hover:bg-neutral-800 ${
        danger ? 'text-red-300' : 'text-neutral-300'
      }`}
    >
      {children}
    </button>
  )
}

/** Resolves the active dialog to its component; keeps Rail's JSX readable. */
function DialogStrip({
  dialog,
  tree,
  snapshot,
  busy,
  importResult,
  onCancel,
  onCreateRoot,
  onCreateChild,
  onRename,
  onMove,
  onDelete,
  onImport,
}: {
  dialog: NonNullable<Dialog>
  tree: FolderTreeNode[]
  snapshot: import('../../../../shared/db-ipc').LibrariesSnapshot | null
  busy: boolean
  importResult: ImportFoldersResult | null
  onCancel: () => void
  onCreateRoot: (name: string) => void
  onCreateChild: (parent: string, name: string) => void
  onRename: (slug: string, name: string) => void
  onMove: (slug: string, parent: string | null) => void
  onDelete: (slug: string) => void
  onImport: (libraryId: number) => void
}): React.JSX.Element {
  switch (dialog.kind) {
    case 'newRoot':
      return (
        <NameDialog title="New folder" confirmLabel="Create" busy={busy} onConfirm={onCreateRoot} onCancel={onCancel} />
      )
    case 'newChild':
      return (
        <NameDialog
          title={`New folder in “${dialog.parentName}”`}
          confirmLabel="Create"
          busy={busy}
          onConfirm={(name) => onCreateChild(dialog.parent, name)}
          onCancel={onCancel}
        />
      )
    case 'rename':
      return (
        <NameDialog
          title="Rename folder"
          initial={dialog.current}
          confirmLabel="Rename"
          busy={busy}
          onConfirm={(name) => onRename(dialog.slug, name)}
          onCancel={onCancel}
        />
      )
    case 'move': {
      const node = findNode(tree, dialog.slug)
      const exclude = node ? collectSubtreeSlugs(node) : new Set<string>([dialog.slug])
      return (
        <MoveDialog
          name={dialog.name}
          folders={flatten(tree, exclude)}
          busy={busy}
          onConfirm={(parent) => onMove(dialog.slug, parent)}
          onCancel={onCancel}
        />
      )
    }
    case 'delete':
      return (
        <ConfirmDialog
          title={`Delete “${dialog.name}”?`}
          body="This removes the grouping only — your documents stay in their libraries."
          confirmLabel="Delete folder"
          busy={busy}
          onConfirm={() => onDelete(dialog.slug)}
          onCancel={onCancel}
        />
      )
    case 'import':
      return (
        <ImportDialog
          snapshot={snapshot}
          busy={busy}
          result={importResult}
          onConfirm={onImport}
          onCancel={onCancel}
        />
      )
  }
}
