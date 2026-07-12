import { useEffect, useReducer, useRef, useState } from 'react'
import type { AcpAgent, AcpApi, AcpDialogueSummary, AcpPermissionRequest, AcpUpdate } from './types'
import { TranscriptBody } from './TranscriptBody'
import { PlanList } from './PlanList'
import { PermissionCard } from './PermissionCard'
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
 * The rich-client preload additions (`acp.setMode`, and `respondPermission` taking an `optionId`
 * instead of a boolean) land with the parallel main-half work; until then the accessor cast is the
 * one expected `typecheck:web` residual (Property 'setMode' missing on the preload's acp surface).
 * The accessor keeps the rest of the pane fully typed against the frozen-contract AcpApi.
 */
const acpApi = (): AcpApi => window.astrolabe.acp

/** Compact token count: 12_300 → "12.3k", 200_000 → "200k", 940 → "940". */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

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
 * tool calls render as expandable cards (linking to the Document Hub when one carries a documentId),
 * and permission requests surface as inline option cards. A "History" toggle browses past
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
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  // Updates that arrive for a session not yet active. The initial mode/config/commands events fire
  // the instant session/new returns — BEFORE newSession()'s promise resolves and sets sessionRef —
  // so we buffer them here and replay on activation (see flushPending). This is what makes the
  // config bar appear before the first prompt, with zero extra tokens.
  const pending = useRef<AcpUpdate[]>([])

  const flushPending = (id: string): void => {
    const buffered = pending.current
    pending.current = []
    for (const u of buffered) if (u.sessionId === id) dispatch({ type: 'update', u })
  }

  // Slash palette (spec §Track B/3): opens when the draft starts with `/`, filtered by the token
  // after the slash. `slashOpen` lets Esc dismiss it without clearing the draft; `slashIndex` is
  // the keyboard-highlighted row.
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)

  // History browser state (v1.1): `historyOpen` swaps the pane into read-only mode; `reading` is
  // the opened past dialogue (null = the list view).
  const [historyOpen, setHistoryOpen] = useState(false)
  const [dialogues, setDialogues] = useState<AcpDialogueSummary[] | null>(null)
  const [reading, setReading] = useState<{ summary: AcpDialogueSummary; entries: TranscriptEntry[] } | null>(null)
  // A failed resume (adapter no longer has the session) surfaces inline in the read-only view.
  const [continueError, setContinueError] = useState<string | null>(null)

  // Load the agent registry and subscribe to the update / permission streams once, up front, so
  // no notification is missed between session-start and the first render.
  useEffect(() => {
    const acp = acpApi()
    void acp.agents().then(setAgents)
    const offUpdate = acp.onUpdate((u) => {
      if (sessionRef.current && u.sessionId === sessionRef.current) {
        dispatch({ type: 'update', u })
        // A mid-session error marks the session dead — surface the restart banner.
        if (u.kind === 'error') setDeadReason(u.reason ?? 'The agent stopped unexpectedly.')
      } else {
        // Not yet active (or already-dead) session → buffer; flushPending replays on activation.
        pending.current.push(u)
        if (pending.current.length > 500) pending.current.shift()
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
          flushPending(res.sessionId)
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
    setSlashOpen(false)
    void acpApi().prompt(sessionId, text)
  }

  // Slash palette: filter available commands by the token after a leading `/`.
  const slashQuery = draft.startsWith('/') ? draft.slice(1).split(/\s/, 1)[0].toLowerCase() : ''
  const filteredCommands = draft.startsWith('/')
    ? transcript.availableCommands.filter((c) => c.name.toLowerCase().includes(slashQuery))
    : []
  const showPalette = slashOpen && draft.startsWith('/') && filteredCommands.length > 0

  const onDraftChange = (value: string): void => {
    setDraft(value)
    setSlashOpen(value.startsWith('/'))
    setSlashIndex(0)
  }

  const insertCommand = (name: string): void => {
    setDraft(`/${name} `)
    setSlashOpen(false)
    promptRef.current?.focus()
  }

  const respond = (requestId: string, optionId: string): void => {
    void acpApi().respondPermission(requestId, optionId)
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
          flushPending(res.sessionId)
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
    setContinueError(null)
    // Re-fetch agents so `loadSupported` reflects the live agent's just-learned capability (it is
    // only known post-initialize, so the mount-time agents() call may predate it).
    void acpApi().agents().then(setAgents)
    void acpApi().dialogues().then(setDialogues)
  }
  const backToLive = (): void => {
    setHistoryOpen(false)
    setReading(null)
  }
  const openPast = (summary: AcpDialogueSummary): void => {
    setContinueError(null)
    void acpApi()
      .readDialogue(summary.file)
      .then((d) => setReading({ summary, entries: entriesFromDialogue(d) }))
  }

  // Resume a past dialogue into a live session (v1.2): session/load, then run the SAME activation
  // path as newSession — the adapter's replayed updates rebuild a fresh live transcript. On failure
  // (the agent no longer has the session) surface it inline and stay read-only.
  const continuePast = (): void => {
    const summary = reading?.summary
    if (!summary?.sessionId) return
    setContinueError(null)
    void acpApi()
      .loadSession(summary.agentKey, summary.sessionId)
      .then((res) => {
        if ('sessionId' in res) {
          setHistoryOpen(false)
          setReading(null)
          setDeadReason(null)
          setSessionError(null)
          sessionRef.current = res.sessionId
          setSessionId(res.sessionId)
          dispatch({ type: 'reset', sessionId: res.sessionId })
          flushPending(res.sessionId)
        } else {
          setContinueError(res.error)
        }
      })
  }

  // A past dialogue is resumable only if it recorded a sessionId AND its agent is installed and
  // advertises session/load. Codex (resume/close, not loadSession) stays disabled.
  const readingAgent = reading ? agents?.find((a) => a.key === reading.summary.agentKey) : null
  const canContinue =
    !!reading?.summary.sessionId && !!readingAgent && readingAgent.available && !!readingAgent.loadSupported
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
        {!historyOpen && transcript.availableModes.length > 0 && (
          <select
            aria-label="mode"
            value={transcript.currentModeId ?? ''}
            onChange={(e) => sessionId && void acpApi().setMode(sessionId, e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500"
          >
            {transcript.availableModes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
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

      {!historyOpen &&
        (transcript.configOptions.length > 0 || transcript.usage || transcript.sessionTitle) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs">
            {transcript.sessionTitle && (
              <span className="max-w-[12rem] truncate font-medium text-zinc-300" title={transcript.sessionTitle}>
                {transcript.sessionTitle}
              </span>
            )}
            {transcript.configOptions.map((opt) =>
              opt.type === 'select' ? (
                // Visible name label: a bare dropdown shows only its value ("On", "medium"),
                // which says nothing about WHAT it controls. The name goes on-screen, not just
                // in aria-label.
                <label key={opt.id} className="flex items-center gap-1 text-zinc-500" title={opt.description ?? opt.name}>
                  <span className="text-zinc-400">{opt.name}</span>
                  <select
                    aria-label={opt.name}
                    title={opt.description ?? opt.name}
                    value={String(opt.currentValue)}
                    onChange={(e) => sessionId && void acpApi().setConfig(sessionId, opt.id, e.target.value)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                  >
                    {(opt.values ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={opt.id} className="flex items-center gap-1 text-zinc-400" title={opt.description ?? opt.name}>
                  <input
                    type="checkbox"
                    aria-label={opt.name}
                    checked={opt.currentValue === true}
                    onChange={(e) => sessionId && void acpApi().setConfig(sessionId, opt.id, e.target.checked)}
                  />
                  {opt.name}
                </label>
              ),
            )}
            {transcript.usage && (
              <span className="ml-auto whitespace-nowrap text-zinc-500" aria-label="usage">
                {formatTokens(transcript.usage.used)} / {formatTokens(transcript.usage.size)} tokens
                {transcript.usage.cost != null ? ` · $${transcript.usage.cost.toFixed(2)}` : ''}
              </span>
            )}
          </div>
        )}

      {historyOpen ? (
        reading ? (
          <>
            <div className="border-b border-amber-900/50 bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-300/90">
              past dialogue (read-only) · {reading.summary.agentKey} ·{' '}
              {new Date(reading.summary.startedAt).toLocaleString()}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => setReading(null)}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  ← all dialogues
                </button>
                {canContinue && (
                  <button
                    onClick={continuePast}
                    className="rounded border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-800/40"
                  >
                    Continue this chat ↗
                  </button>
                )}
              </div>
              {continueError && (
                <p className="mb-3 whitespace-pre-wrap rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 text-xs text-red-300">
                  {continueError}
                </p>
              )}
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
            ) : transcript.entries.length === 0 && !(transcript.plan && transcript.plan.length > 0) && !blockingError ? (
              <p className="text-xs text-zinc-600">
                ask about your library — the index is mounted into this session.
              </p>
            ) : (
              <>
                <TranscriptBody entries={transcript.entries} onOpenUri={onOpenUri} onOpenHub={onOpenHub} />
                {transcript.plan && transcript.plan.length > 0 && (
                  <div className="mt-3">
                    <PlanList entries={transcript.plan} />
                  </div>
                )}
              </>
            )}
          </div>

          {perms.map((r, i) => (
            <PermissionCard key={r.requestId} request={r} keyboardActive={i === 0} onRespond={respond} />
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
            <div className="relative border-t border-zinc-800 p-3">
              {showPalette && (
                <ul
                  role="listbox"
                  aria-label="slash commands"
                  className="absolute inset-x-3 bottom-full mb-1 max-h-56 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                >
                  {filteredCommands.map((c, i) => (
                    <li key={c.name} role="option" aria-selected={i === slashIndex}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          insertCommand(c.name)
                        }}
                        className={`flex w-full flex-col items-start px-3 py-1 text-left ${
                          i === slashIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                        }`}
                      >
                        <span className="font-mono text-xs text-zinc-100">/{c.name}</span>
                        {c.description && <span className="text-[11px] text-zinc-500">{c.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={promptRef}
                  value={draft}
                  disabled={!canSend}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (showPalette) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setSlashIndex((n) => Math.min(n + 1, filteredCommands.length - 1))
                        return
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setSlashIndex((n) => Math.max(n - 1, 0))
                        return
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        insertCommand(filteredCommands[slashIndex].name)
                        return
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setSlashOpen(false)
                        return
                      }
                    }
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
