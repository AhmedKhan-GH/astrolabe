import type { FolderTreeNode } from '../../../../main/index/queries'

/**
 * Pure folder-tree traversal used by the rail (selection, the Move-to picker's
 * subtree exclusion). No React, no IPC — trivially testable, exercised through
 * the Move dialog in Rail.test.tsx.
 */

/** Depth-first find by slug. */
export function findNode(nodes: FolderTreeNode[], slug: string): FolderTreeNode | null {
  for (const n of nodes) {
    if (n.slug === slug) return n
    const found = findNode(n.children, slug)
    if (found) return found
  }
  return null
}

/** Every slug in `node`'s subtree, including `node` itself. A folder may not be
 *  moved into its own descendant, so this set is the Move picker's exclude. */
export function collectSubtreeSlugs(node: FolderTreeNode): Set<string> {
  const out = new Set<string>()
  const walk = (n: FolderTreeNode): void => {
    out.add(n.slug)
    n.children.forEach(walk)
  }
  walk(node)
  return out
}

export interface FlatFolder {
  slug: string
  name: string
  depth: number
}

/** Flatten the tree to indented rows, dropping any slug in `exclude`. Skipping a
 *  node skips its whole subtree (its children are unreachable once its parent is
 *  gone). */
export function flatten(nodes: FolderTreeNode[], exclude: Set<string>, depth = 0): FlatFolder[] {
  const out: FlatFolder[] = []
  for (const n of nodes) {
    if (exclude.has(n.slug)) continue
    out.push({ slug: n.slug, name: n.name, depth })
    out.push(...flatten(n.children, exclude, depth + 1))
  }
  return out
}
