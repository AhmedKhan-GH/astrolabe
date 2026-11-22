# Astrolabe Architecture

Status: Updated November 22, 2026, with conclusions from November 8, 17, and 18. Open Decisions records the questions that remain unsettled.

See [Product Direction](direction.md) for the purpose, requirements, and reasons for this architecture.

## Purpose

Astrolabe is the founder's productivity app for specialized work. It takes on containerized Artisan workflows, Repo Monitor, and Agent Monitor.
It brings specialized interfaces together, such as a library, reader, canvas, board, and data table. Each tool keeps its specialized interface.
Agents work in them where the person chooses.

The aim is a workflow that closes the loop between inputs and outputs. An agent acts in the same tools the person uses and inspects the result.
It continues until the output meets the goal. The person watches the work, can stop it, and approves anything that cannot be undone.

## Project Context

| Project       | What it is                          | Stack                     | Location                         |
|---------------|-------------------------------------|---------------------------|----------------------------------|
| Astrolabe     | productivity app across five layers | Rust                      | `~/RustroverProjects/astrolabe`  |
| Caliper       | the machine-learning instrument     | C++ (ImGui, Metal/Vulkan) | `~/CLionProjects/caliper`        |
| Alidade       | learning platform                   | web                       | `~/WebstormProjects/alidade`     |
| Compass       | practice platform                   | web                       | `~/WebstormProjects/compass`     |
| Constellation | the organization's knowledge base   | to be decided             | internal                         |

Caliper stays in C++ because it is built around LibTorch and zero-copy GPU access. Astrolabe reaches it through
Caliper's C interface (see [Caliper Integration](#caliper-integration)).

## Agent Loop

Every agent action in Astrolabe follows the same loop:

1. **Act** through a tool's commands.
2. **Inspect** the tool's state in structured form.
3. **Render** the result (an image, a page, an export).
4. **Compare** it with the goal, and act again.

The Sternbild marks used this loop in VectorCraft. Commands from its catalog changed the marks, `document.inspect` returned their state, and exports showed the result before the next change.
Astrolabe makes that pattern the rule for every tool. Verification belongs in the loop.

## Layers

