import { describe, it, expect } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { mapSessionUpdate, harvestDocumentId } from './update-map'

/**
 * Pure mapping unit tests (spec §Renderer contract): SDK session/update variants → AcpUpdateEvent.
 * These pin the exact shape the parallel renderer agent codes against.
 */

describe('mapSessionUpdate', () => {
  it('maps an agent message chunk to a chunk event with text', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello from the library' },
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'chunk',
      text: 'Hello from the library',
    })
  })

  it('drops an empty / non-text chunk (nothing to render)', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'x', mimeType: 'image/png' },
    }
    expect(mapSessionUpdate('s1', u)).toBeNull()
  })

  it('maps a tool_call to a tool-call event with name + status', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'search_library',
      status: 'in_progress',
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool-call',
      toolName: 'search_library',
      toolStatus: 'in_progress',
    })
  })

  it('maps a completed tool_call_update to a tool-result, harvesting the documentId', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      title: 'get_document',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '{"documentId": 42, "title": "x"}' } }],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool-result',
      toolName: 'get_document',
      toolStatus: 'completed',
      documentId: 42,
    })
  })

  it('an in-flight tool_call_update stays a tool-call (not a result)', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'in_progress',
    }
    expect(mapSessionUpdate('s1', u)).toMatchObject({ kind: 'tool-call', toolStatus: 'in_progress' })
  })

  it('ignores updates the transcript does not render (thoughts, plans)', () => {
    expect(
      mapSessionUpdate('s1', {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking' },
      }),
    ).toBeNull()
    expect(mapSessionUpdate('s1', { sessionUpdate: 'plan', entries: [] })).toBeNull()
  })
})

describe('harvestDocumentId', () => {
  it('finds documentId in JSON result text', () => {
    expect(
      harvestDocumentId({ content: [{ type: 'content', content: { type: 'text', text: 'x "documentId": 7 y' } }] }),
    ).toBe(7)
  })

  it('finds documentId from an astro://doc provenance uri in a resource link', () => {
    expect(
      harvestDocumentId({
        content: [{ type: 'content', content: { type: 'resource_link', name: 'doc', uri: 'astro://doc/123' } }],
      }),
    ).toBe(123)
  })

  it('reads rawOutput objects too', () => {
    expect(harvestDocumentId({ rawOutput: { hits: [{ documentId: 9 }] } })).toBe(9)
  })

  it('returns undefined when there is nothing to harvest', () => {
    expect(harvestDocumentId({ content: [{ type: 'content', content: { type: 'text', text: 'no ids here' } }] })).toBeUndefined()
    expect(harvestDocumentId({})).toBeUndefined()
  })
})
