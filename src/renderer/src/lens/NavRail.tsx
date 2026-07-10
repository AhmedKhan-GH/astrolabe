import { useState } from 'react'
import clsx from 'clsx'
import { CollectionTree } from './CollectionTree'
import type { NavData, NavNode, LensSelection } from './types'

const TAG_LIMIT = 40

/**
 * Left navigation rail — pure presentational. Kinds (chips), Sources (header row +
 * structural tree), Tags (filter + top-N). Each click bubbles a single-dimension
 * `onSelect` partial; the parent folds it into the LensSelection (see selection.ts).
 */
export function NavRail({
  nav,
  selection,
  onSelect,
}: {
  nav: NavData
  selection: LensSelection
  onSelect: (partial: Partial<LensSelection>) => void
}) {
  const [tagFilter, setTagFilter] = useState('')

  const tags = nav.tags
    .filter((t) => t.name.toLowerCase().includes(tagFilter.trim().toLowerCase()))
    .slice(0, TAG_LIMIT)

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-800 pr-3 text-sm">
      <Section title="Kinds">
        <div className="flex flex-wrap gap-1.5">
          {nav.kinds.map((k) => (
            <button
              key={k.kind}
              aria-pressed={selection.kind === k.kind}
              onClick={() => onSelect({ kind: k.kind as LensSelection['kind'] })}
              className={clsx(
                'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
                selection.kind === k.kind
                  ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                  : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800',
              )}
            >
              <span>{k.kind}</span>
              <span className="text-[10px] text-zinc-500">{k.count}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Sources">
        <div className="flex flex-col gap-2">
          {nav.sources.map((src) => (
            <div key={src.key} className="flex flex-col">
              <button
                aria-pressed={selection.sourceKey === src.key}
                onClick={() => onSelect({ sourceKey: src.key as LensSelection['sourceKey'] })}
                className={clsx(
                  'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs font-medium',
                  selection.sourceKey === src.key
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-300 hover:bg-zinc-800',
                )}
              >
                <span>{src.key}</span>
                <span className="ml-auto text-[10px] text-zinc-500">{src.documentCount}</span>
              </button>
              {src.tree.length > 0 && (
                <CollectionTree
                  nodes={src.tree}
                  selectedId={structuralSelectedId(src.key, selection)}
                  onSelectNode={(node) => onSelect(nodeToPartial(src.key, node))}
                />
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tags">
        <input
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="filter tags…"
          className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
        />
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button
              key={t.name}
              aria-pressed={selection.tag === t.name}
              onClick={() => onSelect({ tag: t.name })}
              className={clsx(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                selection.tag === t.name
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-400 hover:brightness-125',
              )}
            >
              <span>#{t.name}</span>
              <span className="text-[10px] text-zinc-500">{t.count}</span>
            </button>
          ))}
        </div>
      </Section>
    </nav>
  )
}

/** obsidian trees carry folder-path string ids → folderPrefix; others → collectionId. */
function nodeToPartial(sourceKey: string, node: NavNode): Partial<LensSelection> {
  return sourceKey === 'obsidian'
    ? { folderPrefix: String(node.id) }
    : { collectionId: Number(node.id) }
}

function structuralSelectedId(sourceKey: string, selection: LensSelection): number | string | undefined {
  return sourceKey === 'obsidian' ? selection.folderPrefix : selection.collectionId
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      {children}
    </section>
  )
}
