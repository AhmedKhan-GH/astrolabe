import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * The index write path, v2 (spine spec v2 §1–2) — Tier A: every connector
 * funnels through here, and the identity rules live here. All work per document
 * happens in ONE transaction. Idempotent by contract: same payload twice = no
 * change (upsert.itest.ts).
 *
 * v2 vs v1: instances resolve within a LIBRARY (libraryId, externalKey), never
 * connector-wide; the hash join spans everything (two connectors OR two
 * libraries of one connector merge into one document); and no path in this
 * module deletes a document row — a document whose instances are all gone is a
 * ghost (spec §2), surfaced or hidden by the query layer, never pruned here.
 * FTS row maintenance joins in the queries commit (one component, one commit).
 */

export interface AnnotationInput {
  externalKey: string
  type: string
  text?: string | null
  comment?: string | null
  pageLabel?: string | null
  color?: string | null
  positionJson?: string | null
  modifiedAt: number
}

export interface DocumentInput {
  /** The scan scope: resolve via ensureLibrary before upserting (spec §2). */
  libraryId: number
  externalKey: string
  uri: string
  title: string
  kind: 'pdf' | 'image' | 'note' | 'other'
  filePath?: string | null
  contentSha256?: string | null
  metaJson?: string | null
  modifiedAt: number
  tags?: string[]
  /** Collection externalKeys (collections themselves upserted via upsertCollections). */
  collectionKeys?: string[]
  annotations?: AnnotationInput[]
}

export interface CollectionInput {
  externalKey: string
  name: string
  parentExternalKey?: string | null
}

