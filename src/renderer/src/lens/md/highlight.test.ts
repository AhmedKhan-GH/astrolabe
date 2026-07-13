import { describe, it, expect } from 'vitest'
import { splitHighlights } from './highlight'

describe('splitHighlights (Obsidian ==highlight== segmentation)', () => {
  it('passes text without markers through as one text segment', () => {
    expect(splitHighlights('plain text')).toEqual([{ type: 'text', value: 'plain text' }])
  })

  it('splits a single ==marked== span with surrounding text', () => {
    expect(splitHighlights('a ==b== c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'mark', value: 'b' },
      { type: 'text', value: ' c' },
    ])
  })

  it('handles a value that is entirely one highlight', () => {
    expect(splitHighlights('==only==')).toEqual([{ type: 'mark', value: 'only' }])
  })

  it('splits multiple highlights in one value', () => {
    expect(splitHighlights('==a== and ==b==')).toEqual([
      { type: 'mark', value: 'a' },
      { type: 'text', value: ' and ' },
      { type: 'mark', value: 'b' },
    ])
  })

  it('leaves an unclosed marker as plain text', () => {
    expect(splitHighlights('==open but never closed')).toEqual([
      { type: 'text', value: '==open but never closed' },
    ])
  })

  it('does not produce an empty mark for ====', () => {
    expect(splitHighlights('====')).toEqual([{ type: 'text', value: '====' }])
  })

  it('a marker does not span a newline', () => {
    expect(splitHighlights('==a\nb==')).toEqual([{ type: 'text', value: '==a\nb==' }])
  })

  it('highlighted text may contain a single = sign', () => {
    expect(splitHighlights('==x = y==')).toEqual([{ type: 'mark', value: 'x = y' }])
  })
})
