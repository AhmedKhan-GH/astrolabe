/**
 * One per-source entry in the always-on stats strip. Three states (in-app
 * permission flow): ok → count, denied → "Grant access" (the probe that
 * summons the native macOS consent dialog runs in the main process),
 * anything else → dim unavailable.
 */
export interface SourceBadgeData {
  key: string
  status: string
  documentCount: number
}

export function SourceBadge({
  src,
  fresh,
  granting,
  onGrant,
}: {
  src: SourceBadgeData
  fresh: number | null
  granting: boolean
  onGrant: (sourceKey: string) => void
}) {
  if (src.status === 'denied') {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-400/80">
        {src.key}: permission denied
        <button
          onClick={() => onGrant(src.key)}
          disabled={granting}
          title="Ask macOS for access to this source's folder (iCloud Drive is blocked until you approve)"
          className="rounded border border-red-900 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-950 disabled:opacity-50"
        >
          {granting ? 'asking…' : 'Grant access'}
        </button>
      </span>
    )
  }
  if (src.status !== 'ok') {
    return <span className="text-amber-400/80">{src.key}: unavailable</span>
  }
  return (
    <span className="text-emerald-400/80">
      {src.key}: {src.documentCount.toLocaleString()} in index
      {fresh != null && <span className="text-zinc-500"> (+{fresh} new)</span>}
    </span>
  )
}
