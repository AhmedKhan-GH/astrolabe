import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'

/**
 * The index write path (runway step 3) — Tier A: every connector funnels through
 * here, and the hash-join rule lives here. All work per document happens in ONE
 * transaction, FTS row included. Idempotent by contract: same payload twice = no
 * change (tested in upsert.itest.ts).
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
  sourceKey: string
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
  function ensureSource(key: string): s.Source {
    const existing = db.select().from(s.sources).where(eq(s.sources.key, key)).get()
    if (existing) return existing
    return db.insert(s.sources).values({ key }).returning().get()
  }

  function upsertTagIds(names: string[]): number[] {
    return names.map((name) => {
      const found = db.select().from(s.tags).where(eq(s.tags.name, name)).get()
      if (found) return found.id
      return db.insert(s.tags).values({ name }).returning().get().id
    })
  }

  /** Upsert a source's collection tree; two passes so parents resolve regardless of order. */
  function upsertCollections(sourceKey: string, items: CollectionInput[]): void {
    const source = ensureSource(sourceKey)
    db.transaction(() => {
      for (const c of items) {
        const existing = db
          .select()
          .from(s.collections)
          .where(and(eq(s.collections.sourceId, source.id), eq(s.collections.externalKey, c.externalKey)))
          .get()
        if (existing) {
          db.update(s.collections).set({ name: c.name }).where(eq(s.collections.id, existing.id)).run()
        } else {
          db.insert(s.collections).values({ sourceId: source.id, externalKey: c.externalKey, name: c.name }).run()
        }
      }
      for (const c of items) {
        if (!c.parentExternalKey) continue
        const child = db
          .select()
          .from(s.collections)
          .where(and(eq(s.collections.sourceId, source.id), eq(s.collections.externalKey, c.externalKey)))
          .get()
        const parent = db
          .select()
          .from(s.collections)
          .where(and(eq(s.collections.sourceId, source.id), eq(s.collections.externalKey, c.parentExternalKey)))
          .get()
        if (child && parent) {
          db.update(s.collections).set({ parentId: parent.id }).where(eq(s.collections.id, child.id)).run()
        }
      }
    })
  }

  /**
   * The core write. Resolution order for the target document:
   *  1. existing instance (sourceId, externalKey) → its document
   *  2. else contentSha256 match → attach instance to that document (the HASH JOIN)
   *  3. else create a new document
   */
  function upsertDocument(input: DocumentInput): { documentId: number; instanceId: number } {
    const source = ensureSource(input.sourceKey)
    return db.transaction(() => {
      const existingInstance = db
        .select()
        .from(s.documentInstances)
        .where(
          and(
            eq(s.documentInstances.sourceId, source.id),
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
        sourceId: source.id,
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
            .where(and(eq(s.collections.sourceId, source.id), eq(s.collections.externalKey, key)))
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

      refreshFtsRow(documentId)
      return { documentId, instanceId }
    })
  }

  /** Rebuild the document's FTS row from current relational state (same tx as writes). */
  function refreshFtsRow(documentId: number): void {
    const doc = db.select().from(s.documents).where(eq(s.documents.id, documentId)).get()
    if (!doc) return
    const tagNames = db
      .select({ name: s.tags.name })
      .from(s.tags)
      .innerJoin(s.documentTags, eq(s.documentTags.tagId, s.tags.id))
      .where(eq(s.documentTags.documentId, documentId))
      .all()
      .map((r) => r.name)
    const annots = db
      .select({ text: s.annotations.text, comment: s.annotations.comment })
      .from(s.annotations)
      .innerJoin(s.documentInstances, eq(s.annotations.instanceId, s.documentInstances.id))
      .where(eq(s.documentInstances.documentId, documentId))
      .all()
    const body = annots.flatMap((a) => [a.text, a.comment]).filter(Boolean).join('\n')
    db.run(sql`DELETE FROM search_fts WHERE rowid = ${documentId}`)
    db.run(
      sql`INSERT INTO search_fts (rowid, title, body, tags) VALUES (${documentId}, ${doc.title}, ${body}, ${tagNames.join(' ')})`,
    )
  }

  /** ADR-0005 made operational: wipe everything derived; cursors reset. */
  function wipeDerived(): void {
    db.transaction(() => {
      db.run(sql`DELETE FROM search_fts`)
      db.delete(s.annotations).run()
      db.delete(s.documentCollections).run()
      db.delete(s.documentTags).run()
      db.delete(s.documentInstances).run()
      db.delete(s.collections).run()
      db.delete(s.tags).run()
      db.delete(s.documents).run()
      db.update(s.sources).set({ syncCursor: null, lastSyncAt: null }).run()
    })
  }

  return { ensureSource, upsertDocument, upsertCollections, wipeDerived, refreshFtsRow }
}

export type UpsertApi = ReturnType<typeof createUpsertApi>