export function createUpsertApi(db: Db) {
  function ensureConnector(key: string): s.Connector {
    const existing = db.select().from(s.connectors).where(eq(s.connectors.key, key)).get()
    if (existing) return existing
    return db.insert(s.connectors).values({ key }).returning().get()
  }

  /** Create-or-get a library under its connector. (connectorKey, stableKey) is
   *  the identity; displayName refreshes on every call (a renamed Zotero group
   *  or relocated Eagle library keeps its row). */
  function ensureLibrary(connectorKey: string, stableKey: string, displayName: string): s.Library {
    const connector = ensureConnector(connectorKey)
    const existing = db
      .select()
      .from(s.libraries)
      .where(and(eq(s.libraries.connectorId, connector.id), eq(s.libraries.stableKey, stableKey)))
      .get()
    if (existing) {
      if (existing.displayName !== displayName) {
        return db
          .update(s.libraries)
          .set({ displayName })
          .where(eq(s.libraries.id, existing.id))
          .returning()
          .get()
      }
      return existing
    }
    return db
      .insert(s.libraries)
      .values({ connectorId: connector.id, stableKey, displayName })
      .returning()
      .get()
  }

  function upsertTagIds(names: string[]): number[] {
    return names.map((name) => {
      const found = db.select().from(s.tags).where(eq(s.tags.name, name)).get()
      if (found) return found.id
      return db.insert(s.tags).values({ name }).returning().get().id
    })
  }

  /** Upsert a library's collection tree; two passes so parents resolve regardless of order. */
  function upsertCollections(libraryId: number, items: CollectionInput[]): void {
    db.transaction(() => {
      for (const c of items) {
        const existing = db
          .select()
          .from(s.collections)
          .where(and(eq(s.collections.libraryId, libraryId), eq(s.collections.externalKey, c.externalKey)))
          .get()
        if (existing) {
          db.update(s.collections).set({ name: c.name }).where(eq(s.collections.id, existing.id)).run()
        } else {
          db.insert(s.collections).values({ libraryId, externalKey: c.externalKey, name: c.name }).run()
        }
      }
      for (const c of items) {
        if (!c.parentExternalKey) continue
        const child = db
          .select()
          .from(s.collections)
          .where(and(eq(s.collections.libraryId, libraryId), eq(s.collections.externalKey, c.externalKey)))
          .get()
        const parent = db
          .select()
          .from(s.collections)
          .where(
            and(eq(s.collections.libraryId, libraryId), eq(s.collections.externalKey, c.parentExternalKey)),
          )
          .get()
        if (child && parent) {
          db.update(s.collections).set({ parentId: parent.id }).where(eq(s.collections.id, child.id)).run()
        }
      }
    })
  }

  /**
   * The core write. Resolution order for the target document (spec §1):
   *  1. existing instance (libraryId, externalKey) → its document
   *  2. else contentSha256 match → attach instance to that document (the HASH
   *     JOIN — across connectors and across libraries alike)
   *  3. else create a new document
   */
  function upsertDocument(input: DocumentInput): { documentId: number; instanceId: number } {
    return db.transaction(() => {
      const existingInstance = db
        .select()
        .from(s.documentInstances)
        .where(
          and(
            eq(s.documentInstances.libraryId, input.libraryId),
            eq(s.documentInstances.externalKey, input.externalKey),
          ),
        )
        .get()

      let documentId: number
      if (existingInstance) {
        documentId = existingInstance.documentId
        db.update(s.documents)
          .set({
            title: input.title,
            modifiedAt: input.modifiedAt,
            ...(input.contentSha256 ? { contentSha256: input.contentSha256 } : {}),
          })
          .where(eq(s.documents.id, documentId))
          .run()
      } else {
        const byHash = input.contentSha256
          ? db.select().from(s.documents).where(eq(s.documents.contentSha256, input.contentSha256)).get()
          : undefined
        if (byHash) {
          documentId = byHash.id
        } else {
          documentId = db
            .insert(s.documents)
            .values({
              contentSha256: input.contentSha256 ?? null,
              title: input.title,
              kind: input.kind,
              createdAt: input.modifiedAt,
              modifiedAt: input.modifiedAt,
            })
            .returning()
            .get().id
        }
      }

      const instanceValues = {
        documentId,
        libraryId: input.libraryId,
        externalKey: input.externalKey,
        uri: input.uri,
        filePath: input.filePath ?? null,
        metaJson: input.metaJson ?? null,
      }
      let instanceId: number
      if (existingInstance) {
        instanceId = existingInstance.id
        db.update(s.documentInstances).set(instanceValues).where(eq(s.documentInstances.id, instanceId)).run()
      } else {
        instanceId = db.insert(s.documentInstances).values(instanceValues).returning().get().id
      }

      if (input.tags) {
        const tagIds = upsertTagIds(input.tags)
        for (const tagId of tagIds) {
          db.insert(s.documentTags).values({ documentId, tagId }).onConflictDoNothing().run()
        }
      }

      if (input.collectionKeys) {
        for (const key of input.collectionKeys) {
          const coll = db
            .select()
            .from(s.collections)
            .where(and(eq(s.collections.libraryId, input.libraryId), eq(s.collections.externalKey, key)))
            .get()
          if (coll) {
            db.insert(s.documentCollections)
              .values({ documentId, collectionId: coll.id })
              .onConflictDoNothing()
              .run()
          }
        }
      }

      if (input.annotations) {
        for (const a of input.annotations) {
          db.insert(s.annotations)
            .values({ instanceId, ...a })
            .onConflictDoUpdate({
              target: [s.annotations.instanceId, s.annotations.externalKey],
              set: {
                text: a.text ?? null,
                comment: a.comment ?? null,
                pageLabel: a.pageLabel ?? null,
                color: a.color ?? null,
                positionJson: a.positionJson ?? null,
                modifiedAt: a.modifiedAt,
                type: a.type,
              },
            })
            .run()
        }
      }

      return { documentId, instanceId }
    })
  }

  /**
   * ADR-0005 made operational: wipe everything derived from document scans.
   * Connectors and LIBRARIES survive (availability memory is presence state,
   * spec §2); their cursors reset so the next sync walks from zero. Caveat,
   * recorded: an explicit rebuild loses ghost rows until a scan re-creates
   * their documents — hash-keyed reading files on disk are untouched and
   * re-attach by hash (spec §3); ghost re-materialization from those files is
   * an M3 concern.
   */
  function wipeDerived(): void {
    db.transaction(() => {
      db.delete(s.annotations).run()
      db.delete(s.documentCollections).run()
      db.delete(s.documentTags).run()
      db.delete(s.documentInstances).run()
      db.delete(s.collections).run()
      db.delete(s.tags).run()
      db.delete(s.documents).run()
      db.update(s.libraries).set({ syncCursor: null, lastScanAt: null }).run()
    })
  }

  /**
   * Delete `connectors` rows whose key is not currently registered — cascading
   * their libraries, and those libraries' instances/collections (FK cascades).
   * Called at boot so removing a connector self-heals. v2: DOCUMENTS ARE NEVER
   * DELETED (spec §2) — a document stripped of its last instance becomes a
   * ghost, hidden by default surfaces, its reading history intact. Returns the
   * count of connectors pruned.
   */
  function pruneUnknownConnectors(knownKeys: string[]): number {
    const known = new Set(knownKeys)
    const unknown = db
      .select()
      .from(s.connectors)
      .all()
      .filter((row) => !known.has(row.key))
    if (unknown.length === 0) return 0
    db.transaction(() => {
      for (const c of unknown) {
        db.delete(s.connectors).where(eq(s.connectors.id, c.id)).run()
      }
    })
    return unknown.length
  }

  return {
    ensureConnector,
    ensureLibrary,
    upsertDocument,
    upsertCollections,
    wipeDerived,
    pruneUnknownConnectors,
  }
}

export type UpsertApi = ReturnType<typeof createUpsertApi>
