---
kind: index
---

# Development

Development covers workspace builds, tests, macOS app bundles, roadmap verification, and documentation builds for contributors.

```mermaid
flowchart LR
    src[Rust Workspace] -->|build, test, bundle| app[Astrolabe.app]
    roadmap[Roadmap YAML] -->|check and hook| rmdoc[Roadmap Pages]
    docs[Markdown Sources] -->|headings and mkdocs| site[Docs Site]
```

Local build and verification paths across Rust crates, roadmap sources, and documentation.

## Workspace Workflow

One Cargo workspace compiles `astrolabe`, `astrolabe-kit`, `astrolabe-engines`, and `astrolabe-contract`. Contributors build, launch in live or `--demo` mode, run `cargo test`, and package `Astrolabe.app` through `./scripts/bundle.sh`. [Development Basics](development-basics.md) lists all requirements and commands.

## Roadmap and Documentation

`roadmap/check.py` validates the roadmap YAML files under `roadmap/`, and MkDocs runs `roadmap/build.py` as a hook. Documentation lives under `docs/` and compiles with pinned MkDocs Material packages in strict mode. Every heading must pass `scripts/check_doc_headings.py`, and every interface change must follow [UI Principles](../interface/ui-principles.md).
