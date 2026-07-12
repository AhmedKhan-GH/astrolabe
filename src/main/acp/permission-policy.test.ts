import { describe, it, expect } from 'vitest'
import { isAutoApprovableTool } from './permission-policy'

describe('isAutoApprovableTool — safe-reads allowlist', () => {
  it('auto-approves non-mutating kinds', () => {
    for (const kind of ['read', 'search', 'fetch']) {
      expect(isAutoApprovableTool({ kind, title: 'anything' })).toBe(true)
    }
  })

  it('always prompts for mutating / ambiguous kinds', () => {
    for (const kind of ['edit', 'delete', 'move', 'execute', 'switch_mode', 'other']) {
      expect(isAutoApprovableTool({ kind, title: 'anything' })).toBe(false)
    }
  })

  it('auto-approves our read-only MCP tools by name even when the kind is other/absent', () => {
    expect(isAutoApprovableTool({ kind: 'other', title: 'search_library' })).toBe(true)
    expect(isAutoApprovableTool({ kind: null, title: 'mcp: get_document(42)' })).toBe(true)
    expect(isAutoApprovableTool({ title: 'list_overview' })).toBe(true)
  })

  it('does NOT auto-approve an unknown tool with no safe signal', () => {
    expect(isAutoApprovableTool({ kind: 'other', title: 'run_migration' })).toBe(false)
    expect(isAutoApprovableTool({ title: '' })).toBe(false)
    expect(isAutoApprovableTool({})).toBe(false)
  })

  it('a mutating kind is never rescued by a name coincidence (kind is definitive for mutations)', () => {
    // An execute tool whose command text happens to mention a tool name still prompts, because we
    // match kind first and only fall back to the title for non-kind-safe calls — and execute is a
    // mutating kind, so the name path is never a false rescue here.
    expect(isAutoApprovableTool({ kind: 'execute', title: 'bash: grep search_library src' })).toBe(false)
  })
})
