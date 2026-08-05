# Pi Studio

A Windows desktop client for the [pi coding agent](https://github.com/earendil-works/pi), built for engineers who bring their own model endpoints. Pi Studio wraps the pi agent runtime in an Electron shell with a React interface, adds a hardened security model on top of it, and runs multiple agent backends side by side — one conversation per workspace, several workspaces at once.

Pi Studio is a source fork of `earendil-works/pi`. It is not published to npm; it ships as a portable Windows executable and tracks upstream through periodic snapshot merges.

---

## Design constraints

Four product invariants shape every technical decision in this package:

1. **Catalog-free, bring-your-own-endpoint.** The bundled backend ships no built-in provider catalogs and performs no catalog network refresh; the only chat models that exist are the ones declared in the user's `models.json`, while optional image generation uses a separately configured BYO endpoint. There is no first-party OAuth. A build-time guard (`scripts/build-backend.mjs`) fails the build if catalog code reaches the bundle, and `src/backend-scope.js` enforces the boundary at runtime.
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
- **Same-repository isolation:** picking a local folder that is already running provisions a `git worktree` on a fresh `task/<name>` branch under the app's data directory — several agents work one repository without touching each other's files. In an SSH or WSL workspace, the add-task action instead provisions a managed worktree in that Linux environment under `~/.pi/studio/worktrees` on a fresh `task/remote-*` branch. Git, artifacts, and backend RPC follow the active local or remote task; stopping removes only a clean worktree (changes are kept, never forced) while the branch stays for review and landing. Local trust follows the repository identity — a trusted repo's worktrees start trusted — and kept local worktrees plus retained worktrees on the active remote connection are listed and explicitly deletable under Settings → Agent. Non-git folders refuse a second concurrent task.
- **Lifecycle:** the pool cap (1–5) and the idle window are settings; a task whose backend has been silent past the window stops itself — never the task being viewed, never the primary — and its session reopens instantly from the on-disk session file.

### Remote workspaces (SSH and WSL)

Settings → Connections discovers local WSL distributions and also accepts saved OpenSSH hosts. WSL connects directly through `wsl.exe` and requires no SSH server; Docker Desktop distributions are excluded from discovery. Both transports reuse the same remote backend, Git, worktree, artifact, and project-trust paths. The Install / Repair action can provision the managed runtime on Linux x64/arm64 environments that do not already have Node.js: after explicit confirmation it downloads the checksum-pinned Node.js 22.19.0 archive, installs the exact Pi version matching the Studio build with npm lifecycle scripts disabled, and writes stable runtime/package links under `~/.pi/studio`; it never uses sudo or changes the system runtime. On connect, Pi Studio streams its catalog-free Node RPC bundle and runs it against those installed dependencies and assets. Remote project extensions, settings, skills, prompts, themes, and context files use the same untrusted-by-default banner as local workspaces; decisions persist in the remote Pi agent directory and hot-reload resources in place. SSH config, agent, or identity-file authentication remains non-interactive.

### Security model

Pi Studio assumes the workspace and provider-supplied content may be hostile. The renderer is a trusted UI authority:
it can intentionally start prompts and terminal commands, mutate files, and perform Git operations, so compromising it is
equivalent to controlling the application. Electron sandboxing and the IPC allowlist reduce attack surface and contain
untrusted framed content; they are defense in depth, not an authorization boundary against compromised renderer code.

| Layer | Enforcement |
| --- | --- |
| Renderer confinement | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; top-level navigation and window-open are denied and routed through a protocol-checked external opener, while user-entered HTTP(S) previews stay inside a sandboxed frame |
| IPC allowlist | The main process forwards only the renderer's typed command set to the backend (`backend-command-allowlist.js`); unknown command types are rejected before they reach the RPC layer, but allowed commands carry the trusted renderer's authority |
| Tool approval | A bundled inline extension registers the `permission-mode` flag and gates tool calls at the agent loop's single choke point: `full` runs everything, `auto` asks before risky bash, out-of-workspace writes, computer control, and image generation, while `ask` also confirms passive screen access |
| Project trust | Folders carrying project-local resources (`.pi` extensions, settings, skills) load **untrusted by default**; extensions do not execute until the user trusts the folder (persisted in `<agentDir>/trust.json`, revocable from Settings, hot-reloaded both ways) |
| Process hygiene | Local git and gh use `execFile` argument vectors; SSH and WSL operations allow only fixed commands and quote every remote-shell argument. Branch names and commit messages are validated before they become argv entries |
| Path containment | Reveal/open operations and image-generation references/outputs verify both lexical and real paths against the workspace root. SSH artifact reads bind validation and transfer to one opened descriptor, so symlink swaps cannot escape the remote workspace |

### Git integration

The top-bar git panel covers the full flow without leaving the app: status with ahead/behind, staged-all commits, push with automatic upstream creation, branch list/switch/create, per-file and per-hunk review, and pull-request creation/review through the GitHub CLI (explicit `--repo/--head/--base`, non-interactive) with a pre-filled compare-page fallback when `gh` is absent. SSH and WSL workspaces run the same Git and `gh` operations in the remote Linux environment; untracked-file discard moves files to `~/.pi/studio/trash`. Remote parsing understands https/ssh/scp forms and GitHub Enterprise hosts.

### Artifact previews

The workbench previews text, Markdown, sandboxed HTML, images, PDF, CSV, TSV, and XLSX files with a 40 MB in-panel limit. In SSH and WSL workspaces the selected file is streamed through a non-interactive, descriptor-bound read: its physical target must remain inside the remote workspace, metadata and byte length are verified, and Open/Reveal materializes a content-addressed copy in Pi Studio's private local cache (512 MB download limit). The remote workspace is otherwise untouched.

### Automations

Scheduled tasks run independent prompts in the selected workspace or a retained git worktree, while heartbeats continue a main-process-verified conversation. The editor exposes native interval, weekday, and time controls for hourly, daily, weekday, and weekly schedules, with advanced RRULE entry for unsupported patterns. Pi package prompts can publish task name, prompt, and RRULE defaults under **From Pi packages**; created tasks retain the package link and can restore current package defaults without changing their model, destination, workspace, notifications, status, or history. Runs retain sessions, model/reasoning choices, notification policy, unread/archive state, and safe worktree cleanup. Create with Pi starts a fresh guided scheduling conversation; history can mark all unread runs as read or archive all current completed runs after confirmation.

### Plugin resources

Settings → Resources installs npm, Git, and local packages at user or project scope and hot-reloads their resources. When no Pi manifest is present, Codex plugin manifests can provide skills, commands, supported command hooks, and HTTP MCP servers. MCP packages expose a connect tool, register remote tools after connection, open the browser for OAuth when required, and persist credentials in mode-`0600` profile files. Codex apps, stdio MCP servers, unsupported hook events, and marketplace discovery remain outside the bridge.

### Sessions

Sessions are append-only JSONL files owned by the backend. The client adds import (validated, size-capped, collision-free copy into the sessions directory, then an in-place switch) and export (save-dialog copy of any backend-listed session), plus reveal, trash, clone, fork navigation, and cross-workspace listing.

## Development

Prerequisites: Node 22.19+, Bun 1.3.14, git. All commands from the repository root unless noted.

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

Pi Studio targets individual developers and small teams that bring their own model endpoints. Its core workflow is: open a local, WSL, or SSH workspace; run isolated agent tasks; review the resulting diff; commit, push, or open a pull request; and resume the session later.

User settings, model configuration, sessions, automations, trust records, and task metadata must migrate forward without silent data loss. The renderer, main process, and backend ship together, so their internal RPC contract does not retain compatibility layers and downgrade compatibility is not guaranteed.

Upstream releases are evaluated from stable tags. Security and model-protocol fixes may be cherry-picked, but Pi Studio's product boundaries take precedence over minimizing the fork diff.

Near-term: stabilize the core workflow and extend the plugin bridge only when Codex manifest, app, hook, or marketplace compatibility has a verified local use case.

Deliberately deferred: cloud accounts and sync, team permissions, hosted agents, a plugin marketplace, first-party model billing, code signing and auto-update, installer distribution, backend size reduction (~100 MB Bun runtime), macOS/Linux, and additional locales.

## License

Inherits the upstream pi-mono license. Pi Studio is an independent fork and is not affiliated with or endorsed by Earendil Works.
