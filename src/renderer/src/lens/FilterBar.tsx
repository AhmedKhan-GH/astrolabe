import { useState } from 'react'
import clsx from 'clsx'
import { isEmpty } from './selection'
import type { ScopeDim } from './selection'
import type { LensSelection, SourceKey, DocumentKind, PresenceValue } from './types'
import { PRESENCE_LABELS } from './types'

/**
 * Active-filter summary above the search input: one removable chip per active facet
 * value, plus "Clear all". Renders nothing when there is nothing active — but stays
 * visible for the "Save view…" affordance whenever `canSave` is set (a search `q`
 * is typed) even with an empty selection. Keeps selections made in collapsed tree
 * nodes visible and reversible.
 */
export function FilterBar({
  selection,
  collectionNames,
  vcollectionNames,
  canSave,
  onToggleScope,
  onToggleKind,
  onTogglePresence,
  onRemoveTag,
  onClearAll,
  onSaveView,
}: {
  selection: LensSelection
  collectionNames?: Map<number, string>
  /** slug → display name for virtual collection chips (fallback: the slug). */
  vcollectionNames?: Map<string, string>
  /** True when there is state to save beyond the selection (a non-empty `q`). */
  canSave?: boolean
  onToggleScope: (dim: ScopeDim, value: SourceKey | number | string) => void
  onToggleKind: (kind: DocumentKind) => void
  onTogglePresence: (value: PresenceValue) => void
  onRemoveTag: (name: string) => void
  onClearAll: () => void
  onSaveView?: (name: string) => void
}) {
  const empty = isEmpty(selection)
  // Hidden only when truly nothing is active — no facets and nothing else to save.
  if (empty && !canSave) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!empty && (
        <>
          {selection.sourceKeys.map((k) => (
            <Chip key={`src-${k}`} label={k} onRemove={() => onToggleScope('sourceKeys', k)} />
          ))}
          {selection.collectionIds.map((id) => (
            <Chip
              key={`col-${id}`}
              label={collectionNames?.get(id) ?? `collection #${id}`}
              onRemove={() => onToggleScope('collectionIds', id)}
            />
          ))}
          {selection.folderPrefixes.map((p) => (
            <Chip key={`fld-${p}`} label={p} onRemove={() => onToggleScope('folderPrefixes', p)} />
          ))}
          {selection.virtualCollections.map((slug) => (
            <Chip
              key={`vc-${slug}`}
              label={vcollectionNames?.get(slug) ?? slug}
              removeName={slug}
              onRemove={() => onToggleScope('virtualCollections', slug)}
            />
          ))}
          {selection.presence.map((p) => (
            <Chip
              key={`presence-${p}`}
              label={PRESENCE_LABELS[p]}
              removeName={PRESENCE_LABELS[p]}
              onRemove={() => onTogglePresence(p)}
            />
          ))}
          {selection.kinds.map((k) => (
            <Chip key={`kind-${k}`} label={k} onRemove={() => onToggleKind(k)} />
          ))}
          {selection.tags.map((t) => (
            <Chip
              key={`tag-${t.name}`}
              label={`${t.mode === 'exclude' ? '−' : ''}#${t.name}`}
              removeName={t.name}
              tone={t.mode === 'exclude' ? 'exclude' : 'require'}
              onRemove={() => onRemoveTag(t.name)}
            />
          ))}
          <button
            onClick={onClearAll}
            className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            Clear all
          </button>
        </>
      )}
      {onSaveView && <SaveView onSaveView={onSaveView} />}
    </div>
  )
}

/**
 * Inline "Save view…" affordance — a button that swaps to a name input on click
 * (never a native `prompt()`, per the audit lesson); Enter saves, Escape cancels.
 */
function SaveView({ onSaveView }: { onSaveView: (name: string) => void }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  if (!naming) {
    return (
      <button
        onClick={() => setNaming(true)}
        className="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
      >
        Save view…
      </button>
    )
  }

  const commit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSaveView(trimmed)
    setName('')
    setNaming(false)
  }

  return (
    <input
      autoFocus
      aria-label="view name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') {
          setName('')
          setNaming(false)
        }
      }}
      onBlur={() => setNaming(false)}
      placeholder="Name this view…"
      className="ml-auto w-40 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
    />
  )
}

function Chip({
  label,
  removeName,
  tone = 'neutral',
  onRemove,
}: {
  label: string
  removeName?: string
  tone?: 'neutral' | 'require' | 'exclude'
  onRemove: () => void
}) {
  return (
    <span
      className={clsx(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
        tone === 'require' && 'border-emerald-600/60 bg-emerald-900/40 text-emerald-100',
        tone === 'exclude' && 'border-red-600/50 bg-red-900/40 text-red-200',
        tone === 'neutral' && 'border-zinc-700 bg-zinc-800 text-zinc-300',
      )}
    >
      <span>{label}</span>
      <button
        aria-label={`remove ${removeName ?? label}`}
        onClick={onRemove}
        className="text-zinc-500 hover:text-zinc-200"
      >
        ×
      </button>
    </span>
  )
}
