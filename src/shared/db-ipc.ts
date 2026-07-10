import { z } from 'zod'

/**
 * Wire contract for the generic typed table-client (salvage-manifest pattern,
 * runway spec step 2). Recorded ceiling (docs/01 audit): FTS, joins, and
 * transactions never go through this channel — they get named channels
 * (`index:search`, `index:rebuild`, steps 3/6).
 */
export const DB_CHANNEL = 'db:query'

const row = z.record(z.string(), z.unknown())
const id = z.number().int().positive()

export const dbRequestSchema = z.discriminatedUnion('op', [
  z.object({ table: z.string(), op: z.literal('getAll') }),
  z.object({ table: z.string(), op: z.literal('getById'), id }),
  z.object({ table: z.string(), op: z.literal('create'), values: row }),
  z.object({ table: z.string(), op: z.literal('update'), id, values: row }),
  z.object({ table: z.string(), op: z.literal('delete'), id }),
])
export type DbRequest = z.infer<typeof dbRequestSchema>
