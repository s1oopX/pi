# Codex Desktop Parity Audit

Status: living document · Last verified against Codex Desktop 26.721.4979.0 and public information 2026-07 (see sources)

Feature-by-feature comparison against the OpenAI Codex desktop app (launched
2026-02, major "Codex for (almost) everything" update 2026-04). Drives the
continuous alignment loop; one row lands per iteration.

## Matrix

| Codex capability | Pi Studio | Status |
| --- | --- | --- |
| Parallel agents, worktree isolation, project/thread organization | Task pool M1–M4: per-folder backends, same-repo worktrees, idle reaping | ✅ parity+ (idle reaping is ours) |
| In-app git: commit, push, branches, PR creation | Git panel + gh PR flow | ✅ |
| Review pane: per-file diffs of the working tree | Git panel file rows expand to a diff | ✅ (this audit's landing) |
| Review pane: discard/revert per file | Armed two-click discard; HEAD files restored, new files recycled (recoverable) | ✅ (this audit's landing) |
| Review pane: stage/revert per **chunk** | Staged/unstaged sections with stage, unstage, and armed discard per hunk; main process re-reads and hash-validates every patch | ✅ |
| Inline diff comments → ask the agent to address | Select an old/new line number, write a review comment, and draft the exact file/section/line context into the composer | ✅ |
| GitHub PR review comments in-app (PR Chat) | The Git panel loads current-branch PR comments, review summaries, and inline threads through authenticated `gh`; it posts general comments, replies to threads, shows resolved/outdated state, resolves or reopens threads, opens source items on GitHub, and drafts file/line-scoped agent handoffs | ✅ |
| Multiple terminal tabs | Concurrent workbench tabs with preserved output/drafts/history and per-command Stop | ✅ |
| Task sidebar: live plan/sources/artifacts | Workbench Plan reads the latest real `update_plan` tool call; Sources de-duplicates cited HTTP(S) links; Artifacts tracks written, edited, and linked workspace files | ✅ |
| Persistent thread goals | Bundled create/get/update tools persist goal state in the session branch, inject active objectives across turns, account for elapsed/token-budget usage, and resume blocked work on the next direct user message | ✅ core parity |
| Summary pane | Turn summary | ✅ |
| Session naming/rename, thread search, pinning, archiving | Inline rename (double-click), server-backed search, persistent pin ordering, and a searchable archived/restore view | ✅ |
| Copy last reply, per-message copy | Command palette + Mod+Shift+C; hover copy | ✅ |
| What's-new/changelog view | About → What's New | ✅ |
| Drag-drop folder to open; drop narration | Window-level drop + narration overlay | ✅ |
| Contextual window title | session — app | ✅ |
| In-app browser for frontend iteration | Sandboxed HTTP(S) frame with URL navigation, back/forward, reload, and external fallback | ✅ |
| Artifact viewer (PDF/spreadsheet outputs) | Inline text, Markdown, HTML, image, PDF, CSV, TSV, and XLSX preview with worksheet selection, truncation notices, source toggle where applicable, refresh, open, reveal, and copy-path actions; legacy `.xls` opens in the system app | ✅ core preview; legacy `.xls` delegated |
| Computer use | Built-in Windows screenshots and input control with bounded coordinates, typed-text redaction, fresh post-action screenshots, and permission-mode approval | ✅ core bridge; Windows only |
| Installable plugin bundles | Settings → Resources installs, updates, lists, and removes npm/Git/local Pi packages at user or project scope, then hot-reloads bundled extensions, skills, prompts, and themes with diagnostics. Install/update is explicitly confirmed because package code has full system access. | 🟡 core bridge; Pi package format is supported, not Codex plugin manifests, apps, hooks, or marketplace metadata |
| Memory | Settings → Memory: local bounded memory file, global opt-in, tool-chat generation control, per-chat Use/Generate switches, reset, and `/memories` shortcut | 🟡 local bridge; Codex account/cloud synchronization is not included |
| Image generation | Opt-in BYO OpenRouter-compatible endpoint/model/key, workspace-contained references and outputs, approval gating, and Artifact collection | 🟡 BYO bridge; no hosted Codex image service |
| SSH/WSL remote devboxes | Settings → Connections discovers local user WSL distributions (excluding Docker Desktop), connects directly through `wsl.exe` without an SSH server, and also persists/tests/connects OpenSSH targets. Both transports stream the catalog-free Studio Node RPC backend into the Linux environment, which owns the agent, shell, credentials, sessions, workspace, full Git panel, and isolated parallel worktrees while retaining the desktop trust/approval/plan/goal contract. Artifact preview/open/reveal streams only the selected file through a descriptor-bound containment check into a bounded private local cache. Settings → Agent lists retained managed worktrees from the active connection, reports dirty state, and explicitly removes them while preserving task branches. Install / Repair bootstraps a checksum-pinned private Node.js runtime and the exact matching Pi package on Linux x64/arm64 without sudo. Project extensions and related resources remain disabled until the user stores a trust decision in that environment; trusting or revoking hot-reloads them in place | ✅ core parity; direct WSL and OpenSSH transports landed |
| Automations / scheduled tasks | Persistent RRULE cron tasks and bound-conversation heartbeats with structured Repeat / On / At controls for hourly, daily, weekday, and weekly schedules, plus advanced RRULE fallback, loaded Pi prompt templates, per-automation model/reasoning, local or dedicated-worktree destinations, notifications, run triage, and reopenable sessions. Create with Pi starts a fresh guided scheduling conversation; history supports Mark all as read and confirmed Archive all actions. Heartbeats bind main-process-verified session metadata, reuse an existing owning backend when available, and lock the target session while running; worktree cleanup preserves local changes. | 🟡 near parity; the remaining verified gap is plugin scheduled-task templates and Reset to plugin defaults |

## Loop backlog (ordered)

1. Add plugin-provided scheduled-task templates and Reset to plugin defaults, the remaining verified Automations gap.
2. Extend the plugin bridge only when Codex manifest/app/hook compatibility has a verified local use case.
3. Revisit inline legacy `.xls` preview only if the system-app fallback proves insufficient.

Sources: [OpenAI Codex — Plugin structure](https://developers.openai.com/codex/plugins/build#plugin-structure), [OpenAI Codex — Automations](https://developers.openai.com/codex/app/automations#thread-automations), [OpenAI — Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/), [SmartScope — Codex desktop April 2026 update](https://smartscope.blog/en/generative-ai/chatgpt/codex-desktop-major-update-april-2026/), [Codex KB — workspace/review pane](https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/), [Macaron — Codex review pane guide](https://macaron.im/blog/codex-app-review-pane), [Releasebot — Codex updates July 2026](https://releasebot.io/updates/openai/codex)
