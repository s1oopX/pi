# Codex Desktop Parity Audit

Status: living document · Last verified against public Codex information 2026-07 (see sources)

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
| Inline diff comments → ask the agent to address | "Ask agent" on a file's diff drafts an @file prompt | 🟡 file-level landed; chunk/line comments open |
| GitHub PR review comments in-app (PR Chat) | — | ❌ heavy (GitHub API + auth); deliberate non-goal for now |
| Multiple terminal tabs | Single workbench terminal | ❌ candidate |
| Task sidebar: live plan/sources/artifacts | Live tool cards, turn summary, streaming status | 🟡 partial (no plan pane) |
| Summary pane | Turn summary | ✅ |
| Session naming/rename, thread search | Inline rename (double-click), search | ✅ |
| Copy last reply, per-message copy | Command palette + Mod+Shift+C; hover copy | ✅ |
| What's-new/changelog view | About → What's New | ✅ |
| Drag-drop folder to open; drop narration | Window-level drop + narration overlay | ✅ |
| Contextual window title | session — app | ✅ |
| In-app browser for frontend iteration | Workbench browser actions (open URLs) | 🟡 partial (no embedded browser) |
| Artifact viewer (PDF/spreadsheet outputs) | — | ❌ low priority (rare output shape here) |
| Computer use / plugins / memory / image generation | — | ➖ platform-scope non-goals for a BYO-endpoint client |
| SSH remote devboxes | — | ➖ non-goal (local-first product) |
| Automations / scheduled tasks | — | ❌ candidate (long-term; backend cron-like runs) |

## Loop backlog (ordered)

1. Multiple terminal tabs in the workbench.
2. Plan pane fed from turn structure.
3. Line-anchored diff comments feeding the agent prompt.

Sources: [OpenAI — Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/), [SmartScope — Codex desktop April 2026 update](https://smartscope.blog/en/generative-ai/chatgpt/codex-desktop-major-update-april-2026/), [Codex KB — workspace/review pane](https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/), [Macaron — Codex review pane guide](https://macaron.im/blog/codex-app-review-pane), [Releasebot — Codex updates July 2026](https://releasebot.io/updates/openai/codex)
