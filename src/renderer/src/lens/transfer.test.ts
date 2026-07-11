import { describe, it, expect } from 'vitest'
import { transferDirection, transferLabel } from './transfer'

const inst = (sourceKey: string, filePath: string | null = '/tmp/x.pdf') => ({ sourceKey, filePath })

describe('transferDirection', () => {
  it('eagle-only file-backed pdf → to-zotero', () => {
    expect(transferDirection('pdf', [inst('eagle')])).toBe('to-zotero')
  })

  it('zotero-only file-backed pdf → to-eagle', () => {
    expect(transferDirection('pdf', [inst('zotero')])).toBe('to-eagle')
  })

  it('present in both → null (already reconciled)', () => {
    expect(transferDirection('pdf', [inst('zotero'), inst('eagle')])).toBeNull()
  })

  it('neither zotero nor eagle (e.g. obsidian-only) → null', () => {
    expect(transferDirection('pdf', [inst('obsidian')])).toBeNull()
  })

  it('a non-pdf is never transferable', () => {
    expect(transferDirection('image', [inst('eagle')])).toBeNull()
    expect(transferDirection('note', [inst('zotero')])).toBeNull()
  })

  it('an eagle-only pdf with no file on disk → null (nothing to move)', () => {
    expect(transferDirection('pdf', [inst('eagle', null)])).toBeNull()
  })

  it('a zotero-only pdf with no file on disk → null', () => {
    expect(transferDirection('pdf', [inst('zotero', null)])).toBeNull()
  })
})

describe('transferLabel', () => {
  it('names the target system', () => {
    expect(transferLabel('to-zotero')).toBe('→ Zotero')
    expect(transferLabel('to-eagle')).toBe('→ Eagle')
  })
})
