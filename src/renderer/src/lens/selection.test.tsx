// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { applySelection } from './selection'
import type { LensSelection } from './types'

describe('applySelection', () => {
  it('sets a fresh dimension', () => {
    expect(applySelection({}, { kind: 'pdf' })).toEqual({ kind: 'pdf' })
  })

  it('toggles the same value off (click-again)', () => {
    expect(applySelection({ kind: 'pdf' }, { kind: 'pdf' })).toEqual({})
  })

  it('replaces a different value in the same dimension', () => {
    expect(applySelection({ kind: 'pdf' }, { kind: 'image' })).toEqual({ kind: 'image' })
  })

  it('kind and tag compose (independent dimensions)', () => {
    const s = applySelection({ kind: 'pdf' }, { tag: 'ml' })
    expect(s).toEqual({ kind: 'pdf', tag: 'ml' })
  })

  it('selecting a collection clears a plain source selection', () => {
    const current: LensSelection = { sourceKey: 'zotero', tag: 'ml' }
    expect(applySelection(current, { collectionId: 5 })).toEqual({ collectionId: 5, tag: 'ml' })
  })

  it('selecting a plain source clears a collection selection', () => {
    expect(applySelection({ collectionId: 5 }, { sourceKey: 'zotero' })).toEqual({
      sourceKey: 'zotero',
    })
  })

  it('collection and folder are mutually exclusive', () => {
    expect(applySelection({ folderPrefix: 'Projects/' }, { collectionId: 5 })).toEqual({
      collectionId: 5,
    })
    expect(applySelection({ collectionId: 5 }, { folderPrefix: 'Projects/' })).toEqual({
      folderPrefix: 'Projects/',
    })
  })

  it('selecting a plain source clears a folder selection', () => {
    expect(applySelection({ folderPrefix: 'Projects/' }, { sourceKey: 'obsidian' })).toEqual({
      sourceKey: 'obsidian',
    })
  })
})
