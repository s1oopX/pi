# Parallel Running Tasks — Design (P2)

Status: proposal for review · Owner: desktop · Last updated: 2026-07-26

The flagship gap against the Codex desktop app: Pi Studio can hold many
threads, but only one can *run* at a time, because the whole client speaks to a
single `pi-studio-backend.exe`. This document proposes a bounded multi-backend
process pool so several agent tasks stream concurrently, and stages the work so
each milestone lands green on its own.

## 1. Where we are

- `src/main.js` owns exactly one backend child. All of its state is
  module-level singletons: `backend`, `backendBuffer`, `pendingRequests`,
  `requestCounter`, `backendReady`/`backendStarting`, restart bookkeeping, the
  session mutation queue, and the pending extension-UI store.
- The backend process is single-session by construction: the RPC session in
  `rpc-mode.ts` is one `session` per process. Concurrency inside one process is
  not on the table without a deep upstream rewrite — parallelism must come from
  more processes.
- Workspace switch (`workspace:open`) stops and restarts the backend in the new
  cwd. "Tasks" in the sidebar are just sessions whose cwd lives under
  `userData/tasks`; they run on the same single backend, one at a time.
- Renderer state (`store`) models one active conversation: one `session`, one
  `isStreaming`, one message list, one event stream (`backend:event`).

## 2. Goal and non-goals

Goal: N tasks (default cap 3) each bound to its own backend process, running
and streaming at the same time; the user switches freely between them; a crash
or restart in one task never touches the others; approvals and toasts say which
task they belong to.

Non-goals (this cycle): multi-window; running two tasks *in the same working
tree* without isolation (phase M3 adds git-worktree isolation); mac/linux;
changing the RPC wire contract (multiplexing happens entirely in the desktop
main process — a pool member still speaks plain single-session JSONL).

## 3. Design

### 3.1 BackendHandle (M1 — pure refactor)

Extract every module-level singleton in `main.js` that belongs to *a* backend
into a `BackendHandle` class (plain JS first; the batch-3 "TS-ify main.js"
leftover can ride along or follow):

```
class BackendHandle {
  id            // stable string, "main" for the primary
  cwd           // workspace the child was spawned in
  child         // spawned process or undefined
  buffer/bytes  // stdout JSONL reassembly
  pendingRequests, requestCounter
  ready, starting, restartAttempts, retryAt, stderrTail
  mutationQueue // per-backend session mutation queue
  pendingExtensionUIRequests
  request(command, opts)   // today's requestBackend
  send(command)            // fire-and-forget path
  start(), stop(), restart()
  onEvent(payload)         // forwards tagged events to the renderer
}
```

`main.js` keeps a `backends = Map<backendId, BackendHandle>` plus
`primaryBackendId`. Every existing IPC handler resolves the primary handle, so
behavior is unchanged and the whole e2e suite must stay green with zero renderer
changes. This is the risky-diff milestone; everything after it is additive.

Renderer-facing events gain a tag: `backend:event` / `backend:status` /
`backend:log` payloads carry `backendId`. The preload stays a pass-through.
Old renderer code reads the payload fields it already knows; the tag is
ignored until M2.

### 3.2 Task pool and routing (M2)

New main-process registry mapping tasks to backends:

- `task:create { cwd }` → picks a free pool slot (cap default 3, setting), does
  `new BackendHandle(id, cwd).start()`, returns `{ taskId }`. The primary
  workspace backend is task 0 and always exists.
- `task:list` → `[ { taskId, cwd, ready, streaming, sessionName, unread } ]`.
- `task:stop { taskId }` → graceful `stopBackend()` for that handle; the
  session file survives, so the thread reopens later on any backend.
- Existing single-backend IPC (`backend:request`, `git:*`, `workspace:*`)
  gains an optional `taskId` argument resolved through the registry; omitted →
  primary, so the current renderer keeps working mid-migration.

Renderer store becomes keyed: `tasks: Record<taskId, TaskSlice>` where
`TaskSlice` holds what the store holds today (session, messages, streaming and
tool state). `activeTaskId` selects the rendered slice; the composer, message
list, workbench, and status bar read the active slice only. Events dispatch by
`payload.backendId`. Background slices still ingest events so unread counts and
completion state are correct when the user switches back.

Sidebar: the Tasks section shows running tasks with a live activity dot and an
unread badge; clicking switches `activeTaskId` (no backend restart — this is
the headline UX win over today's switch-and-restart). Completion of a
background task fires a toast + optional OS notification.

Approvals: `extension_ui_request` events are already correlated by id in the
per-backend pending store; the dialog surfaces the owning task's name. A
background task waiting on approval shows a badge on its sidebar row.

### 3.3 Same-repo isolation (M3) — LANDED 2026-07-26 (see parallel-tasks-m3-tdd.md)

Two tasks in one repository must not fight over the working tree. Reuse the
existing git plumbing (`git-commit.js` patterns) to offer, at `task:create`
time for a cwd that is already claimed by a running task:

- `git worktree add <userData>/worktrees/<taskId> -b task/<name>` (validated
  branch name, no shell), spawn the backend in the worktree;
- on task completion, the GitPanel commit/push/PR flow already covers landing
  the branch; `git worktree remove` on task close (keep on crash for forensics).

Non-git folders: refuse a second concurrent task with a clear message.

### 3.4 Limits and hygiene

- Pool cap (default 3, max 5) — each Bun backend is ~100-200 MB RSS; the
  deferred "replace 105 MB Bun exe" size work multiplies in value here.
- Idle reaping: a non-primary backend with no activity for 30 min stops itself
  (session files make resume cheap).
- Shared agentDir is mostly read-only per process; `trust.json` already uses a
  lockfile. Audit before M2: `models.json` (read-only — fine), auth storage and
  settings writes (serialize through one writer or accept last-write-wins),
  per-cwd session dirs (already distinct paths, no collision).
- Shutdown: `app.will-quit` iterates the registry and kills the whole tree
  (`taskkill /T` equivalent already used for the single child — verify).

## 4. Milestones

| M  | Deliverable | Proof |
| -- | ----------- | ----- |
| M1 | `BackendHandle` extraction, events tagged, zero behavior change | full e2e suite green unchanged |
| M2 | pool + `task:*` IPC + keyed store + sidebar switching, different-workspace parallelism | e2e: two faux-provider backends stream interleaved; switching mid-stream loses nothing |
| M3 | same-repo worktree isolation + merge-back via GitPanel | e2e: two tasks in one repo, disjoint edits, both branches push |
| M4 | notifications, idle reaping, pool settings UI | unit tests + manual |

M1 is the prerequisite for everything and is safe to start immediately; M2 is
where the feature becomes visible; M3 is the differentiator.

## 5. Open questions (decide at M2 start)

1. Does the composer allow prompting a *background* task directly, or must the
   user switch first? (Proposal: switch first — simpler mental model.)
2. Are task backends spawned eagerly at app start for pinned tasks, or always
   lazily? (Proposal: lazily.)
3. Cap policy when the pool is full: queue the `task:create` or refuse with
   "stop a task first"? (Proposal: refuse with the list of running tasks.)
