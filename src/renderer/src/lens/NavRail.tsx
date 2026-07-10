import { useState } from 'react'
import clsx from 'clsx'
import { CollectionTree } from './CollectionTree'
import type { NavData, NavNode, LensSelection, SourceKey, DocumentKind, SavedView } from './types'

const TAG_LIMIT = 40

type TagMode = 'neutral' | 'require' | 'exclude'

/**
 * Left navigation rail — pure presentational. Clicks toggle set membership with no
 * cross-dimension clearing: kinds/sources/collections/folders are multi-select, and
 * tags are tri-state (neutral → require → exclude → neutral). A "match all / any"
 * control appears beside the Tags heading once ≥2 tags are required.
 */
export function NavRail({
  nav,
  selection,
  views = [],
  appliedViewSlug,
  onToggleKind,
  onToggleScope,
  onCycleTag,
  onSetTagMatch,
  onApplyView,
  onDeleteView,
}: {
  nav: NavData
  selection: LensSelection
  views?: SavedView[]
  appliedViewSlug?: string | null
  onToggleKind: (kind: DocumentKind) => void
  onToggleScope: (
    dim: 'sourceKeys' | 'collectionIds' | 'folderPrefixes',
    value: SourceKey | number | string,
  ) => void
  onCycleTag: (name: string) => void
  onSetTagMatch: (mode: 'all' | 'any') => void
  onApplyView?: (view: SavedView) => void
  onDeleteView?: (slug: string) => void
}) {
  const [tagFilter, setTagFilter] = useState('')

  const tags = nav.tags
    .filter((t) => t.name.toLowerCase().includes(tagFilter.trim().toLowerCase()))
    .slice(0, TAG_LIMIT)

  const tagMode = (name: string): TagMode =>
    selection.tags.find((t) => t.name === name)?.mode ?? 'neutral'
  const requiredCount = selection.tags.filter((t) => t.mode === 'require').length

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-800 pr-3 text-sm">
      {views.length > 0 && (
        <Section title="Views">
          <div className="flex flex-col gap-0.5">
            {views.map((view) => {
              const active = view.slug === appliedViewSlug
              return (
                <div key={view.slug} className="group flex items-center gap-0.5">
                  <button
                    aria-pressed={active}
                    onClick={() => onApplyView?.(view)}
                    className={clsx(
                      'flex min-w-0 flex-1 items-center rounded px-1.5 py-0.5 text-left text-xs',
                      active ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800',
                    )}
                  >
                    <span className="truncate">{view.name}</span>
                  </button>
                  <button
                    aria-label={`delete view ${view.name}`}
                    onClick={() => onDeleteView?.(view.slug)}
                    className="shrink-0 px-1 text-xs text-zinc-600 opacity-0 hover:text-zinc-200 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <Section title="Kinds">
        <div className="flex flex-wrap gap-1.5">
          {nav.kinds.map((k) => {
            const active = selection.kinds.includes(k.kind as DocumentKind)
            return (
              <button
                key={k.kind}
                aria-pressed={active}
                onClick={() => onToggleKind(k.kind as DocumentKind)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
                  active
                    ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                    : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800',
                )}
              >
                <span>{k.kind}</span>
                <span className="text-[10px] text-zinc-500">{k.count}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Sources">
        <div className="flex flex-col gap-2">
          {nav.sources.map((src) => {
            const active = selection.sourceKeys.includes(src.key as SourceKey)
            const selectedIds =
              src.key === 'obsidian' ? selection.folderPrefixes : selection.collectionIds
            return (
              <div key={src.key} className="flex flex-col">
                <button
                  aria-pressed={active}
                  onClick={() => onToggleScope('sourceKeys', src.key as SourceKey)}
                  className={clsx(
                    'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs font-medium',
                    active ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800',
                  )}
                >
                  <span>{src.key}</span>
                  <span className="ml-auto text-[10px] text-zinc-500">{src.documentCount}</span>
                </button>
                {src.tree.length > 0 && (
                  <CollectionTree
                    nodes={src.tree}
                    selectedIds={selectedIds}
                    onSelectNode={(node) => onToggleScope(...scopeArgs(src.key, node))}
                  />
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section
        title="Tags"
        action={
          requiredCount >= 2 ? (
            <button
              aria-label="tag match mode"
              onClick={() => onSetTagMatch(selection.tagMatch === 'all' ? 'any' : 'all')}
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800"
            >
              match: {selection.tagMatch}
            </button>
          ) : null
        }
      >
        <input
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="filter tags…"
          className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
        />
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const mode = tagMode(t.name)
            return (
              <button
                key={t.name}
                data-mode={mode}
                aria-pressed={mode !== 'neutral'}
                onClick={() => onCycleTag(t.name)}
                className={clsx(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                  mode === 'require' && 'bg-emerald-800/60 text-emerald-100 ring-1 ring-emerald-500/60',
                  mode === 'exclude' && 'bg-red-900/50 text-red-200 line-through ring-1 ring-red-500/50',
                  mode === 'neutral' && 'bg-zinc-800 text-zinc-400 hover:brightness-125',
                )}
              >
                {mode === 'require' && <span aria-hidden>✓</span>}
                {mode === 'exclude' && <span aria-hidden>−</span>}
                <span>#{t.name}</span>
                <span className="text-[10px] text-zinc-500">{t.count}</span>
              </button>
            )
          })}
        </div>
      </Section>
    </nav>
  )
}

/** obsidian trees carry folder-path string ids → folderPrefixes; others → collectionIds. */
function scopeArgs(
  sourceKey: string,
  node: NavNode,
): ['folderPrefixes' | 'collectionIds', string | number] {
  return sourceKey === 'obsidian'
    ? ['folderPrefixes', String(node.id)]
    : ['collectionIds', Number(node.id)]
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
