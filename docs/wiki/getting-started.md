# Run Astrolabe from source

The current build runs on macOS from source. It requires:

- macOS
- Git
- Node.js 24
- Corepack

## 1. Clone the repository

```bash
git clone --branch rebuild --single-branch https://github.com/AhmedKhan-GH/astrolabe.git
cd astrolabe
```

## 2. Install dependencies

```bash
corepack enable
pnpm install
```

## 3. Start the desktop app

```bash
pnpm dev
```

On first launch, Astrolabe creates the local workspace and starts a sync. Use the **Sync** button after starting or changing a source app.

Continue with [Connectors](using/connectors.md) to prepare Zotero, Obsidian, or Eagle.

## Useful source checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

These commands type-check both processes, run the unit/component and integration suites, and build the Electron main, preload, and renderer bundles. They do not create a public installer.

See [Current limitations](reference/limitations.md) for the boundaries of the current build.
