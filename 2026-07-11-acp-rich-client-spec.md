# ACP Rich Client — Design Spec (v2 dialogue surface)

**Date:** 2026-07-11 · **Status:** approved — build now
**Problem:** the dialogue pane renders a chatbot (text + tool-name chips) while the adapter is
the full Claude Code / Codex agent. We DROP everything that conveys what the agent is doing:
thinking, tool inputs/outputs (commands, file diffs, locations), plans, slash commands, and
session modes; and we collapse the permission option set to allow/deny while running in
bypassPermissions (so tools aren't even gated). Goal: a CLI-grade client that surfaces the full
ACP surface and gives the agent the configurability of its CLI counterpart.

**Non-goals:** restricting the agent (the user wants full power); building our own agent; write
tools on OUR MCP server (separate track). This is purely: render + control what ACP already
exposes.

## Frozen wire contract (both tracks code against this verbatim)

`AcpUpdateEvent` (src/shared/db-ipc.ts) becomes a discriminated union on `kind`, all carrying
`sessionId`:
- `chunk` `{text}` — agent message text (unchanged)
- `thought` `{text}` — agent_thought_chunk (NEW; renders as a collapsible "thinking" block)
- `tool` `{toolCallId, title, toolKind, status, command?, content?: ToolContentItem[], locations?: {path,line?}[], rawInput?}` — REPLACES the old tool-call/tool-result split. `status` ∈ pending|in_progress|completed|failed. Emitted on both `tool_call` and `tool_call_update`; the renderer upserts by `toolCallId`. `documentId?` still harvested (from content/rawInput) for the hub link.
  - `ToolContentItem` = `{type:'text', text}` | `{type:'diff', path, oldText, newText}` | `{type:'terminal', text}`
- `plan` `{entries: {content, priority?, status}[]}` — the agent's plan/todo list (NEW; replaces prior on each update)
- `commands` `{commands: {name, description?}[]}` — available_commands_update (NEW; feeds the slash palette)
- `mode` `{currentModeId, availableModes?: {id,name}[]}` — current_mode_update + the modes from session/new (NEW)
- `turn-end` `{stopReason?}` — unchanged
- `error` `{reason}` — unchanged (adapter stderr still appended, existing behavior)

`AcpPermissionRequestEvent` gains the FULL option set:
`{requestId, sessionId, title, toolCallId?, options: {optionId, name, kind}[]}` where kind ∈
allow_once|allow_always|reject_once|reject_always. Renderer renders one button per option;
`acp:permission-response {requestId, optionId}` (REPLACES the boolean allow). Default on
timeout/teardown = the first reject_* option (or synthetic reject).

New channels: `acp:set-mode {sessionId, modeId}` → mode change; session/new response's
availableCommands + modes surfaced via an initial `commands`/`mode` event right after session start.

## Track A — main process (src/main/acp/, src/shared, src/preload, src/main/index.ts)

1. **update-map.ts**: map ALL variants above (grounded in @agentclientprotocol/sdk's SessionUpdate
   union — read the installed .d.ts, don't guess field names). tool_call/tool_call_update →
   the unified `tool` event with content (text/diff/terminal), toolKind, locations, rawInput,
   command (from rawInput for execute kind). agent_thought_chunk → `thought`. plan → `plan`.
   available_commands_update → `commands`. current_mode_update → `mode`. Pure + exhaustively
   unit-tested (every variant, content-type coverage, unknown variant → null).
2. **manager.ts**:
   - Turn OFF bypassPermissions so `session/request_permission` fires: pass the adapter the
     appropriate initial mode. Investigate the adapter's permission-mode handling (earlier grep:
     `_meta.claudeCode`, permissionMode, canUseTool) — the client must receive permission requests
     rather than the agent auto-approving. Confirm empirically via the live canary that a tool
     call now produces a request_permission the client answers.
   - Permission: forward the full options array; response returns the chosen optionId; default-deny
     picks a reject option. Update the mock-transport tests.
   - session/new: capture availableModes + availableCommands from the response and emit initial
     `mode`/`commands` events; store currentMode per session.
   - `setMode(sessionId, modeId)` → session/set_mode request.
   - Keep the MCP index mount + minimal client fs/terminal caps UNCHANGED (the agent's OWN tools
     stay full; we are not restricting — we are observing/gating).
3. **db-ipc.ts / preload / index.ts**: the union types above; `acp:set-mode`; permission-response
   carries optionId; preload `acp.setMode(sessionId, modeId)` + `acp.respondPermission(requestId, optionId)`.
   e2e allowlist unchanged (still the `acp` key).

## Track B — renderer (src/renderer/src/dialogue/)

1. **transcript.ts reducer**: upsert tool entries by toolCallId (status transitions in place);
   thought entries (collapsible, grouped consecutive); a single live `plan` block; hold current
   `mode` + `availableModes` + `availableCommands` in transcript state. Thorough unit tests
   (tool upsert lifecycle with content, thought grouping, plan replacement, command/mode state,
   stale-session ignore).
2. **TranscriptBody.tsx / new components**:
   - **ToolCard**: icon by toolKind, title, status spinner/check/x; expandable body showing
     command (mono), diffs (red/green line blocks), text/terminal output; documentId → hub chip.
   - **ThoughtBlock**: muted, collapsible "thinking" disclosure.
   - **PlanList**: checklist with status (pending/in_progress/completed).
   - Permission card: one button per option, styled by kind (allow=emerald, reject=zinc);
     keyboard 1..n selects.
3. **DialoguePane.tsx**:
   - **Slash palette**: typing `/` at the start of the prompt opens a filtered menu of
     availableCommands (name + description); Enter/click inserts. (Sending the command is just
     sending its text — the adapter interprets it.)
   - **Mode switcher**: a small dropdown in the header bound to availableModes → acp.setMode.
   - Keep streaming/stop/history/restart intact.
4. types.ts: mirror the union + permission option shape.

## Testing (TDD; stakes × logic)
- Unit (main): update-map exhaustive; manager permission-options + set-mode + initial mode/commands
  emit (mock transport).
- Unit (renderer): reducer (tool upsert, thought grouping, plan, mode/commands state); ToolCard
  diff rendering; slash palette filter; permission option buttons → correct optionId; mode switch.
- Integration: dialogue-store still round-trips (persist the richer entries — extend the stored
  shape to include tool content minimally, or persist as before + note what history omits).
- Live canary (ASTROLABE_LIVE_ACP=1): assert a real session now yields ≥1 tool event with a
  status transition AND (if the model uses a tool needing permission) a permission request; assert
  availableCommands arrived. Skipped by default.

## Rollout
Frozen contract above; two parallel Opus agents (A main, B renderer); integrate; full gates;
packaged live canary (the permission-mode change MUST be verified against the packaged app, not
just dev); commit; reinstall.
