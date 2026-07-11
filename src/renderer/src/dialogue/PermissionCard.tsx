import { useEffect } from 'react'
import type { AcpPermissionOptionKind, AcpPermissionRequest } from './types'

/**
 * PermissionCard — a session/request_permission surfaced as one button per option (spec §Track
 * B/2, replacing the old allow/deny boolean card). Buttons are styled by kind (allow_* → emerald,
 * reject_* → zinc) and answered by the option's `optionId`. When `keyboardActive`, number keys
 * 1..n pick the corresponding option (only the topmost pending card binds keys to avoid clashes).
 */

function optionClass(kind: AcpPermissionOptionKind): string {
  return kind.startsWith('allow')
    ? 'border-emerald-800 bg-emerald-950 text-emerald-300 hover:bg-emerald-900'
    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
}

export function PermissionCard({
  request,
  keyboardActive = false,
  onRespond,
}: {
  request: AcpPermissionRequest
  keyboardActive?: boolean
  onRespond: (requestId: string, optionId: string) => void
}) {
  useEffect(() => {
    if (!keyboardActive) return
    const onKey = (e: KeyboardEvent): void => {
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= request.options.length) {
        e.preventDefault()
        onRespond(request.requestId, request.options[n - 1].optionId)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [keyboardActive, request, onRespond])

  return (
    <div className="border-t border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs">
      <p className="mb-2 text-amber-200">{request.title}</p>
      <div className="flex flex-wrap gap-2">
        {request.options.map((o, i) => (
          <button
            key={o.optionId}
            type="button"
            onClick={() => onRespond(request.requestId, o.optionId)}
            className={`rounded border px-2 py-1 ${optionClass(o.kind)}`}
          >
            <span aria-hidden className="mr-1 opacity-60">
              {i + 1}
            </span>
            {o.name}
          </button>
        ))}
      </div>
    </div>
  )
}
