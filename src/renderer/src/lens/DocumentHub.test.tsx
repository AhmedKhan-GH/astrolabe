// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { DocumentHub } from './DocumentHub'
import type { DocumentDetail } from './types'

afterEach(cleanup)

const detail = (over: Partial<DocumentDetail> = {}): DocumentDetail => ({
  documentId: 1,
  title: 'Probabilistic Machine Learning',
  kind: 'pdf',
  modifiedAt: Date.now(),
  tags: ['ml', 'textbook'],
  instances: [
    { instanceId: 11, sourceKey: 'zotero', uri: 'zotero://select/items/ABC', filePath: '/tmp/x.pdf', openPdfUri: null },
    { instanceId: 12, sourceKey: 'eagle', uri: 'eagle://item/XYZ', filePath: null, openPdfUri: null },
  ],
  virtualCollections: [{ slug: 'to-read', name: 'To Read' }],
  annotations: { total: 4, pages: [{ pageIndex: 0, count: 3 }, { pageIndex: 5, count: 1 }] },
  presence: 'both',
  backlinks: [{ documentId: 9, title: 'Referring Note', kind: 'note', instanceId: 99 }],
  ...over,
})

const setup = (over: Partial<Parameters<typeof DocumentHub>[0]> = {}) => {
  const props = {
    detail: detail(),
    onOpenUri: vi.fn(),
    onOpenFile: vi.fn(),
    onReveal: vi.fn(),
    onOpenCanvas: vi.fn(),
    onOpenNote: vi.fn(),
    onOpenBacklink: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<DocumentHub {...props} />)
  return props
}

describe('DocumentHub chrome', () => {
  it('is a dialog labelled "document details" with the title, kind, tags and VC chips', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: /document details/i })
    expect(within(dialog).getByText('Probabilistic Machine Learning')).toBeTruthy()
    expect(within(dialog).getByText('#ml')).toBeTruthy()
    expect(within(dialog).getByText('To Read')).toBeTruthy()
  })

  it('the × button closes', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: /close document details/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape closes', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows an error line when detail is null after loading', () => {
    setup({ detail: null, error: 'document not found' })
    expect(screen.getByText(/document not found/i)).toBeTruthy()
  })
})

describe('DocumentHub sources', () => {
  it('a source jump-out dispatches the instance uri', () => {
    const { onOpenUri } = setup()
    fireEvent.click(screen.getByRole('button', { name: /zotero ↗/i }))
    expect(onOpenUri).toHaveBeenCalledWith('zotero://select/items/ABC')
  })

  it('open file / reveal appear only for a file-backed instance', () => {
    const { onOpenFile, onReveal } = setup()
    // exactly one instance (zotero) carries a filePath
    fireEvent.click(screen.getByRole('button', { name: /open file/i }))
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))
    expect(onOpenFile).toHaveBeenCalledWith('/tmp/x.pdf')
    expect(onReveal).toHaveBeenCalledWith('/tmp/x.pdf')
  })

  it('states presence — both sources', () => {
    setup()
    expect(screen.getByText(/both zotero and eagle/i)).toBeTruthy()
  })

  it('states presence — a single source', () => {
    setup({
      detail: detail({
        presence: 'zotero-only',
        instances: [detail().instances[0]!],
      }),
    })
    expect(screen.getByText(/zotero only/i)).toBeTruthy()
  })
})

describe('DocumentHub annotations', () => {
  it('shows the total and top annotated pages', () => {
    setup()
    expect(screen.getByText(/4/).textContent).toMatch(/4/)
    // page labels are 1-based (pageIndex + 1)
    expect(screen.getByText(/page 1/i)).toBeTruthy()
    expect(screen.getByText(/page 6/i)).toBeTruthy()
  })

  it('a pdf offers "open canvas" from the annotations section', () => {
    const { onOpenCanvas } = setup()
    fireEvent.click(screen.getByRole('button', { name: /open canvas/i }))
    expect(onOpenCanvas).toHaveBeenCalledOnce()
  })

  it('a non-pdf document offers no canvas', () => {
    setup({ detail: detail({ kind: 'note', instances: [{ instanceId: 21, sourceKey: 'obsidian', uri: 'obsidian://n', filePath: '/v/n.md', openPdfUri: null }], presence: 'none' }) })
    expect(screen.queryByRole('button', { name: /open canvas/i })).toBeNull()
  })
})

describe('DocumentHub notes / backlinks', () => {
  it('lists backlinks and navigates on click', () => {
    const { onOpenBacklink } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Referring Note/i }))
    expect(onOpenBacklink).toHaveBeenCalledWith({ documentId: 9, instanceId: 99, title: 'Referring Note' })
  })

  it('shows an empty state when there are no linked notes', () => {
    setup({ detail: detail({ backlinks: [] }) })
    expect(screen.getByText(/no linked notes/i)).toBeTruthy()
  })
})

describe('DocumentHub actions', () => {
  it('a note document offers a Note action', () => {
    const noteDetail = detail({
      kind: 'note',
      instances: [{ instanceId: 21, sourceKey: 'obsidian', uri: 'obsidian://n', filePath: '/v/n.md', openPdfUri: null }],
      presence: 'none',
    })
    const { onOpenNote } = setup({ detail: noteDetail })
    fireEvent.click(screen.getByRole('button', { name: /^note$/i }))
    expect(onOpenNote).toHaveBeenCalledOnce()
  })

  it('a pdf without an obsidian file offers no Note action', () => {
    setup()
    expect(screen.queryByRole('button', { name: /^note$/i })).toBeNull()
  })
})
