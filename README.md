<p align="center">
  <img alt="Pi Studio Dev" src="packages/desktop/assets/brand-icon.svg" width="112">
</p>

<h1 align="center">Pi Studio Dev</h1>

<p align="center">
  A Windows-first desktop workspace for the Pi coding agent.
</p>

<p align="center">
  <a href="https://github.com/s1oopX/pi-studio-dev/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/s1oopX/pi-studio-dev?display_name=tag&style=flat-square"></a>
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square&logo=windows">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square"></a>
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/s1oopX/pi-studio-dev/releases/latest">Download</a> ·
  <a href="packages/desktop/README.md">Architecture</a> ·
  <a href="https://github.com/earendil-works/pi">Upstream</a>
</p>

Pi Studio Dev is an independent fork of [earendil-works/pi](https://github.com/earendil-works/pi). It keeps the upstream agent runtime, coding-agent CLI, unified model API, and terminal UI while adding a full Electron desktop client for developers who bring their own model endpoints.

## Highlights

- **Parallel agent tasks** — run several isolated conversations at once, keep background tasks streaming, and use managed Git worktrees when multiple tasks share a repository.
- **Local, SSH, and WSL workspaces** — use the same agent, Git, worktree, artifact, trust, and session flows across local and remote projects.
- **Integrated Git workflow** — inspect changes, stage and commit, push, manage branches, review diffs, and create or inspect pull requests without leaving the app.
- **Bring your own models** — configure OpenAI-compatible or custom endpoints, including quick presets for DeepSeek, Qwen, and Moonshot. The desktop backend ships without a built-in model catalog or first-party OAuth.
- **Automations and durable sessions** — schedule prompts, continue heartbeat conversations, track plans and goals, import or export sessions, and resume work from disk.
- **Developer workbench** — preview text, Markdown, HTML, images, PDF, CSV, TSV, and XLSX artifacts; use terminal tabs, image generation, computer control, and package-provided resources.
- **Security boundaries** — sandboxed rendering, context isolation, a strict IPC allowlist, tool approval modes, path containment, and project resources that are untrusted by default.
- **English and Simplified Chinese** — the interface follows the operating-system language and supports a manual override.

## Download

Download `PiStudio-Dev-*.exe` and `SHA256SUMS` from the [latest release](https://github.com/s1oopX/pi-studio-dev/releases/latest).

Current builds target 64-bit Windows 10 and Windows 11 and are distributed as a portable executable. Builds are not code-signed yet, so Windows SmartScreen may show an unknown-publisher warning. Verify the downloaded file against `SHA256SUMS` before running it.

## First run

1. Start Pi Studio Dev and add a model provider or custom endpoint in Settings.
2. Open a local folder, WSL distribution, or saved SSH host.
3. Review the workspace trust prompt and choose a tool-approval mode.
4. Create a task and start working. Additional tasks can continue in the background.

## Development

Prerequisites: Node.js 22.19+, Bun 1.3+, and Git.

```bash
npm install --ignore-scripts
node node_modules/electron/install.js
npm run hydrate:model-data
npm --prefix packages/desktop start
```

See [packages/desktop/README.md](packages/desktop/README.md) for the architecture, security model, development loop, and test commands.

## Repository layout

| Package | Purpose |
| --- | --- |
| [`packages/desktop`](packages/desktop) | Pi Studio Dev Electron application |
| [`packages/coding-agent`](packages/coding-agent) | Interactive coding-agent CLI and desktop backend |
| [`packages/agent`](packages/agent) | Agent loop, tools, and state management |
| [`packages/ai`](packages/ai) | Unified multi-provider LLM API |
| [`packages/tui`](packages/tui) | Terminal UI components and differential rendering |
| [`packages/server`](packages/server) | Server and RPC infrastructure |

## Upstream and license

The fork-specific product surface is concentrated in `packages/desktop` with a small set of compatibility changes elsewhere in the monorepo. Upstream work remains credited to [Earendil Works](https://github.com/earendil-works/pi).

Pi Studio Dev is independent and is not affiliated with or endorsed by Earendil Works. Licensed under the [MIT License](LICENSE).
