import type { Connector } from './types'
import { zoteroConnector } from './zotero'
import { eagleConnector } from './eagle'

/**
 * Flat connector registry — the only wiring point (doc 10 §5). Obsidian joins in
 * runway step 8. Connectors must never import each other (enforced by
 * eslint-plugin-import-x zones).
 */
export const connectors: Connector[] = [zoteroConnector, eagleConnector]
