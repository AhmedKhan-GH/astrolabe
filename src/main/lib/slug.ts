/**
 * Shared slug derivation (extracted from views.ts so saved views and virtual collections
 * derive their file identity the same way). Slug = kebab-cased name: lowercase, every run of
 * non-`[a-z0-9]` collapsed to a single dash, leading/trailing dashes trimmed. The `fallback`
 * guards the empty result (all-punctuation or non-ascii names) so we never write a dotfile-ish
 * `.json` with no basename — callers pass a domain default (`view`, `collection`).
 */
export function slugify(name: string, fallback = 'item'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}
