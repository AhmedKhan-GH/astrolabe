/**
 * Degraded-source classification (in-app permission flow). macOS TCC rejects
 * iCloud-Drive reads with EPERM/EACCES; that is 'denied' — configured but
 * blocked, fixable by granting access — as opposed to 'unavailable' (tool not
 * running / path unset). Drives the sources.status column and the lens badge.
 */
export type DegradedStatus = 'denied' | 'unavailable'

const DENIED_CODES = new Set(['EPERM', 'EACCES'])
const DENIED_MESSAGE = /\bEPERM\b|\bEACCES\b|operation not permitted|permission denied/i

export function classifyScanError(err: unknown): DegradedStatus {
  // Denied if ANY level of the cause chain is a permission error.
  for (let e = err; e instanceof Error; e = e.cause) {
    const code = (e as NodeJS.ErrnoException).code
    if ((code !== undefined && DENIED_CODES.has(code)) || DENIED_MESSAGE.test(e.message)) return 'denied'
  }
  return 'unavailable'
}
