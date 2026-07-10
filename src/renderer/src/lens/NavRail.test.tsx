// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { NavRail } from './NavRail'
import { emptySelection } from './selection'
import type { NavData, LensSelection, SavedView, VCollectionSummary } from './types'

afterEach(cleanup)

const nav: NavData = {
  kinds: [
    { kind: 'pdf', count: 900 },
    { kind: 'image', count: 400 },
    { kind: 'note', count: 200 },
  ],
  sources: [
    {
      key: 'zotero',
      status: 'ok',
      documentCount: 900,
      tree: [
        {
          id: 1,
          name: 'Root',
          count: 10,
          children: [{ id: 2, name: 'Child', count: 4, children: [{ id: 3, name: 'Grand', count: 1, children: [] }] }],
        },
      ],
    },
    {
      key: 'obsidian',
      status: 'ok',
      documentCount: 200,
      tree: [{ id: 'Projects/', name: 'Projects', count: 12, children: [] }],
    },
    { key: 'eagle', status: 'ok', documentCount: 400, tree: [] },
  ],
  tags: [
    { name: 'ml', count: 50 },
    { name: 'physics', count: 30 },
    { name: 'biology', count: 10 },
  ],
  virtualCollections: [],
}

const handlers = () => ({
  onToggleKind: vi.fn(),
  onToggleScope: vi.fn(),
  onCycleTag: vi.fn(),
  onSetTagMatch: vi.fn(),
})

const views: SavedView[] = [
  { slug: 'unread-ml', name: 'Unread ML', createdAt: '2026-07-10T00:00:00.000Z', filter: {} },
  { slug: 'photos', name: 'Photos', createdAt: '2026-07-10T00:00:00.000Z', filter: {} },
]

function renderRail(selection: LensSelection = emptySelection(), h = handlers()) {
  render(<NavRail nav={nav} selection={selection} {...h} />)
  return h
}

