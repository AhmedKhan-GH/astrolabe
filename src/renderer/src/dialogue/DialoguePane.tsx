import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AcpAgent, AcpApi, AcpPermissionRequest, AcpUpdate } from './types'
import {
  applyUpdate,
  appendUserPrompt,
  emptyTranscript,
  type Transcript,
} from './transcript'

/**
 * The ACP surface is added preload-side by the parallel main-half work; until that lands this is
 * the one expected `typecheck:web` residual (Property 'acp' does not exist on AstrolabeApi). The
 * accessor keeps the rest of the pane fully typed against AcpApi.
 */
const acpApi = (): AcpApi => window.astrolabe.acp

type Action =
  | { type: 'reset'; sessionId: string }
  | { type: 'update'; u: AcpUpdate }
  | { type: 'user'; text: string }

function reduce(state: Transcript, a: Action): Transcript {
  switch (a.type) {
    case 'reset':
      return emptyTranscript(a.sessionId)
    case 'update':
      return applyUpdate(state, a.u)
    case 'user':
      return appendUserPrompt(state, a.text)
  }
}

/**
 * Dialogue pane (ACP client v1) — a self-contained LEFT column that owns one live session with
 * the picked agent. Agent text streams in as markdown (reusing NoteView's zinc prose), tool calls
 * collapse to name+status chips (linking to the Document Hub when a result carries a documentId),
 * and permission requests surface as inline allow/deny cards (default: neither, the user chooses).
 * All IPC flows through `window.astrolabe.acp`; the transcript itself is the pure reducer.
 */
