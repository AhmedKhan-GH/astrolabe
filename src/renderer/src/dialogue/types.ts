/**
 * ACP dialogue contract — renderer-local mirror of the main-side (shared/db-ipc) types, kept
 * here so dialogue component/reducer tests never reach for the preload seam (same pattern as
 * lens/types.ts). The authoritative copy lives main-side; this must stay wire-identical.
 */

/** A streamed session/update notification, forwarded from main verbatim-but-typed. */
export type AcpUpdateKind = 'chunk' | 'tool-call' | 'tool-result' | 'turn-end' | 'error'

export interface AcpUpdate {
  sessionId: string
  kind: AcpUpdateKind
  /** Assistant message text (chunk). */
  text?: string
  /** Tool name for tool-call / tool-result chips. */
  toolName?: string
  /** Free-form lifecycle status from the agent (e.g. 'running', 'completed'). */
  toolStatus?: string
  /** A library document a tool result touched — harvested for provenance + graph linking. */
  documentId?: number
  /** Human-readable failure sentence on an error update. */
  reason?: string
}

/** One row in the agent picker (an adapter that resolved on PATH, plus its auth state). */
export interface AcpAgent {
  key: string
  label: string
  available: boolean
  authenticated: boolean
}

/** A pending session/request_permission forwarded to the renderer for a user choice. */
export interface AcpPermissionRequest {
  requestId: string
  sessionId: string
  title: string
}

/** The `window.astrolabe.acp` surface (mirrors the preload contract). */
export interface AcpApi {
  agents(): Promise<AcpAgent[]>
  newSession(agentKey: string): Promise<{ sessionId: string } | { error: string }>
  prompt(sessionId: string, text: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  respondPermission(requestId: string, allow: boolean): Promise<void>
  onUpdate(cb: (u: AcpUpdate) => void): () => void
  onPermissionRequest(cb: (r: AcpPermissionRequest) => void): () => void
}
