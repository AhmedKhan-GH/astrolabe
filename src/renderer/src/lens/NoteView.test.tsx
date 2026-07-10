// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { NoteView } from './NoteView'
import type { DocumentLinks } from './types'

afterEach(cleanup)

const noLinks: DocumentLinks = { outlinks: [], backlinks: [] }

const setup = (over: Partial<Parameters<typeof NoteView>[0]> = {}) => {
  const onNavigate = vi.fn()
  const onOpenUri = vi.fn()
  const onClose = vi.fn()
  render(
    <NoteView
      title="Zettel One"
      content={'# Heading\n\nSome **body** text.'}
      tags={['ml', 'notes']}
      uri="obsidian://open?path=%2Fvault%2FZettel%20One.md"
      links={noLinks}
      onNavigate={onNavigate}
      onOpenUri={onOpenUri}
      onClose={onClose}
      {...over}
    />,
  )
  return { onNavigate, onOpenUri, onClose }
}

describe('NoteView chrome', () => {
  it('is a dialog labelled "note view" with the title and tag chips', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: /note view/i })
    expect(within(dialog).getByText('Zettel One')).toBeTruthy()
    expect(within(dialog).getByText('#ml')).toBeTruthy()
    expect(within(dialog).getByText('#notes')).toBeTruthy()
  })

  it('renders the markdown body', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy()
    expect(screen.getByText('body').tagName).toBe('STRONG')
  })

  it('the × button closes', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: /close note/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape closes', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('"open in Obsidian" dispatches the note uri', () => {
    const { onOpenUri } = setup()
    fireEvent.click(screen.getByRole('button', { name: /open in obsidian/i }))
    expect(onOpenUri).toHaveBeenCalledWith('obsidian://open?path=%2Fvault%2FZettel%20One.md')
  })

  it('hides "open in Obsidian" when there is no uri', () => {
    setup({ uri: undefined })
    expect(screen.queryByRole('button', { name: /open in obsidian/i })).toBeNull()
  })

  it('fires onOpenDetails from the ⓘ affordance when wired; hidden otherwise', () => {
    const onOpenDetails = vi.fn()
    setup({ onOpenDetails })
    fireEvent.click(screen.getByRole('button', { name: /document details/i }))
    expect(onOpenDetails).toHaveBeenCalledOnce()
    cleanup()
    setup()
    expect(screen.queryByRole('button', { name: /document details/i })).toBeNull()
  })

  it('shows an error state in the panel when the load failed', () => {
    setup({ error: 'HTTP 404', content: '' })
    const dialog = screen.getByRole('dialog', { name: /note view/i })
    expect(within(dialog).getByText(/HTTP 404/)).toBeTruthy()
  })

  it('renders a notice above the body while still showing the source', () => {
    setup({ notice: 'drawing could not be parsed — showing source' })
    expect(screen.getByText(/drawing could not be parsed/i)).toBeTruthy()
    // The source body still renders alongside the notice.
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeTruthy()
  })
})

describe('NoteView wiki links', () => {
  it('a resolved wiki link navigates in-app to the resolved target', () => {
    const links: DocumentLinks = {
      outlinks: [
        { targetName: 'Target Note', documentId: 5, title: 'Target Note', kind: 'note', instanceId: 55 },
      ],
      backlinks: [],
    }
    const { onNavigate } = setup({ content: 'see [[Target Note]] please', links })
    fireEvent.click(screen.getByRole('button', { name: 'Target Note' }))
    expect(onNavigate).toHaveBeenCalledWith({ documentId: 5, instanceId: 55, title: 'Target Note' })
  })

  it('an unresolved wiki link is a muted, non-navigating "not in vault" span', () => {
    const { onNavigate } = setup({ content: 'see [[Ghost]] here', links: noLinks })
    const ghost = screen.getByTitle('not in vault')
    expect(ghost.textContent).toBe('Ghost')
    fireEvent.click(ghost)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('a normal external link opens via onOpenUri, not navigation', () => {
    const { onOpenUri, onNavigate } = setup({ content: '[docs](https://example.test/x)' })
    fireEvent.click(screen.getByRole('link', { name: 'docs' }))
    expect(onOpenUri).toHaveBeenCalledWith('https://example.test/x')
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('NoteView backlinks', () => {
  it('lists backlinks and navigates on row click', () => {
    const links: DocumentLinks = {
      outlinks: [],
      backlinks: [{ documentId: 9, title: 'Referring Note', kind: 'note', instanceId: 99 }],
    }
    const { onNavigate } = setup({ links })
    fireEvent.click(screen.getByRole('button', { name: /Referring Note/ }))
    expect(onNavigate).toHaveBeenCalledWith({ documentId: 9, instanceId: 99, title: 'Referring Note' })
  })

  it('renders no backlinks section when there are none', () => {
    setup({ links: noLinks })
    expect(screen.queryByText(/backlinks/i)).toBeNull()
  })
})
