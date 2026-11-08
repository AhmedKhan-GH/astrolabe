# Astrolabe architecture

Status: first draft, 2026-11-07. The decisions marked open at the end are still the founder's to make.

## What Astrolabe is for

Astrolabe is one app for specialised work. It brings specialised interfaces together (a library, a reader, a canvas,
a board, a data table) without flattening them into one generic interface, and lets agents work in them where the
person chooses.

The aim is an agent-augmented workflow that closes the loop between inputs and outputs, beyond a chat window. An agent
in Astrolabe does not describe what to do; it acts in the same tools the person uses, looks at the result, and
continues until the output meets the goal. The person watches it happen, can stop it, and approves anything that cannot
be undone.

## Where it sits among the Sternbild projects

| Project       | What it is                          | Stack                     | Location                         |
|---------------|-------------------------------------|---------------------------|----------------------------------|
| Astrolabe     | the workbench of specialised tools  | Rust                      | `~/RustroverProjects/astrolabe`  |
| Caliper       | the machine-learning instrument     | C++ (ImGui, Metal/Vulkan) | `~/CLionProjects/caliper`        |
| Alidade       | learning platform                   | web                       | `~/WebstormProjects/alidade`     |
| Compass       | practice platform                   | web                       | `~/WebstormProjects/compass`     |
| Constellation | the organisation's knowledge base   | to be decided             | internal                         |

Caliper stays in C++ because it is built around LibTorch and zero-copy GPU access. Astrolabe reaches it through
Caliper's C interface (see "Caliper inside Astrolabe" below), not by sharing code.

## The loop

Every agent action in Astrolabe follows the same loop:

1. **Act** through a tool's commands.
2. **Inspect** the tool's state in structured form.
3. **Render** the result (an image, a page, an export).
4. **Compare** it with the goal, and act again.

This is how the Sternbild marks were drawn in VectorCraft: commands from its catalogue, `document.inspect` to read the
state back, exports to look at, then the next change. Astrolabe makes that pattern the rule for every tool, so
verification is part of the loop rather than left to the person.

## Layers

```
┌──────────────────────────── Astrolabe host ────────────────────────────┐
│ Shell        windows, docked panes, command palette, workspaces, theme │
│ Agent        runs the loop; visible timeline; approvals; take-over     │
│ Workflows    saved chains of commands, re-run when their inputs change │
│ MCP surface  the same catalogue, for Claude Code, Codex and others     │
│ Command layer  routing · history · undo · who acted · approval gates   │
├────────────────────────────────────────────────────────────────────────┤
│ Tools        each implements the tool contract                         │
│              in-process (Rust crates)  │  out-of-process (control port)│
├────────────────────────────────────────────────────────────────────────┤
│ Workspace    item references · links between items · local index       │
│ Sources      Zotero · Obsidian · Eagle/Falcon · Constellation · files  │
└────────────────────────────────────────────────────────────────────────┘
          optional: the shared Sternbild server (accounts, licences, sync)
```

## The tool contract

Defined in `crates/astrolabe-contract`. Every tool, however it was built, provides:

- **A command catalogue.** Every action is a named command (`library.tag.add`) with a JSON Schema for its parameters
  and result, and a declared effect: read, write, destructive or external. The tool's own buttons and menus call these
  commands. There is no private path an agent cannot take, and nothing an agent does is invisible.
- **Inspection.** `inspect(item, query)` answers structured questions: an item's fields, its children, its links.
- **Rendering.** `render(item, request)` draws or exports an item in a declared format, so the result of an action can
  be looked at.
- **Item references.** Everything a tool holds has a stable `astrolabe://<tool>/<kind>/<id>`, so one tool's output can
  be another tool's input without copying.
- **Imports and exports** in declared formats.
- **Panes** the host can dock. This is the one part that is not in the contract crate, because it depends on the UI
  toolkit; it lives in the host.

A command's outcome lists the items it changed and, where possible, the invocation that undoes it. The host records
every invocation with who acted (the person, an agent, or a workflow).

## Specialised tools from AI-built clones

Tools are expected to come from AI-built clones of existing applications (Falcon, the Eagle clone, is the model),
adapted to Astrolabe. A clone joins once it implements the contract:

- **Clones written in Rust** implement the `Tool` trait directly and share the host's panes and memory.
- **Clones in other languages** run as their own process and attach through a control port, the way VectorCraft's
  `--control` port works. A small adapter in the host speaks the contract to them.

Adapting a clone is therefore a bounded job: write its command catalogue, its inspection, its rendering and its pane.
Rust is the default for new clones because, when agents write most of the code, the compiler is the strongest
automatic check on what they produce.

## The agent

- **Works in the open.** It drives the same tools the person sees, and every command it runs appears on a timeline in
  the UI. The person can pause it, take over, or undo.
- **Asks first** for any command whose effect is destructive or external (the host's `needs_approval`).
- **Sees only what tools expose.** It reads through `inspect` and `render`, and changes things only through commands.
- **Model-agnostic.** It runs on the provider the person chooses.

## Workflows

A loop that worked can be saved as a workflow: a chain of commands with its inputs named. Workflows re-run when their
inputs change. For example: new papers arrive in the library, so re-index them, summarise each into Constellation and
update the reading board. Workflows run as their own actor, so the history shows what they did, and they are held to
the same approval gates as agents.

## The MCP surface

The host publishes the whole command catalogue, inspection and rendering as an MCP server. Astrolabe's own agent and
outside agents (Claude Code, Codex) drive the tools through the same interface, so no tool needs a separate
integration for each agent.

## Data

- **Local first.** One local index (SQLite with full-text search) over the workspace's items and their links. The
  earlier TypeScript build's connectors for Zotero, Obsidian and Eagle, and their specifications (folders, multiple
  libraries, rename healing; see the old repository's `docs/`), are the requirements for the Rust connectors.
- **Constellation** is a source like the others, so the organisation's knowledge sits next to the person's own.
- **The shared Sternbild server** handles accounts, licences and sync only. Nothing local depends on it being
  reachable.

## Caliper inside Astrolabe

Caliper exposes a C interface for embedding (libcaliper) and for its applets. Astrolabe can host Caliper views in a
pane through that interface, and Caliper can implement the tool contract through an adapter, so its commands join the
catalogue. Caliper itself stays a standalone C++ app.

## First milestone

The thinnest loop that proves the idea:

1. The command layer and the tool contract (started here).
2. Two tools: the library (built from Falcon's crates) and one output tool (a canvas or a document).
3. One agent loop on them, visible in the UI: gather these sources, make this artefact, check it, revise. Then save it
   as a workflow and re-run it.

If that loop feels better than a chat window, the rest is adding tools.

## Open decisions

- **Falcon.** Either Falcon and Astrolabe both build on shared crates taken out of Falcon (library, PDF, media,
  plug-in loading), with Falcon staying a free, open-source app; or Falcon becomes Astrolabe's library tool. The first
  is recommended.
- **The UI toolkit.** egui (as Falcon uses) for the instrument-like panes. It is weak at rich text and long-form
  reading, so reading and editing panes may use Falcon's PDF crate, native views or a contained web view.
- **The server's name.** The shared backend was planned as the Go "Alidade" service, but Alidade is now the learning
  platform, so the server needs its own name.
- **Out-of-process transport.** JSON over a local socket, as VectorCraft does, is the default; to be confirmed when the
  first non-Rust clone joins.
