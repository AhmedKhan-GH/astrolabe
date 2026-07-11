import type { ContentBlock, SessionUpdate, ToolCall, ToolCallContent, ToolCallUpdate } from '@agentclientprotocol/sdk'
import type { AcpUpdateEvent } from '../../shared/db-ipc'

/**
 * PURE mapping from the SDK's `session/update` notification variants into the renderer contract
 * (`AcpUpdateEvent`, src/shared/db-ipc.ts). Kept side-effect-free and unit-tested — the parallel
 * renderer agent codes against the OUTPUT shape exactly. `turn-end` and `error` are NOT update
 * variants; the manager synthesizes those from the prompt lifecycle, so this returns null for
 * anything that is not a chunk / tool-call / tool-result.
 */

/** Text-bearing surface of a content block (the LLM text, or a resource_link's uri). */
function blockText(block: ContentBlock): string {
  if (block.type === 'text') return block.text
  if (block.type === 'resource_link') return block.uri
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

function fromToolCall(sessionId: string, tc: ToolCall): AcpUpdateEvent {
  const event: AcpUpdateEvent = { sessionId, kind: 'tool-call', toolName: tc.title }
  if (tc.status) event.toolStatus = tc.status
  const documentId = harvestDocumentId(tc)
  if (documentId !== undefined) event.documentId = documentId
  return event
}

function fromToolCallUpdate(sessionId: string, tc: ToolCallUpdate): AcpUpdateEvent {
  // A terminal status is a RESULT; anything earlier is still an in-flight tool-call.
  const done = tc.status === 'completed' || tc.status === 'failed'
  const event: AcpUpdateEvent = {
    sessionId,
    kind: done ? 'tool-result' : 'tool-call',
    ...(tc.title ? { toolName: tc.title } : {}),
  }
  if (tc.status) event.toolStatus = tc.status
  const documentId = harvestDocumentId(tc)
  if (documentId !== undefined) event.documentId = documentId
  return event
}

/** Map one update, or null when it carries nothing the transcript renders (thoughts, plans, mode
 *  changes, usage, the user echo, …). */
export function mapSessionUpdate(sessionId: string, update: SessionUpdate): AcpUpdateEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = update.content.type === 'text' ? update.content.text : ''
      return text ? { sessionId, kind: 'chunk', text } : null
    }
    case 'tool_call':
      return fromToolCall(sessionId, update)
    case 'tool_call_update':
      return fromToolCallUpdate(sessionId, update)
    default:
      return null
  }
}
