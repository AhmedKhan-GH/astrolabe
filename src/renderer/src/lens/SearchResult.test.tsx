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
