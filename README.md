# Astrolabe

One app for specialized work: specialized interfaces brought together, with agents working in them where you choose.

- `crates/astrolabe-contract`: the contract every tool implements (commands, inspection, rendering, item references).
- `crates/astrolabe`: the host. For now, the command layer: routing, history and approval gates.
- `docs/architecture.md`: the architecture and the open decisions.
- `docs/direction.md`: the product direction, requirements, layer model, and consolidation order.
- `docs/open-core.md`: internal commercial strategy. Keep it out of any public copy of the repository.
- `site/`: the landing page, deployed to GitHub Pages by `.github/workflows/pages.yml`.

```sh
cargo test
cargo run -p astrolabe
```

The earlier Electron/TypeScript build lives at `~/WebstormProjects/astrolabe`; its specifications are the requirements
for the Rust connectors.
