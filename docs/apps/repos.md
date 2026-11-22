---
kind: concept
---

# Repos

Repos monitors local Git repositories, branches, and worktrees inside the single Astrolabe application.

```mermaid
flowchart LR
    git[Local Git Repos] -->|status reads| readers[Git Readers]
    readers -->|repo state| engine[Repos Engine]
    engine -->|view model| view[Repos View]
```

Data flow from local Git repositories through live readers and the Repos engine to the interface.

## Components

Repos combines three parts inside the single Rust workspace. Live Git readers inspect repository directories on disk and collect branch, worktree, and working-tree status. The Repos module in `astrolabe-engines` normalizes that state into sorted snapshots, and the Repos view renders those snapshots through shared widgets from `astrolabe-kit`.

## Live Data Readers

Readers query local repositories directly on demand without a background daemon or persistent database. Each scan reads HEAD state, staged and unstaged changes, ahead and behind counts, and linked worktrees from Git metadata. Direct reads keep state accurate after external CLI commands run in a terminal or agent session.

## Repository Views

The Repos view presents a dense workstation layout that follows [UI Principles](../interface/ui-principles.md). Repository names stay consistent across rows, inspectors, and badges, and status indicators use one shared color key. Because Repos runs inside the same process as [Agents](agents.md), future views can connect dirty worktrees and recent commits directly to active agent sessions.

## Monitor Retirement

Repo Monitor moves its scan and state engine into `astrolabe-engines` and its interface into `astrolabe`. Standalone Repo Monitor stays available only during the transition and retires when Repos inside Astrolabe matches its capabilities.

## Limits

The table records current scope limits for the initial Repos integration.

| Area | Current Limit |
|---|---|
| Repository source | Local Git checkouts and linked worktrees only |
| State storage | In-memory live snapshots without a persistent SQLite cache |
| Execution model | Direct reads inside `astrolabe` with no background daemon |
| Mutations | Read-only inspection until command approval gates land |
