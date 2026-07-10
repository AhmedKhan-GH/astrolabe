import { describe, it, expect } from 'vitest'
import { buildCollectionTree, buildFolderTree, type NavNode } from './nav-tree'

/**
 * Unit tier for the nav-rail tree builders (docs/2026-07-10-library-navigator-spec §Module plan):
 * all the branching — nesting, orphan parents, folder derivation from relpaths — lives in these
 * pure functions, so this is where the risk is tested. No SQLite here.
 */

const byName = (nodes: NavNode[]) => nodes.map((n) => n.name)

describe('buildCollectionTree', () => {
  it('empty rows → empty tree', () => {
    expect(buildCollectionTree([], new Map())).toEqual([])
  })

  it('flat roots (no parents) carry direct-membership counts, alpha-ordered', () => {
    const tree = buildCollectionTree(
      [
        { id: 1, name: 'Zebra', parentId: null },
        { id: 2, name: 'Alpha', parentId: null },
      ],
      new Map([
        [1, 3],
        [2, 7],
      ]),
    )
    expect(byName(tree)).toEqual(['Alpha', 'Zebra'])
    expect(tree.map((n) => [n.id, n.count])).toEqual([
      [2, 7],
      [1, 3],
    ])
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('nests children under their parentId', () => {
    const tree = buildCollectionTree(
      [
        { id: 1, name: 'Library', parentId: null },
        { id: 2, name: 'Papers', parentId: 1 },
        { id: 3, name: 'Drafts', parentId: 2 },
      ],
      new Map([[3, 5]]),
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]?.name).toBe('Library')
    const papers = tree[0]?.children[0]
    expect(papers?.name).toBe('Papers')
    expect(papers?.children[0]?.name).toBe('Drafts')
    expect(papers?.children[0]?.count).toBe(5)
  })

  it('orphan parentId (parent not in rows) is promoted to a root', () => {
    const tree = buildCollectionTree(
      [{ id: 2, name: 'Orphan', parentId: 999 }],
      new Map(),
    )
    expect(byName(tree)).toEqual(['Orphan'])
    expect(tree[0]?.count).toBe(0) // missing from count map → 0
  })
})

describe('buildFolderTree', () => {
  it('empty input → empty tree', () => {
    expect(buildFolderTree([])).toEqual([])
  })

  it('root-level notes belong to no folder node', () => {
    expect(buildFolderTree(['note.md', 'other.md'])).toEqual([])
  })

  it('derives a nested folder tree from dirname segments', () => {
    const tree = buildFolderTree(['Projects/Foo/a.md', 'Projects/b.md'])
    expect(byName(tree)).toEqual(['Projects'])
    const projects = tree[0]
    expect(projects?.id).toBe('Projects/') // id is the folderPrefix (trailing slash)
    expect(projects?.count).toBe(1) // b.md is directly in Projects/
    const foo = projects?.children[0]
    expect(foo?.name).toBe('Foo')
    expect(foo?.id).toBe('Projects/Foo/')
    expect(foo?.count).toBe(1) // a.md
    expect(foo?.children).toEqual([])
  })

  it('counts multiple docs directly in the same folder', () => {
    const tree = buildFolderTree(['A/one.md', 'A/two.md', 'A/three.md'])
    expect(tree[0]?.name).toBe('A')
    expect(tree[0]?.count).toBe(3)
  })

  it('materialises intermediate folders that hold no direct docs', () => {
    const tree = buildFolderTree(['A/B/C/deep.md'])
    const a = tree[0]
    expect(a?.name).toBe('A')
    expect(a?.count).toBe(0)
    const b = a?.children[0]
    expect(b?.name).toBe('B')
    expect(b?.count).toBe(0)
    const c = b?.children[0]
    expect(c?.name).toBe('C')
    expect(c?.id).toBe('A/B/C/')
    expect(c?.count).toBe(1)
  })

  it('orders sibling folders alphabetically', () => {
    const tree = buildFolderTree(['Zeta/x.md', 'Alpha/y.md'])
    expect(byName(tree)).toEqual(['Alpha', 'Zeta'])
  })
})
