/**
 * Pure nav-rail tree builders (docs/2026-07-10-library-navigator-spec §Module plan).
 * All the branching for the `index:nav` payload lives here — zotero/eagle collection
 * nesting and obsidian folder derivation — so it is unit-tested in isolation, with no
 * SQLite in the loop. `queries.nav()` feeds these the rows it reads.
 */

/** A rail node. `id` is `collections.id` (zotero/eagle) or the folderPrefix string (obsidian).
 *  `externalKey` is the rebuild-stable collection key (zotero/eagle only); it lets a saved view
 *  persist a collection ref that survives an index rebuild, unlike the regenerated `id`. Obsidian
 *  folder nodes omit it — their `id` (the folderPrefix) is already the stable path. */
export interface NavNode {
  id: number | string
  name: string
  count: number
  externalKey?: string
  children: NavNode[]
}

/** Deterministic sibling order: alpha by name, recursively (the spec leaves order open;
 *  a stable sort keeps the rail — and its tests — from flickering on row-order changes). */
function sortTree(nodes: NavNode[]): NavNode[] {
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  for (const n of nodes) sortTree(n.children)
  return nodes
}

/**
 * Zotero/Eagle rail tree from `collections` rows (parentId nesting) + DIRECT-membership
 * counts (no subtree roll-up in v1 — spec §index:nav). A parentId pointing at a row that
 * is absent from `rows` (an orphan — parent filtered out or not yet synced) is promoted to
 * a root rather than dropped, so no collection ever vanishes from the rail.
 */
export function buildCollectionTree(
  rows: { id: number; name: string; parentId: number | null; externalKey: string }[],
  countByCollectionId: Map<number, number>,
): NavNode[] {
  const nodes = new Map<number, NavNode>()
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      name: r.name,
      count: countByCollectionId.get(r.id) ?? 0,
      externalKey: r.externalKey,
      children: [],
    })
  }
  const roots: NavNode[] = []
  for (const r of rows) {
    const node = nodes.get(r.id)!
    const parent = r.parentId != null ? nodes.get(r.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node) // no parent, or orphan parentId → root
  }
  return sortTree(roots)
}

/**
 * Obsidian rail tree derived from instance relpaths (`document_instances.externalKey`).
 * A note's folder is its dirname; each dirname prefix becomes a node, and a folder's count
 * is the docs living DIRECTLY in it (dirname === that folder — subfolders don't roll up).
 * Root-level notes (no slash) belong to no folder node. `id` is the folderPrefix WITH a
 * trailing slash so the renderer can pass it verbatim as browse/search `folderPrefix`
 * (LIKE '<prefix>%'); `name` is the last path segment.
 */
export function buildFolderTree(relPaths: string[]): NavNode[] {
  const directCount = new Map<string, number>() // folder path (no trailing slash) → direct doc count
  const folders = new Set<string>() // every folder + ancestor
  for (const rp of relPaths) {
    const idx = rp.lastIndexOf('/')
    if (idx < 0) continue // root-level note — no folder
    const dir = rp.slice(0, idx)
    if (!dir) continue // leading-slash / malformed → treat as root
    directCount.set(dir, (directCount.get(dir) ?? 0) + 1)
    let acc = ''
    for (const seg of dir.split('/')) {
      if (!seg) continue
      acc = acc ? `${acc}/${seg}` : seg
      folders.add(acc)
    }
  }
  const nodes = new Map<string, NavNode>()
  for (const folder of folders) {
    const name = folder.slice(folder.lastIndexOf('/') + 1)
    nodes.set(folder, { id: `${folder}/`, name, count: directCount.get(folder) ?? 0, children: [] })
  }
  const roots: NavNode[] = []
  for (const folder of folders) {
    const node = nodes.get(folder)!
    const idx = folder.lastIndexOf('/')
    if (idx < 0) roots.push(node)
    else nodes.get(folder.slice(0, idx))!.children.push(node) // ancestor guaranteed present
  }
  return sortTree(roots)
}