export function DialoguePane({
  onOpenUri,
  onOpenHub,
  onClose,
}: {
  onOpenUri: (uri: string) => void
  onOpenHub: (documentId: number) => void
  /** Optional collapse affordance in the pane header (the Lens toggle owns open/close). */
  onClose?: () => void
}) {
  const [agents, setAgents] = useState<AcpAgent[] | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [perms, setPerms] = useState<AcpPermissionRequest[]>([])
  const [transcript, dispatch] = useReducer(reduce, emptyTranscript(''))
  const sessionRef = useRef<string | null>(null)

  // Load the agent registry and subscribe to the update / permission streams once, up front, so
  // no notification is missed between session-start and the first render.
  useEffect(() => {
    const acp = acpApi()
    void acp.agents().then(setAgents)
    const offUpdate = acp.onUpdate((u) => dispatch({ type: 'update', u }))
    const offPerm = acp.onPermissionRequest((r) => {
      if (sessionRef.current && r.sessionId !== sessionRef.current) return
      setPerms((p) => [...p, r])
    })
    return () => {
      offUpdate()
      offPerm()
    }
  }, [])

  // Resolved picker selection: the explicit pick, else the first installed agent (derived, not an
  // effect, so there's no default-setting render cascade).
  const selected =
    (selectedKey != null ? agents?.find((a) => a.key === selectedKey) : null) ??
    agents?.find((a) => a.available) ??
    null

  // A ready agent (installed + logged in) gets a fresh session; switching agents restarts it.
  // Keyed on the resolved key so the effect only refires on a real agent change.
  const readyKey = selected && selected.available && selected.authenticated ? selected.key : null
  useEffect(() => {
    if (!readyKey) return
    let cancelled = false
    void acpApi()
      .newSession(readyKey)
      .then((res) => {
        if (cancelled) return
        if ('sessionId' in res) {
          sessionRef.current = res.sessionId
          setSessionId(res.sessionId)
          setSessionError(null)
          dispatch({ type: 'reset', sessionId: res.sessionId })
        } else {
          sessionRef.current = null
          setSessionId(null)
          setSessionError(res.error)
        }
      })
    return () => {
      cancelled = true
    }
  }, [readyKey])

  const send = (): void => {
    const text = draft.trim()
    if (!text || !sessionId || transcript.streaming) return
    dispatch({ type: 'user', text })
    setDraft('')
    void acpApi().prompt(sessionId, text)
  }

  const respond = (requestId: string, allow: boolean): void => {
    void acpApi().respondPermission(requestId, allow)
    setPerms((p) => p.filter((x) => x.requestId !== requestId))
  }

  // Agent prose — mirrors NoteView's zinc prose classes; the `a` renderer intercepts every href
  // (zotero:// / eagle:// / obsidian:// provenance and plain links) into the host's openUri.
  const md = useMemo<Components>(
    () => ({
      h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold text-zinc-100">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold text-zinc-100">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-zinc-200">{children}</h3>,
      p: ({ children }) => <p className="my-1.5 leading-relaxed text-zinc-300">{children}</p>,
      ul: ({ children }) => <ul className="my-1.5 list-disc pl-5 text-zinc-300">{children}</ul>,
      ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5 text-zinc-300">{children}</ol>,
      li: ({ children }) => <li className="my-0.5">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-1.5 border-l-2 border-zinc-700 pl-3 text-zinc-400">{children}</blockquote>
      ),
      strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      code: ({ children }) => (
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-[0.85em] text-zinc-200">{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="my-1.5 overflow-x-auto rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-200">
          {children}
        </pre>
      ),
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault()
            if (href) onOpenUri(href)
          }}
          className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
        >
          {children}
        </a>
      ),
    }),
    [onOpenUri],
  )

  const availableCount = agents?.filter((a) => a.available).length ?? 0
  const canSend = !!sessionId && !transcript.streaming

  return (
    <aside
      role="complementary"
      aria-label="dialogue"
      className="flex h-full w-[26rem] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950"
    >
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-sm font-medium text-zinc-100">Dialogue</span>
        {agents && availableCount > 0 && (
          <select
            aria-label="agent"
            value={selected?.key ?? ''}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          >
            {agents.map((a) => (
              <option key={a.key} value={a.key} disabled={!a.available}>
                {a.label}
                {a.available ? '' : ' (not installed)'}
              </option>
            ))}
          </select>
        )}
        {onClose && (
          <button
            aria-label="close dialogue"
            onClick={onClose}
            className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            ×
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
        {agents == null ? (
          <p className="text-xs text-zinc-600">loading agents…</p>
        ) : availableCount === 0 ? (
          <p className="text-xs text-zinc-500">
            no agents available — install Claude Code or the Codex ACP adapter to start a dialogue.
          </p>
        ) : selected && !selected.authenticated ? (
          <p className="whitespace-pre-wrap font-mono text-xs text-amber-400/90">
            {selected.key} is installed but signed out — run{' '}
            {selected.key === 'codex' ? 'codex login' : 'claude'} (or codex login) in a terminal, then retry.
          </p>
        ) : sessionError ? (
          <p className="text-xs text-red-400">could not start session: {sessionError}</p>
        ) : transcript.entries.length === 0 ? (
          <p className="text-xs text-zinc-600">
            ask about your library — the index is mounted into this session.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {transcript.entries.map((e, i) => {
              if (e.kind === 'message' && e.role === 'user') {
                return (
                  <li key={i} className="whitespace-pre-wrap rounded-lg bg-zinc-800/60 px-3 py-2 text-zinc-200">
                    {e.text}
                  </li>
                )
              }
              if (e.kind === 'message') {
                return (
                  <li key={i} className="max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url) => url} components={md}>
                      {e.text}
                    </ReactMarkdown>
                  </li>
                )
              }
              if (e.kind === 'tool') {
                const label = `${e.toolName} · ${e.status}`
                return (
                  <li key={i}>
                    {e.documentId != null ? (
                      <button
                        onClick={() => onOpenHub(e.documentId as number)}
                        title="open in Document Hub"
                        className="inline-flex items-center gap-1 rounded-full border border-violet-800 bg-violet-950/60 px-2 py-0.5 text-[11px] text-violet-300 hover:bg-violet-900"
                      >
                        <span className="font-mono">{label}</span>
                        <span aria-hidden>ⓘ</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-mono text-zinc-400">
                        {label}
                      </span>
                    )}
                  </li>
                )
              }
              return (
                <li key={i} className="rounded border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                  {e.reason}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {perms.map((r) => (
        <div key={r.requestId} className="border-t border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs">
          <p className="mb-2 text-amber-200">{r.title}</p>
          <div className="flex gap-2">
            <button
              onClick={() => respond(r.requestId, true)}
              className="rounded border border-emerald-800 bg-emerald-950 px-2 py-1 text-emerald-300 hover:bg-emerald-900"
            >
              Allow once
            </button>
            <button
              onClick={() => respond(r.requestId, false)}
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
            >
              Deny
            </button>
          </div>
        </div>
      ))}

      {availableCount > 0 && (
        <div className="border-t border-zinc-800 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              disabled={!canSend}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder="Ask your library…"
              className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            {transcript.streaming ? (
              <button
                onClick={() => sessionId && acpApi().cancel(sessionId)}
                className="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!canSend || draft.trim().length === 0}
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
