import clsx from 'clsx'
import { isEmpty } from './selection'
import type { LensSelection, SourceKey, DocumentKind } from './types'

/**
 * Active-filter summary above the search input: one removable chip per active facet
 * value, plus "Clear all". Renders nothing when the selection is empty. Keeps
 * selections made in collapsed tree nodes visible and reversible.
 */
export function FilterBar({
  selection,
  collectionNames,
  onToggleScope,
  onToggleKind,
  onRemoveTag,
  onClearAll,
}: {
  selection: LensSelection
  collectionNames?: Map<number, string>
  onToggleScope: (
    dim: 'sourceKeys' | 'collectionIds' | 'folderPrefixes',
    value: SourceKey | number | string,
  ) => void
  onToggleKind: (kind: DocumentKind) => void
  onRemoveTag: (name: string) => void
  onClearAll: () => void
}) {
  if (isEmpty(selection)) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
    </div>
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
