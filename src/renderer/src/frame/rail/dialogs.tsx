import { useState } from 'react'
import type { ImportFoldersResult, LibrariesSnapshot } from '../../../../shared/db-ipc'
import type { FlatFolder } from './tree'

/**
 * Inline rail dialogs (frame spec §2). Electron's renderer has no
 * window.prompt/confirm, so folder create/rename/move/delete and the Eagle
 * import each get a tiny in-rail "modal strip": a card pinned in the footer with
 * an input or picker plus confirm/cancel. Purely presentational — every mutation
 * and refresh lives in Rail.
 */

const cardClass = 'rounded border border-neutral-700 bg-neutral-900 p-3 text-sm'
const inputClass =
  'w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500'
const optionClass = (active: boolean): string =>
  [
    'block w-full truncate rounded px-2 py-1 text-left text-sm',
    active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-800',
  ].join(' ')

function DialogButtons({
  confirmLabel,
  busy,
  danger,
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  confirmLabel: string
  busy?: boolean
  danger?: boolean
  confirmDisabled?: boolean
  /** Omit for a submit button (lets a form's Enter key confirm). */
  onConfirm?: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="mt-2 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
      >
        Cancel
      </button>
      <button
        type={onConfirm ? 'button' : 'submit'}
        onClick={onConfirm}
        disabled={busy || confirmDisabled}
        className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
          danger
            ? 'border-red-500/60 text-red-300 hover:border-red-400'
            : 'border-violet-500/60 text-violet-300 hover:border-violet-400'
        }`}
      >
        {busy ? '…' : confirmLabel}
      </button>
    </div>
  )
}

/** Name entry (new folder, new subfolder, rename). Enter submits. */
export function NameDialog({
  title,
  initial = '',
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  initial?: string
  confirmLabel: string
  busy?: boolean
  onConfirm: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onConfirm(value.trim())
      }}
      className={cardClass}
    >
      <div className="mb-1 font-medium text-neutral-200">{title}</div>
      <input
        autoFocus
        aria-label="Folder name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Folder name"
        className={inputClass}
      />
      <DialogButtons
        confirmLabel={confirmLabel}
        busy={busy}
        confirmDisabled={!value.trim()}
        onCancel={onCancel}
      />
    </form>
  )
}

/** Confirm a destructive action (delete). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  body?: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className={cardClass}>
      <div className="mb-1 font-medium text-neutral-200">{title}</div>
      {body && <p className="mb-2 text-xs text-neutral-400">{body}</p>}
      <DialogButtons
        confirmLabel={confirmLabel}
        busy={busy}
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  )
}

/** Mini folder-tree picker for Move to… — `folders` already excludes the moving
 *  row's own subtree; "Top level" is parent = null. */
export function MoveDialog({
  name,
  folders,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string
  folders: FlatFolder[]
  busy?: boolean
  onConfirm: (parent: string | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const [parent, setParent] = useState<string | null>(null)
  return (
    <div className={cardClass}>
      <div className="mb-1 font-medium text-neutral-200">Move “{name}” to…</div>
      <div className="max-h-40 overflow-y-auto">
        <button type="button" onClick={() => setParent(null)} className={optionClass(parent === null)}>
          Top level
        </button>
        {folders.map((f) => (
          <button
            key={f.slug}
            type="button"
            onClick={() => setParent(f.slug)}
            className={optionClass(parent === f.slug)}
            style={{ paddingLeft: f.depth * 12 + 8 }}
          >
            {f.name}
          </button>
        ))}
      </div>
      <DialogButtons confirmLabel="Move" busy={busy} onConfirm={() => onConfirm(parent)} onCancel={onCancel} />
    </div>
  )
}

/** Import from Eagle… — pick an Eagle library, confirm, then show the outcome
 *  counts (spec §2, D-A6 gesture). */
export function ImportDialog({
  snapshot,
  busy,
  result,
  onConfirm,
  onCancel,
}: {
  snapshot: LibrariesSnapshot | null
  busy?: boolean
  result: ImportFoldersResult | null
  onConfirm: (libraryId: number) => void
  onCancel: () => void
}): React.JSX.Element {
  const eagleLibs = (snapshot?.libraries ?? []).filter((l) => l.connector === 'eagle')
  const [libraryId, setLibraryId] = useState<number | null>(eagleLibs[0]?.id ?? null)

  if (result) {
    return (
      <div className={cardClass}>
        <div className="mb-1 font-medium text-neutral-200">Imported from Eagle</div>
        <p className="text-xs text-neutral-300">
          Created {result.created} folders · {result.members} members · {result.skipped} skipped.
        </p>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={cardClass}>
      <div className="mb-1 font-medium text-neutral-200">Import from Eagle…</div>
      {eagleLibs.length === 0 ? (
        <p className="text-xs text-neutral-500">No Eagle libraries available.</p>
      ) : (
        <div className="max-h-40 overflow-y-auto">
          {eagleLibs.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLibraryId(l.id)}
              className={optionClass(libraryId === l.id)}
            >
              {l.displayName} ({l.documentCount})
            </button>
          ))}
        </div>
      )}
      <DialogButtons
        confirmLabel="Import"
        busy={busy}
        confirmDisabled={libraryId == null}
        onConfirm={() => libraryId != null && onConfirm(libraryId)}
        onCancel={onCancel}
      />
    </div>
  )
}
