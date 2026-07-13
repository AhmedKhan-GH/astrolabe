import { describe, it, expect } from 'vitest'
import {
  applyEvents,
  readingRecordRequestSchema,
  type ReadingStateFile,
} from './reading-state'

/**
 * Unit tier for the reading-state merge (docs/2026-07-13-r2-reader-reading-state-spec §1): the
 * pure `applyEvents` accumulator is the branching worth pinning — dwell sums, visits increment
 * once per event, first/last timestamps advance monotonically, and finished/finishedAt are never
 * touched. Plus the record-request bounds (the frozen wire contract §2).
 */

const T0 = Date.parse('2026-07-13T10:00:00.000Z')
const NOW = Date.parse('2026-07-13T12:00:00.000Z')

const emptyFile = (): ReadingStateFile => ({
  schemaVersion: 1,
  contentSha256: 'hAbc',
  pages: {},
  finished: false,
  finishedAt: null,
  updatedAt: new Date(T0).toISOString(),
})

describe('applyEvents', () => {
  it('creates a page from a single event (visits=1, first=last=at, dwell)', () => {
    const at = Date.parse('2026-07-13T11:00:00.000Z')
    const next = applyEvents(emptyFile(), [{ pageIndex: 3, dwellMs: 1500, at }], NOW)
    expect(next.pages['3']).toEqual({
      dwellMs: 1500,
      visits: 1,
      firstSeenAt: new Date(at).toISOString(),
      lastSeenAt: new Date(at).toISOString(),
    })
    expect(next.updatedAt).toBe(new Date(NOW).toISOString())
  })

  it('accumulates dwell and increments visits across two events on the same page', () => {
    const a = Date.parse('2026-07-13T11:00:00.000Z')
    const b = Date.parse('2026-07-13T11:05:00.000Z')
    const step1 = applyEvents(emptyFile(), [{ pageIndex: 0, dwellMs: 1000, at: a }], NOW)
    const step2 = applyEvents(step1, [{ pageIndex: 0, dwellMs: 2000, at: b }], NOW)
    expect(step2.pages['0']).toEqual({
      dwellMs: 3000,
      visits: 2,
      firstSeenAt: new Date(a).toISOString(),
      lastSeenAt: new Date(b).toISOString(),
    })
  })

  it('keeps the earliest firstSeenAt and latest lastSeenAt regardless of event order', () => {
    const later = Date.parse('2026-07-13T11:30:00.000Z')
    const earlier = Date.parse('2026-07-13T09:00:00.000Z')
    const step1 = applyEvents(emptyFile(), [{ pageIndex: 1, dwellMs: 100, at: later }], NOW)
    // An out-of-order (earlier) event must move firstSeenAt back but not lastSeenAt.
    const step2 = applyEvents(step1, [{ pageIndex: 1, dwellMs: 100, at: earlier }], NOW)
    expect(step2.pages['1'].firstSeenAt).toBe(new Date(earlier).toISOString())
    expect(step2.pages['1'].lastSeenAt).toBe(new Date(later).toISOString())
    expect(step2.pages['1'].visits).toBe(2)
  })

  it('tracks pages independently and folds multiple events in one call', () => {
    const at = Date.parse('2026-07-13T11:00:00.000Z')
    const next = applyEvents(
      emptyFile(),
      [
        { pageIndex: 0, dwellMs: 500, at },
        { pageIndex: 1, dwellMs: 700, at },
        { pageIndex: 0, dwellMs: 300, at: at + 1000 },
      ],
      NOW,
    )
    expect(next.pages['0']).toMatchObject({ dwellMs: 800, visits: 2 })
    expect(next.pages['1']).toMatchObject({ dwellMs: 700, visits: 1 })
  })

  it('never touches finished / finishedAt', () => {
    const finishedFile: ReadingStateFile = {
      ...emptyFile(),
      finished: true,
      finishedAt: new Date(T0).toISOString(),
    }
    const next = applyEvents(finishedFile, [{ pageIndex: 0, dwellMs: 10, at: NOW }], NOW)
    expect(next.finished).toBe(true)
    expect(next.finishedAt).toBe(new Date(T0).toISOString())
  })

  it('does not mutate the input file', () => {
    const file = emptyFile()
    applyEvents(file, [{ pageIndex: 0, dwellMs: 10, at: NOW }], NOW)
    expect(file.pages).toEqual({})
  })
})

describe('readingRecordRequestSchema (frozen wire bounds §2)', () => {
  const ok = { pageIndex: 0, dwellMs: 1, at: 1_700_000_000_000 }

  it('accepts a valid single-event request', () => {
    expect(readingRecordRequestSchema.parse({ documentId: 1, events: [ok] }).events).toHaveLength(1)
  })

  it('rejects an empty events array', () => {
    expect(() => readingRecordRequestSchema.parse({ documentId: 1, events: [] })).toThrow()
  })

  it('rejects more than 500 events', () => {
    const events = Array.from({ length: 501 }, () => ok)
    expect(() => readingRecordRequestSchema.parse({ documentId: 1, events })).toThrow()
  })

  it('rejects a negative pageIndex', () => {
    expect(() =>
      readingRecordRequestSchema.parse({ documentId: 1, events: [{ ...ok, pageIndex: -1 }] }),
    ).toThrow()
  })

  it('rejects dwellMs below 1 or above 600_000', () => {
    expect(() =>
      readingRecordRequestSchema.parse({ documentId: 1, events: [{ ...ok, dwellMs: 0 }] }),
    ).toThrow()
    expect(() =>
      readingRecordRequestSchema.parse({ documentId: 1, events: [{ ...ok, dwellMs: 600_001 }] }),
    ).toThrow()
  })

  it('rejects a non-positive documentId', () => {
    expect(() => readingRecordRequestSchema.parse({ documentId: 0, events: [ok] })).toThrow()
  })
})
