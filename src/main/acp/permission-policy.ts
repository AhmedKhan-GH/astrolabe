/**
 * Safe-reads permission policy (Track 0 / docs/06 — serves [[agent-isolation-decision]]).
 *
 * The agent keeps its full toolset by design; the permission cards are the safety gate. But if the
 * user must approve EVERY tool call — including read-only library searches — permission fatigue sets
 * in and they reflexively click "allow", which hollows out the one protection. So we auto-approve
 * tool calls that are provably non-mutating and keep prompting on everything that can change state.
 *
 * Conservative by construction: we auto-approve ONLY when confidently read-only (a non-mutating
 * ToolKind, or one of our own read-only MCP index tools by name). Anything ambiguous (`edit`,
 * `delete`, `move`, `execute`, `switch_mode`, `other`, or an unrecognized shape) still prompts.
 * The tool card still renders what ran, so auto-approval never hides an action — it only skips the
 * click.
 */

/** ACP ToolKinds that cannot mutate state — safe to run without a prompt. */
const SAFE_KINDS = new Set(['read', 'search', 'fetch'])

/** ToolKinds that CAN change state — never auto-approved, even if a name/title coincidentally
 *  matches a safe tool (a Bash command mentioning "search_library" must still prompt). */
const MUTATING_KINDS = new Set(['edit', 'delete', 'move', 'execute'])

/** Our MCP index tools are all read-only; safe to auto-approve by name even if the kind is `other`. */
const SAFE_MCP_TOOLS = [
  'search_library',
  'browse_library',
  'get_document',
  'get_links',
  'get_annotations',
  'get_page_annotations',
  'list_sources',
  'list_overview',
]

/**
 * True when a tool call is provably read-only and may be auto-approved. `kind` is the primary,
 * principled signal; the MCP-name match is a fallback for our own tools when the adapter reports
 * them as `other`. Title match only (NOT rawInput) — a Bash command mentioning a tool name must
 * never be mistaken for that tool.
 */
export function isAutoApprovableTool(tool: { kind?: string | null; title?: string | null }): boolean {
  if (tool.kind && MUTATING_KINDS.has(tool.kind)) return false // a mutation is never rescued by name
  if (tool.kind && SAFE_KINDS.has(tool.kind)) return true
  // kind is other / switch_mode / absent → allow ONLY our known read-only MCP tools, by name.
  const title = (tool.title ?? '').toLowerCase()
  return title.length > 0 && SAFE_MCP_TOOLS.some((t) => title.includes(t))
}
