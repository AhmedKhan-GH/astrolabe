import type {
  ContentBlock,
  SessionConfigOption,
  SessionConfigSelectOptions,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type { AcpConfigOption, AcpToolContentItem, AcpToolEvent, AcpUpdateEvent } from '../../shared/db-ipc'

/**
 * PURE mapping from the SDK's `session/update` notification variants into the renderer contract
 * (`AcpUpdateEvent`, src/shared/db-ipc.ts — the frozen wire contract). Side-effect-free and
 * exhaustively unit-tested: the parallel renderer agent codes against the OUTPUT shape exactly.
 * `turn-end` and `error` are NOT update variants; the manager synthesizes those from the prompt
 * lifecycle. Everything the adapter emits is surfaced: config-option / usage / session-info now map
 * to their own events; only genuinely-unrenderable variants (the user echo, plan_update/plan_removed,
 * any unknown future variant) return null.
 */

/** Text-bearing surface of a content block (the LLM text, a resource_link's uri, or an embedded
 *  text resource's text). Non-text media (image/audio/binary) has no textual surface → ''. */
function blockText(block: ContentBlock): string {
  if (block.type === 'text') return block.text
  if (block.type === 'resource_link') return block.uri
  if (block.type === 'resource' && 'text' in block.resource) return block.resource.text
  return ''
}

/**
 * Harvest a library documentId from a tool call/result — the Layer 4→5 provenance seam. The index
 * MCP server embeds `documentId` in its JSON result text (and provenance uris look like
 * `astro://doc/<id>`), so we scan the raw output + content blocks for the first match. Best-effort
 * by design: a miss just means no hub link for that result.
 */
export function harvestDocumentId(tc: {
  content?: ToolCallContent[] | null
  rawOutput?: unknown
}): number | undefined {
  const haystacks: string[] = []
  if (tc.rawOutput != null) {
    haystacks.push(typeof tc.rawOutput === 'string' ? tc.rawOutput : JSON.stringify(tc.rawOutput))
  }
  for (const c of tc.content ?? []) {
    if (c.type === 'content') haystacks.push(blockText(c.content))
  }
  for (const h of haystacks) {
    const m = h.match(/"?documentId"?\s*[:=]\s*"?(\d+)/) ?? h.match(/astro:\/\/doc\/(\d+)/)
    if (m) return Number(m[1])
  }
  return undefined
}

/** Map the SDK's ToolCallContent[] into the frozen `AcpToolContentItem[]`. Text/resource_link/text
 *  resources become text items; diffs and terminals map directly. Non-text media is dropped (no
 *  renderable text surface). Returns undefined for an empty/all-dropped collection. */
function mapToolContent(content: ToolCallContent[] | null | undefined): AcpToolContentItem[] | undefined {
  if (!content) return undefined
  const out: AcpToolContentItem[] = []
  for (const c of content) {
    if (c.type === 'content') {
      const text = blockText(c.content)
      if (text) out.push({ type: 'text', text })
    } else if (c.type === 'diff') {
      out.push({ type: 'diff', path: c.path, oldText: c.oldText ?? null, newText: c.newText })
    } else if (c.type === 'terminal') {
      // The wire only exposes the terminal id (the client has no terminal capability in v2); surface
      // it so the renderer can at least name the embedded terminal.
      out.push({ type: 'terminal', text: c.terminalId })
    }
  }
  return out.length ? out : undefined
}

/** Map ToolCallLocation[] → the contract's `{path, line?}[]`, dropping null lines. */
function mapLocations(locations: ToolCallLocation[] | null | undefined): { path: string; line?: number }[] | undefined {
  if (!locations || locations.length === 0) return undefined
  return locations.map((l) => (l.line == null ? { path: l.path } : { path: l.path, line: l.line }))
}

/** The shell command an `execute` tool ran, harvested from its rawInput (`{command: "…"}`). */
function harvestCommand(rawInput: unknown): string | undefined {
  if (rawInput && typeof rawInput === 'object' && 'command' in rawInput) {
    const cmd = (rawInput as { command?: unknown }).command
    if (typeof cmd === 'string' && cmd.length > 0) return cmd
  }
  return undefined
}

/** Build the unified `tool` event from a tool_call or tool_call_update. Only fields the update
 *  actually carries are set — the renderer upserts by `toolCallId`, so a partial update leaves the
 *  rest untouched. */
function toToolEvent(sessionId: string, tc: ToolCall | ToolCallUpdate): AcpToolEvent {
  const event: AcpToolEvent = { sessionId, kind: 'tool', toolCallId: tc.toolCallId }
  if (tc.title != null) event.title = tc.title
  if (tc.kind != null) event.toolKind = tc.kind
  if (tc.status != null) event.status = tc.status
  const command = harvestCommand(tc.rawInput)
  if (command !== undefined) event.command = command
  const content = mapToolContent(tc.content)
  if (content !== undefined) event.content = content
  const locations = mapLocations(tc.locations)
  if (locations !== undefined) event.locations = locations
  if (tc.rawInput !== undefined) event.rawInput = tc.rawInput
  const documentId = harvestDocumentId(tc)
  if (documentId !== undefined) event.documentId = documentId
  return event
}

/** Flatten a select option's selectable values (a flat list OR groups) into the wire's `{id,name}[]`,
 *  mapping the SDK's value-id field (`value`) to `id`. Group structure is UX-only, so we flatten. */
function flattenSelectValues(options: SessionConfigSelectOptions): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  for (const el of options) {
    if ('options' in el) {
      for (const o of el.options) out.push({ id: o.value, name: o.name })
    } else {
      out.push({ id: el.value, name: el.name })
    }
  }
  return out
}

/** Map one SDK `SessionConfigOption` into the frozen `AcpConfigOption` (select carries flattened
 *  `values`; boolean omits them). Exported so the manager can map the initial options from
 *  session/new and the updated set from a `session/set_config_option` response. */
export function mapConfigOption(opt: SessionConfigOption): AcpConfigOption {
  const base = { id: opt.id, name: opt.name, ...(opt.description ? { description: opt.description } : {}) }
  if (opt.type === 'boolean') {
    return { ...base, type: 'boolean', currentValue: opt.currentValue }
  }
  return { ...base, type: 'select', currentValue: opt.currentValue, values: flattenSelectValues(opt.options) }
}

/** Map one update, or null when it carries nothing the transcript renders. */
export function mapSessionUpdate(sessionId: string, update: SessionUpdate): AcpUpdateEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = update.content.type === 'text' ? update.content.text : ''
      return text ? { sessionId, kind: 'chunk', text } : null
    }
    case 'agent_thought_chunk': {
      const text = update.content.type === 'text' ? update.content.text : ''
      return text ? { sessionId, kind: 'thought', text } : null
    }
    case 'tool_call':
      return toToolEvent(sessionId, update)
    case 'tool_call_update':
      return toToolEvent(sessionId, update)
    case 'plan':
      return {
        sessionId,
        kind: 'plan',
        entries: update.entries.map((e) => ({ content: e.content, priority: e.priority, status: e.status })),
      }
    case 'available_commands_update':
      return {
        sessionId,
        kind: 'commands',
        commands: update.availableCommands.map((c) =>
          c.description ? { name: c.name, description: c.description } : { name: c.name },
        ),
      }
    case 'current_mode_update':
      return { sessionId, kind: 'mode', currentModeId: update.currentModeId }
    case 'config_option_update':
      return { sessionId, kind: 'config', options: update.configOptions.map(mapConfigOption) }
    case 'usage_update':
      return {
        sessionId,
        kind: 'usage',
        used: update.used,
        size: update.size,
        // The SDK Cost is {amount, currency}; the wire keeps the numeric amount the UI renders.
        ...(update.cost != null ? { cost: update.cost.amount } : {}),
      }
    case 'session_info_update':
      // title is a partial field: present (incl. explicit null → clear) means "set"; absent means
      // "leave". updatedAt rides along the same way. The reducer keys off which fields are present.
      return {
        sessionId,
        kind: 'session-info',
        ...('title' in update ? { title: update.title } : {}),
        ...('updatedAt' in update ? { updatedAt: update.updatedAt } : {}),
      }
    default:
      // user_message_chunk (the echo), plan_update/plan_removed (unstable), and any unknown future
      // variant carry nothing the transcript renders.
      return null
  }
}
