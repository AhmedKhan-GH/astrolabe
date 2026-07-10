import type { JSX } from 'react'

/** FTS snippets arrive with ⟪term⟫ markers (src/main/index/queries) — render as <mark>. */
export function renderSnippet(snippet: string): JSX.Element[] {
  return snippet
    .split(/⟪|⟫/)
    .map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))
}
