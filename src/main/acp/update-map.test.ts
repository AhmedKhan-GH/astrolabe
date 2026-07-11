import { describe, it, expect } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { mapSessionUpdate, harvestDocumentId } from './update-map'

/**
 * Pure mapping unit tests (spec §"Frozen wire contract"): SDK session/update variants →
 * AcpUpdateEvent. These pin the exact shape the parallel renderer agent codes against. Exhaustive:
 * every mapped variant + every ToolCallContent type + unknown variant → null.
 */

describe('mapSessionUpdate — chunk / thought', () => {
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

  it('maps an agent thought chunk to a thought event', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Let me reason about this' },
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'thought',
      text: 'Let me reason about this',
    })
  })

  it('drops an empty thought chunk', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: '' },
    }
    expect(mapSessionUpdate('s1', u)).toBeNull()
  })

  it('ignores the user message echo', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'my prompt' },
    }
    expect(mapSessionUpdate('s1', u)).toBeNull()
  })
})

describe('mapSessionUpdate — tool', () => {
  it('maps a tool_call to a unified tool event with id/title/kind/status', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'search_library',
      kind: 'search',
      status: 'in_progress',
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't1',
      title: 'search_library',
      toolKind: 'search',
      status: 'in_progress',
    })
  })

  it('harvests the shell command from an execute tool rawInput', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 't2',
      title: 'Run tests',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'pnpm test', description: 'run the suite' },
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't2',
      title: 'Run tests',
      toolKind: 'execute',
      status: 'pending',
      command: 'pnpm test',
      rawInput: { command: 'pnpm test', description: 'run the suite' },
    })
  })

  it('maps text content and harvests a documentId from it', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      title: 'get_document',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '{"documentId": 42, "title": "x"}' } }],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't1',
      title: 'get_document',
      status: 'completed',
      content: [{ type: 'text', text: '{"documentId": 42, "title": "x"}' }],
      documentId: 42,
    })
  })

  it('maps a resource_link content block to a text item using its uri', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      content: [{ type: 'content', content: { type: 'resource_link', name: 'doc', uri: 'astro://doc/9' } }],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't1',
      content: [{ type: 'text', text: 'astro://doc/9' }],
      documentId: 9,
    })
  })

  it('maps a diff content item (oldText null for a new file)', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'diff', path: '/ws/new.ts', oldText: null, newText: 'export const x = 1\n' }],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'diff', path: '/ws/new.ts', oldText: null, newText: 'export const x = 1\n' }],
    })
  })

  it('maps a diff content item with an existing oldText', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      content: [{ type: 'diff', path: '/ws/a.ts', oldText: 'a', newText: 'b' }],
    }
    expect(mapSessionUpdate('s1', u)).toMatchObject({
      content: [{ type: 'diff', path: '/ws/a.ts', oldText: 'a', newText: 'b' }],
    })
  })

  it('maps a terminal content item using its terminalId as text', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      content: [{ type: 'terminal', terminalId: 'term-7' }],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't1',
      content: [{ type: 'terminal', text: 'term-7' }],
    })
  })

  it('maps locations, dropping a null line', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      locations: [
        { path: '/ws/a.ts', line: 12 },
        { path: '/ws/b.ts', line: null },
      ],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't1',
      locations: [{ path: '/ws/a.ts', line: 12 }, { path: '/ws/b.ts' }],
    })
  })

  it('a minimal tool_call_update carries only id + changed fields', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'in_progress',
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'tool',
      toolCallId: 't1',
      status: 'in_progress',
    })
  })
})

