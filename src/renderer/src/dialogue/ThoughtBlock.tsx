import { useState } from 'react'
import type { ThoughtEntry } from './transcript'

/**
 * ThoughtBlock — a muted, collapsible "thinking" disclosure for a run of agent_thought chunks
 * (spec §Track B/2). Collapsed by default so reasoning stays out of the way; expanding reveals the
 * grouped thought text.
 */
export function ThoughtBlock({ entry }: { entry: ThoughtEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-xs text-zinc-500">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 italic hover:text-zinc-400"
      >
        <span aria-hidden>💭</span>
        <span>thinking</span>
        <span aria-hidden className="text-zinc-600">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <p className="mt-1 whitespace-pre-wrap border-l-2 border-zinc-800 pl-3 text-zinc-500">{entry.text}</p>}
    </div>
  )
}
