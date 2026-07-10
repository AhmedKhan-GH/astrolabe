import type { Connector } from './types'
import { zoteroConnector } from './zotero'
import { eagleConnector } from './eagle'
import { obsidianConnector } from './obsidian'

/**
 * Flat connector registry — the only wiring point (doc 10 §5). Connectors must
 * never import each other (enforced by eslint-plugin-import-x zones).
 */
export const connectors: Connector[] = [zoteroConnector, eagleConnector, obsidianConnector]
