import { existsSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import * as s from '../db/schema'
import type { IndexQueries } from './queries'
import type { ZoteroWrite } from '../lib/zotero-write'
import type { EagleWrite } from '../lib/eagle-write'
import type { TransferDirection, TransferRequest, TransferResult } from '../../shared/db-ipc'
import { moduleLogger } from '../lib/logger'

/**
 * Eagle↔Zotero transfer orchestration (2026-07-11-eagle-zotero-sync-spec §Wire contract). Gates a
 * request BEFORE any network call, then dispatches to the target system's write client. It does NOT
 * touch our index — on success the caller runs the TARGET connector's sync, and the content-hash
 * join merges the new instance into the same document row so presence flips to `both` (that hash
 * join, not any bookkeeping here, is the correctness mechanism).
 *
 * Presence gating reuses `queries.documentDetail` (the same Z/E rule the facet uses), rather than
 * re-deriving it — spec: "extract/share, don't duplicate". The affordance rule is symmetric: a
 * `to-zotero` request is legal only for an `eagle-only` document, `to-eagle` only for `zotero-only`.
 */
const log = moduleLogger('index.reconcile')

export interface ReconcileDeps {
  zoteroWrite: ZoteroWrite
  eagleWrite: EagleWrite
  /** Injectable for tests; defaults to a real on-disk existence check. */
  fileExists?: (path: string) => boolean
}

export interface ReconcileApi {
  transfer(req: TransferRequest): Promise<TransferResult>
}

export function createReconcileApi(db: Db, queries: IndexQueries, deps: ReconcileDeps): ReconcileApi {
  const fileExists = deps.fileExists ?? existsSync

  /** The source instance's durable key + on-disk path for one document, or null when absent. */
  function sourceInstance(documentId: number, sourceKey: 'zotero' | 'eagle') {
    return db
      .select({ externalKey: s.documentInstances.externalKey, filePath: s.documentInstances.filePath })
      .from(s.documentInstances)
      .innerJoin(s.sources, eq(s.documentInstances.sourceId, s.sources.id))
      .where(and(eq(s.documentInstances.documentId, documentId), eq(s.sources.key, sourceKey)))
      .get()
  }

  async function transfer(req: TransferRequest): Promise<TransferResult> {
    const detail = queries.documentDetail(req.documentId)
    if (!detail) return { ok: false, reason: 'That document is no longer in the index.' }
    if (detail.kind !== 'pdf') return { ok: false, reason: 'Only PDFs can be moved between Zotero and Eagle.' }

    // Presence-derived existence (same rule as the facet): whether a zotero / eagle instance exists.
    const hasZ = detail.presence === 'both' || detail.presence === 'zotero-only'
    const hasE = detail.presence === 'both' || detail.presence === 'eagle-only'
    const plan: Record<TransferDirection, { src: 'zotero' | 'eagle'; tgt: string; hasSrc: boolean; hasTgt: boolean }> = {
      'to-zotero': { src: 'eagle', tgt: 'Zotero', hasSrc: hasE, hasTgt: hasZ },
      'to-eagle': { src: 'zotero', tgt: 'Eagle', hasSrc: hasZ, hasTgt: hasE },
    }
    const { src, tgt, hasSrc, hasTgt } = plan[req.direction]

    // Idempotence: the target already holds it (presence already covers this).
    if (hasTgt) return { ok: false, reason: `Already in ${tgt}.` }
    // Nothing to move from.
    if (!hasSrc) return { ok: false, reason: `No ${src} copy to move.` }

    const source = sourceInstance(req.documentId, src)
    if (!source?.filePath) return { ok: false, reason: `The ${src} copy has no file on disk to move.` }
    if (!fileExists(source.filePath))
      return { ok: false, reason: `The ${src} file is missing on disk — re-sync ${src} and retry.` }

    log.info({ documentId: req.documentId, direction: req.direction }, 'transfer: gates passed, dispatching')
    if (req.direction === 'to-zotero') {
      return deps.zoteroWrite.promoteDocument({
        title: detail.title,
        tags: detail.tags,
        filePath: source.filePath,
      })
    }
    return deps.eagleWrite.importDocument({
      title: detail.title,
      tags: detail.tags,
      filePath: source.filePath,
      externalKey: source.externalKey,
    })
  }

  return { transfer }
}
