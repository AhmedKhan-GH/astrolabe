---
kind: index
---

# Roadmap

Astrolabe delivers capabilities in stages and starts with monitor consolidation inside one Rust application.

```mermaid
flowchart LR
    app[Single Rust App] -->|extracts| kit[Kit and Engines]
    kit -->|reaches parity| retire[Monitor Retirement]
    retire -->|adds as needed| layers[Workflow Layers]
```

Staged delivery from monitor consolidation to broader workflow layers.

## Active Consolidation

The first stage unifies Repo Monitor and Agent Monitor inside the single `astrolabe` application. Shared widgets move into `astrolabe-kit`, and monitor logic moves into `astrolabe-engines` over live data readers. Standalone monitors retire when Astrolabe matches them on daily work.

## Deferred Capabilities

Persistence, record IDs, event logs, protocol crates, and a daemon wait until a concrete feature needs them. Broader layers from [Product Direction](../introduction/direction.md) and [Astrolabe Architecture](../architecture/architecture.md), such as workflow definitions, hosted environments, and embedded Caliper views, follow on top of the consolidated host.
