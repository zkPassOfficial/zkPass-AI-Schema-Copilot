# Contributing

Thanks for your interest in contributing to zkPass AI Schema Copilot.

## Development setup

Requirements: Node.js >= 18 and npm.

```bash
npm install      # install dependencies
npm run dev      # Vite dev server with HMR
npm run build    # production build into dist/
```

Load the unpacked extension from the `dist/` directory via `chrome://extensions` → enable Developer mode → `Load unpacked`. See the [README](README.md#development) for details.

## Before opening a pull request

Run the checks locally and make sure they pass:

```bash
npm run typecheck   # tsc --noEmit (strict mode)
npm run lint        # ESLint (flat config)
npm run build       # full CRX build
```

There is no automated test suite yet; rely on `typecheck` + `lint` + a manual smoke test (configure a provider → capture on a site → generate a schema → verify).

## Code standards

- TypeScript strict mode is on (`noUnusedLocals`, `noUnusedParameters`). Do not leave unused imports or variables.
- Background code (`src/background/`) runs in a service worker: no `window` or DOM access.
- Tailwind classes are scoped to `src/sidepanel` and `src/options` only.
- Import internal modules via the `@/*` alias (e.g. `@/shared/...`).
- The existing source uses double quotes and is not Prettier-formatted; do not run a blanket `npm run format`. Format only the files you changed.
- Keep comments in English and focused on non-obvious intent.
- Never hardcode API keys or secrets. The AI configuration is read from `chrome.storage` only.

## Commit and PR guidelines

- Use clear, conventional-style commit messages (e.g. `feat:`, `fix:`, `docs:`, `refactor:`).
- Keep PRs focused and describe the change, the reason, and how you verified it.
- Update the README or relevant docs when behavior changes.

## Reporting bugs and requesting features

Open a GitHub issue with steps to reproduce (for bugs) or a clear use case (for features). For security issues, do not open a public issue — see [SECURITY.md](SECURITY.md).
