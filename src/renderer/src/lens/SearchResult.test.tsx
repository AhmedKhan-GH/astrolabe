// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SearchResult, type ResultData } from './SearchResult'
import { renderSnippet } from './snippet'

afterEach(cleanup)

const base: ResultData = {
  documentId: 1,
  title: 'Probabilistic Machine Learning',
  kind: 'pdf',
  snippet: 'the ⟪precision⟫ of the classifier',
  tags: ['ml', 'textbook'],
  instances: [
    { instanceId: 11, sourceKey: 'zotero', uri: 'zotero://select/library/items/ABC', filePath: '/tmp/x.pdf', openPdfUri: null },
    { instanceId: 12, sourceKey: 'eagle', uri: 'eagle://item/XYZ', filePath: null, openPdfUri: null },
  ],
}
const hit = base

describe('SearchResult', () => {
  it('renders title, snippet highlight, both source badges, and tags', () => {
    render(<SearchResult hit={hit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.getByText('Probabilistic Machine Learning')).toBeTruthy()
    expect(screen.getByText('precision').tagName).toBe('MARK') // ⟪⟫ → <mark>
    expect(screen.getByText('zotero ↗')).toBeTruthy()
    expect(screen.getByText('eagle ↗')).toBeTruthy()
    expect(screen.getByText('#ml')).toBeTruthy()
  })

  it('deep-link buttons dispatch the instance URI', () => {
    const onOpenUri = vi.fn()
    render(<SearchResult hit={hit} onOpenUri={onOpenUri} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    screen.getByText('zotero ↗').click()
    expect(onOpenUri).toHaveBeenCalledWith('zotero://select/library/items/ABC')
  })

  it('renderSnippet splits markers into mark elements', () => {
    const parts = renderSnippet('a ⟪b⟫ c ⟪d⟫')
    expect(parts).toHaveLength(5)
  })
})

describe('SearchResult — canvas affordance', () => {
  it('title-click opens the canvas for a pdf hit with a file when wired', () => {
    const onOpenCanvas = vi.fn()
    render(
      <SearchResult hit={hit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} onOpenCanvas={onOpenCanvas} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /open canvas/i }))
    expect(onOpenCanvas).toHaveBeenCalledWith(hit)
  })

  it('a non-pdf hit gets no canvas affordance', () => {
    render(
      <SearchResult
        hit={{ ...base, kind: 'note' }}
        onOpenUri={vi.fn()}
        onOpenFile={vi.fn()}
        onReveal={vi.fn()}
        onOpenCanvas={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /open canvas/i })).toBeNull()
  })

  it('a pdf hit with no file gets no canvas affordance', () => {
    render(
      <SearchResult
        hit={{ ...base, instances: base.instances.map((i) => ({ ...i, filePath: null })) }}
        onOpenUri={vi.fn()}
        onOpenFile={vi.fn()}
        onReveal={vi.fn()}
        onOpenCanvas={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /open canvas/i })).toBeNull()
  })

  it('without onOpenCanvas the title stays plain text (no button)', () => {
    render(<SearchResult hit={hit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /open canvas/i })).toBeNull()
  })
})

describe('SearchResult — hub affordance', () => {
  it('shows an info affordance and fires onOpenHub with the hit when wired', () => {
    const onOpenHub = vi.fn()
    render(
      <SearchResult hit={hit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} onOpenHub={onOpenHub} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /document details:/i }))
    expect(onOpenHub).toHaveBeenCalledWith(hit)
  })

  it('the info affordance is present for a note hit too (separate from the title button)', () => {
    render(
      <SearchResult
        hit={{ ...base, kind: 'note' }}
        onOpenUri={vi.fn()}
        onOpenFile={vi.fn()}
        onReveal={vi.fn()}
        onOpenHub={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /document details:/i })).toBeTruthy()
  })

  it('without onOpenHub there is no info affordance', () => {
    render(<SearchResult hit={hit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /document details:/i })).toBeNull()
  })
})

describe('SearchResult — transfer gesture', () => {
  const eagleOnly: ResultData = {
    ...base,
    instances: [{ instanceId: 12, sourceKey: 'eagle', uri: 'eagle://item/XYZ', filePath: '/lib/x.pdf', openPdfUri: null }],
  }
  const zoteroOnly: ResultData = {
    ...base,
    instances: [{ instanceId: 11, sourceKey: 'zotero', uri: 'zotero://select/items/ABC', filePath: '/z/x.pdf', openPdfUri: null }],
  }

  it('an eagle-only pdf hit fires to-zotero with the documentId', () => {
    const onTransfer = vi.fn()
    render(<SearchResult hit={{ ...eagleOnly, documentId: 5 }} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} onTransfer={onTransfer} />)
    fireEvent.click(screen.getByRole('button', { name: /transfer to-zotero/i }))
    expect(onTransfer).toHaveBeenCalledWith(5, 'to-zotero')
  })

  it('a zotero-only pdf hit fires to-eagle', () => {
    const onTransfer = vi.fn()
    render(<SearchResult hit={zoteroOnly} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} onTransfer={onTransfer} />)
    fireEvent.click(screen.getByRole('button', { name: /transfer to-eagle/i }))
    expect(onTransfer).toHaveBeenCalledWith(1, 'to-eagle')
  })

  it('a both-sources hit gets no transfer affordance', () => {
    render(<SearchResult hit={hit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} onTransfer={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /transfer/i })).toBeNull()
  })

  it('without onTransfer there is no transfer affordance', () => {
    render(<SearchResult hit={eagleOnly} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /transfer/i })).toBeNull()
  })
})

describe('SearchResult — note affordance', () => {
  const noteHit: ResultData = {
    ...base,
    kind: 'note',
    instances: [
      { instanceId: 21, sourceKey: 'obsidian', uri: 'obsidian://open?path=%2Fv%2Fn.md', filePath: '/v/n.md', openPdfUri: null },
    ],
  }

  it('title-click opens the note for an obsidian file-backed note when wired', () => {
    const onOpenNote = vi.fn()
    render(
      <SearchResult hit={noteHit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} onOpenNote={onOpenNote} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /open note/i }))
    expect(onOpenNote).toHaveBeenCalledWith(noteHit)
  })

  it('a pdf hit gets no note affordance', () => {
    render(
      <SearchResult hit={hit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} onOpenNote={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: /open note/i })).toBeNull()
  })

  it('a note with no obsidian file-backed instance gets no note affordance', () => {
    render(
      <SearchResult
        hit={{ ...base, kind: 'note' }} // default fixture is zotero/eagle, no obsidian file
        onOpenUri={vi.fn()}
        onOpenFile={vi.fn()}
        onReveal={vi.fn()}
        onOpenNote={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /open note/i })).toBeNull()
  })

  it('without onOpenNote the title stays plain text (no button)', () => {
    render(<SearchResult hit={noteHit} onOpenUri={vi.fn()} onOpenFile={vi.fn()} onReveal={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /open note/i })).toBeNull()
  })
})
