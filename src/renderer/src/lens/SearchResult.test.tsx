// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SearchResult, type ResultData } from './SearchResult'
import { renderSnippet } from './snippet'

afterEach(cleanup)

const hit: ResultData = {
  documentId: 1,
  title: 'Probabilistic Machine Learning',
  kind: 'pdf',
  snippet: 'the ⟪precision⟫ of the classifier',
  tags: ['ml', 'textbook'],
  instances: [
    { sourceKey: 'zotero', uri: 'zotero://select/library/items/ABC', filePath: '/tmp/x.pdf' },
    { sourceKey: 'eagle', uri: 'eagle://item/XYZ', filePath: null },
  ],
}

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
