import { ensureWorkspace } from '../src/main/lib/workspace'
import { openDb } from '../src/main/db'
import { createSyncApi } from '../src/main/index/sync'
import { createIndexQueries } from '../src/main/index/queries'
import { connectors } from '../src/main/connectors/registry'

/**
 * Dev utility: run a real sync of every registered connector into the REAL
 * workspace index, then a probe search. Run via:
 *   pnpm sync:live [search-term]
 * (Executes under Electron-as-node so the electron-ABI sqlite binary loads.)
 */
const term = process.argv[2] ?? 'precision'
const ws = ensureWorkspace()
const handle = openDb(ws.dbPath)
const sync = createSyncApi(handle.db, connectors)

const reports = await sync.syncAll()
console.log('--- sync reports ---')
for (const r of reports) {
  console.log(
    `${r.sourceKey}: ok=${r.ok} available=${r.available}` +
      (r.ok ? ` documents=${r.documentsUpserted} annotations=${r.annotationsUpserted}` : '') +
      (r.error ? ` error=${r.error}` : ''),
  )
}

const queries = createIndexQueries(handle.db)
const hits = queries.search({ q: term, limit: 5 })
console.log(`--- search "${term}" → ${hits.length} hits ---`)
for (const h of hits) {
  console.log(`• [${h.kind}] ${h.title}`)
  console.log(`  ${h.snippet.replace(/\n/g, ' ').slice(0, 120)}`)
  console.log(`  sources: ${h.instances.map((i) => `${i.sourceKey} → ${i.uri}`).join(' | ')}`)
}
handle.close()
