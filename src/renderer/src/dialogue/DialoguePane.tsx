import { useEffect, useReducer, useRef, useState } from 'react'
import type { AcpAgent, AcpApi, AcpDialogueSummary, AcpPermissionRequest, AcpUpdate } from './types'
import { TranscriptBody } from './TranscriptBody'
import {
  applyUpdate,
  appendUserPrompt,
  emptyTranscript,
  entriesFromDialogue,
  restartTranscript,
  type Transcript,
  type TranscriptEntry,
} from './transcript'

/**
 * The ACP surface is added preload-side by the parallel main-half work; until that lands this is
 * the one expected `typecheck:web` residual (Property 'acp' does not exist on AstrolabeApi). The
 * accessor keeps the rest of the pane fully typed against AcpApi.
 */
const acpApi = (): AcpApi => window.astrolabe.acp

type Action =
  | { type: 'reset'; sessionId: string }
  | { type: 'restart'; sessionId: string }
  | { type: 'update'; u: AcpUpdate }
  | { type: 'user'; text: string }

function reduce(state: Transcript, a: Action): Transcript {
  switch (a.type) {
    case 'reset':
      return emptyTranscript(a.sessionId)
    case 'restart':
      return restartTranscript(state, a.sessionId)
    case 'update':
      return applyUpdate(state, a.u)
    case 'user':
      return appendUserPrompt(state, a.text)
  }
}

/**
 * Dialogue pane (ACP client v1 + the v1.1 history browser / failure recovery) — a self-contained
 * LEFT column that owns one live session with the picked agent. Agent text streams in as markdown,
 * tool calls collapse to chips (linking to the Document Hub when a result carries a documentId),
 * and permission requests surface as inline allow/deny cards. A "History" toggle browses past
 * dialogues read-only; a dead session (adapter death / failed turn / failed session-new) shows a
 * restart banner that starts a fresh session while preserving the transcript above a divider.
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
  const [deadReason, setDeadReason] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [perms, setPerms] = useState<AcpPermissionRequest[]>([])
  const [transcript, dispatch] = useReducer(reduce, emptyTranscript(''))
  const sessionRef = useRef<string | null>(null)

  // History browser state (v1.1): `historyOpen` swaps the pane into read-only mode; `reading` is
  // the opened past dialogue (null = the list view).
  const [historyOpen, setHistoryOpen] = useState(false)
  const [dialogues, setDialogues] = useState<AcpDialogueSummary[] | null>(null)
  const [reading, setReading] = useState<{ summary: AcpDialogueSummary; entries: TranscriptEntry[] } | null>(null)

  // Load the agent registry and subscribe to the update / permission streams once, up front, so
  // no notification is missed between session-start and the first render.
  useEffect(() => {
    const acp = acpApi()
    void acp.agents().then(setAgents)
    const offUpdate = acp.onUpdate((u) => {
      dispatch({ type: 'update', u })
      // A mid-session error marks the session dead — surface the restart banner.
      if (u.kind === 'error' && sessionRef.current && u.sessionId === sessionRef.current) {
        setDeadReason(u.reason ?? 'The agent stopped unexpectedly.')
      }
    })
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
        setDeadReason(null)
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
    if (!text || !sessionId || transcript.streaming || deadReason) return
    dispatch({ type: 'user', text })
    setDraft('')
    void acpApi().prompt(sessionId, text)
  }

  const respond = (requestId: string, allow: boolean): void => {
    void acpApi().respondPermission(requestId, allow)
    setPerms((p) => p.filter((x) => x.requestId !== requestId))
  }

  // Restart after a dead session: start a fresh one for the same agent, preserving the transcript
  // above a divider. A failed restart just re-arms the banner via sessionError.
  const restart = (): void => {
    const key = selected?.key
    if (!key) return
    setDeadReason(null)
    setSessionError(null)
    void acpApi()
      .newSession(key)
      .then((res) => {
        if ('sessionId' in res) {
          sessionRef.current = res.sessionId
          setSessionId(res.sessionId)
          dispatch({ type: 'restart', sessionId: res.sessionId })
        } else {
          sessionRef.current = null
          setSessionError(res.error)
        }
      })
  }

  const openHistory = (): void => {
    setHistoryOpen(true)
    setReading(null)
    setDialogues(null)
    void acpApi().dialogues().then(setDialogues)
  }
  const backToLive = (): void => {
    setHistoryOpen(false)
    setReading(null)
  }
  const openPast = (summary: AcpDialogueSummary): void => {
    void acpApi()
      .readDialogue(summary.file)
      .then((d) => setReading({ summary, entries: entriesFromDialogue(d) }))
  }

  const availableCount = agents?.filter((a) => a.available).length ?? 0
  const canSend = !!sessionId && !transcript.streaming && !deadReason && !sessionError
  // The blocking error banner unifies mid-session death and a failed session-new (spec §2).
  const blockingError = deadReason ?? sessionError
  const restartable = !!selected && selected.available && selected.authenticated

  return (
    <aside
      role="complementary"
      aria-label="dialogue"
      className="flex h-full w-[26rem] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950"
    >
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-sm font-medium text-zinc-100">Dialogue</span>
        {!historyOpen && agents && availableCount > 0 && (
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
        <button
          onClick={historyOpen ? backToLive : openHistory}
          className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          {historyOpen ? 'Back to live' : 'History'}
        </button>
        {onClose && (
          <button
            aria-label="close dialogue"
            onClick={onClose}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            ×
          </button>
        )}
      </header>

      {historyOpen ? (
        reading ? (
          <>
            <div className="border-b border-amber-900/50 bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-300/90">
              past dialogue (read-only) · {reading.summary.agentKey} ·{' '}
              {new Date(reading.summary.startedAt).toLocaleString()}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
              <button
                onClick={() => setReading(null)}
                className="mb-3 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                ← all dialogues
              </button>
              <TranscriptBody entries={reading.entries} onOpenUri={onOpenUri} onOpenHub={onOpenHub} />
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
            {dialogues == null ? (
              <p className="text-xs text-zinc-600">loading history…</p>
            ) : dialogues.length === 0 ? (
              <p className="text-xs text-zinc-500">no past dialogues yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {dialogues.map((d) => (
                  <li key={d.file}>
                    <button
                      onClick={() => openPast(d)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left hover:bg-zinc-800/60"
                    >
                      <div className="truncate text-zinc-200">{d.firstPrompt || '(no prompt)'}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {d.agentKey} · {new Date(d.startedAt).toLocaleString()} · {d.messageCount} messages
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      ) : (
        <>
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
            ) : transcript.entries.length === 0 && !blockingError ? (
              <p className="text-xs text-zinc-600">
                ask about your library — the index is mounted into this session.
              </p>
            ) : (
              <TranscriptBody entries={transcript.entries} onOpenUri={onOpenUri} onOpenHub={onOpenHub} />
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

          {blockingError && restartable && (
            <div className="border-t border-red-900/60 bg-red-950/30 px-3 py-2 text-xs">
              <p className="mb-2 text-red-300">{blockingError}</p>
              <button
                onClick={restart}
                className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-zinc-100 hover:bg-zinc-700"
              >
                Restart session
              </button>
            </div>
          )}

          {availableCount > 0 && !blockingError && (
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
        </>
      )}
    </aside>
  )
}
