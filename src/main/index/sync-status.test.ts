import { describe, it, expect } from 'vitest'
import { classifyScanError } from './sync-status'

/**
 * macOS TCC denies iCloud-Drive reads with EPERM (terminal-spawned processes get
 * silently denied); a denied source must read as 'denied', not 'unavailable',
 * so the lens can offer "Grant access" instead of a misleading dead badge.
 */
describe('classifyScanError', () => {
  it('classifies EPERM (TCC-blocked scandir) as denied', () => {
    const err = Object.assign(
      new Error("EPERM: operation not permitted, scandir '/Users/x/Library/Mobile Documents/iCloud~md~obsidian'"),
      { code: 'EPERM' },
    )
    expect(classifyScanError(err)).toBe('denied')
  })

  it('classifies EACCES as denied', () => {
    const err = Object.assign(new Error('EACCES: permission denied, open /some/file'), { code: 'EACCES' })
    expect(classifyScanError(err)).toBe('denied')
  })

  it('classifies a permission error wrapped as a cause as denied', () => {
    const inner = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    const outer = new Error('obsidian scan failed', { cause: inner })
    expect(classifyScanError(outer)).toBe('denied')
  })

  it('classifies by message when no code survives (stringified errors)', () => {
    expect(classifyScanError(new Error('EPERM: operation not permitted, scandir …'))).toBe('denied')
  })

  it('classifies everything else as unavailable', () => {
    expect(classifyScanError(new Error('fetch failed: ECONNREFUSED 127.0.0.1:41595'))).toBe('unavailable')
    expect(classifyScanError(Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }))).toBe(
      'unavailable',
    )
    expect(classifyScanError('plain string error')).toBe('unavailable')
    expect(classifyScanError(null)).toBe('unavailable')
  })
})
