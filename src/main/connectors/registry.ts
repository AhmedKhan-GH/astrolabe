import type { Connector } from './types'

/**
 * Flat connector registry — the only wiring point (doc 10 §5). Zotero registers
 * in runway step 4, Eagle in step 5, Obsidian in step 8. Connectors must never
 * import each other (enforced by eslint-plugin-import-x zones).
 */
export const connectors: Connector[] = []
