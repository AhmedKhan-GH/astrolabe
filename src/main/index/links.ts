import { basename } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * Wiki-link resolution + read path (docs/2026-07-10 notes wave §Links). Link EDGES are stored
 * at sync time by `upsert` (raw target name, unresolved). This module owns the two derived
 * operations on top of them:
 *
 *  - `resolveLinks(db)` — the post-sync re-pass that joins every link's `targetName` to a
 *    document. It is a FULL recompute each pass (renamed/removed targets fall back to NULL) —
 *    the simplest correct approach at this scale (10³–10⁴ notes; a re-scan touches a handful of
 *    rows, and the whole vault fits comfortably in memory). Resolution mirrors Obsidian's own
 *    order: an exact vault-relpath `<target>.md` wins; else a UNIQUE basename `<target>.md`;
 *    else NULL (no match, or ambiguous — two notes share the basename).
 *
 *  - `documentLinks(db, id)` — the `index:links` payload: a document's outlinks (with the
 *    resolved target's title/kind + the target's obsidian instance to open) and its backlinks
 *    (the notes that link TO it, each with the source note's obsidian instance).
 *
 * Links are an Obsidian construct, so resolution and both read shapes are scoped to obsidian
 * instances (a note is file-identity; there is exactly one obsidian instance per note document).
 */

export interface OutLink {
  targetName: string
  /** The resolved document, or null (unresolved: no match / ambiguous / not yet synced). */
  documentId: number | null
  title: string | null
  kind: string | null
  /** The target document's obsidian instance (what NoteView opens), or null when unresolved. */
  instanceId: number | null
}

export interface BackLink {
  documentId: number
  title: string
  kind: string
  /** The source note's obsidian instance (the note that carries the link). */
  instanceId: number
}

export interface DocumentLinks {
  outlinks: OutLink[]
  backlinks: BackLink[]
}

/**
 * Recompute `targetDocumentId` for every link row against the current obsidian instances.
 * Exact relpath match first, then a UNIQUE basename match, else NULL. Runs in one transaction;
 * only rows whose resolution changed are written.
 */
export function resolveLinks(db: Db): void {
  const instances = db
    .select({
      documentId: s.documentInstances.documentId,
      externalKey: s.documentInstances.externalKey,
    })
    .from(s.documentInstances)
    .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
    .where(eq(s.sources.key, 'obsidian'))
    .all()

  // externalKey → documentId (unique per source), and basename → the set of documents that
  // share it (a set so a basename shared across folders reads as ambiguous, size > 1).
  const byRelpath = new Map<string, number>()
  const byBasename = new Map<string, Set<number>>()
  for (const inst of instances) {
    byRelpath.set(inst.externalKey, inst.documentId)
    const base = basename(inst.externalKey)
    const set = byBasename.get(base) ?? new Set<number>()
    set.add(inst.documentId)
    byBasename.set(base, set)
  }

  const resolveTarget = (targetName: string): number | null => {
    const exact = byRelpath.get(`${targetName}.md`)
    if (exact != null) return exact
    const candidates = byBasename.get(`${basename(targetName)}.md`)
    if (candidates && candidates.size === 1) return [...candidates][0]!
    return null // no match, or ambiguous
  }

  const rows = db.select().from(s.links).all()
  db.transaction(() => {
    for (const link of rows) {
      const targetDocumentId = resolveTarget(link.targetName)
      if (targetDocumentId !== link.targetDocumentId) {
        db.update(s.links).set({ targetDocumentId }).where(eq(s.links.id, link.id)).run()
      }
    }
  })
}

/** The target document's obsidian instance id (what NoteView opens), or null. */
function obsidianInstanceId(db: Db, documentId: number): number | null {
  const row = db
    .select({ id: s.documentInstances.id })
    .from(s.documentInstances)
    .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
    .where(and(eq(s.documentInstances.documentId, documentId), eq(s.sources.key, 'obsidian')))
    .get()
  return row?.id ?? null
}

/** Outlinks (this document's links, in note order) + backlinks (notes pointing at it). */
export function documentLinks(db: Db, documentId: number): DocumentLinks {
  // Outlinks: every link whose SOURCE instance belongs to this document, in insertion order
  // (ORDER BY id preserves the wiki-link order within the note).
  const outRows = db
    .select({ targetName: s.links.targetName, targetDocumentId: s.links.targetDocumentId })
    .from(s.links)
    .innerJoin(s.documentInstances, eq(s.links.sourceInstanceId, s.documentInstances.id))
    .where(eq(s.documentInstances.documentId, documentId))
    .orderBy(s.links.id)
    .all()

  const outlinks: OutLink[] = outRows.map((r) => {
    if (r.targetDocumentId == null) {
      return { targetName: r.targetName, documentId: null, title: null, kind: null, instanceId: null }
    }
    const doc = db
      .select({ title: s.documents.title, kind: s.documents.kind })
      .from(s.documents)
      .where(eq(s.documents.id, r.targetDocumentId))
      .get()
    return {
      targetName: r.targetName,
      documentId: r.targetDocumentId,
      title: doc?.title ?? null,
      kind: doc?.kind ?? null,
      instanceId: obsidianInstanceId(db, r.targetDocumentId),
    }
  })

  // Backlinks: every link resolving TO this document; the source note (via its instance) is the
  // backlink. Dedupe by source document (two aliases in one note pointing here read as one
  // backlink). Ordered by title for a stable, human-meaningful list.
  const backRows = db
    .select({
      sourceInstanceId: s.links.sourceInstanceId,
      documentId: s.documentInstances.documentId,
      title: s.documents.title,
      kind: s.documents.kind,
    })
    .from(s.links)
    .innerJoin(s.documentInstances, eq(s.links.sourceInstanceId, s.documentInstances.id))
    .innerJoin(s.documents, eq(s.documentInstances.documentId, s.documents.id))
    .where(eq(s.links.targetDocumentId, documentId))
    .orderBy(s.documents.title, s.documentInstances.documentId)
    .all()

  const seen = new Set<number>()
  const backlinks: BackLink[] = []
  for (const r of backRows) {
    if (seen.has(r.documentId)) continue
    seen.add(r.documentId)
    backlinks.push({ documentId: r.documentId, title: r.title, kind: r.kind, instanceId: r.sourceInstanceId })
  }

  return { outlinks, backlinks }
}
