# Pi Studio

A Windows desktop client for the [pi coding agent](https://github.com/earendil-works/pi-mono), built for engineers who bring their own model endpoints. Pi Studio wraps the pi agent runtime in an Electron shell with a React interface, adds a hardened security model on top of it, and runs multiple agent backends side by side — one conversation per workspace, several workspaces at once.

Pi Studio is a source fork of `earendil-works/pi-mono`. It is not published to npm; it ships as a portable Windows executable and tracks upstream through periodic snapshot merges (currently pi v0.82.1).

---

## Design constraints

Four product invariants shape every technical decision in this package:

1. **Catalog-free, bring-your-own-endpoint.** The bundled backend ships no built-in provider catalogs and performs no catalog network refresh; the only models that exist are the ones declared in the user's `models.json`. There is no first-party OAuth. A build-time guard (`scripts/build-backend.mjs`) fails the build if catalog code reaches the bundle, and `src/backend-scope.js` enforces the boundary at runtime.
2. **Portable, self-contained distribution.** One unpacked directory, no installer, no registry writes. All profile state relocates under a single user-data directory that tests can redirect (`PI_STUDIO_USER_DATA_DIR`).
3. **Small supply-chain surface.** Exact-pinned dependencies, a self-drawn icon set instead of an icon library, renderer-origin network access blocked outside user-entered sandboxed browser frames, and a strict main-process IPC allowlist. Dev-dependency additions are treated as security decisions.
4. **Bilingual by construction.** Every user-facing string carries English and Simplified Chinese inline (`t(en, zhCN)`); the language follows the OS with a manual override.

## Architecture

Three processes, two protocol layers:

```
┌─────────────────────────────┐   contextBridge    ┌──────────────────────────┐
│  Renderer (React 19, Vite)  │ ◄────────────────► │  Electron main (plain JS) │
│  renderer-next/  ~22k LOC   │   typed IPC only   │  src/main.js + modules    │
└─────────────────────────────┘                    └────────────┬─────────────┘
     sandbox: on, contextIsolation: on,                         │ JSONL RPC over stdio
     nodeIntegration: off, remote frames sandboxed              ▼
                                             ┌─────────────────────────────────┐
                                             │  pi-studio-backend.exe (Bun)    │
                                             │  pi agent runtime, RPC mode     │
                                             │  one process per running task   │
                                             └─────────────────────────────────┘
```

- **Renderer** (`renderer-next/`): React 19 + Zustand. All backend traffic goes through `src/ipc/api.ts`, which implicitly routes to the active task. State is single-conversation (`AppState`) plus a lightweight per-task registry for parallel tasks.
- **Electron main** (`src/`): owns windows, dialogs, git and filesystem access, and the backend process pool. Every backend child is a `BackendHandle` (stdout JSONL reassembly, request correlation, restart backoff with budget, per-process mutation queue); `task-registry.js` maps tasks to handles and enforces the pool policy.
- **Backend** (`packages/coding-agent`, compiled with Bun): the pi agent runtime in RPC mode — sessions, tools, extensions, model I/O. The desktop process speaks newline-delimited JSON over stdin/stdout; events stream back tagged with their `backendId`.

### Parallel tasks

The flagship capability: several agent runs at once, each in its own workspace with its own backend process.

- The **task registry** (main process) caps the pool (default 3), allocates stable ids, enforces one running task per folder, and lazily spawns `BackendHandle`s.
- **Events are tagged** with their originating backend. The renderer routes them: the active task feeds the full conversation pipeline; background tasks only update summaries — a streaming indicator, an unread counter, a completion state with a toast and an OS notification.
- **Switching is hydration, not restart.** Activating a task re-pulls its state over RPC (the same battle-tested path used for workspace switches); no process is stopped, and background runs continue uninterrupted. The backend session file remains the single source of truth, so nothing is lost mid-stream.
- **Same-repository isolation:** picking a folder that is already running provisions a `git worktree` on a fresh `task/<name>` branch under the app's data directory — several agents work one repository without touching each other's files. Git and workspace IPC follows the active task, so a worktree task commits, pushes, and opens pull requests on its own branch from inside the app; stopping the task removes a clean worktree (a worktree with changes is kept, never forced) while the branch stays for review and landing. Trust follows the repository identity — a trusted repo's worktrees start trusted — and kept worktrees are listed and deletable under Settings → Agent. Non-git folders refuse a second concurrent task.
- **Lifecycle:** the pool cap (1–5) and the idle window are settings; a task whose backend has been silent past the window stops itself — never the task being viewed, never the primary — and its session reopens instantly from the on-disk session file.

### Security model

Pi Studio assumes the workspace may be hostile (a cloned repository) and the renderer may be compromised:

| Layer | Enforcement |
| --- | --- |
| Renderer confinement | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; top-level navigation and window-open are denied and routed through a protocol-checked external opener, while user-entered HTTP(S) previews stay inside a sandboxed frame |
| IPC allowlist | The main process forwards only the renderer's typed command set to the backend (`backend-command-allowlist.js`); unknown command types are rejected before they reach the RPC layer |
| Tool approval | A bundled inline extension registers the `permission-mode` flag and gates every tool call at the agent loop's single choke point: `full` runs everything, `auto` asks before risky bash and out-of-workspace writes, `ask` asks always |
| Project trust | Folders carrying project-local resources (`.pi` extensions, settings, skills) load **untrusted by default**; extensions do not execute until the user trusts the folder (persisted in `<agentDir>/trust.json`, revocable from Settings, hot-reloaded both ways) |
| Process hygiene | All git and gh invocations use `execFile` with argument vectors — no shell anywhere; branch names and commit messages are validated before they become argv entries |
| Path containment | Reveal/open operations resolve and verify paths against the workspace root before touching the shell |

### Git integration

The top-bar git panel covers the full local flow without leaving the app: status with ahead/behind, staged-all commits, push with automatic upstream creation, branch list/switch/create, and pull-request creation through the GitHub CLI (explicit `--repo/--head/--base`, non-interactive) with a pre-filled compare-page fallback when `gh` is absent. Remote parsing understands https/ssh/scp forms and GitHub Enterprise hosts.

### Sessions

Sessions are append-only JSONL files owned by the backend. The client adds import (validated, size-capped, collision-free copy into the sessions directory, then an in-place switch) and export (save-dialog copy of any backend-listed session), plus reveal, trash, clone, fork navigation, and cross-workspace listing.

## Development

Prerequisites: Node 24+, Bun 1.3+, git. All commands from the repository root unless noted.

```sh
npm install --ignore-scripts
node node_modules/electron/install.js   # electron postinstall is skipped by --ignore-scripts
npm run hydrate:model-data              # model metadata (data/ is gitignored)
```

Everyday loop (from `packages/desktop`):

```sh
npm run build:backend    # compile the Bun backend  (must run via npm, not node)
npm run dev:renderer     # Vite dev server; PI_DEV=1 electron . attaches to it
npm start                # build backend + launch the packaged renderer
```

Verification (the bar for every change):

```sh
npm run check            # repo root: biome + pinned-deps + shrinkwrap + tsgo
npm test                 # packages/desktop: main-process unit suite (node:test)
npm run check:main       # packages/desktop: type-check the main process (checkJs, strict)
npx vitest run           # renderer-next: renderer suite
npm run test:e2e         # packages/desktop: end-to-end suite
```

### Testing strategy

Two layers, no middle:

- **Pure-logic unit tests** — every non-trivial behavior lives in a pure module tested without Electron (git argv construction, trust rules, task routing, import validation, restart backoff). Main-process modules use `node:test`; renderer modules use Vitest.
- **End-to-end tests** — the real Electron app, the real compiled backend, and a deterministic faux OpenAI-compatible provider on loopback, driven by Playwright. The suite covers the prompt round-trip, live tool streaming, permission denial, project-trust gating (an untrusted extension provably never runs), the full git flow against a local bare remote, and dual-backend parallel streaming with mid-stream switching. Native dialogs are stubbed at the Electron API layer; the faux provider supports content-matched scripted steps and held-open streams for cross-backend determinism.

There is deliberately no jsdom/component-render layer: interaction coverage belongs to the e2e suite, which exercises the real compositor, preload, and IPC chain.

Continuous integration runs both layers on every push (`CI` on Linux, `Desktop E2E` on Windows with the packaged offline build).

## Upstream policy

The fork root is an upstream commit, so upstream releases merge as plain three-way merges (`git merge --squash vX.Y.Z`). The private surface is kept deliberately small: fork-added behavior concentrates in `packages/desktop`, a handful of `custom-*` modules in `packages/ai`, and the RPC desktop contract. Full SDK-ization is blocked while the published pi package does not export the session-runtime internals the backend needs.

## Roadmap

Near-term: none — the roadmap through pool lifecycle, worktree ergonomics, and full-strict main-process type checking has landed.

Deliberately deferred: code signing and auto-update, installer distribution, backend size reduction (~100 MB Bun runtime), macOS/Linux, additional locales.

## License

Inherits the upstream pi-mono license. Pi Studio is an independent fork and is not affiliated with or endorsed by Earendil Works.
