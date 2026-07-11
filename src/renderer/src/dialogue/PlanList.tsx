import type { PlanEntry } from './types'

/**
 * PlanList — the agent's live plan/todo list as a status checklist (spec §Track B/2): a hollow box
 * for pending, a spinner for in_progress, a filled check for completed. Rendered from the single
 * live plan block the reducer holds (replaced whole on each `plan` update).
 */

function StatusMark({ status }: { status: PlanEntry['status'] }) {
  if (status === 'completed')
    return (
      <span title="completed" aria-label="completed" className="text-emerald-400">
        ✓
      </span>
    )
  if (status === 'in_progress')
    return (
      <span
        title="in_progress"
        aria-label="in_progress"
        role="status"
        className="inline-block h-3 w-3 animate-spin rounded-full border border-sky-400 border-t-transparent"
      />
    )
  return (
    <span title="pending" aria-label="pending" className="text-zinc-600">
      ☐
    </span>
  )
}

export function PlanList({ entries }: { entries: PlanEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Plan</div>
      <ul className="flex flex-col gap-1">
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0">
              <StatusMark status={e.status} />
            </span>
            <span className={e.status === 'completed' ? 'text-zinc-500 line-through' : 'text-zinc-300'}>
              {e.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
