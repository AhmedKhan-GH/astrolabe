/* eslint-disable react-refresh/only-export-components -- test-only helpers +
 * a probe component co-located for convenience; fast-refresh is irrelevant. */
import { render, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FolderTreeNode } from '../../../../main/index/queries'
import { FrameProvider, useFrame } from '../state'

/**
 * The preload seam, stubbed. Tests assign the returned stub to
 * `window.astrolabe` and render inside FrameProvider — the boundary spec §8
 * mandates. Mutations are vi.fn() so tests assert the exact request payloads.
 */

export const fixtureTree: FolderTreeNode[] = [
  {
    slug: 'research',
    name: 'Research',
    ownCount: 3,
    subtreeCount: 5,
    children: [{ slug: 'research/ml', name: 'ML', ownCount: 2, subtreeCount: 2, children: [] }],
  },
  { slug: 'inbox', name: 'Inbox', ownCount: 1, subtreeCount: 1, children: [] },
]

export const fixtureTags = [
  { name: 'paper', count: 40 },
  { name: 'todo', count: 12 },
]

export function makeStub(overrides: Record<string, unknown> = {}) {
  const folders = {
    list: vi.fn().mockResolvedValue(fixtureTree),
    create: vi.fn().mockResolvedValue(fixtureTree),
    rename: vi.fn().mockResolvedValue({ tree: fixtureTree, slug: 'x', previousSlug: 'y' }),
    setParent: vi.fn().mockResolvedValue(fixtureTree),
    remove: vi.fn().mockResolvedValue(fixtureTree),
    addMembers: vi.fn().mockResolvedValue(fixtureTree),
    removeMembers: vi.fn().mockResolvedValue(fixtureTree),
    import: vi.fn().mockResolvedValue({ created: 2, members: 10, skipped: 1 }),
  }
  const stub = {
    browse: vi.fn().mockResolvedValue({ total: 4, hits: [] }),
    search: vi.fn().mockResolvedValue([]),
    tags: vi.fn().mockResolvedValue(fixtureTags),
    stats: vi.fn().mockResolvedValue({ documents: 42, annotations: 100, ghosts: 3 }),
    libraries: vi.fn().mockResolvedValue({
      connectors: [
        { key: 'zotero', status: 'ok' },
        { key: 'eagle', status: 'ok' },
      ],
      libraries: [
        {
          id: 1,
          connector: 'zotero',
          stableKey: 'z1',
          displayName: 'Personal',
          availability: 'live',
          lastSeenAt: null,
          lastScanAt: null,
          documentCount: 30,
        },
        {
          id: 7,
          connector: 'eagle',
          stableKey: '/eagle/lib',
          displayName: 'Eagle Lib',
          availability: 'dormant',
          lastSeenAt: null,
          lastScanAt: null,
          documentCount: 12,
        },
      ],
    }),
    document: vi.fn().mockResolvedValue(null),
    sync: vi.fn().mockResolvedValue([]),
    rebuild: vi.fn().mockResolvedValue([]),
    open: vi.fn().mockResolvedValue(true),
    folders,
    ...overrides,
  }
  return stub
}

export type Stub = ReturnType<typeof makeStub>

/** Installs a stub on window.astrolabe and returns it. */
export function installStub(overrides: Record<string, unknown> = {}): Stub {
  const stub = makeStub(overrides)
  // The renderer only ever sees the typed surface; cast through unknown.
  ;(globalThis as unknown as { window: { astrolabe: unknown } }).window.astrolabe = stub
  return stub
}

/** Probe that surfaces the current rail selection for assertions. */
export function RailProbe(): React.JSX.Element {
  const { rail } = useFrame()
  return <div data-testid="rail-probe">{JSON.stringify(rail)}</div>
}

export function renderInFrame(node: ReactNode): RenderResult {
  return render(
    <FrameProvider>
      {node}
      <RailProbe />
    </FrameProvider>,
  )
}
