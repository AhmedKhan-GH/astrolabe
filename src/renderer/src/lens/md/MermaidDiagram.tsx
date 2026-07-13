import { useEffect, useId, useState } from 'react'

/**
 * Lazy mermaid renderer for ```mermaid fences in NoteView. The library (~1.5 MB) is
 * dynamically imported ONLY when a note actually contains a diagram, and only once per
 * session. Render failures fall back to the raw source plus the parser message — a broken
 * diagram must never take the note down.
 */
let mermaidModule: Promise<typeof import('mermaid')> | null = null
const loadMermaid = () => (mermaidModule ??= import('mermaid'))

type RenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string }

export function MermaidDiagram({ source }: { source: string }) {
  const [state, setState] = useState<RenderState>({ status: 'loading' })
  // mermaid.render needs a DOM-unique, CSS-safe id for its scratch element.
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const mermaid = (await loadMermaid()).default
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
        const { svg } = await mermaid.render(`mmd-${id}`, source)
        if (!cancelled) setState({ status: 'ready', svg })
      } catch (e) {
        if (!cancelled)
          setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, id])

  if (state.status === 'error') {
    return (
      <div className="my-2 rounded border border-zinc-800 bg-zinc-900 p-3">
        <p className="mb-2 text-xs text-amber-400">diagram failed to render: {state.message}</p>
        <pre className="overflow-x-auto text-xs text-zinc-400">{source}</pre>
      </div>
    )
  }
  if (state.status === 'ready') {
    return (
      <div
        role="img"
        aria-label="mermaid diagram"
        className="my-2 overflow-x-auto [&_svg]:mx-auto"
        // mermaid sanitizes its own SVG output under securityLevel: 'strict'.
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }
  return (
    <div role="img" aria-label="mermaid diagram" className="my-2">
      <p className="text-xs text-zinc-600">rendering diagram…</p>
    </div>
  )
}