describe('NavRail — kinds', () => {
  it('renders kind chips with counts and fires onToggleKind on click', () => {
    const h = renderRail()
    const chip = screen.getByRole('button', { name: /pdf/i })
    expect(within(chip).getByText('900')).toBeTruthy()
    chip.click()
    expect(h.onToggleKind).toHaveBeenCalledWith('pdf')
  })

  it('highlights every selected kind (multi-select)', () => {
    renderRail({ ...emptySelection(), kinds: ['pdf', 'image'] })
    expect(screen.getByRole('button', { name: /pdf/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /image/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /note/i }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('NavRail — sources & tree (no cross-dimension clearing)', () => {
  it('source header fires onToggleScope(sourceKeys, key)', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /^zotero/i }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('sourceKeys', 'zotero')
  })

  it('highlights each selected source independently', () => {
    renderRail({ ...emptySelection(), sourceKeys: ['zotero', 'eagle'] })
    expect(screen.getByRole('button', { name: /^zotero/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^eagle/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^obsidian/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('collection node fires onToggleScope(collectionIds, id)', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /^Root/ }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('collectionIds', 1)
  })

  it('obsidian folder node fires onToggleScope(folderPrefixes, path)', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /Projects/ }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('folderPrefixes', 'Projects/')
  })

  it('highlights a selected collection node', () => {
    renderRail({ ...emptySelection(), collectionIds: [1] })
    expect(screen.getByRole('button', { name: /^Root/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('NavRail — tags (tri-state)', () => {
  it('fires onCycleTag on click', () => {
    const h = renderRail()
    screen.getByRole('button', { name: /#ml/ }).click()
    expect(h.onCycleTag).toHaveBeenCalledWith('ml')
  })

  it('renders each tag with its mode (neutral / require / exclude)', () => {
    renderRail({
      ...emptySelection(),
      tags: [
        { name: 'ml', mode: 'require' },
        { name: 'physics', mode: 'exclude' },
      ],
    })
    expect(screen.getByRole('button', { name: /#ml/ }).getAttribute('data-mode')).toBe('require')
    expect(screen.getByRole('button', { name: /#physics/ }).getAttribute('data-mode')).toBe('exclude')
    expect(screen.getByRole('button', { name: /#biology/ }).getAttribute('data-mode')).toBe('neutral')
  })

  it('filter input narrows the tag list', () => {
    render(<NavRail nav={nav} selection={emptySelection()} {...handlers()} />)
    const input = screen.getByPlaceholderText(/filter tags/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'phys' } })
    expect(screen.queryByRole('button', { name: /#physics/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /#ml/ })).toBeNull()
  })
})

describe('NavRail — views', () => {
  it('renders no Views section when the list is empty', () => {
    renderRail()
    expect(screen.queryByRole('heading', { name: /views/i })).toBeNull()
  })

  it('renders a row per saved view', () => {
    render(<NavRail nav={nav} selection={emptySelection()} {...handlers()} views={views} />)
    expect(screen.getByRole('heading', { name: /views/i })).toBeTruthy()
    expect(screen.getByText('Unread ML')).toBeTruthy()
    expect(screen.getByText('Photos')).toBeTruthy()
  })

  it('clicking a view fires onApplyView with the view', () => {
    const onApplyView = vi.fn()
    render(
      <NavRail nav={nav} selection={emptySelection()} {...handlers()} views={views} onApplyView={onApplyView} />,
    )
    screen.getByText('Unread ML').click()
    expect(onApplyView).toHaveBeenCalledWith(views[0])
  })

  it('the × on a view row fires onDeleteView with its slug', () => {
    const onDeleteView = vi.fn()
    render(
      <NavRail nav={nav} selection={emptySelection()} {...handlers()} views={views} onDeleteView={onDeleteView} />,
    )
    screen.getByRole('button', { name: /delete view Photos/i }).click()
    expect(onDeleteView).toHaveBeenCalledWith('photos')
  })

  it('deleting does not also apply the view', () => {
    const onApplyView = vi.fn()
    const onDeleteView = vi.fn()
    render(
      <NavRail
        nav={nav}
        selection={emptySelection()}
        {...handlers()}
        views={views}
        onApplyView={onApplyView}
        onDeleteView={onDeleteView}
      />,
    )
    screen.getByRole('button', { name: /delete view Photos/i }).click()
    expect(onApplyView).not.toHaveBeenCalled()
  })

  it('highlights the applied view', () => {
    render(
      <NavRail
        nav={nav}
        selection={emptySelection()}
        {...handlers()}
        views={views}
        appliedViewSlug="photos"
      />,
    )
    expect(screen.getByRole('button', { name: /^Photos/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^Unread ML/ }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('NavRail — collections', () => {
  const collections: VCollectionSummary[] = [
    { slug: 'to-read', name: 'To Read', count: 12, unresolvedCount: 0 },
    { slug: 'faves', name: 'Faves', count: 3, unresolvedCount: 2 },
  ]

  it('renders a count-badged row per collection', () => {
    render(<NavRail nav={nav} selection={emptySelection()} {...handlers()} collections={collections} />)
    expect(screen.getByRole('heading', { name: /collections/i })).toBeTruthy()
    const toRead = screen.getByRole('button', { name: /^To Read/ })
    expect(within(toRead).getByText('12')).toBeTruthy()
  })

  it('clicking a collection fires onToggleScope(virtualCollections, slug)', () => {
    const h = handlers()
    render(<NavRail nav={nav} selection={emptySelection()} {...h} collections={collections} />)
    screen.getByRole('button', { name: /^To Read/ }).click()
    expect(h.onToggleScope).toHaveBeenCalledWith('virtualCollections', 'to-read')
  })

  it('highlights a selected collection', () => {
    render(
      <NavRail
        nav={nav}
        selection={{ ...emptySelection(), virtualCollections: ['faves'] }}
        {...handlers()}
        collections={collections}
      />,
    )
    expect(screen.getByRole('button', { name: /^Faves/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^To Read/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the unresolved marker only when non-zero', () => {
    render(<NavRail nav={nav} selection={emptySelection()} {...handlers()} collections={collections} />)
    expect(within(screen.getByRole('button', { name: /^Faves/ }).parentElement!).queryByText(/2 unresolved/)).toBeTruthy()
    expect(
      within(screen.getByRole('button', { name: /^To Read/ }).parentElement!).queryByText(/unresolved/),
    ).toBeNull()
  })

  it('the × on a collection row fires onDeleteCollection with its slug (and does not toggle)', () => {
    const h = handlers()
    const onDeleteCollection = vi.fn()
    render(
      <NavRail
        nav={nav}
        selection={emptySelection()}
        {...h}
        collections={collections}
        onDeleteCollection={onDeleteCollection}
      />,
    )
    screen.getByRole('button', { name: /delete collection Faves/i }).click()
    expect(onDeleteCollection).toHaveBeenCalledWith('faves')
    expect(h.onToggleScope).not.toHaveBeenCalled()
  })

  it('the New collection input fires onCreateCollection with the typed name on Enter', () => {
    const onCreateCollection = vi.fn()
    render(
      <NavRail
        nav={nav}
        selection={emptySelection()}
        {...handlers()}
        collections={collections}
        onCreateCollection={onCreateCollection}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /new collection/i }))
    const input = screen.getByLabelText(/new collection name/i)
    fireEvent.change(input, { target: { value: 'Later' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateCollection).toHaveBeenCalledWith('Later')
  })

  it('renders the section (for the create affordance) even with no collections', () => {
    render(
      <NavRail nav={nav} selection={emptySelection()} {...handlers()} onCreateCollection={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: /collections/i })).toBeTruthy()
  })

  it('renders no Collections section without collections or a create handler', () => {
    renderRail()
    expect(screen.queryByRole('heading', { name: /collections/i })).toBeNull()
  })
})

describe('NavRail — tag match control', () => {
  const withRequired = (...names: string[]): LensSelection => ({
    ...emptySelection(),
    tags: names.map((name) => ({ name, mode: 'require' as const })),
  })

  it('is hidden with fewer than two required tags', () => {
    renderRail(withRequired('ml'))
    expect(screen.queryByLabelText(/tag match/i)).toBeNull()
  })

  it('appears once two or more tags are required', () => {
    renderRail(withRequired('ml', 'physics'))
    expect(screen.getByLabelText(/tag match/i)).toBeTruthy()
  })

  it('toggling the control fires onSetTagMatch with the other mode', () => {
    const h = renderRail(withRequired('ml', 'physics')) // default tagMatch 'all'
    screen.getByLabelText(/tag match/i).click()
    expect(h.onSetTagMatch).toHaveBeenCalledWith('any')
  })
})