The [layer model](direction.md#layer-model) covers environments, orchestration, interfaces, workflows, and the shared backbone.
The diagram below describes the local host within that system. Its shell and tools provide interfaces, and its agent and command layers support orchestration.
Its workflow support connects the spec, rules, checks, evidence, and history to those tools.

Artisan and Alchemist VMs provide environments outside the local host. Loggia is the company's own Astrolabe installation, and its code supplies orchestration.
Repo Monitor, Agent Monitor, and Artisan Apps provide the first interfaces. The Atlas writing loop is a workflow.
The shared backend provides the backbone, and Caliper supplies an embedded expert interface while it remains a separate product.

```
┌──────────────────────────── Astrolabe host ────────────────────────────┐
│ Shell        windows, docked panes, command palette, workspaces, theme │
│ Agent        runs the loop · visible timeline · approvals · take-over  │
│ Workflows    spec · rules and checks · evidence · history              │
│ MCP surface  the same catalog, for Claude Code, Codex and others       │
│ Command layer  routing · history · undo · who acted · approval gates   │
├────────────────────────────────────────────────────────────────────────┤
│ Tools        each implements the tool contract                         │
│              in-process (Rust crates)  │  out-of-process (control port)│
├────────────────────────────────────────────────────────────────────────┤
│ Workspace    item references · links between items · local index       │
│ Sources      Zotero · Obsidian · Eagle/Falcon · Constellation · files  │
└────────────────────────────────────────────────────────────────────────┘
          optional: shared backbone (accounts, sync, licensing, billing)
```

## Tool Contract

`crates/astrolabe-contract` defines the contract. Every tool provides:

- **Command catalog.** Every action is a named command, such as `library.tag.add`. It declares JSON Schemas for parameters and results, and an effect: read, write, destructive, or external.
  The tool's own buttons and menus call these commands. There is no private path an agent cannot take, and nothing an agent does is invisible.
- **Inspection.** `inspect(item, query)` answers structured questions: an item's fields, its children, its links.
- **Rendering.** `render(item, request)` draws or exports an item in a declared format. The result lets the person or agent inspect the output of an action.
- **Item references.** Everything a tool holds has a stable `astrolabe://<tool>/<kind>/<id>` reference. One tool can use another tool's output as its input without a copy.
- **Imports and exports.** Tools declare the formats they support.
- **Panes.** The host can dock tool panes. Panes live in the host because they depend on the UI toolkit.

A command's outcome lists the items it changed and, where possible, the invocation that undoes it.
The host records every invocation with who acted: the person, an agent, or a workflow.

## Specialized Tools

Additional tools can come from AI-built clones of existing applications. Falcon, the Eagle clone, provides the model.
A clone joins once it implements the contract:

- **Clones written in Rust** implement the `Tool` trait directly and share the host's panes and memory.
- **Clones in other languages** run as their own process and attach through a control port, as VectorCraft's `--control` port does.
  A small adapter in the host speaks the contract to them.

A clone needs a command catalog, inspection, rendering, and a pane to join Astrolabe.
Rust is the default for new clones. Its compiler provides the strongest automatic check when agents write most of the code.

## Agent

The agent drives the same tools the person sees. Every command it runs appears on a timeline in the UI.
The person can pause it, take over, or undo. The agent asks first for any command whose effect is destructive or external, through the host's `needs_approval`.

The agent sees only what tools expose. It reads through `inspect` and `render`, and changes things only through commands.
It runs on the provider the person chooses.

## Workflows

A workflow is a spec, plus its rules and checks, plus its evidence, plus its history.
It uses one definition locally, on hosted capacity, in parallel, and for a team. Curated workflows carry versions and evaluations.
Literature and taste enter through curated sources, rules, and checks. Corrections refine those checks, and runs add evidence and history.

Saved command chains with named inputs form part of a workflow. Workflows can run again when their inputs change.
For example, new papers can trigger re-indexing, summaries in Constellation, and an update to the reading board.
Workflows run as their own actor, and the history records their actions. They use the same approval gates as agents.
The declared workflow format remains open.

## MCP Surface

The host publishes the whole command catalog, inspection, and rendering as an MCP server.
Astrolabe's own agent and outside agents, such as Claude Code and Codex, drive tools through the same interface.
No tool needs a separate integration for each agent.

## Data

Data is local first, with one SQLite index and full-text search over the workspace's items and their links.
The earlier TypeScript build's connectors for Zotero, Obsidian, and Eagle supply the requirements for the Rust connectors.
Their specifications cover folders, multiple libraries, and rename healing (see the old repository's `docs/`).

Constellation is a source like the others, and the organization's knowledge sits next to the person's own.
The shared Sternbild server handles accounts, sync, licensing, and billing. Nothing local depends on the server's availability.

## Caliper Integration

Caliper exposes a C interface for embedding (libcaliper) and for its applets. Astrolabe can host Caliper views in a pane through Caliper Embed.
Caliper can implement the tool contract through an adapter, and its commands then join the catalog.
Caliper itself stays a standalone C++ app.

## Consolidation Order

First, extract the shared Artisan kit into one Rust crate. It contains the theme, app shell, settings, Keychain access, SQLite store, and CLI probe runner.
Repo Monitor, Agent Monitor, and Artisan Apps use the kit while each remains a separate app.

Next, when the next tool starts, put both monitors on `astrolabe-contract` as standalone tools. This lets the contract settle while the tools continue to ship.

Finally, combine the tools in one Astrolabe app when views across tools become necessary. The contract must also remain free of incompatible changes for a few weeks.
One such view connects agent runs, token use, repositories, and commits.

The first release covers the interfaces layer, with Agent Monitor as its first tool. Other layers can remain internal and serve Loggia until they are ready.
See [Product Direction](direction.md#consolidation-order) for the reasons behind this order.

## Open Decisions

- **Falcon.** One option extracts shared crates for Falcon and Astrolabe: library, PDF, media, and plug-in loading. Falcon then stays a free, open-source app.
  Another option makes Falcon the Astrolabe library tool. The sources recommend shared crates, but the choice remains open.
- **UI toolkit.** egui, as Falcon uses, is a candidate for instrument-like panes. It is weak at rich text and long-form reading.
  Reading and editing panes may use Falcon's PDF crate, native views, or a contained web view.
- **Shared backend name.** The planned Go "Alidade" service and the Alidade learning platform share a name. The backend needs a distinct name.
- **Out-of-process transport.** JSON over a local socket, as VectorCraft does, is the proposed default.
  Confirm the transport when the first non-Rust clone joins.
- **Workflow format.** The sources establish the workflow definition, but leave its declared format open.
  It must carry the spec, rules, checks, evidence, and history across environments and scales.
- **Host license.** The final host license remains open. The commercial strategy records the options and their tradeoffs.
- **Astrolabe repositories.** The public site still publishes from the old Electron repository at `~/WebstormProjects/astrolabe`.
  The Rust repository is at `~/RustroverProjects/astrolabe`. The November 21 overview proposes a site move and archive of the Electron repository, but leaves that decision open.
