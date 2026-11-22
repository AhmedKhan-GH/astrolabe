# Astrolabe

Astrolabe is an ecosystem that manages knowledge and assets across specialized applications. People observe their work in one place and keep active state clear across projects. Astrolabe integrates agents where they accelerate workflows or create new ones, and it supports principled, organized thought.

## Workspaces

Astrolabe ships on macOS as a native desktop application in Rust with two workspaces and a demo mode. Both workspaces share one command bar, sidebar rail, and status bar in a single window.

The **Repos** workspace inspects local Git repositories and GitHub remotes in real time. It shows live Git status for uncommitted changes, unpushed commits, and remote updates across configured Watched Folders. People organize and filter repositories with Repository Location filters, tags, nested folders, smart folders, and Boolean queries.

The **Agents** workspace monitors provider limits, local models, and installed tools in one view. It tracks quota windows and credit balances for CLI tools and hosted providers while probes use zero model tokens. The lower pane monitors local Ollama models with GPU memory, context length, and KV cache estimates. The workspace also discovers installed agent tools and stores provider API keys in macOS Keychain.

Deterministic `--demo` mode launches the full interface with synthetic data. It does not access local repositories, user files, macOS Keychain, network endpoints, or installed CLIs.

## Workspace Crates

The Cargo workspace splits the application into four crates with clear boundaries between interface chrome, live engines, and the tool contract.

| Crate | Purpose |
|---|---|
| `astrolabe` | Desktop host application, command dispatch, history, approval gates, and the Repos and Agents workspaces |
| `astrolabe-kit` | Sternbild interface components, layout primitives, theme tokens, and capture helpers for `egui` |
| `astrolabe-engines` | Headless engines for Git and GitHub inspection, filesystem events, quota probes, Ollama telemetry, and demo fixtures |
| `astrolabe-contract` | Shared tool contract for typed commands, state inspection, visual output, and stable `ItemRef` identifiers |

## Development and Verification

Local development requires a Rust toolchain with Edition 2024 support, Python 3, and `uv` for pinned documentation builds. Cargo builds and tests the Rust workspace, while `./scripts/bundle.sh` packages the macOS bundle and `sternbild-docs` checks documentation rules. Full development procedures appear in [docs/development/development-basics.md](docs/development/development-basics.md).

### Application Launch

Run Astrolabe directly from Cargo in live mode or in deterministic demo mode. Pass `--panel agents` to open the Agents workspace first.

```sh
cargo run -p astrolabe
cargo run -p astrolabe -- --demo
```

### Tests and Application Bundle

Run the Cargo test suite across all four crates. Then run the bundle script to build and sign `Astrolabe.app` under `target/bundle/`.

```sh
cargo test
./scripts/bundle.sh
```

### Documentation and Roadmap Checks

Check the roadmap registry and all documentation headings with `sternbild-docs`. Then build the MkDocs site in strict mode with pinned package versions.

```sh
uvx --from "git+https://github.com/AhmedKhan-GH/organization@docs-v1.0.0#subdirectory=packages/sternbild-docs" \
  sternbild-docs check-roadmap --strict-titles --strict-core-scope
uvx --from "git+https://github.com/AhmedKhan-GH/organization@docs-v1.0.0#subdirectory=packages/sternbild-docs" \
  sternbild-docs check-headings
uvx --from mkdocs==1.6.1 \
  --with mkdocs-material==9.8.1 \
  --with mkdocs-awesome-nav==3.3.0 \
  --with pymdown-extensions==13.1 \
  --with "git+https://github.com/AhmedKhan-GH/organization@docs-v1.0.0#subdirectory=packages/sternbild-docs" \
  mkdocs build --strict -d build/docs-site
```
