import { describe, it, expect } from 'vitest'
import { compressToBase64 } from 'lz-string'
import { isExcalidrawNote, parseExcalidrawScene } from './parse'

// A minimal scene — a couple of rectangles + one text element — is enough to exercise
// the parser end to end. We synthesize fixtures rather than copying real vault notes.
const scene = {
  type: 'excalidraw',
  version: 2,
  source: 'test',
  elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 },
    { id: 'b', type: 'rectangle', x: 40, y: 40, width: 80, height: 50 },
    { id: 't', type: 'text', x: 10, y: 10, text: 'hi' },
  ],
  appState: { viewBackgroundColor: '#faf0e6', gridSize: null },
  files: { 'file-1': { mimeType: 'image/png', dataURL: 'data:...' } },
}

/** The vault's real shape: frontmatter → `# Excalidraw Data` → `## Text Elements` → `## Drawing`. */
const jsonNote = (drawing: string, lang = 'json'): string =>
  [
    '---',
    'excalidraw-plugin: parsed',
    'tags: [excalidraw]',
    '---',
    '',
    '# Excalidraw Data',
    '## Text Elements',
    'hi',
    '',
    '## Drawing',
    '```' + lang,
    drawing,
    '```',
    '%%',
  ].join('\n')

describe('isExcalidrawNote', () => {
  it('is true when the frontmatter block carries an excalidraw-plugin key', () => {
    expect(isExcalidrawNote(jsonNote(JSON.stringify(scene)))).toBe(true)
  })

  it('accepts the raw variant value too (line-anchored key, any value)', () => {
    const md = '---\nexcalidraw-plugin: raw\nexcalidraw-open-md: true\n---\n\n# Excalidraw Data\n'
    expect(isExcalidrawNote(md)).toBe(true)
  })

  it('is false for an ordinary note with no frontmatter', () => {
    expect(isExcalidrawNote('# Just a note\n\nsome body')).toBe(false)
  })

  it('is false when excalidraw-plugin only appears in the body prose, not frontmatter', () => {
    const md = '---\ntags: [drawing]\n---\n\nI configured the excalidraw-plugin: true setting today.'
    expect(isExcalidrawNote(md)).toBe(false)
  })

  it('is false when excalidraw-plugin appears before any frontmatter fence', () => {
    expect(isExcalidrawNote('excalidraw-plugin: parsed\n\nnot in a fence')).toBe(false)
  })
})

describe('parseExcalidrawScene', () => {
  it('parses the json variant into elements/appState/files', () => {
    const out = parseExcalidrawScene(jsonNote(JSON.stringify(scene)))
    expect(out.elements).toHaveLength(3)
    expect(out.appState?.viewBackgroundColor).toBe('#faf0e6')
    expect(Object.keys(out.files ?? {})).toContain('file-1')
  })

  it('parses the compressed-json variant (payload built with lz-string)', () => {
    const payload = compressToBase64(JSON.stringify(scene))
    const out = parseExcalidrawScene(jsonNote(payload, 'compressed-json'))
    expect(out.elements).toHaveLength(3)
    expect(out.appState?.viewBackgroundColor).toBe('#faf0e6')
  })

  it('joins a multiline compressed-json payload before decompressing', () => {
    const payload = compressToBase64(JSON.stringify(scene))
    // The obsidian plugin wraps the base64 over several lines; the parser must rejoin.
    const wrapped = payload.replace(/(.{20})/g, '$1\n')
    const out = parseExcalidrawScene(jsonNote(wrapped, 'compressed-json'))
    expect(out.elements).toHaveLength(3)
  })

  it('handles the bare {elements,...} scene shape (no type:excalidraw wrapper)', () => {
    const bare = { elements: scene.elements, appState: { viewBackgroundColor: '#fff' } }
    const out = parseExcalidrawScene(jsonNote(JSON.stringify(bare)))
    expect(out.elements).toHaveLength(3)
    expect(out.appState?.viewBackgroundColor).toBe('#fff')
  })

  it('parses a drawing under an H1 "# Drawing" heading variant too', () => {
    const md = '---\nexcalidraw-plugin: parsed\n---\n\n# Drawing\n```json\n' + JSON.stringify(scene) + '\n```\n'
    expect(parseExcalidrawScene(md).elements).toHaveLength(3)
  })

  it('throws when there is no drawing block', () => {
    const md = '---\nexcalidraw-plugin: parsed\n---\n\n# Excalidraw Data\n## Text Elements\nhi\n'
    expect(() => parseExcalidrawScene(md)).toThrow(/no.*drawing/i)
  })

  it('throws on a corrupt compressed-json payload', () => {
    const md = jsonNote('!!!not-valid-base64!!!', 'compressed-json')
    expect(() => parseExcalidrawScene(md)).toThrow(/decompress/i)
  })

  it('throws on invalid JSON in a json block', () => {
    const md = jsonNote('{ not: valid json,, }')
    expect(() => parseExcalidrawScene(md)).toThrow(/JSON|parse/i)
  })
})
