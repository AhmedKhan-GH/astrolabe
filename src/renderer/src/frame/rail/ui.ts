/**
 * Rail visual tokens (frame spec §2). Kept in a helper module so the row
 * treatment is identical across facets, folders, tags and libraries — and so
 * the component files export only components (react-refresh stays happy).
 */

/** The shared clickable-row treatment; `active` = current rail selection. */
export function rowClass(active: boolean): string {
  return [
    'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm',
    active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-900',
  ].join(' ')
}

/** Availability dot colour for a library row (live/dormant/gone). */
export function availabilityDot(availability: string): string {
  if (availability === 'live') return 'bg-emerald-500'
  if (availability === 'dormant') return 'bg-neutral-500'
  return 'bg-violet-500' // gone — the ghost colour
}