describe('mapSessionUpdate — plan / commands / mode', () => {
  it('maps a plan to a plan event with entries', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Search the library', priority: 'high', status: 'in_progress' },
        { content: 'Summarize findings', priority: 'low', status: 'pending' },
      ],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'plan',
      entries: [
        { content: 'Search the library', priority: 'high', status: 'in_progress' },
        { content: 'Summarize findings', priority: 'low', status: 'pending' },
      ],
    })
  })

  it('maps an empty plan (a cleared plan) to a plan event with no entries', () => {
    expect(mapSessionUpdate('s1', { sessionUpdate: 'plan', entries: [] })).toEqual({
      sessionId: 's1',
      kind: 'plan',
      entries: [],
    })
  })

  it('maps available_commands_update to a commands event', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'create_plan', description: 'Draft a plan' },
        { name: 'research', description: 'Research the codebase' },
      ],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'commands',
      commands: [
        { name: 'create_plan', description: 'Draft a plan' },
        { name: 'research', description: 'Research the codebase' },
      ],
    })
  })

  it('maps current_mode_update to a mode event (no availableModes in a notification)', () => {
    const u: SessionUpdate = { sessionUpdate: 'current_mode_update', currentModeId: 'plan' }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'mode',
      currentModeId: 'plan',
    })
  })
})

describe('mapSessionUpdate — config / usage / session-info', () => {
  it('maps a config_option_update carrying a select option (flattening its option values)', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          description: 'The model to use',
          type: 'select',
          currentValue: 'sonnet',
          options: [
            { value: 'sonnet', name: 'Sonnet' },
            { value: 'opus', name: 'Opus' },
          ],
        },
      ],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'config',
      options: [
        {
          id: 'model',
          name: 'Model',
          description: 'The model to use',
          type: 'select',
          currentValue: 'sonnet',
          values: [
            { id: 'sonnet', name: 'Sonnet' },
            { id: 'opus', name: 'Opus' },
          ],
        },
      ],
    })
  })

  it('flattens a select whose values are grouped', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          id: 'effort',
          name: 'Reasoning Effort',
          type: 'select',
          currentValue: 'high',
          options: [
            { group: 'g1', name: 'Fast', options: [{ value: 'low', name: 'Low' }] },
            { group: 'g2', name: 'Slow', options: [{ value: 'high', name: 'High' }] },
          ],
        },
      ],
    }
    expect(mapSessionUpdate('s1', u)).toMatchObject({
      kind: 'config',
      options: [
        {
          id: 'effort',
          type: 'select',
          currentValue: 'high',
          values: [
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
          ],
        },
      ],
    })
  })

  it('maps a boolean config option (no values list)', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'config_option_update',
      configOptions: [{ id: 'fast', name: 'Fast Mode', type: 'boolean', currentValue: true }],
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'config',
      options: [{ id: 'fast', name: 'Fast Mode', type: 'boolean', currentValue: true }],
    })
  })

  it('maps a usage_update, flattening a structured Cost to its numeric amount', () => {
    const u: SessionUpdate = {
      sessionUpdate: 'usage_update',
      used: 12_300,
      size: 200_000,
      cost: { amount: 0.42, currency: 'USD' },
    }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'usage',
      used: 12_300,
      size: 200_000,
      cost: 0.42,
    })
  })

  it('maps a usage_update without a cost', () => {
    const u: SessionUpdate = { sessionUpdate: 'usage_update', used: 5, size: 100 }
    expect(mapSessionUpdate('s1', u)).toEqual({ sessionId: 's1', kind: 'usage', used: 5, size: 100 })
  })

  it('maps a session_info_update title', () => {
    const u: SessionUpdate = { sessionUpdate: 'session_info_update', title: 'Refactoring the reducer' }
    expect(mapSessionUpdate('s1', u)).toEqual({
      sessionId: 's1',
      kind: 'session-info',
      title: 'Refactoring the reducer',
    })
  })

  it('maps a session_info_update that clears the title (title: null)', () => {
    const u: SessionUpdate = { sessionUpdate: 'session_info_update', title: null }
    expect(mapSessionUpdate('s1', u)).toEqual({ sessionId: 's1', kind: 'session-info', title: null })
  })
})

describe('mapSessionUpdate — unknown / non-rendered variants → null', () => {
  it('returns null for plan_removed (unstable) and the user echo', () => {
    expect(mapSessionUpdate('s1', { sessionUpdate: 'plan_removed', planId: 'p1' } as unknown as SessionUpdate)).toBeNull()
    expect(
      mapSessionUpdate('s1', { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo' } }),
    ).toBeNull()
  })

  it('returns null for a genuinely unknown variant', () => {
    expect(mapSessionUpdate('s1', { sessionUpdate: 'brand_new_thing' } as unknown as SessionUpdate)).toBeNull()
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
