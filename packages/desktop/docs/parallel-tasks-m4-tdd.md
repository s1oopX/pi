# Parallel Tasks M4 — Pool Lifecycle (TDD Plan)

Status: **LANDED 2026-07-26** · Prereq: M3 landed · Companion: `parallel-tasks-design.md` §3.4

Scope: idle reaping and pool settings. Row enrichment was dropped —
`session_changed` carries no session name, so it would cost per-task RPC
polling for cosmetic value.

Decisions:

1. **Idle = no backend traffic.** A handle's `lastActivityAt` bumps on every
   outgoing request and every parsed stdout line; streaming, tool runs, and
   user prompts all count. Renderer-side reading does not — so the reaper
   **never touches the renderer's active task** (the renderer reports switches
   through a fire-and-forget `task:activate`), and never the primary.
2. **Reaping is a normal stop**: the shared stop path (exit wait + worktree
   remove-never-forced) runs, then a `task:changed` push tells the renderer to
   refresh and toast. Session files make resume cheap by design.
3. **Settings live in the main process** (`<userData>/task-settings.json`):
   `maxTasks` (1–5, default 3) and `idleMinutes` (0 = never, default 30).
   The registry cap becomes mutable; `task:list` reports the live cap so the
   sidebar's full-pool state follows the setting.
4. **Test hook:** `PI_STUDIO_IDLE_REAP_MS` overrides the idle window and
   shortens the sweep interval so the e2e can observe a reap in seconds
   (precedent: `PI_STUDIO_USER_DATA_DIR`).

Increments (red → green):

- **A1** BackendHandle `lastActivityAt` (injectable clock) — extend
  `test/backend-handle.test.js`.
- **A2** Registry `listIdle(now, idleMs)` (pool only, never primary) and
  mutable `setMaxTasks`/`getMaxTasks` — extend `test/task-registry.test.js`.
- **A3** main.js: settings load/save, `task:get-settings` / `task:configure` /
  `task:activate` IPC, shared `stopTaskAndCleanup`, sweep interval with the
  env override, `task:changed` push. Electron-bound → covered by the e2e.
- **B1** Renderer plumbing: api wrappers, `setActiveBackendTask` reports to
  main, `task:changed` subscription → refresh + toast, dynamic pool cap in
  the registry state — vitest on the cap logic.
- **B2** Settings → Agent: "Parallel tasks" block (pool size, idle timeout).
- **C** e2e `idle-reap.test.js`: env-shortened window; a backgrounded task
  disappears on its own while the active primary stays; a worktree task's
  worktree is removed by the reap.
- **D** CHANGELOG, README roadmap, design §3.4 landed note, memory.
